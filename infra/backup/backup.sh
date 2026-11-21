#!/usr/bin/env bash
# 670Send — encrypted off-site backup of the database (+ the secrets file).
#
#   sudo ./infra/backup/backup.sh                 # what the nightly timer runs
#   sudo ./infra/backup/backup.sh --tag pre-abc1  # labelled backup (deploy.sh does this before every release)
#
# What is in a backup (one file, encrypted to the public key(s) in BACKUP_GPG_RECIPIENT, so the server cannot read
# its own backups):  database.dump (pg_dump custom format) · meta.json (checksums, schema version, ledger check,
# row counts) · env.backup (a copy of /opt/670send/.env — without FIELD_ENCRYPTION_KEY the stored bank accounts
# cannot be decrypted after a disaster).
# Photos live in the R2 photo bucket and are NOT part of this archive: turn on versioning + a lifecycle rule there
# (docs/DEPLOYMENT.md §9) and keep that bucket's API token separate from the backup bucket's.
#
# Retention: daily/ keeps BACKUP_RETENTION_DAYS (default 30); the first backup of each month is also copied to
# monthly/ and kept ~13 months. Exit code != 0 on ANY failure (systemd marks the unit failed; the ping URL is not hit).
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=common.sh
source "$HERE/common.sh"
need_root

TAG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag) TAG=$(printf '%s' "$2" | tr -c 'A-Za-z0-9._-' '-'); shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done

exec 9>/var/lock/670send-backup.lock
flock -n 9 || die "another backup is already running"
require_backup_config
secure_workdir backup
install -d -m 0755 "$STATE_DIR"

PING=${BACKUP_PING_URL:-$(env_get BACKUP_PING_URL || true)}
ping_url "$PING" /start
fail() { ping_url "$PING" /fail; die "$1"; }

STAMP=$(TZ=UTC date +%Y%m%dT%H%M%SZ)
NAME="670send-${STAMP}${TAG:+-$TAG}"
DAY=$(TZ=Asia/Dili date +%d); YM=$(TZ=Asia/Dili date +%Y/%m)

# ---- 1. database dump -------------------------------------------------------------------------------------------
log "dumping the database ($PG_MODE mode)"
if [[ $PG_MODE == compose ]]; then
  dc exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --compress=6 --no-owner >"$WORK/database.dump" || fail "pg_dump failed"
else
  pg_dump --format=custom --compress=6 --no-owner >"$WORK/database.dump" || fail "pg_dump failed"
fi
[[ -s $WORK/database.dump ]] || fail "the dump is empty"
# A dump that cannot even be listed is worthless: prove it is readable now, not during the disaster.
if [[ $PG_MODE == compose ]]; then dc exec -T postgres pg_restore --list <"$WORK/database.dump" >/dev/null || fail "the dump is not a valid archive"
else pg_restore --list "$WORK/database.dump" >/dev/null || fail "the dump is not a valid archive"; fi

# ---- 2. metadata (what a restore will be checked against) ---------------------------------------------------------
log "recording metadata"
migration=$(psql_q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1" 2>/dev/null || echo unknown)
ledger_net=$(psql_q "SELECT COALESCE(SUM(CASE entry_type WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text FROM ledger_entries" 2>/dev/null || echo unknown)
counts=$(psql_q "SELECT json_build_object('users',(SELECT count(*) FROM users),'shipments',(SELECT count(*) FROM shipments),'ledger_entries',(SELECT count(*) FROM ledger_entries),'audit_logs',(SELECT count(*) FROM audit_logs))" 2>/dev/null || echo '{}')
release=$(awk '$3=="ok"{r=$2} END{print r}' /opt/670send/releases.log 2>/dev/null || true)
dump_sha=$(sha256sum "$WORK/database.dump" | cut -d' ' -f1)
cat >"$WORK/meta.json" <<EOF
{
  "name": "$NAME",
  "createdAtUtc": "$STAMP",
  "tag": "${TAG}",
  "release": "${release:-unknown}",
  "database": "$PG_DB",
  "lastMigration": "$migration",
  "ledgerNet": "$ledger_net",
  "counts": $counts,
  "databaseDumpSha256": "$dump_sha",
  "databaseDumpBytes": $(stat -c %s "$WORK/database.dump")
}
EOF
[[ -r $ENV_FILE ]] && install -m 0600 "$ENV_FILE" "$WORK/env.backup"

# ---- 3. archive + encrypt (to the public key only) ------------------------------------------------------------------
log "encrypting to: $RECIPIENTS"
args=()
IFS=',' read -ra rcpt <<<"$RECIPIENTS"
for r in "${rcpt[@]}"; do args+=(--recipient "$(echo "$r" | xargs)"); done
members=(database.dump meta.json)
[[ -f $WORK/env.backup ]] && members+=(env.backup)
tar -C "$WORK" -cf - "${members[@]}" \
  | gpg --batch --yes --trust-model always --compress-algo none --cipher-algo AES256 "${args[@]}" --encrypt -o "$WORK/$NAME.tar.gpg" \
  || fail "encryption failed (is the public key imported into $GNUPGHOME?)"
rm -f "$WORK/database.dump" "$WORK/env.backup"
size=$(stat -c %s "$WORK/$NAME.tar.gpg")
sha=$(sha256sum "$WORK/$NAME.tar.gpg" | cut -d' ' -f1)
echo "$sha  $NAME.tar.gpg" >"$WORK/$NAME.tar.gpg.sha256"

# ---- 4. upload + verify ----------------------------------------------------------------------------------------------
log "uploading ${size} bytes to $REMOTE/daily/$YM/"
rclone copyto "$WORK/$NAME.tar.gpg" "$REMOTE/daily/$YM/$NAME.tar.gpg" --checksum --retries 5 --low-level-retries 10 || fail "upload failed"
rclone copyto "$WORK/$NAME.tar.gpg.sha256" "$REMOTE/daily/$YM/$NAME.tar.gpg.sha256" --retries 5 || fail "upload of the checksum failed"
remote_size=$(rclone size "$REMOTE/daily/$YM/$NAME.tar.gpg" --json 2>/dev/null | jq -r .bytes || echo -1)
[[ $remote_size == "$size" ]] || fail "uploaded size ($remote_size) differs from local size ($size)"
if [[ $DAY == 01 ]]; then
  log "first backup of the month: keeping a copy in monthly/"
  rclone copyto "$REMOTE/daily/$YM/$NAME.tar.gpg" "$REMOTE/monthly/$NAME.tar.gpg" --retries 5 || warn "monthly copy failed"
  rclone copyto "$REMOTE/daily/$YM/$NAME.tar.gpg.sha256" "$REMOTE/monthly/$NAME.tar.gpg.sha256" --retries 5 || true
fi

# ---- 5. retention ------------------------------------------------------------------------------------------------------
log "pruning daily backups older than ${RETENTION_DAYS} days (monthly: ${MONTHLY_KEEP_DAYS})"
rclone delete "$REMOTE/daily" --min-age "${RETENTION_DAYS}d" --retries 3 || warn "pruning daily/ failed"
rclone delete "$REMOTE/monthly" --min-age "${MONTHLY_KEEP_DAYS}d" --retries 3 2>/dev/null || true
rclone rmdirs "$REMOTE/daily" --leave-root >/dev/null 2>&1 || true

date -u +%Y-%m-%dT%H:%M:%SZ >"$STATE_DIR/last-backup"
echo "$NAME ($size bytes, sha256 ${sha:0:12}…)" >>"$STATE_DIR/last-backup"
ping_url "$PING"
log "backup $NAME complete"
