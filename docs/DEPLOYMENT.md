# 670Send — deployment manual (one Ubuntu 26.04 VPS)

This is the whole path from an empty server to a running, monitored, backed-up 670Send, written for the person who
will operate it. Every command is meant to be copied. Time needed the first time: about half a day (most of it waiting
for DNS, Docker builds and the Meta/WhatsApp approvals — not for typing).

> **Status of this document.** The scripts and configuration were checked as far as a developer PC allows: shell
> scripts with `shellcheck`, the Docker Compose file against the example environment, the Nginx configuration in a
> container with stub back-ends (`infra/nginx/test.sh`), and the backup → restore round trip in an `ubuntu:26.04`
> container against a real PostgreSQL 17. **Nothing has been run on a real Ubuntu 26.04 VPS with real DNS, real
> Let's Encrypt certificates or a real Cloudflare R2 bucket.** §13 lists exactly what is verified and what is not.
> Do the first deployment on a staging server (a cheap VPS and `--staging` certificates) before the production one.

---

## 1. What you are building

```
Internet ──443──▶ host Nginx ──▶ 127.0.0.1:3100  web   (Next.js, container)
   (ufw: 22/80/443)   │      ──▶ 127.0.0.1:4010  api   (NestJS, container) ──▶ postgres · redis   (internal Docker network)
                      │                                    └──▶ Cloudflare R2 (photos & slips), WhatsApp provider
                      └──▶ /srv/670send/current/{pwa,admin}   static apps, one folder per release, atomic symlink
```

| Host name | Serves | Where |
|---|---|---|
| `670send.tl`, `www.670send.tl` | public site (4 languages) | `web` container |
| `app.670send.tl` | field app (agents, couriers, drivers) | static files |
| `admin.670send.tl` | back-office console | static files |
| `api.670send.tl` | the API (`/v1/…`) | `api` container |

Design choices worth knowing:

* **Nginx and Certbot run on the host**, not in containers: fewer moving parts, certificates and renewal are plain
  Ubuntu packages, and a failed deploy can never take the front door down.
* **Nothing is published on a public interface except 80 and 443.** The two containers listen on `127.0.0.1` only;
  PostgreSQL and Redis have no published port and sit on a Docker network with no route to the Internet.
  (Docker bypasses `ufw` for published ports — that is why they are bound to loopback instead of "protected" by a rule.)
* **One server, no orchestrator.** A 2 vCPU / 4 GB / 40 GB VPS carries the expected launch load. When it stops being
  enough, the order of growth is: bigger VPS → managed PostgreSQL (`PG_MODE=direct` is already supported by the backup
  scripts) → a second API container behind the same Nginx (note: BullMQ's repeatable jobs register once per boot, so run
  exactly **one** API instance until the cron jobs are moved to a separate worker).
* **Releases are immutable and kept** (images tagged with the commit, static folders per release): a rollback is a
  tag switch, not a rebuild.

## 2. Before you start

| You need | Notes |
|---|---|
| A VPS with **Ubuntu 26.04 LTS**, 2 vCPU, 4 GB RAM, 40 GB disk, a public IPv4 | Provider choice is yours; pick a region with good latency to Díli (Singapore / Jakarta). Enable the provider's snapshots too — they are not a substitute for §9. |
| DNS control of **670send.tl** | A (and AAAA) records for `670send.tl`, `www`, `app`, `admin`, `api` → the server. Create them now; propagation takes a while. |
| A **Cloudflare R2** account with **two private buckets** | `670send-private` (photos, slips) and `670send-backups` (encrypted database backups). Two buckets, **two API tokens**: a leak of one must not expose the other. |
| A **WhatsApp provider** | Meta Cloud API (approved message templates for business-initiated messages), Fonnte, or a self-hosted WAHA. The API refuses to start in production with `console`. |
| A laptop with **GnuPG** | To create the backup key pair (§9). The private key never goes on the server. |
| An email address for certificate expiry warnings | Let's Encrypt writes there. |
| A tile server for the pick-up map | The public OpenStreetMap server must not carry production traffic (`MAP_TILE_URL`). |

