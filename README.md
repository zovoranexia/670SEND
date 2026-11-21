# 670Send

Inter-municipality parcel logistics for Timor-Leste (14 municipalities) — Zovoranexia, Lda.
`670send.tl` · `app.670send.tl` · `admin.670send.tl` · `api.670send.tl`

* Architecture, ledger design, security decisions and open questions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
* **Install on an Ubuntu 26.04 VPS:** [docs/PANDUAN-INSTALASI-VPS.md](docs/PANDUAN-INSTALASI-VPS.md) (Bahasa Indonesia, step by step) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (English reference) · [infra/README.md](infra/README.md) (file map)
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
| 7 | Admin backoffice `apps/admin` (4 languages, RBAC-gated): dashboard, hub consolidation & manifest dispatch, partners & MoU, finance / deposits / fleet payouts, claims desk with side-by-side photo evidence, localized tariff matrix, WhatsApp template editor, RBAC & audit — no API change needed; driven against the real API | **done** |
| 8 | DevOps kit `infra/` + `docker-compose.prod.yml`: multi-stage Dockerfiles, hardened compose stack, Nginx vhosts + TLS, Ubuntu 26.04 hardening, Certbot, GPG-encrypted off-site backup / restore / restore drill, deploy / rollback — images built and run, Nginx (28 checks) and backups (25 checks, real schema) tested; host scripts **not yet run on a real VPS** | **done** (stage on a test server first) |

Whole repo: **295 API tests** (19 suites, real PostgreSQL + Redis) · 110 PWA · 67 admin · 85 web · 111 package tests — `pnpm test` is green.

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
pnpm --filter @670send/web dev           # public site on http://localhost:3100

cp apps/pwa/.env.example apps/pwa/.env.local   # point VITE_API_URL at the API above
pnpm --filter @670send/pwa dev           # field app on http://localhost:3101 (camera / Bluetooth need HTTPS or localhost)

cp apps/admin/.env.example apps/admin/.env.local   # point VITE_API_URL at the API above
pnpm --filter @670send/admin dev         # back office on http://localhost:3102 (sign in with a staff account; the seed prints none — see .env SEED_SUPERADMIN_*)
```

Requires Node ≥ 22.12 (`.nvmrc` = 24) and pnpm ≥ 10.
