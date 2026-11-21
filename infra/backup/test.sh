#!/usr/bin/env bash
# 670Send — prove the backup kit works, without touching production: the REAL scripts run in compose mode against a
# throw-away PostgreSQL 17 (the same compose file, a separate project), with real gpg and rclone (local remote).
#
#   infra/backup/test.sh                    # minimal schema, ~2 min, needs Docker
#   TEST_REAL_SCHEMA=1 RELEASE=<tag> infra/backup/test.sh   # also applies the real migrations (needs the api-migrate image)
#
# Checks: encrypted at rest · checksum sidecar · off-site upload · listing · scratch restore with the ledger/row-count
# checks · refuses a wrong key · detects tampering · drill (integrity-only without a key, full with one, fails on a stale
# backup) · retention · LIVE restore replaces the database and takes a safety dump first.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WIN_ROOT=$(cd "$ROOT" && (pwd -W 2>/dev/null || pwd))
export MSYS_NO_PATHCONV=1
PROJECT=670send-backup-test
TMP=$(mktemp -d)
WIN_TMP=$(cd "$TMP" && (pwd -W 2>/dev/null || pwd))
RELEASE=${RELEASE:-test}; export RELEASE

# an environment file with distinct dummy secrets + the backup settings
awk 'BEGIN{n=0} /CHANGE_ME/ { n++; sub(/CHANGE_ME_account_id/,"abc123"); while (match($0,/CHANGE_ME[A-Za-z_@.0-9]*/)) { $0 = substr($0,1,RSTART-1) "dummy" n "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" substr($0,RSTART+RLENGTH) } } {print}' \
  "$ROOT/infra/env/production.env.example" \
  | sed -e 's#^BACKUP_GPG_RECIPIENT=.*#BACKUP_GPG_RECIPIENT=backup-test@670send.invalid#' -e 's#^BACKUP_RCLONE_REMOTE=.*#BACKUP_RCLONE_REMOTE=r2backup:/store#' >"$TMP/test.env"