## 3. Harden the server (30 minutes)

Log in as the user your provider gave you (usually `root` or `ubuntu`), get the code, and run the hardening script.
On your laptop, print your public key: `cat ~/.ssh/id_ed25519.pub`.

```bash
apt-get update && apt-get install -y git
git clone https://github.com/zovoranexia/670SEND.git /opt/670send-app && cd /opt/670send-app
sudo ADMIN_USER=deploy ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA… you@laptop' ./infra/host/harden-ubuntu.sh
```

What it does, and why:

| Step | Result |
|---|---|
| Packages, `full-upgrade` | Everything patched before anything is exposed. |
| Timezone `Asia/Dili`, `chrony` | Logs, cron and the backup timers use Díli time; the clock cannot drift (it matters for OTP expiry and JWTs). |
| User `deploy` | The only account allowed to log in. Passwordless account + your key; **set its sudo password when asked**. |
| SSH | Key only, no root login, no password or keyboard-interactive login, `AllowUsers deploy`, 3 tries, no forwarding, idle timeout. **Refuses to run if `deploy` has no key**, so it cannot lock you out. |
| `ufw` | Deny incoming except SSH (rate-limited), 80, 443. IPv6 on. |
| `fail2ban` | Bans repeated SSH failures (1 h, doubling, 1 week for repeat offenders). Web bans are deliberately **not** used: mobile carriers in Timor-Leste share public addresses (CGNAT), and banning one would lock out a whole town. |
| `sysctl` | SYN-cookie, no redirects/source routing, reverse-path filter, restricted kernel pointers/dmesg/ptrace, `vm.overcommit_memory=1` (Redis). `ip_forward` is left on — Docker needs it. |
| Unattended upgrades | Security updates automatic; **reboots at 03:30** when a kernel update needs it. All containers restart by themselves. |
| `auditd` | Watches `/etc/passwd`, `sudoers`, SSH and Nginx config, Docker config and the secrets file. |
| journald, swap, root | Journal capped at 500 MB; 2 GB swap if none (argon2 and the Next.js build have memory peaks); root password login locked. |

**Do this before closing the root session:** open a *second* terminal and run `ssh deploy@<server>`. Only when that
works, close the first. Then, from now on, work as `deploy`.

```bash
sudo ufw status verbose          # 22 (limit), 80, 443
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|allowusers'
sudo fail2ban-client status sshd
```

## 4. Install the platform software (10 minutes)

```bash
cd /opt/670send-app
sudo chown -R deploy:deploy /opt/670send-app          # the operator owns the checkout (deploy.sh pulls and builds from it)
sudo ADMIN_USER=deploy ./infra/scripts/bootstrap.sh   # also links /opt/670send/app → this checkout
exit            # log out and back in once, so the new `docker` group applies to deploy
```

`bootstrap.sh` installs Docker Engine + the compose plugin (from Docker's repository; if it has no `resolute` suite yet
it falls back to Ubuntu's `docker.io`), Nginx, Certbot, rclone and gnupg; writes `/etc/docker/daemon.json` (log
rotation, `live-restore`, `no-new-privileges`, no inter-container traffic on the default bridge); creates the layout

```
/opt/670send/app            this repository                  /opt/670send/.env        secrets (root:deploy 0640)
/opt/670send/releases.log   one line per deploy              /srv/670send/releases/*  static builds, one per release
/srv/670send/current        symlink to the live release      /var/www/certbot         ACME webroot
```

and installs the hardened Nginx configuration with an ACME-only vhost (no certificate needed yet).
Membership of the `docker` group is root-equivalent: only `deploy` is in it.

## 5. Configure (15 minutes)

```bash
sudo nano /opt/670send/.env           # created from infra/env/production.env.example; every CHANGE_ME must go
```

