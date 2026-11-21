#!/usr/bin/env bash
# 670Send — harden a fresh Ubuntu 26.04 LTS VPS. Idempotent: safe to run again after every change.
#
#   sudo ADMIN_USER=deploy ./infra/host/harden-ubuntu.sh
#
# What it does (each step is explained in docs/DEPLOYMENT.md §3):
#   1. packages + security updates   2. timezone + time sync (Asia/Dili, chrony)   3. a non-root admin user
#   4. SSH: keys only, no root, one allowed user     5. firewall (ufw): 22, 80, 443 only
#   6. fail2ban for SSH   7. kernel/network sysctl   8. unattended security updates (+ reboot at 03:30 when needed)
#   9. auditd watches on the files that matter   10. journald limits, swap, root account locked
#
# It refuses to switch SSH to key-only unless the admin user already has an authorized key, so it cannot lock you out.
# Keep your current SSH session open until you have logged in successfully in a SECOND terminal.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

ADMIN_USER=${ADMIN_USER:-deploy}
SSH_PORT=${SSH_PORT:-22}
SWAP_SIZE_GB=${SWAP_SIZE_GB:-2}
TIMEZONE=${TIMEZONE:-Asia/Dili}
# A public key to install for the admin user (optional if ~/.ssh/authorized_keys already exists there).
ADMIN_SSH_PUBKEY=${ADMIN_SSH_PUBKEY:-}

need_root
[[ $SSH_PORT =~ ^[0-9]+$ ]] || die "SSH_PORT must be a number"
. /etc/os-release
if [[ ${ID:-} != ubuntu || ${VERSION_ID:-} != 26.04 ]]; then
  warn "this script is written for Ubuntu 26.04 (found ${PRETTY_NAME:-unknown})."
  confirm "Continue anyway?" || exit 1
fi
export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------------------------------------ 1. packages
log "1/10 packages and security updates"
apt-get update -qq
apt-get -y -qq full-upgrade
apt-get -y -qq install ufw fail2ban unattended-upgrades apt-listchanges chrony auditd needrestart \
  curl ca-certificates gnupg jq git rsync logrotate openssh-server >/dev/null

# ------------------------------------------------------------------------------------------------ 2. time
log "2/10 timezone ($TIMEZONE) and time synchronisation"
timedatectl set-timezone "$TIMEZONE"
systemctl enable --now chrony >/dev/null 2>&1 || true
note "$(timedatectl show -p Timezone --value) — NTP synchronised: $(timedatectl show -p NTPSynchronized --value)"

# ------------------------------------------------------------------------------------------------ 3. admin user
log "3/10 admin user '$ADMIN_USER'"
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "670Send operator" "$ADMIN_USER" >/dev/null
  usermod -aG sudo "$ADMIN_USER"
  log "created $ADMIN_USER (sudo). Set a password for sudo now:  passwd $ADMIN_USER"
  if [[ -t 0 && ${ASSUME_YES:-0} != 1 ]]; then passwd "$ADMIN_USER" || warn "no password set: sudo will not work for $ADMIN_USER until you set one"; fi
fi
home=$(getent passwd "$ADMIN_USER" | cut -d: -f6)
install -d -m 0700 -o "$ADMIN_USER" -g "$ADMIN_USER" "$home/.ssh"
if [[ -n $ADMIN_SSH_PUBKEY ]]; then
  touch "$home/.ssh/authorized_keys"
  grep -qxF "$ADMIN_SSH_PUBKEY" "$home/.ssh/authorized_keys" || echo "$ADMIN_SSH_PUBKEY" >>"$home/.ssh/authorized_keys"
fi
chown "$ADMIN_USER:$ADMIN_USER" "$home/.ssh/authorized_keys" 2>/dev/null || true
chmod 0600 "$home/.ssh/authorized_keys" 2>/dev/null || true
if [[ ! -s $home/.ssh/authorized_keys ]]; then
  die "$ADMIN_USER has no SSH key ($home/.ssh/authorized_keys is empty). Re-run with ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA… you@laptop' — refusing to disable password login, you would be locked out."
fi
# The first-boot cloud image may keep a root key in /root/.ssh: it stays for emergency console use but root SSH is off below.

# ------------------------------------------------------------------------------------------------ 4. SSH
log "4/10 SSH (keys only, no root login, only $ADMIN_USER)"
write_file /etc/ssh/sshd_config.d/99-670send.conf 0644 <<EOF || true
# Managed by 670Send infra/host/harden-ubuntu.sh — edit the script, not this file.
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
AllowUsers $ADMIN_USER
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 20
PermitEmptyPasswords no
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
ClientAliveInterval 300
ClientAliveCountMax 2
LogLevel VERBOSE
EOF
# Ubuntu starts sshd through socket activation: the port lives in the socket unit, not only in sshd_config.
if [[ $SSH_PORT != 22 ]] && systemctl list-unit-files ssh.socket >/dev/null 2>&1; then
  write_file /etc/systemd/system/ssh.socket.d/670send.conf 0644 <<EOF || true
