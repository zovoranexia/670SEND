#!/usr/bin/env bash
# 670Send — one screen that answers "is everything fine?". Safe to run any time; changes nothing.
set -uo pipefail
APP=${APP_DIR:-/opt/670send/app}
ENV_FILE=${ENV_FILE:-/opt/670send/.env}
# shellcheck source=../host/lib.sh
source "$APP/infra/host/lib.sh"
dc() { docker compose --env-file "$ENV_FILE" -f "$APP/docker-compose.prod.yml" "$@"; }
sudo_() { if [[ $EUID -eq 0 ]]; then "$@"; else sudo -n "$@" 2>/dev/null; fi; }

log "containers"
dc ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || warn "cannot read docker compose state"
log "api"
curl -fsS -m 5 http://127.0.0.1:4010/v1/health/ready && echo || warn "API readiness check FAILED"
log "last releases"
tail -n 5 /opt/670send/releases.log 2>/dev/null || note "no release recorded yet"
log "disk and memory"
df -h / /var/lib/docker 2>/dev/null | awk 'NR==1||!seen[$1]++'
free -h | sed -n '1,2p'
log "nginx"
sudo_ nginx -t 2>&1 | tail -2 || note "(nginx -t needs sudo)"
log "certificates (days left)"
for h in 670send.tl app.670send.tl admin.670send.tl api.670send.tl; do
  end=$(echo | timeout 5 openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [[ -n $end ]]; then printf '  %-22s %s days\n' "$h" "$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))"; else printf '  %-22s unreachable\n' "$h"; fi
done
log "backups"
if systemctl list-timers '670send-*' --no-pager 2>/dev/null | grep -q 670send; then systemctl list-timers '670send-*' --no-pager | head -5; else note "backup timers are not enabled yet (docs/DEPLOYMENT.md §9)"; fi
[[ -r /var/lib/670send/last-backup ]] && note "last successful backup: $(cat /var/lib/670send/last-backup)"
[[ -r /var/lib/670send/last-restore-drill ]] && note "last restore drill:      $(cat /var/lib/670send/last-restore-drill)"
log "security"
sudo_ ufw status | head -3 || true
sudo_ fail2ban-client status sshd 2>/dev/null | grep -E 'Currently banned|Total banned' || true
[[ -f /var/run/reboot-required ]] && warn "a reboot is pending (kernel update); unattended-upgrades reboots at 03:30"
exit 0
