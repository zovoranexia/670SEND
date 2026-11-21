# infra — the 670Send DevOps kit (Phase 8)

Everything needed to run 670Send on **one Ubuntu 26.04 LTS VPS**. The step-by-step manual is
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md); this page is the map.

```
docker-compose.prod.yml          postgres · redis · api · web (+ migrate job)   — repository root
infra/
  docker/        api.Dockerfile · web.Dockerfile · static.Dockerfile             multi-stage, non-root, health-checked
  env/           production.env.example                                           every variable, with how to generate it
  nginx/         nginx.conf · sites/*.conf · snippets/*                           4 vhosts, TLS, headers, rate limits
  host/          harden-ubuntu.sh · lib.sh                                        SSH, ufw, fail2ban, sysctl, auto-updates
  scripts/       bootstrap.sh · issue-certs.sh · deploy.sh · rollback.sh · status.sh
  backup/        backup.sh · restore.sh · restore-drill.sh · systemd/*.timer      GPG-encrypted, off-site (R2/S3)
```

| Do this | With |
|---|---|
| Harden a fresh server | `sudo ADMIN_USER=deploy ADMIN_SSH_PUBKEY='ssh-ed25519 …' infra/host/harden-ubuntu.sh` |
| Install Docker, Nginx, Certbot, rclone | `sudo infra/scripts/bootstrap.sh` |
| Get HTTPS certificates | `sudo infra/scripts/issue-certs.sh --email ops@example.com` |
| Deploy / update | `infra/scripts/deploy.sh` (as the operator, not root) |
| Roll back | `infra/scripts/rollback.sh [release]` |
| Is it healthy? | `infra/scripts/status.sh` |
| Back up now / list / restore | `sudo infra/backup/backup.sh` · `restore.sh --list` · `restore.sh --latest --target scratch` |

How the pieces fit:

```
Internet ──443──▶ host Nginx ──▶ 127.0.0.1:3100  web   (Next.js, container)
   (ufw: 22/80/443)   │      ──▶ 127.0.0.1:4010  api   (NestJS, container) ──▶ postgres · redis   (internal network, no published ports)
                      │                                    └──▶ Cloudflare R2 (photos), WhatsApp provider
                      └──▶ /srv/670send/current/{pwa,admin}   static apps (atomic symlink per release)
```
