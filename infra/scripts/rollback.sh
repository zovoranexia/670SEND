#!/usr/bin/env bash
# 670Send — go back to a previous release (images + static apps). Run as the operator.
#
#   ./infra/scripts/rollback.sh              # to the release before the live one
#   ./infra/scripts/rollback.sh <release>    # to a specific release listed in /opt/670send/releases.log
#
# Code only. Database migrations are forward-only and are NOT undone: this is safe when the newer migrations were
# additive (new tables/columns), which is the rule for 670Send migrations. If a migration changed data
# destructively, restore the pre-deploy backup instead (docs/DEPLOYMENT.md §10).
set -euo pipefail
APP=${APP_DIR:-/opt/670send/app}
ENV_FILE=${ENV_FILE:-/opt/670send/.env}
LOG=/opt/670send/releases.log
SRV=/srv/670send
# shellcheck source=../host/lib.sh
source "$APP/infra/host/lib.sh"
[[ $EUID -ne 0 ]] || die "run as the operator account, not root"
export ENV_FILE
dc() { docker compose --env-file "$ENV_FILE" -f "$APP/docker-compose.prod.yml" "$@"; }

mapfile -t OK < <(awk '$3=="ok"{print $2}' "$LOG" | tac | awk '!s[$0]++')
CURRENT=$(readlink "$SRV/current" 2>/dev/null | xargs -r basename)
TARGET=${1:-}
if [[ -z $TARGET ]]; then
  for r in "${OK[@]}"; do [[ $r != "$CURRENT" ]] && { TARGET=$r; break; }; done
fi
[[ -n $TARGET ]] || die "no earlier release to go back to. Known releases: ${OK[*]:-none}"
printf '%s\n' "${OK[@]}" | grep -qx "$TARGET" || die "$TARGET is not a successfully deployed release. Known: ${OK[*]}"
for img in api web; do docker image inspect "670send/$img:$TARGET" >/dev/null 2>&1 || die "image 670send/$img:$TARGET is gone (pruned): redeploy that commit with deploy.sh --ref"; done
[[ -d $SRV/releases/$TARGET ]] || die "static files of $TARGET are gone: redeploy that commit with deploy.sh --ref"

log "rolling back: ${CURRENT:-?} → $TARGET"
confirm "Proceed?" || exit 1
RELEASE=$TARGET dc up -d api web
for _ in $(seq 1 50); do
  a=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q api)" 2>/dev/null || echo starting)
  [[ $a == healthy ]] && break; sleep 3
done
[[ ${a:-} == healthy ]] || die "the api of $TARGET is not healthy: dc logs api"
ln -sfn "$SRV/releases/$TARGET" "$SRV/current.new" && mv -T "$SRV/current.new" "$SRV/current"
echo "$(date -Is) $TARGET ok rollback-from=${CURRENT:-?}" >>"$LOG"
log "now on $TARGET"