# (Windows Docker needs Windows-style paths; on Linux WIN_* equal the normal ones)
DC=(docker compose -p "$PROJECT" --env-file "$WIN_TMP/test.env" -f "$WIN_ROOT/docker-compose.prod.yml")
cleanup() { "${DC[@]}" down -v >/dev/null 2>&1 || true; docker volume rm "${PROJECT}_pgdata" "${PROJECT}_redisdata" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== starting a throw-away PostgreSQL 17 (project $PROJECT)"
"${DC[@]}" up -d postgres >/dev/null
for _ in $(seq 1 40); do [[ $(docker inspect -f '{{.State.Health.Status}}' "$("${DC[@]}" ps -q postgres)" 2>/dev/null) == healthy ]] && break; sleep 2; done
# shellcheck disable=SC2120  # called without arguments for the heredoc form
psql() { "${DC[@]}" exec -T postgres psql -U send670 -d send670 -v ON_ERROR_STOP=1 -q "$@"; }
if [[ ${TEST_REAL_SCHEMA:-0} == 1 ]]; then
  echo "== applying the real migrations and seed"
  "${DC[@]}" run --rm migrate >/dev/null
else
  psql >/dev/null <<'SQL'
CREATE TABLE _prisma_migrations(migration_name text, finished_at timestamptz);
INSERT INTO _prisma_migrations VALUES ('20260101000000_init', now());
CREATE TABLE users(id serial PRIMARY KEY, full_name text);
INSERT INTO users(full_name) VALUES ('Ana'),('Bo'),('Cris');
CREATE TABLE shipments(id serial PRIMARY KEY);
INSERT INTO shipments DEFAULT VALUES; INSERT INTO shipments DEFAULT VALUES;
CREATE TABLE audit_logs(id serial PRIMARY KEY);
CREATE TABLE ledger_entries(id serial PRIMARY KEY, entry_type text, amount numeric(14,4));
INSERT INTO ledger_entries(entry_type, amount) VALUES ('CREDIT', 10.5), ('DEBIT', 10.5), ('CREDIT', 3.2500), ('DEBIT', 3.2500);
SQL
fi

# ---- the inner script runs in an Alpine container with the Docker CLI and the real tools -----------------------------------
cat >"$TMP/inner.sh" <<'INNER'
set -uo pipefail
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
apk add --no-cache bash coreutils util-linux gnupg rclone jq curl tar gawk sed findutils grep >/dev/null 2>&1 || { echo "apk failed"; exit 1; }
mkdir -p /var/lock /etc/670send/gnupg /root/keys /root/wrongkeys /store
chmod 700 /etc/670send/gnupg /root/keys /root/wrongkeys
export COMPOSE_PROJECT_NAME=$PROJECT RELEASE
printf '[r2backup]\ntype = local\n' >/etc/670send/rclone.conf; chmod 600 /etc/670send/rclone.conf

gpg --homedir /root/keys --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "670Send backup test <backup-test@670send.invalid>" default default 0 2>&1 | tail -2
gpg --homedir /root/wrongkeys --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "someone else <else@670send.invalid>" default default 0 >/dev/null 2>&1
gpg --homedir /root/keys --armor --export backup-test@670send.invalid | GNUPGHOME=/etc/670send/gnupg gpg --import >/dev/null 2>&1
B=/opt/670send/app/infra/backup

echo "== backup"
if bash $B/backup.sh >/tmp/backup.log 2>&1; then ok "backup.sh succeeded"; else bad "backup.sh failed"; cat /tmp/backup.log; fi
f=$(ls /store/daily/*/*/*.tar.gpg 2>/dev/null | head -1)
[[ -n $f && -s $f ]] && ok "encrypted archive uploaded to daily/YYYY/MM/" || bad "no archive in the remote"
[[ -f $f.sha256 ]] && ok "checksum sidecar uploaded" || bad "no checksum sidecar"
[[ $(cut -d' ' -f1 "$f.sha256") == "$(sha256sum "$f" | cut -d' ' -f1)" ]] && ok "sidecar matches the archive" || bad "sidecar mismatch"
if grep -qa "PGDMP" "$f" || grep -qa "ledger_entries" "$f"; then bad "the archive contains readable database content"; else ok "nothing readable inside the archive (encrypted)"; fi
if gpg --batch --decrypt "$f" >/dev/null 2>&1; then bad "the server's own keyring could decrypt its backup"; else ok "the server cannot decrypt its own backups (public key only)"; fi
[[ -s /var/lib/670send/last-backup ]] && ok "last-backup state written" || bad "no last-backup state"
[[ -z $(ls -A /var/backups/670send 2>/dev/null) ]] && ok "the staging directory was cleaned up" || bad "staging files left behind: $(ls /var/backups/670send)"

echo "== listing"
listing=$(bash $B/restore.sh --list 2>&1); grep -q '670send-.*tar.gpg' <<<"$listing" && ok "restore.sh --list shows the backup" || bad "listing empty"

echo "== scratch restore (private key supplied)"
if RESTORE_GNUPGHOME=/root/keys bash $B/restore.sh --latest --target scratch >/tmp/restore.log 2>&1 && grep -q "RESTORE OK" /tmp/restore.log; then ok "scratch restore OK (ledger nets to zero, row counts match)"; else bad "scratch restore failed"; cat /tmp/restore.log; fi
grep -qE "ledger net 0(\.0+)?( |$)" /tmp/restore.log && ok "the ledger check ran (nets to zero)" || bad "ledger check missing"
docker ps -a --format '{{.Names}}' | grep -q '^670send-restore-scratch' && bad "scratch container left behind" || ok "scratch container removed afterwards"

echo "== a wrong key is refused"
RESTORE_GNUPGHOME=/root/wrongkeys bash $B/restore.sh --latest --target scratch >/tmp/wrong.log 2>&1 && bad "restore succeeded with the wrong key" || ok "restore with the wrong key fails"

echo "== tampering is detected"
cp "$f" /tmp/good.tar.gpg
printf '\x00' | dd of="$f" bs=1 seek=200 count=1 conv=notrunc 2>/dev/null
RESTORE_GNUPGHOME=/root/keys bash $B/restore.sh --latest --target scratch >/tmp/tamper.log 2>&1 && bad "a corrupted backup was restored" || { grep -q "checksum" /tmp/tamper.log && ok "a corrupted backup is rejected by its checksum" || bad "corrupted backup failed for another reason"; }
cp /tmp/good.tar.gpg "$f"

echo "== restore drill"
bash $B/restore-drill.sh >/tmp/drill1.log 2>&1 && grep -q "integrity only" /tmp/drill1.log && ok "drill without a key on the server: integrity checks only, says so" || { bad "drill (no key) wrong"; cat /tmp/drill1.log; }
RESTORE_GNUPGHOME=/root/keys bash $B/restore-drill.sh >/tmp/drill2.log 2>&1 && grep -q "full restore OK" /tmp/drill2.log && ok "drill with a key available: FULL restore OK" || { bad "drill (key) wrong"; cat /tmp/drill2.log; }
[[ -s /var/lib/670send/last-restore-drill ]] && ok "last-restore-drill state written" || bad "no drill state"
mkdir -p /store-stale/daily/2020/01 && cp "$f" /store-stale/daily/2020/01/670send-20200101T000000Z.tar.gpg && (cd /store-stale/daily/2020/01 && sha256sum 670send-20200101T000000Z.tar.gpg >670send-20200101T000000Z.tar.gpg.sha256)
RCLONE_CONFIG=/etc/670send/rclone.conf BACKUP_RCLONE_REMOTE=r2backup:/store-stale bash $B/restore-drill.sh >/tmp/drill3.log 2>&1 && bad "the drill accepted a 6-year-old backup" || { grep -q "hours old" /tmp/drill3.log && ok "the drill fails loudly when the newest backup is stale" || bad "stale drill failed for another reason"; }

echo "== retention"
mkdir -p /store/daily/2020/01 && echo old >/store/daily/2020/01/670send-20200101T000000Z.tar.gpg && touch -d '2020-01-01' /store/daily/2020/01/670send-20200101T000000Z.tar.gpg
bash $B/backup.sh >/tmp/backup2.log 2>&1 && ok "a second backup ran" || { bad "second backup failed"; cat /tmp/backup2.log; }
[[ -e /store/daily/2020/01/670send-20200101T000000Z.tar.gpg ]] && bad "a 6-year-old backup was not pruned" || ok "backups older than the retention window are pruned"
[[ $(ls /store/daily/2026/*/*.tar.gpg 2>/dev/null | wc -l) -ge 2 ]] && ok "recent backups are kept" || bad "recent backups missing"

echo "== LIVE restore"
PSQL() { docker compose --env-file /opt/670send/.env -f /opt/670send/app/docker-compose.prod.yml exec -T postgres psql -U send670 -d send670 -Atq "$@"; }
PSQL -c "CREATE TABLE zz_after_backup(x int); INSERT INTO zz_after_backup VALUES (1);" >/dev/null
RESTORE_GNUPGHOME=/root/keys bash $B/restore.sh --latest --target live --yes >/tmp/live.log 2>&1 && ok "live restore finished" || { bad "live restore failed"; cat /tmp/live.log; }
[[ $(PSQL -c "SELECT count(*) FROM information_schema.tables WHERE table_name='zz_after_backup'") == 0 ]] && ok "the database went back to the backup (later data is gone, as warned)" || bad "post-backup table still exists"
ls /var/backups/670send/before-restore-*.dump >/dev/null 2>&1 && ok "a safety dump of the previous state was taken first" || bad "no safety dump"
if [[ ${TEST_REAL_SCHEMA:-0} == 1 ]]; then   # a freshly seeded production database has an empty ledger: check the migrations and the seed instead
  [[ $(PSQL -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL") -ge 5 && $(PSQL -c "SELECT count(*) FROM users") -ge 1 ]] && ok "migrations and the seeded Super Admin are present after the restore" || bad "real schema incomplete after restore"
else
  [[ $(PSQL -c "SELECT count(*) FROM ledger_entries") -ge 1 ]] && ok "ledger data present after the restore" || bad "ledger empty after restore"
fi
rm -f /var/backups/670send/before-restore-*.dump

echo; echo "passed $pass · failed $fail"; exit $((fail > 0))
INNER

echo "== running the backup/restore checks (first run installs gpg and rclone in a throw-away Alpine container)"
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WIN_ROOT:/opt/670send/app:ro" \
  -v "$WIN_TMP/test.env:/opt/670send/.env:ro" \
  -v "$WIN_TMP/inner.sh:/inner.sh:ro" \
  -e PROJECT="$PROJECT" -e RELEASE="$RELEASE" -e TEST_REAL_SCHEMA="${TEST_REAL_SCHEMA:-0}" \
  --entrypoint sh docker:cli -c 'apk add --no-cache bash >/dev/null 2>&1; bash /inner.sh'