Generate the secrets (each command prints one value; paste it in, do not reuse values between variables):

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD, REDIS_PASSWORD     (hex only: they go inside connection URLs)
openssl rand -hex 32      # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (different!), OTP_PEPPER
openssl rand -base64 32   # FIELD_ENCRYPTION_KEY
```

| Variable group | Notes |
|---|---|
| URLs, `CORS_ORIGINS` | Exact origins, no wildcards, no trailing slash. |
| `S3_*` | R2: endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`, bucket `670send-private`, a token scoped **only** to that bucket (Object Read & Write). |
| `WHATSAPP_PROVIDER` + its credentials | `meta`, `fonnte` or `waha`. Leave unused providers **commented out** — an empty value fails validation. |
| `SEED_SUPERADMIN_*` | The first Super Admin (≥ 14-character password). The first sign-in forces a password change. |
| `BACKUP_*` | See §9. |

> **Back up `/opt/670send/.env` somewhere safe and offline** (password manager). Losing `FIELD_ENCRYPTION_KEY` makes the
> stored fleet bank accounts unrecoverable; rotating `OTP_PEPPER` invalidates every live pick-up OTP. The nightly backup
> also carries an encrypted copy of this file.

The API checks its own configuration at start and refuses to run with a placeholder secret, with identical JWT
secrets, with `WHATSAPP_PROVIDER=console`, with `S3_AUTO_CREATE_BUCKET=true` or without CORS origins. Create the R2
bucket yourself first (the API will not).

## 6. HTTPS certificates (10 minutes, once DNS resolves)

```bash
dig +short 670send.tl app.670send.tl admin.670send.tl api.670send.tl      # all four must show this server's IP
sudo ./infra/scripts/issue-certs.sh --email ops@zovoranexia.example --staging    # rehearsal first (untrusted certs, no rate limit)
sudo ./infra/scripts/issue-certs.sh --email ops@zovoranexia.example --force      # the real ones (--force replaces the rehearsal certificates)
```

The script switches Nginx to the ACME-only config, checks DNS, obtains four certificates (`www` is a name on the apex
certificate), installs a renewal hook that reloads Nginx, enables the real vhosts (falling back to ACME-only if the
configuration does not validate), and finishes with `certbot renew --dry-run`. Renewal then runs by itself twice a day
(`systemctl list-timers certbot.timer`); a certificate renews when it has 30 days left.

After a `--staging` rehearsal, run the real issuance with `--force` so the untrusted certificates are replaced at once
(without it certbot keeps a certificate that is not yet due, whoever issued it):
`sudo ./infra/scripts/issue-certs.sh --email ops@zovoranexia.example --force`.

## 7. First deployment (20–40 minutes, mostly the first build)

As `deploy`:

```bash
cd /opt/670send/app
./infra/scripts/deploy.sh --no-backup        # first time only: there is no database to back up yet
```

`deploy.sh` runs these steps and stops at the first failure:

1. **Preflight** — Docker reachable, `.env` has no placeholders, the two JWT secrets differ, WhatsApp is not `console`,
   the compose file validates, ≥ 6 GB free.
2. **Checkout** — `git pull --ff-only` (or `--ref <tag|commit>`); the release id is the commit.
3. **Pre-deploy backup** — encrypted and uploaded (skipped on the first deploy).
4. **Build** — images for `api`, `web`, `migrate`, and the two static apps (their own build-time smoke checks run in the build).
5. **Migrate** — `prisma migrate deploy` and the **idempotent** seed (reference data, RBAC, tariffs, templates, the first Super Admin; it never overwrites what an admin edited).
6. **Start** the new `api` and `web`.
7. **Health gate** — both containers healthy *and* `/v1/health/ready` (database reachable), up to 150 s. On failure the previous images are started again and the static apps are never switched.
8. **Publish** the static apps by switching the `current` symlink atomically.
9. **Record and prune** — `releases.log`; the last 5 releases and their images are kept.

Then check:

```bash
./infra/scripts/status.sh
curl -s https://api.670send.tl/v1/health          # {"status":"ok"}
```

Open `https://admin.670send.tl`, sign in with the `SEED_SUPERADMIN_*` account, change the password when asked, and do
the first-day checklist:

