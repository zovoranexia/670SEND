#!/usr/bin/env bash
# 670Send — list backups, and restore one (into a scratch database to inspect, or over the live database).
#
#   sudo ./infra/backup/restore.sh --list
#   sudo RESTORE_GNUPGHOME=/root/restore-keys ./infra/backup/restore.sh --latest --target scratch
#   sudo RESTORE_GNUPGHOME=/root/restore-keys ./infra/backup/restore.sh --file daily/2026/11/670send-….tar.gpg --target live
#
# The PRIVATE key is not on the server. Import it into a throw-away keyring just for the restore:
#     export RESTORE_GNUPGHOME=$(mktemp -d); gpg --homedir "$RESTORE_GNUPGHOME" --import backup-private.asc
# and delete that directory afterwards.
#
# --target scratch  restore into a disposable PostgreSQL container and run the sanity checks; touches nothing live.
# --target live     stop api+web, take a safety dump of the CURRENT database, restore over it, run the checks,
#                   start api+web. Asks you to type the database name. Needs --yes to skip the question (disasters at 3 a.m.).
# --with-env        also write the archived secrets file next to the live one as /opt/670send/.env.restored (never overwrites).
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=common.sh
source "$HERE/common.sh"
need_root

MODE=""; FILE=""; TARGET=scratch; YES=0; WITH_ENV=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --list) MODE=list; shift ;;
    --latest) MODE=restore; FILE=latest; shift ;;
    --file) MODE=restore; FILE=$2; shift 2 ;;
    --target) TARGET=$2; shift 2 ;;
    --yes) YES=1; shift ;;
    --with-env) WITH_ENV=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[[ -n $MODE ]] || die "usage: restore.sh --list | --latest | --file <path> [--target scratch|live] [--with-env] [--yes]"
[[ $TARGET == scratch || $TARGET == live ]] || die "--target must be scratch or live"
[[ -n $REMOTE ]] || die "BACKUP_RCLONE_REMOTE is not set"
have rclone || die "rclone is not installed"

if [[ $MODE == list ]]; then
  log "backups in $REMOTE (newest last)"
  { rclone lsl "$REMOTE/daily" 2>/dev/null || true; rclone lsl "$REMOTE/monthly" 2>/dev/null || true; } | { grep '\.tar\.gpg$' || true; } | sort -k2,3 | awk '{printf "%10d  %s %s  %s\n",$1,$2,substr($3,1,8),$4}'
  exit 0
fi

# ---- locate -----------------------------------------------------------------------------------------------------------
if [[ $FILE == latest ]]; then
  FILE=$(rclone lsf "$REMOTE/daily" -R --files-only 2>/dev/null | grep '\.tar\.gpg$' | sort | tail -1 | sed 's#^#daily/#')
  [[ $FILE != daily/ && -n $FILE ]] || die "no backup found in $REMOTE/daily"
fi
log "restoring $FILE (target: $TARGET)"
[[ -n ${RESTORE_GNUPGHOME:-} && -d $RESTORE_GNUPGHOME ]] || die "set RESTORE_GNUPGHOME to a keyring that holds the PRIVATE key (see the header of this script)"
secure_workdir restore

# ---- download, verify, decrypt -------------------------------------------------------------------------------------------
rclone copyto "$REMOTE/$FILE" "$WORK/backup.tar.gpg" --retries 5
if rclone copyto "$REMOTE/$FILE.sha256" "$WORK/backup.sha256" --retries 2 2>/dev/null; then
  want=$(cut -d' ' -f1 "$WORK/backup.sha256"); have_sha=$(sha256sum "$WORK/backup.tar.gpg" | cut -d' ' -f1)
  [[ $want == "$have_sha" ]] || die "checksum of the downloaded file does not match the one stored with it: corrupted or tampered"
  note "encrypted file checksum OK"
else
  warn "no .sha256 next to the backup; relying on the checks inside the archive"
fi
gpg --homedir "$RESTORE_GNUPGHOME" --batch --decrypt "$WORK/backup.tar.gpg" 2>"$WORK/gpg.err" | tar -C "$WORK" -xf - || { cat "$WORK/gpg.err" >&2; die "decryption failed: wrong key?"; }
[[ -s $WORK/database.dump && -s $WORK/meta.json ]] || die "the archive does not contain database.dump and meta.json"
want_dump=$(jq -r .databaseDumpSha256 "$WORK/meta.json")
[[ $(sha256sum "$WORK/database.dump" | cut -d' ' -f1) == "$want_dump" ]] || die "database.dump does not match the checksum recorded in meta.json"
log "backup from $(jq -r .createdAtUtc "$WORK/meta.json"), release $(jq -r .release "$WORK/meta.json"), last migration $(jq -r .lastMigration "$WORK/meta.json")"

