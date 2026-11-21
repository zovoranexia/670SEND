#!/usr/bin/env bash
# 670Send — build, migrate and switch to a new release, with a rollback point. Run as the operator (docker group), not root.
#
#   ./infra/scripts/deploy.sh                 # latest of the current branch (git pull --ff-only), full deploy
#   ./infra/scripts/deploy.sh --ref v1.2.0    # a tag / branch / commit
#   ./infra/scripts/deploy.sh --skip-pull     # deploy the working tree exactly as it is
#   ./infra/scripts/deploy.sh --no-backup     # skip the pre-deploy backup (first deploy / emergencies only)
#
# Order (nothing user-visible changes until step 6):
#   1 preflight  2 checkout  3 pre-deploy backup  4 build images + static apps  5 migrate (forward-only)
#   6 start the new api/web  7 health gate  8 publish the static apps (atomic symlink)  9 record + prune
# If the health gate fails the previous images are started again and the static apps are never switched.
set -euo pipefail
APP=${APP_DIR:-/opt/670send/app}
ENV_FILE=${ENV_FILE:-/opt/670send/.env}
LOG=/opt/670send/releases.log
SRV=/srv/670send
KEEP=${KEEP_RELEASES:-5}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-150}
# shellcheck source=../host/lib.sh
source "$APP/infra/host/lib.sh"

REF=""; PULL=1; BACKUP=1; SEED=1
while [[ $# -gt 0 ]]; do
  case $1 in
    --ref) REF=$2; shift 2 ;;
    --skip-pull) PULL=0; shift ;;
    --no-backup) BACKUP=0; shift ;;
    --no-seed) SEED=0; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[[ $EUID -ne 0 ]] || die "run as the operator account, not root (root-owned build files make later deploys fail)"
cd "$APP"
export ENV_FILE
dc() { docker compose --env-file "$ENV_FILE" -f "$APP/docker-compose.prod.yml" "$@"; }

# ------------------------------------------------------------------------------------------------ 1. preflight
log "1/9 preflight"
have docker || die "docker is not installed (run infra/scripts/bootstrap.sh)"
docker info >/dev/null 2>&1 || die "cannot talk to Docker: log out and in again so your docker group membership applies"
[[ -r $ENV_FILE ]] || die "$ENV_FILE is missing or unreadable"
for key in POSTGRES_PASSWORD REDIS_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET OTP_PEPPER FIELD_ENCRYPTION_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY SEED_SUPERADMIN_PASSWORD WHATSAPP_PROVIDER; do
  v=$(env_get "$key" "$ENV_FILE" || true)
  [[ -n $v ]] || die "$key is not set in $ENV_FILE"
  [[ $v != *CHANGE_ME* ]] || die "$key still holds the CHANGE_ME placeholder in $ENV_FILE"
done
[[ $(env_get JWT_ACCESS_SECRET) != "$(env_get JWT_REFRESH_SECRET)" ]] || die "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ"
[[ $(env_get WHATSAPP_PROVIDER) != console ]] || die "WHATSAPP_PROVIDER=console only logs messages: choose meta, fonnte or waha"
dc config -q || die "docker-compose.prod.yml does not validate with $ENV_FILE"
avail_gb=$(df -BG --output=avail /var/lib/docker 2>/dev/null | tail -1 | tr -dc 0-9 || echo 99)
(( avail_gb >= 6 )) || die "only ${avail_gb} GB free under /var/lib/docker: a build needs ~6 GB (docker image prune -a, or grow the disk)"
API_URL=$(env_get API_URL)

# ------------------------------------------------------------------------------------------------ 2. checkout
log "2/9 source"
if [[ -d .git ]]; then
  if (( PULL )); then
    git fetch --tags --prune origin
    if [[ -n $REF ]]; then git checkout --detach "$REF"; else git pull --ff-only; fi
  elif [[ -n $REF ]]; then git checkout --detach "$REF"; fi
  RELEASE=$(git rev-parse --short=10 HEAD)
  [[ -z $(git status --porcelain --untracked-files=no) ]] || { RELEASE="$RELEASE-dirty$(date +%H%M%S)"; warn "uncommitted changes: this release is $RELEASE"; }
else
  RELEASE=$(date +%Y%m%d%H%M%S)
fi
export RELEASE
PREV=$(awk '$3=="ok"{r=$2} END{print r}' "$LOG" 2>/dev/null || true)
log "release $RELEASE (previous live release: ${PREV:-none})"