- [ ] Partners → create the 670Link agents and fleet partners (MoU dates, bank accounts, vehicles/drivers with permits).
- [ ] Finance → tariffs reviewed (zone rates in all four languages), `claim_cs_approval_limit_usd`, bus capacity setting.
- [ ] Templates → the 11 WhatsApp messages read correctly in the four languages; send one real test parcel end to end.
- [ ] Users → one named account per back-office person; no shared accounts; the seeded Super Admin kept for emergencies.
- [ ] §9 done (backups running **and one restore tested**).

## 8. Operating it

| Task | Command |
|---|---|
| Deploy the latest code | `./infra/scripts/deploy.sh` |
| Deploy a tag or commit | `./infra/scripts/deploy.sh --ref v1.3.0` |
| Roll back to the previous release | `./infra/scripts/rollback.sh` (or `… <release>`; see `/opt/670send/releases.log`) |
| Everything at a glance | `./infra/scripts/status.sh` |
| Logs | `docker compose --env-file /opt/670send/.env -f docker-compose.prod.yml logs -f --tail 100 api` · Nginx: `/var/log/nginx/{access,error}.log` |
| Restart one service | `… restart api` |
| Open a database shell | `… exec postgres psql -U send670 -d send670` |
| Nginx change | edit `infra/nginx/…`, run `infra/nginx/test.sh`, then `sudo ./infra/scripts/bootstrap.sh && sudo nginx -t && sudo systemctl reload nginx` |

**Rollbacks change code, not data.** Migrations are forward-only; 670Send migrations are additive, so the previous code
runs fine on the newer schema. If a release ever includes a destructive data migration, treat the pre-deploy backup
(taken automatically, labelled `pre-<release>`) as the way back (§10).

**Updates of the operating system** are automatic (security) with a reboot at 03:30 when needed. Once a month, run
`sudo apt update && sudo apt full-upgrade` for the rest, and `docker compose … pull postgres redis` + a deploy for new
base images of PostgreSQL/Redis (stay on the same major version; a PostgreSQL major upgrade is a planned dump/restore, not a pull).

**Disk:** `docker system df`, `docker image prune -a` (deploy.sh already prunes old releases); Postgres logs slow queries (> 500 ms) to the container log.

**Monitoring.** Out of the box: container health checks with automatic restart, the `status.sh` page, the backup
dead-man's-switch (§9). Add an external uptime monitor on `https://api.670send.tl/v1/health` and
`https://670send.tl/` (any free service; alert by WhatsApp/email) — that is the one check that notices the whole
server being down.

## 9. Backups — the part that decides whether a bad day is survivable

**What is protected:** the PostgreSQL database (every parcel, wallet, ledger entry, audit row) and a copy of the secrets file,
encrypted so the server (and the bucket) cannot read them. **Photos** live in the R2 photo bucket: protect them there
(below). **Redis** holds only queue state and is rebuilt on start.

**Targets:** RPO (data you can lose) ≈ 24 h with the nightly job, plus the pre-deploy backup before every release;
RTO (time to be running again) ≈ 1–2 hours on a fresh server (§10). Tighten the RPO by running the timer more often or
by adding PostgreSQL WAL archiving once the business needs it.

### 9.1 Create the backup key (once, on your laptop — not on the server)

```bash
gpg --quick-generate-key "670Send backup <backup@zovoranexia.example>" default default 0     # ed25519 + an encryption subkey, no expiry; set a strong passphrase
gpg --armor --export backup@zovoranexia.example > backup-public.asc
gpg --armor --export-secret-keys backup@zovoranexia.example > backup-private.asc          # → password manager + offline USB, two places
```

The private key is the only thing that can open a backup. **If you lose it, every backup is garbage; if someone else
gets it together with the bucket, they can read your data.** Store it offline in two places and tell a second person where.

### 9.2 Configure the server