[Socket]
ListenStream=
ListenStream=$SSH_PORT
EOF
  systemctl daemon-reload
fi
sshd -t || die "sshd configuration test failed — nothing was reloaded"
if systemctl is-active ssh.socket >/dev/null 2>&1; then systemctl restart ssh.socket; fi
systemctl reload ssh 2>/dev/null || systemctl restart ssh
note "keep this session open and test a NEW login before closing it"

# ------------------------------------------------------------------------------------------------ 5. firewall
log "5/10 firewall (ufw): SSH $SSH_PORT, 80, 443"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit "$SSH_PORT"/tcp comment 'ssh (rate limited)' >/dev/null
ufw allow 80/tcp comment 'http (redirect + ACME)' >/dev/null
ufw allow 443/tcp comment 'https' >/dev/null
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw --force enable >/dev/null
note "Docker publishes ports straight into iptables and bypasses ufw: this is why docker-compose.prod.yml binds only to 127.0.0.1"

# ------------------------------------------------------------------------------------------------ 6. fail2ban
log "6/10 fail2ban (SSH only — see docs: mobile carriers in Timor-Leste share addresses, so web bans are not used)"
write_file /etc/fail2ban/jail.d/670send.local 0644 <<EOF || true
[DEFAULT]
backend = systemd
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w
findtime = 10m
maxretry = 4
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = $SSH_PORT

[recidive]
enabled = true
backend = auto
logpath = /var/log/fail2ban.log
bantime = 1w
findtime = 1d
maxretry = 3
EOF
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl restart fail2ban

# ------------------------------------------------------------------------------------------------ 7. sysctl
log "7/10 kernel and network settings"
# net.ipv4.ip_forward must stay ON: Docker needs it to route container traffic.
write_file /etc/sysctl.d/99-670send.conf 0644 <<'EOF' || true
# Managed by 670Send infra/host/harden-ubuntu.sh
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.tcp_rfc1337 = 1
net.core.somaxconn = 1024
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
kernel.unprivileged_bpf_disabled = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0
# Redis background saves need this (otherwise "Can't save in background: fork" under memory pressure).
vm.overcommit_memory = 1
vm.swappiness = 10
EOF
sysctl --system >/dev/null

# ------------------------------------------------------------------------------------------------ 8. updates
log "8/10 unattended security updates"
write_file /etc/apt/apt.conf.d/52670send-unattended 0644 <<'EOF' || true
// Managed by 670Send infra/host/harden-ubuntu.sh
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
// Kernel updates need a reboot. Do it at 03:30 Díli time (the quietest hour); every container restarts by itself.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
write_file /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
write_file /etc/needrestart/conf.d/670send.conf 0644 <<'EOF' || true
# Restart services after library updates automatically; never ask (no tty during unattended upgrades).
$nrconf{restart} = 'a';
EOF

# ------------------------------------------------------------------------------------------------ 9. audit
log "9/10 audit trail for the files that matter"
write_file /etc/audit/rules.d/670send.rules 0640 <<'EOF' || true
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/sudoers -p wa -k sudoers
-w /etc/sudoers.d/ -p wa -k sudoers
-w /etc/ssh/sshd_config -p wa -k sshd
-w /etc/ssh/sshd_config.d/ -p wa -k sshd
-w /opt/670send/.env -p rwa -k 670send-secrets
-w /etc/nginx/ -p wa -k nginx
-w /etc/docker/ -p wa -k docker
EOF
augenrules --load >/dev/null 2>&1 || true

# ------------------------------------------------------------------------------------------------ 10. housekeeping
log "10/10 journald limits, swap, root account"
write_file /etc/systemd/journald.conf.d/670send.conf 0644 <<'EOF' || true
[Journal]
SystemMaxUse=500M
MaxRetentionSec=1month
Storage=persistent
EOF
systemctl restart systemd-journald
if ! swapon --show --noheadings | grep -q .; then
  log "creating a ${SWAP_SIZE_GB} GB swap file (argon2 hashing and the Next.js build have memory peaks)"
  fallocate -l "${SWAP_SIZE_GB}G" /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
passwd -l root >/dev/null 2>&1 || true   # no password login for root (key-less); use sudo from $ADMIN_USER

log "done. Verify:"
note "ssh -p $SSH_PORT $ADMIN_USER@<server>        (second terminal, BEFORE closing this one)"
note "sudo ufw status verbose · sudo fail2ban-client status sshd · sudo sshd -T | grep -Ei 'permitroot|passwordauth|allowusers'"
note "next: sudo ./infra/scripts/bootstrap.sh"
