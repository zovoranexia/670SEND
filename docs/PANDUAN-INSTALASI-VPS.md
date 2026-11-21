# Panduan Lengkap: Instalasi dan Konfigurasi 670Send di VPS Ubuntu 26.04

Panduan ini membawa Anda dari **server kosong** sampai **670Send berjalan, ber-HTTPS, dan ter-backup**. Ditulis untuk
operator yang belum pernah memasang server produksi: setiap langkah menjelaskan *apa* yang dilakukan, *mengapa*, dan
*bagaimana memastikan berhasil*. Semua perintah bisa disalin.

> **Tentang status pengujian (baca dulu).** Image Docker, stack compose produksi, konfigurasi Nginx, dan sistem backup
> sudah dibangun dan diuji sungguhan di komputer pengembangan. **Skrip yang menyentuh server itu sendiri** (pengerasan
> keamanan, pemasangan paket, penerbitan sertifikat, deploy) **belum pernah dijalankan di VPS Ubuntu 26.04 asli**, dan
> belum ada uji dengan DNS, Let's Encrypt, Cloudflare R2, dan penyedia WhatsApp sungguhan. Karena itu: **lakukan seluruh
> panduan ini lebih dulu di server uji** (VPS murah yang dihapus setelahnya) memakai sertifikat `--staging`, baru
> ulangi di server produksi. Bagian 16 merinci apa yang sudah dan belum terbukti.
>
> Panduan teknis versi ringkas (Inggris): [`DEPLOYMENT.md`](DEPLOYMENT.md). Peta berkas: [`../infra/README.md`](../infra/README.md).

---

## Daftar isi

