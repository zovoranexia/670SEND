# @670send/api — NestJS 11 backend

Phase 2 = the platform layer (auth, RBAC, i18n, audit, idempotency, ledger, uploads).
Phase 3 = the logistics engine on top of it (pricing, intake, hubs, manifests, inbound, OTP/PoD, unclaimed worker, WhatsApp, receipts). Endpoint list: `docs/ARCHITECTURE.md` §10c.

```bash
pnpm db:up && pnpm --filter @670send/api db:migrate && pnpm db:seed     # from the repo root
pnpm --filter @670send/api start:dev                                      # http://localhost:$API_PORT/v1
pnpm --filter @670send/api test                                           # 181 tests, real PostgreSQL (+ Redis if up)
```

Environment is validated at boot (`src/config/env.ts`); see the root `.env.example`.
Local port clash? Set `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `S3_PORT`.

## Writing an endpoint — the checklist

```ts
@Controller('shipments')
export class ShipmentsController {
  @RequirePermissions('shipments:create')          // REQUIRED: routes without it are denied (403)
  @Idempotent()                                    // money / intake: Idempotency-Key header
  @Audit('SHIPMENT_CREATED', 'shipment')           // immutable audit row after success
  @Post()
  create(@CurrentActor() actor: Actor,
         @Body(new ZodValidationPipe(createShipmentSchema)) body: CreateShipmentDto) { … }
}
```

| Need | Use |
|------|-----|
| Anyone signed in | `@Authenticated()` |
| No login (login, tracker, health) | `@Public()` — sparingly |
| All / any of several permissions | `@RequirePermissions(a, b)` / `@RequireAnyPermission(a, b)` |
| Resource ownership (`agent_id`…) | `assertCanAccess(actor, { agentIds: [s.originAgentId, s.destAgentId] }, 'shipments:read_all')` → 404 for strangers |
| Force-override | `@AuditReasonRequired()` (+ `X-Audit-Reason` header or `body.reason`) |
| Add before/after to the audit row | `RequestContext.audit({ entityId, before, after })` |
| Audit row in the same DB transaction | `AuditService.writeInTx(tx, …)` — preferred for critical changes |
| Localized error | `throw new AppException('some_code', 422, { param })` + add `errors.some_code` to all 4 locales in `@670send/i18n` (a test fails if any language is missing) |
| Validation | Zod schema from `@670send/validation`; messages that are i18n keys are translated automatically |

## Money — always through the ledger

```ts
await this.prisma.$transaction(async (tx) => {
  const shipment = await tx.shipment.create({ … });
  await this.uploads.consumeForShipment(tx, { uploadIds, shipmentId: shipment.id, actorId });   // 2-photo gate
  await this.ledger.post({ referenceType: 'SHIPMENT_INTAKE', referenceId: shipment.id,
    idempotencyKey, lines: [ …debits and credits that net to zero… ] }, tx);                    // same tx
});
```

* Amounts: strings / `Prisma.Decimal` with ≤ 4 decimals — never JS numbers.
* A wallet (other than `EXTERNAL_CLEARING`) can never go negative or spend `locked_balance`.
* Fix mistakes with `ledger.reverse(txnId, { reason })`; ledger rows cannot be updated or deleted.
* `ledger.reconcile()` must always return `ok: true` — wire it to the Finance screen and an alert.

## Languages

Precedence per request: **`X-Lang`** (language switcher) → signed-in user's **`preferred_lang`** → **`Accept-Language`** → **Tetun**.

## Logistics building blocks

| Need | Use |
|------|-----|
| Price + canal for a parcel | `PricingService.quote()` (pure rules in `@670send/pricing`) |
| Next waybill number | `WaybillService.next(tx, orig, dest)` — atomic, rolls back with the intake |
| Change a tracking status | `ShipmentStateService.transition(tx, id, to, {…})` — state machine + optimistic lock + immutable event |
| Send a WhatsApp | `NotificationsService.notifyShipment(id, EVENT, ['SENDER','RECIPIENT'], vars)` — never throws, deduped, localized |
| Release money | `SettlementService` (`releaseFleetShare`, `releaseDestinationShares`, `collectStoragePenalty`) |
| Pickup OTP | `OtpService.issue(tx, id)` / `verify(id, otp)` (HMAC, attempts, lock) |
| Background job | `QueueService.registerHandler(name, fn)` + `enqueue()` (inline when `QUEUES_ENABLED=false`) |
| Re-run the unclaimed sweep for one parcel | `UnclaimedService.sweep(now, { onlyIds: [id] })` |

## Admin, finance & claims building blocks (Phase 4)

| Need | Use |
|------|-----|
| Credit a deposit / refund / pay a payout | `FinanceService` / `PayoutsService` — always one ledger transaction with a deterministic idempotency key (`deposit:<id>`, `refund-addon:<id>`, `claim-pay:<id>`) |
| Maker-checker rule | compare **user ids** (`creator.id !== approver.id`), never roles |
| Claim liability cap | `ClaimsService.liabilityPreview(actor, waybill)` — the same function the filing screen calls |
| Generate payouts | `PayoutsService.generate(actor, { cycle \| fleetPartnerId }, idempotencyKey)` (manual) · `generateDue(cycle)` (06:00 Asia/Dili scheduler, runs as the technical system user) |
| A scheduled job | `QueueService.registerSchedule(id, cron, jobName)` — registered on boot, timezone Asia/Dili |
| CSV download | `toCsv(header, rows)` — prefixes `= + - @ TAB CR` cells with `'`; controllers prepend a UTF-8 BOM |
| Encrypted field (bank details) | `FieldCrypto.encrypt/decrypt`; expose only masked values, audit every reveal |
| PATCH schema | write it explicitly — **never** `.partial()` a create schema that has `.default()` values (the defaults get re-applied) |
| Change a role's rights | `AccessService.setRolePermissions` — takes effect on the next request (actor cache is invalidated) |