```bash
sudo install -d -m 0700 /etc/670send/gnupg
sudo GNUPGHOME=/etc/670send/gnupg gpg --import backup-public.asc          # the PUBLIC key only
sudo rclone config --config /etc/670send/rclone.conf                      # new remote "r2backup": type s3, provider Cloudflare,
sudo chmod 600 /etc/670send/rclone.conf                                   #   the BACKUP bucket's own access key, endpoint https://<account>.r2.cloudflarestorage.com
sudo nano /opt/670send/.env      # BACKUP_GPG_RECIPIENT=backup@zovoranexia.example · BACKUP_RCLONE_REMOTE=r2backup:670send-backups
sudo ./infra/backup/backup.sh    # run one now
sudo ./infra/backup/restore.sh --list
sudo systemctl enable --now 670send-backup.timer 670send-restore-drill.timer
```

Optionally add a **dead-man's switch**: a free healthchecks.io check per job; set `BACKUP_PING_URL` and
`BACKUP_DRILL_PING_URL`. The jobs ping on success and `/fail` on failure, so "the backup silently stopped" becomes an email.

Retention: `daily/` keeps 30 days, the first backup of each month is copied to `monthly/` and kept ~13 months. For defence
against ransomware or a stolen token, enable **Object Lock / bucket versioning** on the backup bucket if your plan allows,
and give the backup token no *delete* permission beyond its prefix.

### 9.3 Photos (the R2 photo bucket)

Turn on **versioning** (or an R2 lifecycle rule that keeps noncurrent versions ≥ 30 days) so a mistaken delete is
recoverable, keep the bucket **private** (the API hands out 5-minute signed links), and use a token limited to that
bucket. Consider a second, scheduled `rclone sync` to a different provider if photo evidence is legally important.

### 9.4 The monthly restore drill (15 minutes, by a human, with the offline key)

A backup nobody has restored is a hope. Once a month:

```bash
export RESTORE_GNUPGHOME=$(mktemp -d)                                     # a throw-away keyring on the server
sudo gpg --homedir "$RESTORE_GNUPGHOME" --import backup-private.asc       # copy the file up with scp; passphrase when asked
sudo RESTORE_GNUPGHOME=$RESTORE_GNUPGHOME ./infra/backup/restore.sh --latest --target scratch
sudo rm -rf "$RESTORE_GNUPGHOME"; shred -u backup-private.asc
```

It downloads the newest backup, verifies the checksum, decrypts, restores into a disposable PostgreSQL 17 container,
and checks: migrations finished, **the ledger nets to exactly zero**, and user/shipment/ledger row counts equal those
recorded at backup time. "RESTORE OK" is the only acceptable end.

The weekly timer (`670send-restore-drill`) covers the integrity half automatically: the newest backup exists, is < 36 h old,
matches its checksum and is a valid encrypted message. It can run the full restore unattended only if you deliberately
keep a second "drill" key on the server (add it to `BACKUP_GPG_RECIPIENT`, comma-separated); by default there is none, on purpose.

## 10. When things go wrong

| Situation | What to do |
|---|---|
| **A release misbehaves** | `./infra/scripts/rollback.sh`. If the health gate caught it during the deploy, the old release is already running. |
| **A migration damaged data** | Stop the traffic (`docker compose … stop api web`), restore the `pre-<release>` backup: `sudo RESTORE_GNUPGHOME=… ./infra/backup/restore.sh --file daily/…/670send-…-pre-<release>.tar.gpg --target live`, then roll back the code. The live restore takes a **safety dump of the current database first** and asks you to type the database name. |
| **Database corrupted / deleted** | `restore.sh --latest --target live` (same safeguards). Expect to lose up to a day of data; reconcile from WhatsApp logs and the audit trail afterwards. |
| **The server is gone** | New VPS → §3, §4 → copy `.env` from your password manager (or from the newest backup: `restore.sh … --with-env` writes `/opt/670send/.env.restored`) → point DNS at the new IP → §6 → `deploy.sh --no-backup` (creates an empty database) → `restore.sh --latest --target live`. Photos are untouched (R2). |
| **A secret leaked** | Rotate it in `.env`, `deploy.sh --skip-pull`. JWT secrets: everyone signs in again. `OTP_PEPPER`: pending pick-up OTPs become invalid (the app can resend them). `FIELD_ENCRYPTION_KEY`: **do not rotate without a re-encryption plan** (bank details). R2 / WhatsApp tokens: rotate at the provider first. |
| **Locked out of SSH** | Use the provider's web console; `sudo fail2ban-client unban <ip>`; check `/etc/ssh/sshd_config.d/99-670send.conf`. |
| **Certificate expired** | `sudo certbot renew` and `sudo systemctl reload nginx`; read `/var/log/letsencrypt/letsencrypt.log` (port 80 closed? DNS changed?). |
| **Disk full** | `docker system df`; `docker image prune -a`; `sudo journalctl --vacuum-size=200M`; `/var/backups/670send` should be empty between backups. |

