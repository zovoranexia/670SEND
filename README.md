# 670Send

Inter-municipality parcel logistics for Timor-Leste (14 municipalities) — Zovoranexia, Lda.
`670send.tl` · `app.670send.tl` · `admin.670send.tl` · `api.670send.tl`

* Architecture, ledger design, security decisions and open questions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
* Database setup, migrations and seed: [apps/api/prisma/README.md](apps/api/prisma/README.md)
* API conventions (decorators, guards, ledger, idempotency, uploads, tests): [apps/api/README.md](apps/api/README.md)
* Business source document: `../paket_dokumen_sop_mou_skema_tarif_logistik_670send.md`

## Status

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Architecture, monorepo, `@670send/*` packages, Prisma schema, guards, seed, `.env.example` | **done** |
| 2 | Backend core: auth, i18n, RBAC guard, audit, ledger, idempotency, uploads — 82 tests on real PostgreSQL | **done** |
| 3 | Logistics engine: pricing, intake, hubs, manifests, inbound, OTP/PoD, cron, WhatsApp, receipts — 181 API tests, real Redis + PostgreSQL | **done** |
| 4 | Admin, finance & claims APIs: deposits, fleet payouts, claims engine, RBAC / template / tariff CRUD, directory & compliance, RTS, analytics + CSV — 108 more API tests | **done** |
| 5 | Public site `apps/web` (next-intl, 4 languages): landing, live calculator, tracker, pick-up booking with map pin, prohibited items & terms — 85 tests, axe-clean | **done** |
| 6 | Field PWA `apps/pwa` (installable, offline shell): agent drop-off wizard with camera compression and Bluetooth receipt printing, inbound scan, OTP hand-over, courier jobs, driver trips — 110 tests, driven in a real browser against the real API | **done** |
| 7–8 | Admin backoffice · DevOps kit | planned |

Whole repo: **295 API tests** (19 suites, real PostgreSQL + Redis) · 110 PWA · 85 web · 111 package tests — `pnpm test` is green.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm build
pnpm --filter @670send/api db:migrate
pnpm db:seed
pnpm test
pnpm --filter @670send/api start:dev     # API on :API_PORT (default 4000), prefix /v1

cp apps/web/.env.example apps/web/.env.local   # point NEXT_PUBLIC_API_URL at the API above
pnpm --filter @670send/web dev           # public site on http://localhost:3100  (admin 3102 is reserved)

cp apps/pwa/.env.example apps/pwa/.env.local   # point VITE_API_URL at the API above
pnpm --filter @670send/pwa dev           # field app on http://localhost:3101 (camera / Bluetooth need HTTPS or localhost)
```

Requires Node ≥ 22.12 (`.nvmrc` = 24) and pnpm ≥ 10.
