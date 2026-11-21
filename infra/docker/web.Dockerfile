# syntax=docker/dockerfile:1.7
# 670Send public site (Next.js standalone) — build context is the repository root:
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_WEB_URL=https://670send.tl --build-arg NEXT_PUBLIC_API_URL=https://api.670send.tl \
#     -t 670send/web:<release> .
# NEXT_PUBLIC_* values are compiled into the bundle (and into the Content-Security-Policy), so they are build arguments.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Dili
RUN npm install -g pnpm@12.18.0 --no-fund --no-audit
WORKDIR /repo

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

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@670send/web..." --store-dir /pnpm/store
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_WEB_URL=https://670send.tl
ARG NEXT_PUBLIC_API_URL=https://api.670send.tl
ARG NEXT_PUBLIC_SUPPORT_WHATSAPP=
ARG NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
ARG NEXT_PUBLIC_MAP_ATTRIBUTION="© OpenStreetMap contributors"
ENV NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPPORT_WHATSAPP=$NEXT_PUBLIC_SUPPORT_WHATSAPP \
    NEXT_PUBLIC_MAP_TILE_URL=$NEXT_PUBLIC_MAP_TILE_URL \
    NEXT_PUBLIC_MAP_ATTRIBUTION=$NEXT_PUBLIC_MAP_ATTRIBUTION \
    NODE_ENV=production
RUN pnpm --filter "@670send/web^..." run build \
 && pnpm --filter @670send/web run build

# The standalone tree mirrors the repo layout (.next/standalone/apps/web/server.js); static assets and public/ sit beside it.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Dili PORT=3100 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
WORKDIR /app/apps/web
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