Endpoints the field PWA relies on (all in `src/admin/directory.service.ts` / `src/logistics/manifests.service.ts`):

| Route | Purpose |
|-------|---------|
| `GET /v1/field/profile` | who the signed-in agent / courier / driver / fleet owner is and where they work (municipality, kiosk, hub, fleet); 403 for back-office users |
| `GET /v1/kiosks?municipalityCode=` | active kiosks of a municipality (id, name, address, hours — no phones) so the wizard can choose the destination kiosk (`shipments:create`) |
| `GET /v1/manifests/:code` → `incidents[]` | a driver sees the incidents of **their own** trip (they have no `incidents:read`) and confirms them with `POST /v1/incidents/:id/driver-confirm` |

New permissions: add the key to `packages/types/src/permissions.ts` (catalog + the roles that get it), rebuild `@670send/types`, and re-run the seed; the guard denies by default until you do.

## Tests

`jest` global setup creates `<db>_test` on the same Postgres server, runs `prisma migrate deploy` and the seed.
The database is DROPPED and recreated on every run (only a database named `*_test` can be dropped), so no balance or sequence leaks between runs. The dev database is never used. Photo storage is an in-memory fake and WhatsApp is the console adapter (tests read the messages like a customer would). `test/queue.spec.ts` needs Redis (`pnpm db:up`) and uses Redis database 15; it skips itself when Redis is down.

## Auth quick reference

| Route | Body | Notes |
|-------|------|-------|
| `POST /v1/auth/login` | `{ email, password }` | backoffice, fleet owners |
| `POST /v1/auth/login/pin` | `{ phone, pin }` | AGENT · COURIER · DRIVER · FLEET_OWNER only |
| `POST /v1/auth/refresh` | `{ refreshToken }` | rotates; reuse of an old token kills the session |
| `POST /v1/auth/logout` | `{ refreshToken? }` | revokes the session family |
| `GET /v1/auth/me` · `PATCH /v1/auth/me/language` | | |
| `POST /v1/auth/password/change` · `/pin/change` | | revokes all sessions |