# ---- sanity checks (shared with the restore drill) ------------------------------------------------------------------------
# usage: run_checks <psql command…>; compares the restored database with meta.json
run_checks() {
  local q=("$@") failed=0 net users shipments entries unfinished
  net=$("${q[@]}" -Atqc "SELECT COALESCE(SUM(CASE entry_type WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text FROM ledger_entries")
  users=$("${q[@]}" -Atqc "SELECT count(*) FROM users"); shipments=$("${q[@]}" -Atqc "SELECT count(*) FROM shipments")
  entries=$("${q[@]}" -Atqc "SELECT count(*) FROM ledger_entries")
  unfinished=$("${q[@]}" -Atqc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL")
  local want_net; want_net=$(jq -r .ledgerNet "$WORK/meta.json")
  printf '  users %s · shipments %s · ledger entries %s · ledger net %s · unfinished migrations %s\n' "$users" "$shipments" "$entries" "$net" "$unfinished"
  [[ $net == "$want_net" ]] || { warn "ledger net $net ≠ $want_net recorded at backup time"; failed=1; }
  [[ $(printf '%.4f' "$net") == "0.0000" ]] || { warn "the restored ledger does not net to zero"; failed=1; }
  [[ $unfinished == 0 ]] || { warn "$unfinished migrations unfinished"; failed=1; }
  [[ $users == "$(jq -r .counts.users "$WORK/meta.json")" && $shipments == "$(jq -r .counts.shipments "$WORK/meta.json")" && $entries == "$(jq -r .counts.ledger_entries "$WORK/meta.json")" ]] || { warn "row counts differ from meta.json"; failed=1; }
  return $failed
}

# ---- scratch restore ------------------------------------------------------------------------------------------------------
if [[ $TARGET == scratch ]]; then
  c=670send-restore-scratch-$$
  net=670send-restore-net-$$
  trap 'docker rm -f "$c" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
  docker network create --internal "$net" >/dev/null
  docker run -d --name "$c" --network "$net" -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=restore -e POSTGRES_USER=send670 postgres:17-alpine >/dev/null
  for _ in $(seq 1 40); do docker exec "$c" pg_isready -U send670 -d restore >/dev/null 2>&1 && break; sleep 2; done
  docker exec "$c" pg_isready -U send670 -d restore >/dev/null || die "scratch postgres did not start"
  log "restoring into a scratch PostgreSQL 17 container"
  docker cp "$WORK/database.dump" "$c:/tmp/database.dump"
  docker exec "$c" pg_restore -U send670 -d restore --no-owner --exit-on-error /tmp/database.dump || die "pg_restore failed"
  log "sanity checks"
  if run_checks docker exec -i "$c" psql -U send670 -d restore; then log "RESTORE OK — the backup is usable"; else die "RESTORE CHECKS FAILED"; fi
  if (( WITH_ENV )) && [[ -f $WORK/env.backup ]]; then install -m 0640 "$WORK/env.backup" /opt/670send/.env.restored; log "secrets copy written to /opt/670send/.env.restored"; fi
  exit 0
fi

# ---- live restore ---------------------------------------------------------------------------------------------------------
[[ $PG_MODE == compose ]] || die "--target live is for the compose deployment"
warn "THIS REPLACES THE LIVE DATABASE '$PG_DB' with the backup of $(jq -r .createdAtUtc "$WORK/meta.json")."
warn "Everything written after that moment (parcels, deposits, ledger entries) will be LOST unless it is in the safety dump taken now."
if (( ! YES )); then
  read -r -p "Type the database name ($PG_DB) to continue: " typed
  [[ $typed == "$PG_DB" ]] || die "aborted"
fi
log "1/5 stopping api and web"
dc stop api web || warn "could not stop api/web (already stopped?)"
log "2/5 safety dump of the current database → $WORK_ROOT/before-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
safety="$WORK_ROOT/before-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
dc exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --no-owner >"$safety" || die "safety dump failed: nothing was changed (api/web are stopped: dc start api web)"
chmod 0600 "$safety"
log "3/5 restoring"
dc exec -T postgres psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$PG_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\""
dc exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --exit-on-error <"$WORK/database.dump" || die "pg_restore failed. The safety dump is $safety"
log "4/5 sanity checks"
run_checks dc exec -T postgres psql -U "$PG_USER" -d "$PG_DB" || die "checks failed. The safety dump is $safety"
if (( WITH_ENV )) && [[ -f $WORK/env.backup ]]; then install -m 0640 "$WORK/env.backup" /opt/670send/.env.restored; log "secrets copy written to /opt/670send/.env.restored"; fi
log "5/5 starting api and web"
dc start api web || warn "api/web were not started: run  dc up -d api web"
log "restore finished. Safety dump of what was there before: $safety (delete it when you no longer need it)"