## 11. Security notes for the operator

* The admin console is on the public Internet by design (staff work from anywhere). Its protections: sign-in rate limits at
  Nginx and in the API, account lock-out, forced temporary-password change, RBAC on every call, audit of every
  sensitive action. To restrict it further, list your office/VPN addresses in
  `/etc/nginx/snippets/670send/admin-allowlist.conf` (an `allow …; deny all;` file that ships empty).
* Nobody should use the `root` or `deploy` accounts for day-to-day work on the platform: the platform's own RBAC
  (Super Admin, Ops, Finance, CS) is what staff use through the console.
* The `deploy` user is root-equivalent (docker group, sudo). Give it to as few people as possible and use one SSH key per person (add keys to `~deploy/.ssh/authorized_keys`).
* Rate limits per IP (Nginx) are generous on purpose because mobile carriers share addresses. If a whole town hits a limit,
  raise `burst` in `infra/nginx/sites/api.670send.tl.conf` and redeploy the config — do not remove the limits.
* Keep the server clock right (`chronyc tracking`): OTP expiry, JWT validity and TLS all depend on it.

## 12. Files, at a glance

See [`infra/README.md`](../infra/README.md). Every script prints what it does and is safe to run again.

## 13. What has — and has not — been verified

**Verified on the development machine**

- All shell scripts pass `shellcheck` (warning level).
- `docker-compose.prod.yml` validates against the example environment; optional variables are absent (not empty) in the API container when unset.
- The three Dockerfiles: all built; the production compose file was run for real (postgres, redis, `migrate` on an empty database, API healthy, read-only/non-root/capabilities dropped, nothing published except the API on loopback); the web container ran hardened with the CSP and HSTS — details in `docs/ARCHITECTURE.md` §10h.
- Host side as far as a container allows: every package the scripts install exists in Ubuntu 26.04, Docker's apt repository has a `resolute` suite, and the generated SSH and fail2ban configurations pass `sshd -t` (OpenSSH 10.2) and `fail2ban-client -t`.
- The Nginx configuration: `infra/nginx/test.sh` (syntax, redirects, ACME path, SPA fallback, cache rules, CSP preserved in cache locations, forged `X-Forwarded-For` overwritten, 405 on writes, rate limiting, upload size limit, unknown hosts).
- Backup → restore round trip in an `ubuntu:26.04` container against PostgreSQL 17 (`gpg`, `rclone` with a local remote): dump, encryption, upload, checksum, retention, scratch restore with the ledger/row-count checks, and the restore drill (integrity-only and full).

**Not verified — do these on a staging server first**

- The hardening script, `bootstrap.sh` and `issue-certs.sh` on a real Ubuntu 26.04 VPS (they were written against Ubuntu's and Docker's documentation; they were syntax-checked, not executed — in particular `ufw`, `fail2ban`, `ssh.socket`, `auditd`, `unattended-upgrades` and Docker's apt repository for the 26.04 codename).
- Real Let's Encrypt issuance and renewal, real DNS, OCSP stapling.
- A real Cloudflare R2 bucket (endpoint, signed URLs through the admin console's CSP, versioning) and a real WhatsApp provider.
- Behaviour under load, and the memory sizing on a 4 GB machine (PostgreSQL 1.5 GB, API 768 MB, web 512 MB, Redis 512 MB limits).
- PostgreSQL major-version upgrades, multi-server setups, WAL archiving / point-in-time recovery (not implemented).
