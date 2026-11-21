#!/usr/bin/env bash
# Shared by backup.sh / restore.sh / restore-drill.sh (sourced).
#
# Where things live on the server (all root-only):
#   /etc/670send/gnupg/        keyring holding ONLY the public key(s) backups are encrypted to
#   /etc/670send/rclone.conf   rclone remote of the BACKUP bucket (a different bucket and API token from the photos)
#   /var/lib/670send/          last-backup / last-restore-drill timestamps
APP=${APP_DIR:-/opt/670send/app}
ENV_FILE=${ENV_FILE:-/opt/670send/.env}
# shellcheck source=../host/lib.sh
source "$APP/infra/host/lib.sh"

export GNUPGHOME=${BACKUP_GNUPGHOME:-/etc/670send/gnupg}
export RCLONE_CONFIG=${RCLONE_CONFIG:-/etc/670send/rclone.conf}
STATE_DIR=${STATE_DIR:-/var/lib/670send}
WORK_ROOT=${BACKUP_WORK_DIR:-/var/backups/670send}
# PG_MODE=compose (production: run pg_dump/psql inside the compose postgres container)
# PG_MODE=direct  (tests / a managed database: use the libpq environment PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
PG_MODE=${PG_MODE:-compose}

PG_USER=$(env_get POSTGRES_USER || true); PG_USER=${PG_USER:-send670}
PG_DB=$(env_get POSTGRES_DB || true);     PG_DB=${PG_DB:-send670}
RECIPIENTS=${BACKUP_GPG_RECIPIENT:-$(env_get BACKUP_GPG_RECIPIENT || true)}
REMOTE=${BACKUP_RCLONE_REMOTE:-$(env_get BACKUP_RCLONE_REMOTE || true)}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-$(env_get BACKUP_RETENTION_DAYS || true)}; RETENTION_DAYS=${RETENTION_DAYS:-30}
# shellcheck disable=SC2034  # used by backup.sh, which sources this file
MONTHLY_KEEP_DAYS=${BACKUP_MONTHLY_KEEP_DAYS:-400}

dc() { docker compose --env-file "$ENV_FILE" -f "$APP/docker-compose.prod.yml" "$@"; }

# pg <command…>  — run a PostgreSQL client tool against the production database (stdin/stdout pass through)
pg() {
  if [[ $PG_MODE == compose ]]; then dc exec -T postgres "$@"; else "$@"; fi
}
pg_args() { # connection arguments for the tool, per mode
  if [[ $PG_MODE == compose ]]; then printf -- '-U %s -d %s' "$PG_USER" "$PG_DB"; else printf -- ''; fi
}
psql_q() { # psql_q "SQL" → single value, no headers
  if [[ $PG_MODE == compose ]]; then dc exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -Atqc "$1"; else psql -Atqc "$1"; fi
}

ping_url() { # ping_url <url> [suffix]  — dead-man's-switch (healthchecks.io style); never fails the job
  local url=$1 suffix=${2:-}
  [[ -n $url ]] && curl -fsS -m 10 --retry 3 -o /dev/null "${url}${suffix}" 2>/dev/null || true
}

# Remote layout: <remote>/daily/YYYY/MM/<file>   and   <remote>/monthly/<file> (the first backup of each month)
require_backup_config() {
  [[ -n $RECIPIENTS ]] || die "BACKUP_GPG_RECIPIENT is not set (docs/DEPLOYMENT.md §9)"
  [[ -n $REMOTE ]] || die "BACKUP_RCLONE_REMOTE is not set (docs/DEPLOYMENT.md §9)"
  have gpg || die "gpg is not installed"
  have rclone || die "rclone is not installed"
  [[ -r $RCLONE_CONFIG ]] || die "rclone configuration $RCLONE_CONFIG not found"
  rclone lsd "${REMOTE%%:*}:" >/dev/null 2>&1 || rclone lsf "$REMOTE" >/dev/null 2>&1 || die "cannot reach the backup remote $REMOTE (check $RCLONE_CONFIG)"
}

secure_workdir() { # secure_workdir <prefix> → creates a 0700 directory and registers its removal on exit
  install -d -m 0700 "$WORK_ROOT"
  WORK=$(mktemp -d "$WORK_ROOT/$1.XXXXXX")
  chmod 0700 "$WORK"
  trap 'rm -rf "$WORK"' EXIT
}
