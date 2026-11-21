#!/usr/bin/env bash
# 670Send — install what the stack needs on the (already hardened) Ubuntu 26.04 server. Idempotent.
#
#   sudo ADMIN_USER=deploy ./infra/scripts/bootstrap.sh
#
# Installs Docker Engine + compose plugin, Nginx, Certbot, rclone and gnupg; creates the directory layout;
# installs the Nginx configuration (no certificates yet — see issue-certs.sh) and the backup timers.
#
# Layout:
#   /opt/670send/app          this repository (git clone)          /opt/670send/.env       secrets (0640 root:ADMIN_USER)
#   /opt/670send/releases.log one line per deployed release        /srv/670send/releases/<id>/{pwa,admin}  static builds
#   /srv/670send/current      symlink to the live static release   /var/www/certbot       ACME webroot
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=../host/lib.sh
source "$ROOT/infra/host/lib.sh"
need_root
export DEBIAN_FRONTEND=noninteractive
ADMIN_USER=${ADMIN_USER:-deploy}
id "$ADMIN_USER" >/dev/null 2>&1 || die "user $ADMIN_USER does not exist: run infra/host/harden-ubuntu.sh first"
. /etc/os-release

# ---------------------------------------------------------------------------------------------- Docker Engine
if have docker && docker compose version >/dev/null 2>&1; then
  log "Docker already installed: $(docker --version)"
else
  log "installing Docker Engine"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  codename=${VERSION_CODENAME:-}
  if curl -fsI "https://download.docker.com/linux/ubuntu/dists/${codename}/Release" >/dev/null 2>&1; then
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  else
    warn "Docker's repository has no '${codename}' suite yet: using Ubuntu's own packages"
    apt-get update -qq
    apt-get install -y -qq docker.io docker-compose-v2 docker-buildx >/dev/null
  fi
fi
write_file /etc/docker/daemon.json 0644 <<'EOF' || true
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true,
  "icc": false,
  "default-ulimits": { "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 } }
}
EOF
systemctl enable --now docker >/dev/null 2>&1
systemctl reload docker 2>/dev/null || systemctl restart docker
# Membership of the docker group is root-equivalent: only the operator account gets it.
usermod -aG docker "$ADMIN_USER"

# ---------------------------------------------------------------------------------------------- Nginx, Certbot, tools
log "installing Nginx, Certbot, rclone, gnupg"
apt-get install -y -qq nginx certbot rclone gnupg postgresql-client-common >/dev/null
systemctl enable nginx >/dev/null 2>&1

# ---------------------------------------------------------------------------------------------- directories
log "creating the directory layout"
install -d -m 0750 -o root -g "$ADMIN_USER" /opt/670send
install -d -m 0755 -o "$ADMIN_USER" -g "$ADMIN_USER" /srv/670send /srv/670send/releases
install -d -m 0755 /var/www/certbot
install -d -m 0750 -o root -g "$ADMIN_USER" /var/backups/670send
touch /opt/670send/releases.log && chown "$ADMIN_USER:$ADMIN_USER" /opt/670send/releases.log
if [[ ! -e /opt/670send/.env ]]; then
  install -m 0640 -o root -g "$ADMIN_USER" "$ROOT/infra/env/production.env.example" /opt/670send/.env
  warn "created /opt/670send/.env from the template: fill in every CHANGE_ME before deploying"
else
  chown root:"$ADMIN_USER" /opt/670send/.env; chmod 0640 /opt/670send/.env
fi
if [[ ! -e /opt/670send/app ]]; then ln -s "$ROOT" /opt/670send/app; note "linked /opt/670send/app → $ROOT"; fi
# An empty placeholder release keeps Nginx able to start before the first deployment.
if [[ ! -e /srv/670send/current ]]; then
  install -d -o "$ADMIN_USER" -g "$ADMIN_USER" /srv/670send/releases/empty/pwa /srv/670send/releases/empty/admin
  echo "<!doctype html><title>670Send</title><p>Not deployed yet.</p>" | tee /srv/670send/releases/empty/pwa/index.html /srv/670send/releases/empty/admin/index.html >/dev/null
  ln -sfn /srv/670send/releases/empty /srv/670send/current
fi

# ---------------------------------------------------------------------------------------------- Nginx configuration
log "installing the Nginx configuration"
[[ -f /etc/nginx/nginx.conf.distribution ]] || cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.distribution
install -m 0644 "$ROOT/infra/nginx/nginx.conf" /etc/nginx/nginx.conf
install -d -m 0755 /etc/nginx/snippets/670send /etc/nginx/sites-available /etc/nginx/sites-enabled
for f in "$ROOT"/infra/nginx/snippets/*.conf; do
  dest=/etc/nginx/snippets/670send/$(basename "$f")
  # the allow-list is operator-owned: never overwrite it once edited
  [[ $(basename "$f") == admin-allowlist.conf && -e $dest ]] && continue
  install -m 0644 "$f" "$dest"
done
for f in "$ROOT"/infra/nginx/sites/*.conf "$ROOT"/infra/nginx/acme-bootstrap.conf; do install -m 0644 "$f" "/etc/nginx/sites-available/$(basename "$f")"; done
rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf
if ! ls /etc/nginx/sites-enabled/* >/dev/null 2>&1; then
  ln -sfn /etc/nginx/sites-available/acme-bootstrap.conf /etc/nginx/sites-enabled/acme-bootstrap.conf
fi
nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx

# ---------------------------------------------------------------------------------------------- backup timers
log "installing the backup timers (they stay disabled until the backup keys are configured)"
for u in "$ROOT"/infra/backup/systemd/*; do install -m 0644 "$u" "/etc/systemd/system/$(basename "$u")"; done
systemctl daemon-reload

log "done. Next steps:"
note "1. edit /opt/670send/.env            (every CHANGE_ME)"
note "2. point DNS for 670send.tl, www, app, admin, api at this server"
note "3. sudo ./infra/scripts/issue-certs.sh --email you@example.com"
note "4. as $ADMIN_USER:  ./infra/scripts/deploy.sh      (log out and in once so the docker group applies)"
note "5. set up backups: docs/DEPLOYMENT.md §9, then  sudo systemctl enable --now 670send-backup.timer 670send-restore-drill.timer"