0. [Cara memakai panduan ini](#0-cara-memakai-panduan-ini)
1. [Gambaran besar](#1-gambaran-besar)
2. [Persiapan sebelum mulai](#2-persiapan-sebelum-mulai)
3. [Langkah 1 — Masuk ke server dan ambil kode](#3-langkah-1--masuk-ke-server-dan-ambil-kode)
4. [Langkah 2 — Pengerasan keamanan server](#4-langkah-2--pengerasan-keamanan-server)
5. [Langkah 3 — Pasang Docker, Nginx, Certbot](#5-langkah-3--pasang-docker-nginx-certbot)
6. [Langkah 4 — Isi konfigurasi (`.env`)](#6-langkah-4--isi-konfigurasi-env)
7. [Langkah 5 — Sertifikat HTTPS](#7-langkah-5--sertifikat-https)
8. [Langkah 6 — Deploy pertama](#8-langkah-6--deploy-pertama)
9. [Langkah 7 — Periksa dan atur data awal](#9-langkah-7--periksa-dan-atur-data-awal)
10. [Langkah 8 — Backup dan uji pemulihan](#10-langkah-8--backup-dan-uji-pemulihan)
11. [Operasional sehari-hari](#11-operasional-sehari-hari)
12. [Pemulihan saat ada masalah](#12-pemulihan-saat-ada-masalah)
13. [Pemecahan masalah (troubleshooting)](#13-pemecahan-masalah-troubleshooting)
14. [Daftar periksa keamanan dan go-live](#14-daftar-periksa-keamanan-dan-go-live)
15. [Lampiran: peta direktori, port, perintah cepat](#15-lampiran-peta-direktori-port-perintah-cepat)
16. [Apa yang sudah dan belum terbukti](#16-apa-yang-sudah-dan-belum-terbukti)

---

## 0. Cara memakai panduan ini

* **Urutan itu penting.** Kerjakan dari atas ke bawah. Setiap langkah punya bagian **✅ Pastikan berhasil**; jangan lanjut
  sebelum hasilnya sesuai.
* **Perkiraan waktu pertama kali:** ½ hari kerja (sebagian besar menunggu DNS, build Docker, dan persetujuan WhatsApp).
* **Dua "pengguna" di server.** `root` hanya dipakai di awal. Setelah Langkah 2 Anda bekerja sebagai **`deploy`** dan
  memakai `sudo` untuk hal yang butuh hak administrator. Di panduan ini, perintah `sudo …` = jalankan dengan sudo;
  perintah tanpa `sudo` = jalankan sebagai `deploy`.
* **`<…>` adalah isian Anda.** Contoh: `<IP-SERVER>` ganti dengan alamat IP server Anda.
* Ikon: ⚠️ hati-hati / mudah salah · ✅ cara memastikan berhasil · 💡 tips.

---

## 1. Gambaran besar

```
Internet ──443──▶ Nginx (di server) ──▶ 127.0.0.1:3100  web   (situs publik, kontainer)
 (firewall: 22/80/443)       │       ──▶ 127.0.0.1:4010  api   (API, kontainer) ──▶ postgres · redis  (jaringan internal)
                             │                                      └──▶ Cloudflare R2 (foto & bukti), penyedia WhatsApp
                             └──▶ /srv/670send/current/{pwa,admin}   aplikasi statis (satu folder per rilis)
```

| Alamat | Untuk apa | Dilayani oleh |
|---|---|---|
| `670send.tl` (dan `www.`) | situs publik: kalkulator tarif, lacak paket, pesan jemput | kontainer `web` |
| `app.670send.tl` | aplikasi lapangan (agen, kurir, sopir) | berkas statis |
| `admin.670send.tl` | backoffice staf | berkas statis |
| `api.670send.tl` | API (`/v1/…`) | kontainer `api` |

**Yang berjalan di Docker:** PostgreSQL 17, Redis 7, API, situs web, dan satu pekerjaan sekali jalan `migrate`
(membuat tabel + data awal). **Yang berjalan langsung di server:** Nginx (pintu masuk, HTTPS) dan Certbot (sertifikat).

Keputusan desain yang perlu Anda tahu:

* Hanya port **22 (SSH), 80, 443** yang terbuka ke internet. API dan situs web hanya mendengarkan di `127.0.0.1`;
  PostgreSQL dan Redis bahkan tidak punya port yang dipublikasikan.
* **Satu server, satu instance API.** Cukup untuk peluncuran. Jangan menjalankan dua API sekaligus (tugas terjadwal akan ganda).
* **Setiap rilis disimpan** (image bertag + folder statis), jadi *rollback* hanya berpindah rilis, bukan membangun ulang.

---

## 2. Persiapan sebelum mulai

Siapkan semua ini **sebelum** menyentuh server. Kekurangan salah satunya akan menghentikan Anda di tengah jalan.

### 2.1 Checklist

- [ ] Satu **VPS Ubuntu 26.04 LTS** (spesifikasi di 2.2) dengan alamat IPv4 publik, dan akses `root` atau `ubuntu` via SSH
- [ ] Kendali atas **DNS domain `670send.tl`** (2.3)
- [ ] Akun **Cloudflare R2** dengan **dua bucket privat** dan **dua token** (2.4)
- [ ] **Penyedia WhatsApp** yang sudah dipilih (2.5)
- [ ] Di laptop Anda: **kunci SSH**, **GnuPG**, **Git** (2.6)
- [ ] Alamat **email** untuk peringatan sertifikat (Let's Encrypt)
- [ ] **Penyedia peta (tile)** untuk peta pesan-jemput (2.7)

### 2.2 Spesifikasi VPS

| | Minimum untuk mulai | Catatan |
|---|---|---|
| Sistem | **Ubuntu 26.04 LTS** (64-bit) | Gunakan citra resmi dari penyedia VPS |
| CPU / RAM | 2 vCPU / **4 GB** | 2 GB akan kewalahan saat build; jika terpaksa, tambah swap |
| Disk | 40 GB SSD | Build Docker butuh ±6 GB kosong; deploy akan menolak jika kurang |
| Jaringan | IPv4 publik; IPv6 opsional | Pilih wilayah dekat Díli (Singapura / Jakarta) |
| Snapshot | aktifkan snapshot dari penyedia | Berguna, tetapi **bukan pengganti backup** (Langkah 8) |

💡 Buka juga **konsol web** penyedia VPS Anda: itu jalan darurat jika Anda salah mengatur SSH.

### 2.3 Domain dan DNS

Buat catatan DNS berikut di tempat domain Anda dikelola. Semuanya mengarah ke **IP server**.

| Tipe | Nama | Nilai |
|---|---|---|
| A | `670send.tl` (atau `@`) | `<IP-SERVER>` |
| A | `www` | `<IP-SERVER>` |
| A | `app` | `<IP-SERVER>` |
| A | `admin` | `<IP-SERVER>` |
| A | `api` | `<IP-SERVER>` |
| AAAA | *(sama seperti di atas)* | hanya jika server punya IPv6 yang berfungsi |

* TTL 300 detik memudahkan perbaikan. Propagasi bisa memakan menit sampai jam.
* ✅ **Pastikan berhasil** (di laptop; kelimanya harus menunjukkan IP server):
  ```bash
  dig +short 670send.tl www.670send.tl app.670send.tl admin.670send.tl api.670send.tl
  ```
* ⚠️ **Jika memakai Cloudflare untuk DNS, pilih "DNS only" (awan abu-abu), jangan "Proxied" (awan oranye).** Dengan proxy,
  Nginx hanya melihat alamat IP Cloudflare: pembatas laju, log audit, dan penguncian akun salah sasaran. Dukungan
  proxy memerlukan konfigurasi tambahan (`real_ip`) yang belum disediakan.

### 2.4 Cloudflare R2 (penyimpanan foto dan backup)

Anda butuh **dua bucket terpisah** dan **dua token terpisah**. Pemisahan ini disengaja: bocornya satu token tidak boleh
membuka yang lain.

1. Masuk ke dasbor Cloudflare → **R2 Object Storage** → aktifkan R2 (butuh metode pembayaran; kuota gratis tersedia).
2. **Create bucket** `670send-private` → untuk **foto & bukti** (jangan aktifkan akses publik).
3. **Create bucket** `670send-backups` → untuk **backup database terenkripsi** (jangan aktifkan akses publik).
4. Catat **Account ID** (di halaman R2). Endpoint Anda: `https://<ACCOUNT-ID>.r2.cloudflarestorage.com`.
5. **Manage R2 API Tokens → Create API token**, dua kali:
   * Token **foto**: izin **Object Read & Write**, dibatasi **hanya** ke bucket `670send-private`.
   * Token **backup**: izin **Object Read & Write**, dibatasi **hanya** ke bucket `670send-backups`.
   * Simpan **Access Key ID** dan **Secret Access Key** tiap token di pengelola kata sandi (Secret hanya tampil sekali).
6. Di bucket `670send-private`: aktifkan **versioning** atau aturan siklus-hidup yang menyimpan versi lama ≥ 30 hari,
   agar penghapusan tak sengaja bisa dipulihkan.

💡 API **tidak membuat bucket sendiri** di produksi; bucket harus sudah ada (langkah 2–3).

### 2.5 Penyedia WhatsApp

Notifikasi (OTP pengambilan, status paket, pengingat penyimpanan) dikirim lewat WhatsApp. API menolak berjalan di produksi
dengan `WHATSAPP_PROVIDER=console` (itu hanya mode uji). Pilihan yang didukung:

| Penyedia | Kapan cocok | Catatan **penting** |
|---|---|---|
| **`fonnte`** | Cara tercepat; cukup token API | Gateway tidak resmi: ada risiko nomor dibatasi oleh WhatsApp. Pakai nomor khusus bisnis. |
| **`waha`** | Anda mau mengelola sendiri | Server WAHA terpisah (belum termasuk di stack ini); butuh `WAHA_BASE_URL` yang bisa dijangkau API. Risiko nomor sama seperti di atas. |
| **`meta`** (Cloud API resmi) | Jalur resmi jangka panjang | ⚠️ **Adaptor saat ini mengirim teks bebas.** Pesan yang dimulai bisnis di luar jendela layanan 24 jam **hanya terkirim bila memakai *template* yang sudah disetujui Meta**, dan itu belum diimplementasikan. Untuk go-live gunakan `fonnte` atau `waha`; `meta` memerlukan pekerjaan pengembangan tambahan (kirim sebagai template). |

Siapkan kredensialnya (token Fonnte, atau URL+kunci WAHA) sebelum Langkah 4.

### 2.6 Alat di laptop Anda

**Kunci SSH** (untuk masuk ke server tanpa kata sandi):

```bash
ssh-keygen -t ed25519 -C "nama@laptop"
```

Tampilkan kunci **publik** (satu baris, awalan `ssh-ed25519 AAAA…`) — Anda akan menempelkannya di Langkah 2:

```bash
cat ~/.ssh/id_ed25519.pub
```

(Windows PowerShell: `Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub`.)

**GnuPG** (untuk kunci backup, bagian 10.1). Linux/macOS biasanya sudah ada; di Windows pasang **Gpg4win**.

### 2.7 Peta untuk halaman "Pesan Jemput"

Server peta publik OpenStreetMap **tidak boleh** menanggung lalu lintas produksi. Siapkan layanan tile milik sendiri atau
berbayar dan catat URL-nya (`https://…/{z}/{x}/{y}.png`) untuk variabel `MAP_TILE_URL` di Langkah 4. Untuk uji coba, bisa
dikosongkan (memakai OSM).

---

## 3. Langkah 1 — Masuk ke server dan ambil kode

1. Masuk sebagai pengguna yang diberikan penyedia (biasanya `root` atau `ubuntu`):
   ```bash
   ssh root@<IP-SERVER>
   ```
2. Pasang Git lalu ambil kode (repositori ini publik; tidak perlu kredensial):
   ```bash
   apt-get update && apt-get install -y git
   git clone https://github.com/zovoranexia/670SEND.git /opt/670send-app
   cd /opt/670send-app
   ```
   * Bila nanti repositori dijadikan **privat**, `git pull` dari server butuh kunci deploy: buat dengan
     `ssh-keygen -t ed25519` sebagai pengguna `deploy`, daftarkan sebagai **Deploy key (read-only)** di GitHub, dan
     ubah remote ke `git@github.com:zovoranexia/670SEND.git`.
   * Tanpa Git sama sekali: salin folder proyek dari laptop (`rsync -a --exclude node_modules ./ root@<IP>:/opt/670send-app/`).
     Deploy tetap jalan, tetapi tanpa `git pull` (rilis diberi nama berdasarkan waktu).

✅ **Pastikan berhasil:** `ls /opt/670send-app/infra/host/harden-ubuntu.sh` menampilkan berkas tersebut.

---

## 4. Langkah 2 — Pengerasan keamanan server

Skrip `infra/host/harden-ubuntu.sh` mengamankan server baru. Aman dijalankan ulang kapan saja.

⚠️ **Baca sebelum menjalankan.** Skrip mematikan login SSH dengan kata sandi dan login `root`. Ia **menolak berjalan** bila
pengguna `deploy` belum punya kunci SSH, jadi Anda tidak akan terkunci — tetapi **jangan menutup sesi SSH yang sedang
terbuka** sampai Anda berhasil masuk lewat terminal *kedua*.

```bash
cd /opt/670send-app
sudo ADMIN_USER=deploy ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA…isi-kunci-publik-Anda… nama@laptop' ./infra/host/harden-ubuntu.sh
```

Saat diminta, **buat kata sandi untuk pengguna `deploy`**. Kata sandi ini hanya dipakai untuk `sudo` (login SSH tetap
hanya dengan kunci). Variabel opsional: `SSH_PORT=2222` (ganti port SSH), `SWAP_SIZE_GB=4`, `TIMEZONE=Asia/Dili`.

**Yang dilakukan skrip:**

| Langkah | Hasil |
|---|---|
| Paket & pembaruan | Seluruh sistem diperbarui sebelum dibuka ke internet |
| Zona waktu `Asia/Dili` + `chrony` | Jam akurat (penting untuk kedaluwarsa OTP, token, dan TLS) |
| Pengguna `deploy` | Satu-satunya akun yang boleh login SSH |
| SSH | Hanya kunci; tanpa root; tanpa kata sandi; 3 percobaan; tanpa forwarding |
| Firewall `ufw` | Hanya 22 (dibatasi lajunya), 80, 443 |
| `fail2ban` | Memblokir IP yang berulang kali gagal login SSH |
| Pengaturan kernel (`sysctl`) | Perlindungan jaringan dasar; `ip_forward` tetap menyala untuk Docker |
| Pembaruan keamanan otomatis | Otomatis; **reboot pukul 03:30 waktu Díli** bila ada pembaruan kernel |
| `auditd` | Mencatat perubahan pada berkas penting (SSH, sudoers, Nginx, `.env`) |
| journald, swap, root | Log dibatasi 500 MB; swap 2 GB; kata sandi root dikunci |

💡 Web **tidak** diblokir `fail2ban` dengan sengaja: operator seluler di Timor-Leste berbagi alamat IP publik (CGNAT),
sehingga satu pemblokiran bisa mengunci satu kota. Pembatasan lalu lintas web dilakukan oleh Nginx dengan batas longgar.

✅ **Pastikan berhasil** — **buka terminal kedua** (jangan tutup yang pertama):

```bash
ssh deploy@<IP-SERVER>
```

Jika berhasil masuk, barulah tutup sesi `root`. Kemudian (sebagai `deploy`):

```bash
sudo ufw status verbose                       # 22 (limit), 80, 443
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|allowusers'
sudo fail2ban-client status sshd
timedatectl | grep -E 'Time zone|synchronized'
```

Harapannya: `permitrootlogin no`, `passwordauthentication no`, `allowusers deploy`, zona waktu `Asia/Dili`.

⚠️ Jika Anda mengubah `SSH_PORT`, selalu sertakan `-p <port>` pada `ssh` berikutnya dan pastikan firewall sudah mengizinkannya
(skrip melakukannya) sebelum menutup sesi lama.

---

## 5. Langkah 3 — Pasang Docker, Nginx, Certbot

Sebagai **`deploy`**:

```bash
cd /opt/670send-app
sudo chown -R deploy:deploy /opt/670send-app
sudo ADMIN_USER=deploy ./infra/scripts/bootstrap.sh
```

Skrip ini memasang **Docker Engine + plugin compose** (dari repositori resmi Docker; jika belum ada untuk Ubuntu 26.04
ia memakai paket `docker.io` dari Ubuntu), **Nginx, Certbot, rclone, gnupg**; menulis `/etc/docker/daemon.json` (rotasi log,
`live-restore`); memasang konfigurasi Nginx yang sudah diperketat (dengan vhost yang baru melayani tantangan sertifikat);
dan membuat struktur berikut:

```
/opt/670send/app            → tautan ke /opt/670send-app (kode)
/opt/670send/.env           → rahasia & konfigurasi (dibuat dari templat; hak: root:deploy 0640)
/opt/670send/releases.log   → catatan setiap deploy
/srv/670send/releases/…     → hasil build aplikasi statis, satu folder per rilis
/srv/670send/current        → tautan ke rilis yang sedang aktif
/var/www/certbot            → folder tantangan sertifikat
```

Terakhir, **keluar dan masuk lagi** agar keanggotaan grup `docker` berlaku:

```bash
exit
ssh deploy@<IP-SERVER>
```

⚠️ Keanggotaan grup `docker` setara hak `root`. Hanya akun operator (`deploy`) yang boleh memilikinya.

✅ **Pastikan berhasil:**

```bash
docker --version && docker compose version
sudo nginx -t
ls -l /opt/670send/
```

`docker ps` harus berjalan **tanpa** `sudo` (kosong tidak masalah).

---

## 6. Langkah 4 — Isi konfigurasi (`.env`)

Semua konfigurasi dan rahasia ada di **satu berkas**: `/opt/670send/.env`. Berkas ini dibuat dari templat; Anda mengisi
setiap nilai `CHANGE_ME`.

### 6.1 Buat rahasia acak (otomatis)

Perintah berikut mengisi enam rahasia sekaligus dengan nilai acak yang kuat:

```bash
gen() { sudo sed -i "s|^$1=.*|$1=$2|" /opt/670send/.env; }
gen POSTGRES_PASSWORD  "$(openssl rand -hex 24)"
gen REDIS_PASSWORD     "$(openssl rand -hex 24)"
gen JWT_ACCESS_SECRET  "$(openssl rand -hex 32)"
gen JWT_REFRESH_SECRET "$(openssl rand -hex 32)"
gen OTP_PEPPER         "$(openssl rand -hex 32)"
gen FIELD_ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

⚠️ Jalankan **sekali saja** pada instalasi baru. Mengulanginya setelah ada data **mengganti** `OTP_PEPPER` (OTP yang
sedang berlaku jadi tidak sah) dan `FIELD_ENCRYPTION_KEY` (**rekening bank mitra tidak bisa lagi dibuka**).

### 6.2 Isi sisanya

```bash
sudo nano /opt/670send/.env
```

| Variabel | Isi | Keterangan |
|---|---|---|
| `WEB_URL`, `PWA_URL`, `ADMIN_URL`, `API_URL` | alamat HTTPS keempat situs | tanpa garis miring di akhir |
| `CORS_ORIGINS` | tiga alamat (web, app, admin) dipisah koma | alamat persis, tanpa `*` |
| `POSTGRES_USER`, `POSTGRES_DB` | biarkan `send670` | |
| `S3_ENDPOINT` | `https://<ACCOUNT-ID>.r2.cloudflarestorage.com` | dari 2.4 |
| `S3_REGION` | `auto` | |
| `S3_BUCKET` | `670send-private` | |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | token **foto** | bukan token backup |
| `S3_FORCE_PATH_STYLE` | `false` | |
| `WHATSAPP_PROVIDER` | `fonnte` atau `waha` (lihat 2.5) | `console` ditolak API |
| `FONNTE_TOKEN` | token Fonnte | hanya bila memakai Fonnte |
| `WAHA_BASE_URL`, `WAHA_API_KEY` | dari WAHA Anda | hanya bila memakai WAHA |
| `META_WA_*` | **hapus/komentari** bila tidak dipakai | |
| `OPS_ALERT_PHONE` | nomor WA tim ops (opsional) | menerima peringatan, mis. paket retur |
| `SUPPORT_WHATSAPP` | nomor dukungan (digit saja) | opsional; tampil di situs publik |
| `MAP_TILE_URL`, `MAP_ATTRIBUTION` | dari 2.7 | opsional untuk uji |
| `SEED_SUPERADMIN_EMAIL` | email Super Admin pertama | akun nyata Anda |
| `SEED_SUPERADMIN_PHONE` | mis. `+67033000000` | format Timor-Leste |
| `SEED_SUPERADMIN_PASSWORD` | **≥ 14 karakter**, bukan nilai bawaan | hanya untuk login pertama |
| `BACKUP_*` | lihat Langkah 8 | isi nanti |

⚠️ **Variabel opsional yang tidak dipakai harus dikomentari (`#`) atau dihapus — jangan dibiarkan kosong.** Nilai kosong
membuat validasi API gagal (misalnya `WAHA_BASE_URL=` dianggap URL tidak sah).

### 6.3 Simpan salinan di luar server

Salin seluruh isi `.env` ke **pengelola kata sandi** Anda. Server bisa hilang; tanpa `FIELD_ENCRYPTION_KEY` rekening bank
mitra yang tersimpan tak dapat dipulihkan. (Backup malam juga memuat salinan terenkripsi berkas ini.)

✅ **Pastikan berhasil:**

```bash
sudo grep -c CHANGE_ME /opt/670send/.env      # hasil: 0 (atau hanya baris BACKUP_* yang akan Anda isi di Langkah 8)
docker compose --env-file /opt/670send/.env -f /opt/670send/app/docker-compose.prod.yml config -q && echo "KONFIGURASI VALID"
```

`BACKUP_*` boleh masih berisi contoh pada tahap ini. API juga memeriksa dirinya sendiri saat start dan **menolak berjalan**
bila ada rahasia yang masih placeholder, bila dua rahasia JWT sama, bila `WHATSAPP_PROVIDER=console`, atau bila
`CORS_ORIGINS` kosong; pesannya jelas dan muncul di log.

---

## 7. Langkah 5 — Sertifikat HTTPS

Prasyarat: DNS dari 2.3 sudah menunjuk ke server dan port 80/443 terbuka.

**Latihan dulu** dengan sertifikat uji (tidak dipercaya browser, tetapi tidak terkena batas Let's Encrypt):

```bash
cd /opt/670send-app
sudo ./infra/scripts/issue-certs.sh --email <email-anda@contoh.com> --staging
```

Jika lancar, terbitkan yang **asli** (`--force` menggantikan sertifikat latihan):

```bash
sudo ./infra/scripts/issue-certs.sh --email <email-anda@contoh.com> --force
```

Skrip: mengalihkan Nginx ke konfigurasi khusus tantangan, **memeriksa DNS** (menolak jika nama belum mengarah ke
server), menerbitkan **empat sertifikat** (apex+www, app, admin, api), memasang *hook* yang memuat ulang Nginx setiap kali
sertifikat diperbarui, mengaktifkan vhost penuh (jika konfigurasi tidak valid ia kembali ke mode tantangan), dan menutup
dengan uji pembaruan (`certbot renew --dry-run`). Pembaruan berikutnya otomatis (`certbot.timer`), dimulai saat sisa
masa berlaku 30 hari.

✅ **Pastikan berhasil:**

```bash
sudo certbot certificates                      # empat sertifikat, masa berlaku ~90 hari
systemctl list-timers certbot.timer            # pembaruan terjadwal
curl -sI https://api.670send.tl | head -1      # akan 404 (normal: root API kosong) — yang penting koneksi TLS berhasil
```

Setelah aplikasi berjalan (Langkah 6), uji kualitas TLS di <https://www.ssllabs.com/ssltest/> (targetnya A atau A+).

⚠️ Let's Encrypt membatasi 5 kegagalan per jam per nama. Jika gagal berulang, perbaiki penyebabnya (biasanya DNS atau port 80)
dan tunggu, jangan terus mencoba. Untuk rincian lihat bagian 13.

---

## 8. Langkah 6 — Deploy pertama

Sebagai **`deploy`**:

```bash
cd /opt/670send/app
./infra/scripts/deploy.sh --no-backup
```

(`--no-backup` hanya untuk deploy pertama, karena belum ada database yang perlu dicadangkan.)

**Build pertama memakan beberapa menit** (mengunduh dan membangun image). Skrip berjalan berurutan dan berhenti pada
kegagalan pertama:

1. **Pemeriksaan awal** — Docker bisa diakses, `.env` tak berisi placeholder, dua rahasia JWT berbeda, WhatsApp bukan
   `console`, compose valid, disk kosong ≥ 6 GB.
2. **Kode** — `git pull --ff-only` (atau `--ref <tag/commit>`); nama rilis = commit.
3. **Backup pra-deploy** — dilewati pada deploy pertama.
4. **Build** — image `api`, `web`, `migrate`, dan aplikasi statis (PWA + admin).
5. **Migrasi** — membuat semua tabel dan mengisi data referensi (tarif, 11 template × 4 bahasa, peran & izin, 14
   munisipalitas, 4 hub) beserta **Super Admin pertama**. Aman diulang; tidak menimpa data yang sudah diubah admin.
6. **Menyalakan** `api` dan `web` versi baru.
7. **Gerbang kesehatan** (maks. 150 detik) — kedua kontainer harus *healthy* dan `/v1/health/ready` menjawab. Bila gagal,
   rilis lama otomatis dinyalakan kembali dan aplikasi statis **tidak** dialihkan.
8. **Publikasi** aplikasi statis (pengalihan tautan atomik).
9. **Pencatatan & pembersihan** — menyimpan 5 rilis terakhir.

💡 Jika build gagal karena memori, pastikan swap aktif (`swapon --show`, dibuat oleh Langkah 2) lalu jalankan ulang.

✅ **Pastikan berhasil:**

```bash
./infra/scripts/status.sh
curl -s https://api.670send.tl/v1/health                       # {"status":"ok"}
curl -s https://api.670send.tl/v1/health/ready                 # {"status":"ready"}
curl -sI https://670send.tl | head -3                          # HTTP/2 200
curl -sI https://app.670send.tl | head -3
curl -sI https://admin.670send.tl | head -3
```

Lalu buka keempat alamat di browser.

---

## 9. Langkah 7 — Periksa dan atur data awal

### 9.1 Login pertama

1. Buka <https://admin.670send.tl>.
2. Masuk dengan `SEED_SUPERADMIN_EMAIL` dan `SEED_SUPERADMIN_PASSWORD` dari `.env`.
3. Karena seed produksi menandai akun sebagai "harus ganti kata sandi", Anda langsung diarahkan ke **"Pilih kata sandi baru"**
   (min. 12 karakter, huruf dan angka). Setelah diganti, semua sesi ditutup: **masuk lagi** dengan kata sandi baru.
4. Pilih bahasa di pojok kiri bawah (TET / PT / EN / ID); pilihan tersimpan di profil Anda.

💡 Setelah masuk, Anda boleh menghapus `SEED_SUPERADMIN_PASSWORD` dari `.env` (tidak dipakai lagi; seed tidak menimpa akun
yang sudah ada).

### 9.2 Urutan pengaturan yang disarankan

| # | Menu | Lakukan |
|---|---|---|
| 1 | **Peran & Izin** → *Pengguna* | Buat satu akun staf per orang (peran Ops, Finance, CS). Hindari akun bersama (login admin memakai email + kata sandi; akun lapangan memakai nomor HP + PIN). |
| 2 | **Peran & Izin** → *Pengaturan* | Tinjau `bus_capacity` (batas paket per perjalanan bus), `claim_cs_approval_limit_usd`, jendela klaim, dompet komisi, aturan OTP. |
| 3 | **Tarif** | Periksa tarif zona, nama dan estimasi waktu dalam 4 bahasa, harga layanan tambahan, dan biaya tambahan per munisipalitas. |
| 4 | **Templat WhatsApp** | Baca 11 pesan dalam 4 bahasa; sesuaikan bila perlu. Pesan "paket tiba" **wajib** memuat `{{otp}}`. |
| 5 | **Mitra & Kepatuhan** → *Agen & kurir* | Buat agen 670Link (kios + akun operator: nomor WhatsApp + PIN 6 digit; **hanya Super Admin**), catat adendum, lalu aktifkan. Buat kurir (Super Admin atau Ops). |
| 6 | **Mitra & Kepatuhan** → *Armada & MoU* | Buat mitra armada (tanggal MoU, rekening bank, akun pemilik). Rekening bank disimpan terenkripsi. |
| 7 | **Mitra & Kepatuhan** → *Kendaraan & pengemudi* | Lihat bagian 9.3: **pembuatan kendaraan dan sopir saat ini hanya lewat API.** |
| 8 | **Keuangan & Buku Besar** | Pastikan *Rekonsiliasi* menunjukkan "Semua seimbang". Deposit agen diajukan dari aplikasi lapangan dan disetujui di sini oleh **orang lain** (aturan empat mata). |

### 9.3 Kendaraan dan sopir (celah yang diketahui)

⚠️ **Antarmuka admin belum menyediakan tombol "tambah kendaraan" dan "tambah sopir"** (hanya *verifikasi/nonaktifkan*).
Keduanya tersedia di API dan bisa dibuat dari terminal. Sebagai Ops atau Super Admin (ganti isian `<…>`; ID mitra dilihat
dengan `GET /v1/admin/fleet-partners`):

```bash
API=https://api.670send.tl/v1
read -r -p "Email admin: " EMAIL; read -r -s -p "Kata sandi: " PASS; echo
TOKEN=$(curl -s "$API/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .accessToken)

# daftar mitra armada (catat "id")
curl -s "$API/admin/fleet-partners" -H "authorization: Bearer $TOKEN" | jq '.[] | {id, companyName}'

# kendaraan (jenis: BUS_PASSENGER | PICKUP_CARGO | TRUCK_CARGO | SEA_FERRY; koridor: LOCAL | EAST | SOUTH | WEST | SEA)
curl -s "$API/fleet/vehicles" -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "fleetPartnerId":"<ID-MITRA>","plateNumber":"DL 1234 AB","vehicleType":"BUS_PASSENGER","routeCorridor":"EAST",
  "maxParcelSlots":10,"dnttPermitNo":"DNTT-001","dnttPermitExpiry":"2027-12-31","kirExpiry":"2027-06-30"}'

# sopir (PIN 6 digit, tidak boleh pola mudah seperti 123456)
curl -s "$API/fleet/drivers" -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "fleetPartnerId":"<ID-MITRA>","fullName":"Nama Sopir","phone":"+67077123456","pin":"<PIN-6-DIGIT>",
  "preferredLang":"tet","licenseNumber":"SIM-001","licenseExpiry":"2027-12-31"}'
```

Setelah dibuat, buka **Mitra & Kepatuhan → Kendaraan & pengemudi** dan tekan **Verifikasi** pada masing-masing agar aktif. Kendaraan hanya bisa
dipakai di manifes bila MoU berlaku, izin DNTT + KIR belum kedaluwarsa, dan SIM sopir berlaku.

### 9.4 Uji satu paket dari awal sampai akhir

Lakukan sekali sebelum go-live: (1) agen mengajukan deposit di aplikasi lapangan → Finance menyetujui (akun berbeda);
(2) agen mendaftarkan paket (wizard 5 langkah, 2 foto) → label/resi tercetak; (3) di **Operasi Hub**: *Terima di hub* →
*Karung induk* → *Manifes* → *Tandai siap untuk pengemudi*; (4) sopir memindai QR manifes dan memotret bagasi di aplikasi lapangan; (5) agen tujuan
memindai kedatangan; (6) penerima menunjukkan OTP dan KTP → serah terima; (7) cek buku besar dan *Rekonsiliasi*.
Pastikan WhatsApp **benar-benar terkirim** pada tiap tahap.

---

## 10. Langkah 8 — Backup dan uji pemulihan

**Mengapa penting:** inilah yang menentukan apakah hari buruk bisa dilewati. Backup mencakup database (paket, dompet,
buku besar, audit) dan salinan `.env`, **dienkripsi dengan kunci publik** sehingga server maupun bucket tidak bisa
membacanya. Foto ada di bucket R2 foto (dilindungi versioning, 2.4). Redis hanya berisi antrean dan dibangun ulang otomatis.

Target: kehilangan data maksimal ±24 jam (+ backup otomatis sebelum setiap deploy); waktu pemulihan di server baru ±1–2 jam.

### 10.1 Buat kunci backup (di LAPTOP, bukan di server)

```bash
gpg --quick-generate-key "670Send backup <backup@zovoranexia.example>" default default 0
gpg --armor --export backup@zovoranexia.example > backup-public.asc
gpg --armor --export-secret-keys backup@zovoranexia.example > backup-private.asc
```

(Saat diminta, buat **frasa sandi yang kuat**.) Simpan `backup-private.asc` + frasa sandinya di **dua tempat terpisah di luar
server** (pengelola kata sandi + flash disk offline) dan beri tahu **satu orang kedua** letaknya.

⚠️ **Kunci privat adalah satu-satunya cara membuka backup.** Hilang = semua backup tak berguna. Jangan pernah menaruhnya di server.

### 10.2 Pasang di server

Salin hanya `backup-public.asc` ke server (`scp backup-public.asc deploy@<IP>:`), lalu:

```bash
sudo install -d -m 0700 /etc/670send/gnupg
sudo GNUPGHOME=/etc/670send/gnupg gpg --import backup-public.asc
rm backup-public.asc
```

Buat konfigurasi rclone untuk bucket **backup** (pakai token **backup**, bukan token foto). Ganti isian:

```bash
sudo tee /etc/670send/rclone.conf >/dev/null <<'EOF'
[r2backup]
type = s3
provider = Cloudflare
access_key_id = <ACCESS-KEY-ID-TOKEN-BACKUP>
secret_access_key = <SECRET-TOKEN-BACKUP>
endpoint = https://<ACCOUNT-ID>.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
sudo chmod 600 /etc/670send/rclone.conf
```

(`no_check_bucket = true` perlu karena token dibatasi ke satu bucket dan tidak boleh membuat bucket.)

Isi bagian backup di `.env`:

```bash
sudo nano /opt/670send/.env
#   BACKUP_GPG_RECIPIENT=backup@zovoranexia.example
#   BACKUP_RCLONE_REMOTE=r2backup:670send-backups
#   BACKUP_RETENTION_DAYS=30
```

Jalankan satu backup sekarang, lalu lihat daftarnya:

```bash
cd /opt/670send/app
sudo ./infra/backup/backup.sh
sudo ./infra/backup/restore.sh --list
```

Aktifkan jadwal otomatis (backup tiap 02:15, uji integritas tiap Minggu 04:30, waktu Díli):

```bash
sudo systemctl enable --now 670send-backup.timer 670send-restore-drill.timer
systemctl list-timers '670send-*'
```

💡 **Dead-man's switch (sangat disarankan):** buat dua *check* gratis di healthchecks.io dan isi `BACKUP_PING_URL` dan
`BACKUP_DRILL_PING_URL` di `.env`. Tugas akan "ping" saat berhasil dan `/fail` saat gagal, sehingga backup yang diam-diam
berhenti akan mengirim email.

Retensi: backup harian disimpan 30 hari; backup pertama tiap bulan disalin ke `monthly/` dan disimpan ±13 bulan.

✅ **Pastikan berhasil:** `--list` menampilkan berkas `670send-….tar.gpg`, dan `sudo cat /var/lib/670send/last-backup` menunjukkan waktu dan ukuran.

### 10.3 Latihan pemulihan bulanan (wajib, 15 menit)

*Backup yang belum pernah dipulihkan hanyalah harapan.* Sebulan sekali, bersama kunci privat offline:

```bash
cd /opt/670send/app
export RESTORE_GNUPGHOME=$(mktemp -d)
scp backup-private.asc deploy@<IP>:                      # dari laptop (di terminal laptop)
sudo gpg --homedir "$RESTORE_GNUPGHOME" --import backup-private.asc    # frasa sandi diminta
sudo RESTORE_GNUPGHOME="$RESTORE_GNUPGHOME" ./infra/backup/restore.sh --latest --target scratch
sudo rm -rf "$RESTORE_GNUPGHOME"; shred -u backup-private.asc
```

Skrip mengunduh backup terbaru, memeriksa checksum, mendekripsi, memulihkannya ke **database sementara** (kontainer yang
dibuang sesudahnya), lalu memeriksa: migrasi selesai, **buku besar bernilai nol**, dan jumlah pengguna/paket/entri sama
dengan saat backup. Satu-satunya akhir yang dapat diterima adalah **`RESTORE OK`**.

Timer mingguan (`670send-restore-drill`) hanya memeriksa **integritas** (backup ada, < 36 jam, checksum cocok, pesan
terenkripsi valid) karena server tidak memegang kunci privat. Itu disengaja.

---

## 11. Operasional sehari-hari

| Tugas | Perintah (sebagai `deploy`, dari `/opt/670send/app`) |
|---|---|
| Lihat kondisi keseluruhan | `./infra/scripts/status.sh` |
| Deploy versi terbaru | `./infra/scripts/deploy.sh` |
| Deploy tag/commit tertentu | `./infra/scripts/deploy.sh --ref v1.2.0` |
| Kembali ke rilis sebelumnya | `./infra/scripts/rollback.sh` (atau `… <rilis>`; lihat `/opt/670send/releases.log`) |
| Log API (live) | `docker compose --env-file /opt/670send/.env -f docker-compose.prod.yml logs -f --tail 100 api` |
| Restart satu layanan | idem, `… restart api` |
| Masuk ke database | idem, `… exec postgres psql -U send670 -d send670` |
| Log Nginx | `sudo tail -f /var/log/nginx/error.log` · `access.log` |
| Backup sekarang | `sudo ./infra/backup/backup.sh` |

💡 Agar perintah `docker compose` lebih pendek, buat alias di `~/.bashrc`:

```bash
echo "alias dc='docker compose --env-file /opt/670send/.env -f /opt/670send/app/docker-compose.prod.yml'" >> ~/.bashrc && source ~/.bashrc
# lalu:  dc ps · dc logs -f api · dc restart api
```

**Rollback mengubah kode, bukan data.** Migrasi bersifat maju-saja dan aditif, jadi kode lama tetap jalan di skema baru.
Bila sebuah rilis memuat migrasi yang merusak data, jalan kembalinya adalah backup `pre-<rilis>` yang dibuat otomatis (bagian 12).

**Pembaruan sistem.** Pembaruan keamanan berjalan otomatis (reboot 03:30 bila perlu; semua kontainer menyala sendiri).
Sebulan sekali jalankan `sudo apt update && sudo apt full-upgrade`. Image PostgreSQL/Redis: tetap pada versi mayor yang sama;
peningkatan mayor PostgreSQL adalah dump/restore yang direncanakan, bukan sekadar `pull`.

**Disk.** `docker system df`; `docker image prune -a`; `sudo journalctl --vacuum-size=200M`. `/var/backups/670send` harus kosong di antara backup.

**Pemantauan.** Bawaan: pemeriksaan kesehatan kontainer dengan restart otomatis, halaman `status.sh`, dan dead-man's
switch backup. **Tambahkan monitor uptime eksternal** (layanan gratis apa pun, notifikasi WhatsApp/email) pada
`https://api.670send.tl/v1/health` dan `https://670send.tl/` — itu satu-satunya pemeriksaan yang menyadari seluruh server mati.

**Mengubah konfigurasi Nginx.** Ubah berkas di `infra/nginx/…`, jalankan `infra/nginx/test.sh` (butuh Docker; di laptop pengembang),
lalu di server `sudo ./infra/scripts/bootstrap.sh && sudo nginx -t && sudo systemctl reload nginx`.

**Menambah staf yang boleh SSH.** Tambahkan kunci publik mereka ke `/home/deploy/.ssh/authorized_keys` (satu kunci per orang).
Ingat, `deploy` setara `root`; batasi seminimal mungkin.

---

## 12. Pemulihan saat ada masalah

| Situasi | Tindakan |
|---|---|
| **Rilis baru bermasalah** | `./infra/scripts/rollback.sh`. Bila gerbang kesehatan menangkapnya saat deploy, rilis lama sudah otomatis berjalan lagi. |
| **Migrasi merusak data** | Hentikan lalu lintas (`dc stop api web`), pulihkan backup `pre-<rilis>`: `sudo RESTORE_GNUPGHOME=… ./infra/backup/restore.sh --file daily/…/670send-…-pre-<rilis>.tar.gpg --target live`, lalu rollback kode. Pemulihan live **mengambil dump pengaman dulu** dan meminta Anda mengetik nama database. |
| **Database rusak/terhapus** | `restore.sh --latest --target live` (pengaman sama). Siapkan diri kehilangan ≤ 1 hari data; rekonsiliasi dari log WhatsApp dan jejak audit. |
| **Server hilang total** | VPS baru → ulangi Bagian 3–5 → pasang `.env` dari pengelola kata sandi (atau `restore.sh … --with-env` menulis `/opt/670send/.env.restored`) → arahkan DNS ke IP baru → Bagian 7 → `deploy.sh --no-backup` (membuat database kosong) → `restore.sh --latest --target live`. Foto tidak terpengaruh (R2). |
| **Rahasia bocor** | Ganti di `.env`, lalu `deploy.sh --skip-pull`. JWT: semua orang login ulang. `OTP_PEPPER`: OTP yang belum dipakai jadi tidak sah (aplikasi bisa mengirim ulang). `FIELD_ENCRYPTION_KEY`: **jangan diganti tanpa rencana enkripsi ulang**. Token R2/WhatsApp: ganti dulu di penyedia. |
| **Tidak bisa SSH** | Pakai konsol web penyedia; `sudo fail2ban-client unban <ip>`; periksa `/etc/ssh/sshd_config.d/99-670send.conf`. |
| **Sertifikat kedaluwarsa** | `sudo certbot renew && sudo systemctl reload nginx`; baca `/var/log/letsencrypt/letsencrypt.log` (port 80 tertutup? DNS berubah?). |
| **Disk penuh** | `docker system df`; `docker image prune -a`; `sudo journalctl --vacuum-size=200M`. |

---

## 13. Pemecahan masalah (troubleshooting)

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| `harden-ubuntu.sh`: "deploy has no SSH key" | `ADMIN_SSH_PUBKEY` kosong/salah | Jalankan ulang dengan kunci publik lengkap (satu baris `ssh-ed25519 AAAA…`). |
| Terkunci setelah hardening | Kunci SSH tak cocok / port berubah | Konsol web penyedia → periksa `authorized_keys` pengguna `deploy` dan `sshd -T`. |
| `permission denied` saat `docker …` | Belum keluar-masuk setelah bootstrap | `exit`, login ulang (grup `docker`). |
| `issue-certs.sh`: "X does not resolve yet" | DNS belum propagasi / salah | `dig +short <nama>`; tunggu; perbaiki catatan. |
| Certbot: "Timeout during connect" / 403 | Port 80 tertutup, atau awan **oranye** Cloudflare | Buka port 80 di firewall penyedia; set DNS ke **DNS only**. |
| Certbot: "too many failed authorizations" | Terlalu banyak percobaan gagal | Tunggu 1 jam; gunakan `--staging` untuk latihan. |
| `deploy.sh`: "still holds the CHANGE_ME placeholder" | `.env` belum lengkap | `sudo grep -n CHANGE_ME /opt/670send/.env`; isi. |
| `deploy.sh`: "does not validate with …/.env" | Variabel wajib hilang | `docker compose --env-file … config` menampilkan variabel mana. |
| API tidak *healthy*; log: "Refusing to start in production…" | Rahasia placeholder / JWT sama / `console` / CORS kosong | Perbaiki `.env`, `deploy.sh --skip-pull`. |
| API: "Invalid environment configuration … url" | Variabel opsional diisi **kosong** (mis. `WAHA_BASE_URL=`) | Komentari (`#`) atau hapus barisnya. |
| `migrate` gagal terhubung ke database | Postgres belum sehat | `dc logs postgres`; tunggu; jalankan ulang `deploy.sh`. |
| Build kehabisan memori / "Killed" | RAM kecil | Pastikan swap aktif (`swapon --show`), jalankan ulang; pertimbangkan VPS 4 GB. |
| Halaman memuat tetapi data kosong / error CORS di browser | `CORS_ORIGINS` tak memuat alamat situs | Samakan persis (https, tanpa `/` di akhir) lalu `deploy.sh --skip-pull`. |
| Foto/bukti tak tampil di admin | CSP admin tak memuat host R2, atau token/bucket salah | Pakai R2 default (`*.r2.cloudflarestorage.com`); untuk domain khusus ubah `infra/nginx/snippets/headers-admin.conf`. |
| WhatsApp tidak terkirim | Token salah / nomor belum terhubung / mode Meta tanpa template | Cek **Templat WhatsApp → Log pengiriman** (status & pesan galat); lihat 2.5. |
| `restore.sh`: "decryption failed" | Kunci privat salah | Impor kunci yang sesuai ke `RESTORE_GNUPGHOME`. |
| `backup.sh`: "cannot reach the backup remote" | `rclone.conf` / token / nama bucket salah | `sudo rclone --config /etc/670send/rclone.conf lsf r2backup:670send-backups`. |
| Banyak pengguna di satu kota kena "429" | Batas laju per-IP (CGNAT) | Naikkan `burst` di `infra/nginx/sites/api.670send.tl.conf`, terapkan ulang konfigurasi Nginx. **Jangan** hapus batasnya. |
| Situs tampil "502 Bad Gateway" | Kontainer `web`/`api` mati | `./infra/scripts/status.sh`; `dc logs --tail 100 api web`; `dc up -d`. |

---

## 14. Daftar periksa keamanan dan go-live

**Server**
- [ ] Login SSH hanya dengan kunci; root dan kata sandi nonaktif (`sshd -T`)
- [ ] `ufw` aktif: hanya 22/80/443; `fail2ban` aktif
- [ ] Pembaruan otomatis aktif; zona waktu `Asia/Dili`; jam tersinkron
- [ ] Hanya `deploy` di grup `docker`; satu kunci SSH per orang

**Aplikasi**
- [ ] `.env` berhak `root:deploy 0640`; salinannya ada di pengelola kata sandi (offline)
- [ ] Sertifikat **asli** (bukan staging) terpasang; SSL Labs ≥ A; pembaruan otomatis teruji (`--dry-run`)
- [ ] `https://api.670send.tl/v1/health/ready` → `ready`; keempat situs terbuka
- [ ] Super Admin sudah mengganti kata sandi; `SEED_SUPERADMIN_PASSWORD` dihapus dari `.env`; akun staf per orang dibuat
- [ ] Uji satu paket dari awal sampai akhir (9.4) berhasil dengan WhatsApp **sungguhan**
- [ ] Peta pesan-jemput memakai penyedia tile yang layak produksi

**Backup & pemulihan**
- [ ] Backup pertama berhasil; timer aktif; dead-man's switch dipasang
- [ ] Kunci privat tersimpan di dua tempat offline + satu orang kedua mengetahuinya
- [ ] **Satu latihan pemulihan penuh sukses** (`RESTORE OK`) sebelum go-live
- [ ] Versioning bucket foto aktif; token foto dan token backup **berbeda**

**Pemantauan**
- [ ] Monitor uptime eksternal pada `api` dan situs publik, dengan notifikasi yang benar-benar sampai ke seseorang

---

## 15. Lampiran: peta direktori, port, perintah cepat

**Direktori penting**

| Lokasi | Isi |
|---|---|
| `/opt/670send-app` (= `/opt/670send/app`) | Kode repositori |
| `/opt/670send/.env` | Rahasia & konfigurasi |
| `/opt/670send/releases.log` | Riwayat deploy |
| `/srv/670send/releases/<rilis>/{pwa,admin}` | Build aplikasi statis |
| `/srv/670send/current` | Rilis statis aktif (tautan) |
| `/etc/nginx/{nginx.conf,sites-available,snippets/670send}` | Konfigurasi Nginx |
| `/etc/letsencrypt/` | Sertifikat |
| `/etc/670send/{gnupg,rclone.conf}` | Kunci publik backup, konfigurasi R2 backup |
| `/var/lib/670send/` | Cap waktu backup & latihan terakhir |
| `/var/log/nginx/`, `journalctl -u 670send-backup` | Log |

**Port**

| Port | Pemakai | Terbuka ke internet? |
|---|---|---|
| 22 (atau `SSH_PORT`) | SSH | ya (dibatasi laju) |
| 80, 443 | Nginx | ya |
| 4010 | API (kontainer) | **tidak** (hanya `127.0.0.1`) |
| 3100 | Situs web (kontainer) | **tidak** (hanya `127.0.0.1`) |
| 5432, 6379 | PostgreSQL, Redis | **tidak** (jaringan internal Docker) |

**Urutan perintah, ringkas** (setelah semua prasyarat siap)

```bash
# sebagai root, sekali
apt-get update && apt-get install -y git
git clone https://github.com/zovoranexia/670SEND.git /opt/670send-app && cd /opt/670send-app
ADMIN_USER=deploy ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA…' ./infra/host/harden-ubuntu.sh
# tes login 'ssh deploy@IP' di terminal lain, lalu sebagai deploy:
sudo chown -R deploy:deploy /opt/670send-app && cd /opt/670send-app
sudo ADMIN_USER=deploy ./infra/scripts/bootstrap.sh        # lalu keluar-masuk SSH
sudo nano /opt/670send/.env                                # isi (Langkah 4)
sudo ./infra/scripts/issue-certs.sh --email you@example.com --staging
sudo ./infra/scripts/issue-certs.sh --email you@example.com --force
cd /opt/670send/app && ./infra/scripts/deploy.sh --no-backup
# backup: Langkah 8, lalu:
sudo systemctl enable --now 670send-backup.timer 670send-restore-drill.timer
```

---

## 16. Apa yang sudah dan belum terbukti

**Sudah diuji sungguhan (komputer pengembangan + Docker):**
* Ketiga Dockerfile dibangun; stack compose produksi dijalankan terhadap database kosong (migrasi + seed produksi sukses,
  API *healthy*, sistem berkas hanya-baca, non-root, hanya API terbuka di `127.0.0.1`); kontainer web berjalan terperkuat.
* Konfigurasi Nginx: 28 pemeriksaan otomatis (pengalihan, tantangan ACME, fallback SPA, aturan cache, header keamanan,
  `X-Forwarded-For` palsu ditimpa, 405 untuk tulis, pembatas laju, batas ukuran unggahan, host tak dikenal).
* Backup: 25 pemeriksaan otomatis (terenkripsi, tak terbaca oleh server, checksum, unggah, pemulihan ke database sementara
  dengan pemeriksaan buku besar, kunci salah ditolak, perusakan terdeteksi, latihan, retensi, pemulihan live) — pada skema
  minimal **dan** skema asli.
* Semua skrip lolos `shellcheck`; semua paket yang dipasang ada di arsip Ubuntu 26.04; repositori Docker memiliki suite
  `resolute`; konfigurasi SSH yang dihasilkan lolos `sshd -t` (OpenSSH 10.2) dan jail `fail2ban` lolos `fail2ban-client -t`.

**Belum terbukti — kerjakan di server uji lebih dulu:**
* `harden-ubuntu.sh`, `bootstrap.sh`, `issue-certs.sh`, `deploy.sh`, `rollback.sh` **belum dijalankan utuh di VPS Ubuntu 26.04
  asli** (khususnya `ufw`, `ssh.socket`, `auditd`, `unattended-upgrades`, repositori apt Docker).
* DNS nyata, penerbitan dan pembaruan Let's Encrypt, OCSP stapling, bucket R2 nyata, penyedia WhatsApp nyata.
* Beban nyata dan kecukupan memori di 4 GB (batas: PostgreSQL 1,5 GB, API 768 MB, web 512 MB, Redis 512 MB — titik awal, bukan hasil uji).
* Pengiriman template Meta (belum diimplementasikan), pembuatan kendaraan/sopir lewat antarmuka admin (belum ada),
  alur klaim dengan foto asli, pembayaran armada ujung-ke-ujung (hanya teruji lewat tes otomatis).
* Belum ada pemantauan terpusat, arsip WAL / pemulihan titik-waktu, prosedur peningkatan mayor PostgreSQL, atau multi-server.