# ------------------------------------------------------------------------------------------------ 3. backup
if (( BACKUP )) && dc ps --status running --services 2>/dev/null | grep -qx postgres; then
  log "3/9 pre-deploy backup"
  "$APP/infra/backup/backup.sh" --tag "pre-$RELEASE" || die "the pre-deploy backup failed: fix backups first (or deploy with --no-backup if you accept the risk)"
else
  log "3/9 pre-deploy backup skipped ($( ((BACKUP)) && echo 'database not running yet' || echo '--no-backup'))"
fi

# ------------------------------------------------------------------------------------------------ 4. build
log "4/9 building images (api, web, migrate) — the first build takes several minutes"
dc build api web migrate
log "    building the static apps (field PWA + admin console)"
rm -rf "${SRV:?}/releases/$RELEASE"
docker build -f infra/docker/static.Dockerfile --build-arg "VITE_API_URL=$API_URL" --target export \
  --output "type=local,dest=$SRV/releases/$RELEASE" .
[[ -f $SRV/releases/$RELEASE/pwa/index.html && -f $SRV/releases/$RELEASE/admin/index.html ]] || die "the static build produced no index.html"

# ------------------------------------------------------------------------------------------------ 5. migrate
log "5/9 database: start postgres + redis, apply migrations$( ((SEED)) && echo ' and the idempotent seed')"
dc up -d postgres redis
for _ in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q postgres)" 2>/dev/null || echo starting)
  [[ $s == healthy ]] && break; sleep 2
done
[[ ${s:-} == healthy ]] || die "postgres did not become healthy: dc logs postgres"
if (( SEED )); then dc run --rm migrate; else dc run --rm migrate sh -c "pnpm exec prisma migrate deploy"; fi

# ------------------------------------------------------------------------------------------------ 6/7. start + health gate
log "6/9 starting api and web"
dc up -d --remove-orphans api web
log "7/9 health gate (up to ${HEALTH_TIMEOUT}s)"
healthy=0
for _ in $(seq 1 $((HEALTH_TIMEOUT / 3))); do
  api=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q api)" 2>/dev/null || echo starting)
  web=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q web)" 2>/dev/null || echo starting)
  if [[ $api == healthy && $web == healthy ]] && curl -fsS http://127.0.0.1:4010/v1/health/ready >/dev/null 2>&1; then healthy=1; break; fi
  sleep 3
done
if (( ! healthy )); then
  warn "api=$api web=$web — the new release is NOT healthy"
  dc logs --tail 40 api web || true
  echo "$(date -Is) $RELEASE FAILED prev=${PREV:-none}" >>"$LOG"
  if [[ -n $PREV ]] && docker image inspect "670send/api:$PREV" >/dev/null 2>&1; then
    warn "rolling back to $PREV (static apps were not switched; migrations are forward-only)"
    RELEASE=$PREV dc up -d api web
  fi
  die "deploy of $RELEASE failed"
fi

# ------------------------------------------------------------------------------------------------ 8. publish static apps
log "8/9 publishing the static apps"
ln -sfn "$SRV/releases/$RELEASE" "$SRV/current.new" && mv -T "$SRV/current.new" "$SRV/current"

# ------------------------------------------------------------------------------------------------ 9. record + prune
echo "$(date -Is) $RELEASE ok prev=${PREV:-none}" >>"$LOG"
log "9/9 housekeeping (keeping the last $KEEP releases)"
mapfile -t keep < <(awk '$3=="ok"{print $2}' "$LOG" | tac | awk '!s[$0]++' | head -n "$KEEP")
for d in "$SRV"/releases/*/; do
  name=$(basename "$d"); [[ $name == empty ]] && continue
  printf '%s\n' "${keep[@]}" | grep -qx "$name" || rm -rf "$d"
done
for img in 670send/api 670send/web 670send/api-migrate; do
  docker images --format '{{.Tag}}' "$img" | grep -vxE 'current|<none>' | while read -r tag; do
    printf '%s\n' "${keep[@]}" | grep -qx "$tag" || docker rmi "$img:$tag" >/dev/null 2>&1 || true
  done
done
docker image prune -f >/dev/null 2>&1 || true

log "release $RELEASE is live."
note "https://670send.tl · https://app.670send.tl · https://admin.670send.tl · https://api.670send.tl/v1/health"
note "roll back:  ./infra/scripts/rollback.sh        status:  ./infra/scripts/status.sh"
