#!/usr/bin/env bash
# 670Send — monthly proof that the backups are real. A backup nobody has restored is a hope, not a backup.
#
#   sudo ./infra/backup/restore-drill.sh
#
# Always:  downloads the newest daily backup, checks it against its stored checksum, checks it is a valid
#          GPG message for the configured recipient, and checks it is recent (younger than 36 h) and plausibly sized.
# If the server holds a secret key that can open it (BACKUP_GNUPGHOME has a "drill key" as an extra recipient, or
#          RESTORE_GNUPGHOME points at a keyring with the private key):
#          also restores it into a scratch PostgreSQL container and runs the ledger / row-count checks.
# Otherwise it says clearly that only the integrity half ran: do the full drill by hand once a month with the offline key
# (docs/DEPLOYMENT.md §9): restore.sh --latest --target scratch.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=common.sh
source "$HERE/common.sh"
need_root
require_backup_config
install -d -m 0755 "$STATE_DIR"
PING=${BACKUP_DRILL_PING_URL:-$(env_get BACKUP_DRILL_PING_URL || true)}
ping_url "$PING" /start
fail() { ping_url "$PING" /fail; die "$1"; }
secure_workdir drill

latest=$(rclone lsf "$REMOTE/daily" -R --files-only 2>/dev/null | grep '\.tar\.gpg$' | sort | tail -1 || true)
[[ -n $latest ]] || fail "there is no backup in $REMOTE/daily"
log "newest backup: $latest"

# 1. freshness
stamp=$(basename "$latest" | sed -E 's/^670send-([0-9]{8}T[0-9]{6}Z).*/\1/')
ts=$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2} UTC" +%s 2>/dev/null || echo 0)
age_h=$(( ( $(date -u +%s) - ts ) / 3600 ))
(( ts > 0 )) || fail "cannot read the timestamp of $latest"
(( age_h <= 36 )) || fail "the newest backup is $age_h hours old: the nightly backup has stopped working"
note "age: ${age_h} h"

# 2. integrity
rclone copyto "$REMOTE/daily/$latest" "$WORK/b.tar.gpg" --retries 5
rclone copyto "$REMOTE/daily/$latest.sha256" "$WORK/b.sha256" --retries 3 || fail "the checksum file is missing"
[[ $(cut -d' ' -f1 "$WORK/b.sha256") == "$(sha256sum "$WORK/b.tar.gpg" | cut -d' ' -f1)" ]] || fail "checksum mismatch: the stored backup is corrupted"
size=$(stat -c %s "$WORK/b.tar.gpg")
(( size > 20000 )) || fail "the backup is only $size bytes: it cannot contain the database"
# `gpg --list-packets` exits non-zero when it holds no secret key (the normal state of this server): read its output, not its exit code.
gpg --batch --list-packets "$WORK/b.tar.gpg" >"$WORK/packets.txt" 2>&1 || true
grep -q 'pubkey enc packet' "$WORK/packets.txt" || fail "the file is not a GPG message encrypted to a public key"
note "integrity OK ($size bytes, valid encrypted message)"

# 3. full restore when a secret key is available
keyhome=""
for h in "${RESTORE_GNUPGHOME:-}" "$GNUPGHOME"; do
  [[ -n $h && -d $h ]] || continue
  if gpg --homedir "$h" --batch --list-secret-keys 2>/dev/null | grep -q '^sec'; then keyhome=$h; break; fi
done
if [[ -n $keyhome ]]; then
  log "a secret key is available: running a FULL restore into a scratch container"
  RESTORE_GNUPGHOME=$keyhome "$HERE/restore.sh" --file "daily/$latest" --target scratch || fail "the restore of the newest backup FAILED"
  result="full restore OK"
else
  warn "no secret key on this server (by design): only the integrity checks ran. Do the full drill by hand with the offline key."
  result="integrity only (no key on the server)"
fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $latest — $result" >"$STATE_DIR/last-restore-drill"
ping_url "$PING"
log "restore drill finished: $result"
