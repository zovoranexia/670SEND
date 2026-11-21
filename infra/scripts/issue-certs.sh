#!/usr/bin/env bash
# 670Send — obtain the Let's Encrypt certificates and switch Nginx from the ACME-only bootstrap to the real vhosts.
#
#   sudo ./infra/scripts/issue-certs.sh --email ops@zovoranexia.example           # real certificates
#   sudo ./infra/scripts/issue-certs.sh --email ops@zovoranexia.example --staging # rehearsal (untrusted certs, no rate limit)
#   sudo ./infra/scripts/issue-certs.sh --email ops@zovoranexia.example --force   # replace the rehearsal certificates with real ones
#
# Prerequisite: DNS A/AAAA records of 670send.tl, www., app., admin. and api. point at this server and ports 80/443
# are open. Four certificates are issued (one per site; www is a name on the apex certificate). Renewal is automatic
# (certbot's systemd timer) and a deploy hook reloads Nginx. Safe to run again: certbot skips certificates that are
# not due.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=../host/lib.sh
source "$ROOT/infra/host/lib.sh"
need_root

EMAIL=""; STAGING=(); FORCE=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --email) EMAIL=$2; shift 2 ;;
    --staging) STAGING=(--staging); shift ;;
    --force) FORCE=(--force-renewal); shift ;;   # replace existing certificates now (e.g. staging → real)
    *) die "unknown option $1 (use --email <address> [--staging] [--force])" ;;
  esac
done
[[ -n $EMAIL ]] || die "--email is required (Let's Encrypt sends expiry warnings there)"

# site → host names on its certificate
declare -A SITES=(
  [670send.tl]="670send.tl www.670send.tl"
  [app.670send.tl]="app.670send.tl"
  [admin.670send.tl]="admin.670send.tl"
  [api.670send.tl]="api.670send.tl"
)

# 1. only the ACME responder on port 80 (the real vhosts reference certificates that do not exist yet)
log "switching Nginx to the ACME-only configuration"
find /etc/nginx/sites-enabled -mindepth 1 -maxdepth 1 -exec rm -f {} +
ln -sfn /etc/nginx/sites-available/acme-bootstrap.conf /etc/nginx/sites-enabled/acme-bootstrap.conf
nginx -t && systemctl reload nginx

# 2. check DNS before spending a Let's Encrypt attempt (5 failures per hour per host)
my_ip=$(curl -fsS -4 https://api.ipify.org 2>/dev/null || true)
for name in 670send.tl www.670send.tl app.670send.tl admin.670send.tl api.670send.tl; do
  resolved=$(getent ahostsv4 "$name" | awk 'NR==1{print $1}' || true)
  if [[ -z $resolved ]]; then die "$name does not resolve yet: create the DNS record first"; fi
  if [[ -n $my_ip && $resolved != "$my_ip" ]]; then warn "$name → $resolved but this server is $my_ip"; confirm "Continue anyway?" || exit 1; fi
done

# 3. certificates
for site in "${!SITES[@]}"; do
  args=()
  for n in ${SITES[$site]}; do args+=(-d "$n"); done
  log "certificate for ${SITES[$site]}"
  certbot certonly --webroot -w /var/www/certbot --cert-name "$site" "${args[@]}" \
    --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --keep-until-expiring "${STAGING[@]}" "${FORCE[@]}"
done

# 4. renewal: reload Nginx after every successful renewal
write_file /etc/letsencrypt/renewal-hooks/deploy/670send-reload-nginx.sh 0755 <<'EOF' || true
#!/bin/sh
# Managed by 670Send infra/scripts/issue-certs.sh
nginx -t && systemctl reload nginx
EOF
systemctl enable --now certbot.timer >/dev/null 2>&1 || warn "certbot.timer not found: add a daily 'certbot renew' cron job"

# 5. the real vhosts
log "enabling the 670Send vhosts"
rm -f /etc/nginx/sites-enabled/acme-bootstrap.conf
for f in 670send.tl app.670send.tl admin.670send.tl api.670send.tl; do ln -sfn "/etc/nginx/sites-available/$f.conf" "/etc/nginx/sites-enabled/$f.conf"; done
if ! nginx -t; then
  warn "the full configuration is invalid — going back to the ACME-only one"
  rm -f /etc/nginx/sites-enabled/*.conf; ln -sfn /etc/nginx/sites-available/acme-bootstrap.conf /etc/nginx/sites-enabled/acme-bootstrap.conf
  nginx -t && systemctl reload nginx
  die "fix the Nginx configuration, then run this script again"
fi
systemctl reload nginx

log "renewal rehearsal (no certificates are changed)"
certbot renew --dry-run --quiet && note "renewal works" || warn "renewal dry run failed: read /var/log/letsencrypt/letsencrypt.log"
log "done. Check:  curl -sI https://670send.tl | head -1   ·   https://www.ssllabs.com/ssltest/"
