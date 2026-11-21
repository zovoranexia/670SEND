# syntax=docker/dockerfile:1.7
# 670Send API — build context is the repository root:
#   docker build -f infra/docker/api.Dockerfile -t 670send/api:<release> .
#   docker build -f infra/docker/api.Dockerfile --target migrate -t 670send/api-migrate:<release> .
#
# Stages: base → manifests → build (everything, incl. dev tools) → prod (pruned production tree)
#         → runtime (default, small, non-root)  |  migrate (build + entrypoint for migrations/seed, run on deploy only)
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    TZ=Asia/Dili
# openssl: Prisma's query engine links against it; slim images do not ship it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.18.0 --no-fund --no-audit
WORKDIR /repo

# ---- 1. manifests only: the dependency layer is re-used until a package.json or the lockfile changes ----------------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
COPY packages/pricing/package.json packages/pricing/
COPY packages/i18n/package.json packages/i18n/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/pwa/package.json apps/pwa/
COPY apps/admin/package.json apps/admin/

# ---- 2. build ------------------------------------------------------------------------------------------------------
FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@670send/api..." --store-dir /pnpm/store
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# The shared packages first (topological order), then the Prisma client, then the API itself.
RUN pnpm --filter "@670send/api^..." run build \
 && pnpm --filter @670send/api run db:generate \
 && pnpm --filter @670send/api run build

# ---- 3. production tree: only runtime dependencies, with the Prisma client generated inside it -----------------------
FROM build AS prod
RUN pnpm --filter @670send/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma
WORKDIR /out
# `pnpm deploy` copies the whole package folder: keep only what runs (dist, prisma schema, node_modules, package.json).
# prisma.config.ts is removed because it imports the CLI, which is not in the pruned tree (and is not needed to run).
# The CLI is a dev dependency, so the client is generated with a pinned `npx prisma` of the SAME version as the
# installed @prisma/client (the lockfile decides it), otherwise Prisma refuses the mismatch.
RUN rm -rf src test jest.config.js nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts prisma/seed.ts prisma/README.md \
 && V=$(node -p "require('/out/node_modules/@prisma/client/package.json').version") \
 && npx --yes "prisma@$V" generate --schema prisma/schema.prisma

# ---- 4a. one-shot job: apply migrations + idempotent seed (needs the CLI, tsx and the workspace packages) -------------
FROM build AS migrate
USER node
WORKDIR /repo/apps/api
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "-c"]
# `docker compose run --rm migrate` applies pending migrations, then seeds (never overwrites admin edits).
CMD ["pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts"]

# ---- 4b. the API ---------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Dili \
    API_PORT=4010
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod --chown=node:node /out /app
USER node
EXPOSE 4010
HEALTHCHECK --interval=15s --timeout=4s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4010)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
