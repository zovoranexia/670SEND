# syntax=docker/dockerfile:1.7
# The two static single-page apps (field PWA and admin console). Nothing runs from this image: the `export` stage
# is written to a folder (`docker build --target export --output type=local,dest=<dir>`) that the host Nginx serves.
#   docker build -f infra/docker/static.Dockerfile --build-arg VITE_API_URL=https://api.670send.tl \
#     --target export --output type=local,dest=/srv/670send/releases/<release> .
# VITE_API_URL is public and compiled into the bundles.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TZ=Asia/Dili
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
    pnpm install --frozen-lockfile --filter "@670send/pwa..." --filter "@670send/admin..." --store-dir /pnpm/store
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/pwa apps/pwa
COPY apps/admin apps/admin
ARG VITE_API_URL=https://api.670send.tl
ENV VITE_API_URL=$VITE_API_URL NODE_ENV=production
RUN pnpm --filter "@670send/pwa^..." --filter "@670send/admin^..." run build \
 && pnpm --filter @670send/pwa run build \
 && pnpm --filter @670send/admin run build \
 && pnpm --filter @670send/pwa run smoke \
 && pnpm --filter @670send/admin run smoke

FROM scratch AS export
COPY --from=build /repo/apps/pwa/dist /pwa
COPY --from=build /repo/apps/admin/dist /admin
