# @670send/admin — the back office (`admin.670send.tl`)

Staff console for 670Send: executive dashboard, shipments, hub consolidation & manifest dispatch, partners & MoU, finance / deposits / fleet payouts, CS & claims desk with side-by-side photo evidence, localized tariff matrix, WhatsApp template editor, RBAC & audit. **Four languages everywhere** — Tetun (default and fallback), Português, English, Indonesia — switchable from every screen, saved to the user's profile.

React 19 · Vite 7 · `use-intl` · React Router 7 · Tailwind 4. It is a static single-page app: **no secrets** (only `VITE_API_URL`, compiled in), all authority stays in the API.

## Run it

```bash
cp .env.example .env.local        # VITE_API_URL=http://localhost:4010 (the API must list http://localhost:3102 in CORS_ORIGINS)
pnpm --filter @670send/admin dev  # http://localhost:3102 (strict port)
```

Sign in with a staff account (`email` + password). Accounts created or reset by an admin carry a *temporary* password and see only the **Choose a new password** screen until it is replaced; the change signs everyone out, so sign in again afterwards. Field accounts (agent, courier, driver) and fleet owners are told this console is for staff.

## Verify it

```bash
pnpm --filter @670send/admin typecheck
pnpm --filter @670send/admin test       # 67 tests (jsdom, API stubbed with a fetch router)
pnpm --filter @670send/admin build
pnpm --filter @670send/admin smoke      # checks the BUILT app: chunks, budget, no third-party code, session rules
```

## Map

| Route | Screen | Needs (any of) |
|---|---|---|
| `/` | Dashboard + CSV exports | `dashboard:view` |
| `/shipments` | Search, timeline, reminders, status override | `shipments:read_all` |
| `/hubs` | Receive · master bags · manifests · pick-ups | `hubs:read` `master_bags:read` `manifests:read` `pickups:read` |
| `/partners` | Fleet & MoU · vehicles & drivers · agents & couriers · compliance alerts | `fleet_partners:read` `agents:read` `couriers:read` `vehicles:read` `drivers:read` |
| `/finance` | Deposits · payouts · wallets & ledger · reconciliation & refunds | `deposits:read` `payouts:read` `wallets:read_all` `ledger:read` `reconciliation:run` |
| `/claims` | Claims · arrival incidents · return to sender | `claims:read` `incidents:read` `rts:manage` |
| `/tariffs` | Zones (4-language names + ETA), add-ons, surcharges | `tariffs:read` (edit: `tariffs:manage`) |
| `/templates` | Templates (11 × 4 languages), delivery log | `templates:manage` `notification_logs:read` |
| `/access` | Users · roles & permission matrix · settings | `users:manage` `rbac:manage` `settings:manage` |
| `/audit` | Audit log with before/after | `audit:read` |

Inside a screen each tab and button checks its own permission again. The API is always the authority: a hidden button is a courtesy, a refused call is shown with the API's own translated message.

## Decisions worth knowing

* **Four-eyes is visible.** The Approve button is disabled on a deposit or payout you created. The API checks by *person* and is authoritative (`self_approval_forbidden`).
* **Idempotent money.** Deposit approval, payout/claim payment, refunds and payout generation send an `Idempotency-Key` bound to the payload (`src/lib/idempotency.ts`): a retry after a dropped connection reuses it, a real answer from the server ends the attempt.
* **Bank details on demand.** Masked everywhere; the full number appears only after a warned click, and the API audits every reveal.
* **Session in `sessionStorage`** (ends with the tab), access token in memory, single-flight refresh. A refresh whose answer is lost and retried after the server's 10-second grace window is treated as token theft and ends the session — you will see *session expired*.
* **Díli days → UTC.** Range filters take UTC timestamps only; `diliDayStartIso` / `diliDayEndIso` convert a calendar day.
* **Hubs and municipality → hub** come from `@670send/types` (no API endpoint exists).
* **Photo evidence** uses short-lived signed URLs (≈ 5 minutes): the desk offers *Refresh photos*; the page sends `no-referrer`.
* Each area is its own chunk (first load ≈ 218 KB gzipped); the QR generator ships only with the hub console.

### Recommended headers for `admin.670send.tl` (Phase 8 puts them in Nginx)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<object-storage-host>; connect-src 'self' https://api.670send.tl; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow
Cache-Control: no-cache   (for /index.html;  /assets/* may be immutable)
```

`<object-storage-host>` is the host of the signed URLs (the R2/S3 endpoint) — needed for deposit slips and claim photos.

## Not verified yet

* Claim evidence with real photos, payouts end to end, manifest creation with a real fleet, template save and role editing were covered by tests against the documented contracts, **not clicked through on the live stack**. Run a UAT pass with the four back-office roles.
* No bulk actions, saved filters or real-time updates; nothing tested on Safari/Firefox.

## Open items

* Hub list endpoint, "loose parcels at a hub" filter, waybills inside a manifest bag, photos on incidents, cursors on the capped lists: listed in `docs/ARCHITECTURE.md` §10g. The console works around each without changing the API.
