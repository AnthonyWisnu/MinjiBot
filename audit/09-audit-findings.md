# 09 — Master Audit Findings Registry (Single Source of Truth)

Dokumen ini adalah **daftar induk tunggal (_Single Source of Truth_)** untuk seluruh **37 temuan** hasil audit teknis MinjiBot. Setiap dokumen domain (`01` s/d `08`), [`REMEDIATION_PLAN.md`](./REMEDIATION_PLAN.md), dan instruksi implementasi di `phases/PHASE-01` s/d `PHASE-05` mengacu pada **ID Unik** di dokumen ini.

---

## Ringkasan Indeks Temuan

| ID                    | Klasifikasi       | Kategori             |   Severity    | Prioritas | Fase Target | Judul Ringkas                                                                               |
| :-------------------- | :---------------- | :------------------- | :-----------: | :-------: | :---------: | :------------------------------------------------------------------------------------------ |
| [`SEC-01`](#sec-01)   | Confirmed Finding | Security             |   Critical    |    P0     |  PHASE-01   | Eksposur Web QR Tanpa Auth, Rahasia Statis `AlertServer` & Telemetri Per-Pesan              |
| [`SEC-02`](#sec-02)   | Confirmed Finding | Security / CI-CD     |   Critical    |    P0     | PHASE-05\*  | Persistent Self-Hosted Runner pada Repo Publik & `prisma db push --accept-data-loss`        |
| [`SEC-03`](#sec-03)   | Confirmed Finding | Security             |     High      |    P0     |  PHASE-01   | SSRF, Bypass Substring Hostname `.includes()` & Redirect Cookie `yt-dlp`/`gallery-dl`       |
| [`SEC-04`](#sec-04)   | Confirmed Finding | Security / Deps      |     High      |    P0     |  PHASE-01   | Sharp Pixel Bomb (`limitInputPixels: false`), 29 Advisory `npm audit` & Semver Baileys      |
| [`SEC-05`](#sec-05)   | Confirmed Finding | Security / Authz     |     High      |    P0     |  PHASE-01   | Bypass Otorisasi DM Multi-Tenant (`.quote`/`.tweet`, Mantan Owner & Enumerasi Kode)         |
| [`SEC-06`](#sec-06)   | Confirmed Finding | Security             |    Medium     |    P1     |  PHASE-01   | Interpolasi XML/SVG Tanpa Escape, Input Tanpa Batas & Overflow Kata Panjang                 |
| [`SEC-07`](#sec-07)   | Confirmed Finding | Security / OpSec     |    Medium     |    P1     |  PHASE-01   | Kebocoran `error.message` Mentah, Cacat Substring `userSafeError` & OpSec SSH VPS           |
| [`LOG-01`](#log-01)   | Confirmed Finding | Business Logic       |   Critical    |    P0     |  PHASE-02   | Eksploitasi Pencetakan Poin/Limit Tak Terbatas di `.slot`, Race Double-Spend & Tanpa Ledger |
| [`LOG-02`](#log-02)   | Confirmed Finding | Business Logic       |   Critical    |    P0     |  PHASE-02   | Pencetakan Limit Massal `.addlimitall` oleh Tenant Owner/Admin Tanpa Transaksi & Ledger     |
| [`LOG-03`](#log-03)   | Confirmed Finding | Business Logic       |   Critical    |    P0     |  PHASE-02   | `YOUTUBE_VIDEO_DOWNLOAD` Absen dari `HEAVY_FEATURE_COST` (`.yt` Gratis & Rusak di DM)       |
| [`LOG-04`](#log-04)   | Confirmed Finding | Logic / Media        |     High      |    P1     |  PHASE-02   | `.hd` Tanpa Potong Limit, Distorsi Rasio EXIF `fit: "fill"` & Kualitas Upscale Naif         |
| [`LOG-05`](#log-05)   | Confirmed Finding | Moderation / Privacy |   Critical    |    P0     |  PHASE-01   | `AntiDelete` Mem-posting Ulang Hasil Hapus Moderasi & Membongkar `viewOnceMessage*`         |
| [`LOG-06`](#log-06)   | Confirmed Finding | Identity / Logic     |   Critical    |    P0     |  PHASE-02   | Kegagalan Sistemik Dual-JID (`@lid` vs `@s.whatsapp.net`) Lintas 10 Modul Fitur             |
| [`LOG-07`](#log-07)   | Confirmed Finding | Economy Atomicity    |   Critical    |    P0     |  PHASE-02   | Klaim `.daily` Non-Atomik, TOCTOU `P2002` Idempotensi & Double-Settlement `.play`           |
| [`LOG-08`](#log-08)   | Confirmed Finding | Guards / Lifecycle   |     High      |    P1     |  PHASE-02   | Cacat `TenantGuard`, `FeatureGuard`, Transisi Status Tenant & Invalidasi Cache              |
| [`LOG-09`](#log-09)   | Confirmed Finding | Logic / Games / Time |     High      |    P1     |  PHASE-02   | Cacat Sekunder Moderasi, Game/TicTacToe, Profil Hantu, Cooldown, `INT4` & Zona WIB          |
| [`PERF-01`](#perf-01) | Confirmed Finding | Performance          |   Critical    |    P0     |  PHASE-03   | Badai 5–7 Query SQL Per-Pesan, Pipeline di Grup Mati & Cache RAM `AntiDelete` 1 GB          |
| [`PERF-02`](#perf-02) | Confirmed Finding | Performance          |     High      |    P1     |  PHASE-03   | Konkurensi Media Tanpa Semaphore, Alokasi Buffer Penuh, Sync I/O & HoL Blocking             |
| [`PERF-03`](#perf-03) | Confirmed Finding | Database / Perf      |    Medium     |    P2     |  PHASE-03   | Indeks `.silent` Absen, FK `TenantPrivateSession`, Query Duplikat & Map Tak Terbatas        |
| [`REL-01`](#rel-01)   | Confirmed Finding | Reliability          |     High      |    P1     |  PHASE-03   | Risiko Deadlock Pipe `stdout` 64 KB di 5 `spawn()`, Proses Yatim & Guard `tempFile`         |
| [`REL-02`](#rel-02)   | Confirmed Finding | Reliability          |     High      |    P1     |  PHASE-03   | Kebocoran Permanen `reservedLimit` Saat Crash/Restart & Race `P2002` pada `upsert`          |
| [`REL-03`](#rel-03)   | Confirmed Finding | Reliability / WA     |     High      |    P1     |  PHASE-03   | Absennya `cachedGroupMetadata` & `getMessage`, Guard `BotLifecycle` & Retry Reminder        |
| [`REL-04`](#rel-04)   | Confirmed Finding | Database / Ops       |   Critical    |    P0     |  PHASE-05   | SQL Migrasi `DO \$\$` Rusak, Duplikasi Timestamp `20260905010000` & Absennya Konfig PM2     |
| [`REL-05`](#rel-05)   | Potential Finding | Reliability / WA     |    Medium     |    P2     |  PHASE-03   | Penulisan `saveCreds()` Paralel Tanpa Antrean Berpotensi Merusak JSON `creds.json`          |
| [`ARCH-01`](#arch-01) | Confirmed Finding | Architecture         |    Medium     |    P2     |  PHASE-02   | Pelanggaran Layering Command-ke-Repository, Duplikasi Avatar & 10 Command Tanpa Catch       |
| [`QUAL-01`](#qual-01) | Confirmed Finding | Code Quality         |     High      |    P1     |  PHASE-04   | 278 Masalah ESLint, 104 File Unformatted, Ignore Kurang & 38 Paket Extraneous               |
| [`DOC-01`](#doc-01)   | Confirmed Finding | Maintainability      |     High      |    P1     |  PHASE-04   | Ketidaksinkronan `AGENTS.md`, `README.md`, `PLAN.md`, `.env.example`, `.menu` & `.panel`    |
| [`COMP-01`](#comp-01) | Confirmed Finding | Compatibility        |    Medium     |    P2     |  PHASE-03   | Bug `PATH` Windows, `.mp4` Non-H.264 Gagal Putar di HP, `fromMe: false` & Font Linux        |
| [`COMP-02`](#comp-02) | Improvement       | Portability          |      Low      |    P3     |  PHASE-05   | Penyediaan `Dockerfile`, `.dockerignore` & `docker-compose.yml` Multi-Platform              |
| [`ACC-01`](#acc-01)   | Not Applicable    | Accessibility / SEO  | Informational |    N/A    |     N/A     | WCAG & SEO Tidak Berlaku pada Headless WhatsApp Bot Tanpa Antarmuka Web Publik              |
| [`UXL-01`](#uxl-01)   | Confirmed Finding | Legal / Licensing    |     High      |    P1     |  PHASE-04   | Berkas `LICENSE` MIT Tidak Ada (Link Rusak di `README.md:280`) & `"private": true`          |
| [`UXL-02`](#uxl-02)   | Confirmed Finding | Legal / ToS          |     High      |    P1     |  PHASE-04   | Risiko Banned Nomor WhatsApp Unofficial API (`Baileys`) Tanpa Disclaimer Operator           |
| [`UXL-03`](#uxl-03)   | Confirmed Finding | Legal / UX           |     High      |    P1     |  PHASE-02   | Risiko Impersonasi Centang Biru & Fitnah Pihak Ketiga pada `.tweet @user <teks>`            |
| [`UXL-04`](#uxl-04)   | Confirmed Finding | Privacy / Compliance |    Medium     |    P2     |  PHASE-02   | Retensi PII Tanpa Batas, Absennya `.deletemydata`/`.purgetenant` & `PRIVACY.md`             |
| [`UXL-05`](#uxl-05)   | Potential Finding | Legal / IP           |    Medium     |    P2     |  PHASE-02   | Potensi Klaim Hak Cipta/Publisitas Foto Selebritas `assets/minji.png` & `src/Minji.png`     |
| [`QA-01`](#qa-01)     | Confirmed Finding | Testing              |     High      |    P1     |  PHASE-05   | `tsconfig.json` Mengecualikan `tests/`, Menyembunyikan 39 Error TypeScript di 15 File Test  |
| [`QA-02`](#qa-02)     | Confirmed Finding | Testing              |     High      |    P1     |  PHASE-05   | Cakupan Test Command 10% (`3/30`), Downloader/HD/Lifecycle 0% & Asersi Semu                 |

> _Catatan `SEC-02`: Penonaktifan persistent self-hosted runner di pengaturan GitHub dilakukan segera sebagai tindakan pra-fase, sementara penggantian file workflow `.github/workflows/deploy.yml` ke `prisma migrate deploy` dieksekusi di `PHASE-05` tepat setelah perbaikan migrasi `REL-04` dan gerbang kualitas `QUAL-01`/`QA-01` tuntas._

---

## Detail Lengkap Seluruh Temuan

<a id="sec-01"></a>

### SEC-01 — Eksposur Web QR Tanpa Autentikasi, Rahasia Statis `AlertServer` & Telemetri Per-Pesan

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security` — **Critical** (_Alasan_: Eksposur langsung kredensial pairing sesi WhatsApp ke direktori web publik memungkinkan pengambilalihan akun penuh tanpa autentikasi).
- **Lokasi**: `src/utils/qrExporter.ts:107-125`, `src/bot/lifecycle.ts:12,69,75`, `src/services/alertServer.ts:14-15,51,112`, `src/services/telemetry.service.ts:21`, `src/bot/messageHandler.ts:10,37,103,111`, `src/index.ts:8,24,49`, `src/config/env.ts:44`, `.env.example:24`, `scratch/test_web_routes.ts:1-45`.
- **Bukti / Kondisi Aktual**: `exportQrToWeb(qr)` menulis halaman HTML berisi kode QR aktif ke `/var/www/void-downloader/minji-auth/index.html` dengan auto-refresh 5 detik tanpa login; `AlertServer` memiliki fallback secret statis yang dipublikasikan di `.env.example` dan memakai `!==` biasa; `reportPulse()` mengirim HTTP POST pada setiap pesan masuk/keluar ke domain eksternal.
- **Root Cause**: Utilitas operasional internal khusus server pemilik digabungkan langsung ke kode inti repositori publik tanpa batas konfigurasi atau isolasi autentikasi.
- **Dampak & Risiko**: Pembajakan sesi WhatsApp bot oleh pihak luar, pengiriman pesan spam via endpoint lokal, kebocoran metadata trafik pengguna _self-hosted_, dan terbukanya struktur direktori internal VPS.
- **Rekomendasi Perbaikan**: Hapus total `src/utils/qrExporter.ts`, `src/services/alertServer.ts`, `src/services/telemetry.service.ts`, dan `scratch/`; bersihkan seluruh impor dan variabel lingkungan terkait di `lifecycle.ts`, `messageHandler.ts`, `index.ts`, `env.ts`, dan `.env.example`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-01` | Verifikasi `grep` tidak ada sisa referensi `qrExporter`, `alertServer`, `telemetry`, `void-downloader`, atau `INTERNAL_ALERT_SECRET`, diikuti `npm run build` sukses.

---

<a id="sec-02"></a>

### SEC-02 — Persistent Self-Hosted Runner pada Repo Publik & `prisma db push --accept-data-loss`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security / CI-CD` — **Critical** (_Alasan_: Runner permanen di repositori publik berisiko RCE di host produksi, sedangkan `--accept-data-loss` dapat menghapus kolom/tabel produksi secara otomatis).
- **Lokasi**: `.github/workflows/deploy.yml:15,26,28,35,39`.
- **Bukti / Kondisi Aktual**: Workflow menggunakan `runs-on: [self-hosted, vps-minji]`, path ter-hardcode `/home/anthony/MinjiBot`, penghapusan paksa `.git/index.lock` di luar kunci internal, fallback `npm ci || npm install`, dan `npx prisma db push --skip-generate --accept-data-loss`.
- **Root Cause**: Penggunaan jalan pintas deployment lokal langsung di VPS dan pemakaian `db push` untuk melewati migrasi SQL yang error (`REL-04`).
- **Dampak & Risiko**: Potensi pengambilalihan server produksi jika trigger workflow berubah/disalahgunakan, kegagalan CI di fork komunitas, dan risiko kehilangan data finansial/tenant saat perubahan skema.
- **Rekomendasi Perbaikan**: Cabut self-hosted runner dari repo publik; buat `.github/workflows/ci.yml` di `ubuntu-latest`; ubah `.github/workflows/deploy.yml` memakai `ubuntu-latest` + SSH berbasis _GitHub Secrets_ dengan guard `if: github.repository == 'AnthonyWisnu/MinjiBot'` dan `npx prisma migrate deploy`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-05` (tindakan cabut runner di GitHub dilakukan segera pra-fase) | Validasi sintaks YAML workflow dan uji jalan `ci.yml` pada container bersih.

---

<a id="sec-03"></a>

### SEC-03 — SSRF, Bypass Substring Hostname `.includes()` & Redirect Cookie `yt-dlp`/`gallery-dl`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security` — **High** (_Alasan_: Penyerang anggota grup dapat mengecoh validasi domain untuk memicu request server/ekstraktor beserta file cookie ke host arbitrer atau jaringan internal).
- **Lokasi**: `src/services/media/downloader.service.ts:110,140,196,485,538,590,608,626,782-799`, `src/commands/media/downloader.command.ts:38-42,138-147,199-206`, `src/utils/urlValidator.ts:14-28`.
- **Bukti / Kondisi Aktual**: `host.includes("tiktok.com")` / `host.includes("instagram.com")` meloloskan `evil-tiktok.com` atau `instagram.com.attacker.tld`; `urlValidator.ts` memakai `endsWith(domain)` tanpa titik pemisah; `yt-dlp` dipanggil dengan `--cookies` tanpa `--ies` maupun `--no-playlist`; URL media dari `tikwm.com` di-`fetch` tanpa cek IP privat.
- **Root Cause**: Validasi URL tidak memeriksa batas label DNS dan tidak meresolusi alamat IP tujuan terhadap blok IP privat/loopback/metadata.
- **Dampak & Risiko**: Server-Side Request Forgery (SSRF) ke layanan localhost/cloud metadata VPS, serta potensi bocornya cookie sesi Instagram ke server penyerang melalui HTTP redirect.
- **Rekomendasi Perbaikan**: Terapkan `assertSafeExternalUrl` terpusat (`https:` wajib, `hostname === d || hostname.endsWith("." + d)`, blokir DNS ke IP privat/loopback/link-local/CGNAT), tambahkan `--ies` & `--no-playlist` pada `yt-dlp`, dan validasi URL media respons API eksternal sebelum `fetch`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-01` | Unit test eksplisit menguji `evil-tiktok.com`, `tiktok.com.evil.com`, `http://127.0.0.1`, `http://169.254.169.254`, IPv6 `::1`, dan URL resmi yang sah.

---

<a id="sec-04"></a>

### SEC-04 — Sharp Pixel Bomb (`limitInputPixels: false`), 29 Advisory `npm audit` & Semver Baileys

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security / Dependencies` — **High** (_Alasan_: Input gambar kecil yang dimanipulasi atau SVG khusus dapat memicu OOM crash / eksploitasi C++ `librsvg` `sharp < 0.35.5`).
- **Lokasi**: `src/services/media/sticker.service.ts:79-82,127-130,141-144,158-161,216-223`, `src/services/media/imageEnhance.service.ts:11`, `src/services/media/quoteCard.service.ts:238`, `src/services/member/profileCard.service.ts:222`, `src/services/media/downloader.service.ts:154,694`, `package.json:21-31`.
- **Bukti / Kondisi Aktual**: `sticker.service.ts` mematikan proteksi piksel dengan `limitInputPixels: false` di 5 lokasi; `npm audit` melaporkan `29` kerentanan (`15` High termasuk `sharp@0.34.5`, `music-metadata`, `undici`, `axios`, `zod`, `prisma`, `minimatch`); `@whiskeysockets/baileys` memakai range `"^6.7.0"`.
- **Root Cause**: Opsi `limitInputPixels: false` ditambahkan agar stiker besar tidak gagal baca tanpa memikirkan batas RAM, serta dependensi belum diperbarui ke rilis keamanan terbaru.
- **Dampak & Risiko**: Denial-of-Service (OOM kill proses bot dengan satu file gambar <100 KB) dan paparan CVE pustaka native pengolahan gambar/MP4.
- **Rekomendasi Perbaikan**: Pasang `limitInputPixels: 4096 * 4096` dan batas jumlah frame animasi (`<= 150` halaman) di semua pemanggilan `sharp()`; upgrade `sharp`, `zod`, `prisma`/`@prisma/client`, kunci `@whiskeysockets/baileys` `^6.7.23`, dan tambahkan `overrides` aman untuk dependensi transitif.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-01` | Unit test gambar berdimensi header `10000x10000` ditolak secara aman, serta `npm audit --omit=dev` turun drastis/bersih dari CVE High yang dapat diperbaiki.

---

<a id="sec-05"></a>

### SEC-05 — Bypass Otorisasi DM Multi-Tenant (`.quote`/`.tweet`, Mantan Owner & Enumerasi Kode)

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security / Authorization` — **High** (_Alasan_: Merusak model bisnis sewa multi-tenant karena non-penyewa dan penyewa yang sudah diblokir/kedaluwarsa tetap mendapat akses gratis di DM).
- **Lokasi**: `src/commands/media/quoteCard.command.ts:18-132`, `src/guards/roleGuard.ts:85-94`, `src/repositories/tenantGroup.repository.ts:49-55`, `src/services/tenant/tenantOwnerSession.service.ts:51-58,83-94`, `src/services/tenant/tenantFeature.service.ts:113-127`, `src/commands/member/memberAdmin.command.ts:204-210`.
- **Bukti / Kondisi Aktual**: `.quote` & `.tweet` tidak memiliki cek role/tenant di DM; `ownerExists()`, `TenantOwnerSessionService`, dan `resolveManagedTenant` tidak memfilter `status === ACTIVE && !isBlocked && expiresAt > now`; `memberAdmin.command.ts` mengecek `findByCode` sebelum mengecek hak akses.
- **Root Cause**: `TenantGuard` hanya memeriksa pesan grup (`context.isGroup`), sementara layanan resolusi DM mengasumsikan kepemilikan historis di tabel `TenantGroup` selalu berarti sewa aktif.
- **Dampak & Risiko**: Penyalahgunaan CPU gratis via DM oleh publik dan oleh mantan penyewa yang grupnya telah `EXPIRED` atau `BLOCKED`, serta kebocoran validitas `tenantCode`.
- **Rekomendasi Perbaikan**: Filter seluruh pengecekan kepemilikan & sesi DM hanya pada grup `ACTIVE`, `isBlocked: false`, dan belum kedaluwarsa; tambahkan guard DM yang seragam pada `quoteCard.command.ts` & command media lain; cek role sebelum query `tenantCode`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-01` | Unit test pengguna acak dan mantan owner grup `EXPIRED`/`BLOCKED` ditolak di DM pada `.quote`, `.tweet`, `.hd`, `.s`, `.panel`, dan `.feature`.

---

<a id="sec-06"></a>

### SEC-06 — Interpolasi XML/SVG Tanpa Escape, Input Tanpa Batas & Overflow Kata Panjang

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security` — **Medium** (_Alasan_: Karakter XML tidak di-escape dapat merusak struktur SVG/memicu error render, dan string raksasa membebani parser `librsvg`).
- **Lokasi**: `src/services/member/profileCard.service.ts:125,188,276-282`, `src/services/media/sticker.service.ts:381-387`, `src/services/media/quoteCard.service.ts:173,261-295`.
- **Bukti / Kondisi Aktual**: `maskedPhone` (saat digit `< 8`) dan `createdAtWib` diinterpolasi tanpa `escapeXml`; `&apos;` belum di-escape di `sticker.service.ts`; panjang teks `.brat`/`.quote`/`.tweet` tidak dibatasi; kata tunggal tanpa spasi meluber; posisi badge `.tweet` dihitung dari `safeName.length` pasca-escape.
- **Root Cause**: Fungsi `escapeXml` dibuat terpisah per file secara tidak lengkap dan pembungkus baris teks hanya memecah berdasarkan karakter spasi.
- **Dampak & Risiko**: Gagal render kartu profil/stiker pada nama berkarakter khusus (`&`, `<`, `'`), tampilan visual rusak, dan lonjakan CPU pada input ribuan karakter.
- **Rekomendasi Perbaikan**: Buat utilitas tunggal `src/utils/xml.ts` (`escapeXml`, `wrapSvgText` dengan _hard word-break_, dan pembatas panjang karakter) dan gunakan di seluruh generator SVG; hitung lebar nama dari teks mentah sebelum escape.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-01` | Unit test render `.profile`, `.brat`, `.quote`, `.tweet` dengan input `<script>&"'` dan kata tanpa spasi 500 karakter berhasil menghasilkan gambar valid.

---

<a id="sec-07"></a>

### SEC-07 — Kebocoran `error.message` Mentah, Cacat Substring `userSafeError` & OpSec SSH VPS

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Security / OpSec` — **Medium** (_Alasan_: Membocorkan detail internal sistem ke chat publik sekaligus salah menyensor kata bahasa Indonesia normal; SSH berbasis password berisiko brute-force).
- **Lokasi**: `src/utils/userSafeError.ts:1-24`, `src/commands/media/audioEffect.command.ts:85-87`, `src/commands/media/quoteCard.command.ts:79-80,129-130`, `src/commands/stats/groupStats.command.ts:32-33,47-48,72-73`.
- **Bukti / Kondisi Aktual**: Tiga file command mengirim `error.message` mentah ke WhatsApp; `SENSITIVE_KEYWORDS` memuat `"ig"` dan `"api"` dengan `.includes()`, memblokir kata _"digunakan"_, _"lagi"_, _"tetapi"_, sementara meloloskan `ENOENT`, `TypeError`, dan kode Prisma `P20xx`.
- **Root Cause**: Pendekatan _blacklist substring_ yang rapuh alih-alih pemisahan kelas error domain pengguna (`AppUserError`) vs error infrastruktur.
- **Dampak & Risiko**: Kebocoran path server/pesan error DB ke pengguna akhir, UX pesan error terpotong salah, dan risiko akses tidak sah ke VPS jika autentikasi password SSH dibiarkan aktif.
- **Rekomendasi Perbaikan**: Ganti `userSafeError.ts` dengan kelas `AppUserError` (allowlist eksplisit) + pencatatan `logger.error` untuk semua error tak dikenal; arahkan semua command ke `formatUserSafeError`; jalankan checklist pengerasan SSH key-only & rotasi kredensial di VPS.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-01` | Unit test memastikan `"Limit tidak dapat digunakan"` tampil utuh bila dilempar sebagai `AppUserError`, sedangkan `new Error("ENOENT /home/...")` diganti pesan fallback aman.

---

<a id="log-01"></a>

### LOG-01 — Eksploitasi Pencetakan Poin/Limit Tak Terbatas di `.slot`, Race Double-Spend & Tanpa Ledger

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Business Logic` — **Critical** (_Alasan_: Menghancurkan seluruh integritas ekonomi grup; `TENANT_OWNER` dapat mencetak ratusan juta poin & limit dalam hitungan detik).
- **Lokasi**: `src/services/game/slotGame.service.ts:39-99,133,166-177`.
- **Bukti / Kondisi Aktual**: `isOwner` mencakup `isTenantOwner`, melewati cek `pointsBalance < parsedBet` (L75), menyuntik `+100` poin gratis (L45), memicu saldo negatif saat kalah (L166), dan karena taruhan besar `!== pointsBalance` maka `isAllIn = false` (win rate ~65%); `.slot allin` paralel tidak memakai debit kondisional; `bet * 10` bisa melebihi `INT4`; tidak ada baris `GroupMemberTransaction` maupun panggilan `levelUpNotifierService`.
- **Root Cause**: Pencampuran hak bypass fitur berat `TENANT_OWNER` ke dalam logika taruhan poin serta pembaruan database langsung di luar `MemberEconomyService`.
- **Dampak & Risiko**: Inflasi tak terbatas pada saldo poin/limit grup, pelanggaran invariant saldo `>= 0`, ketidaklengkapan audit finansial, dan crash overflow PostgreSQL.
- **Rekomendasi Perbaikan**: Hapus bypass saldo & suntikan poin untuk `TENANT_OWNER`, batasi `MAX_SLOT_BET = 100_000`, lakukan debit kondisional (`pointsBalance: { gte: bet }`) + kredit hadiah + penulisan `GroupMemberTransaction` di dalam satu `prisma.$transaction`, dan panggil `levelUpNotifierService`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-02` | Unit test `TENANT_OWNER` gagal bertaruh melebihi saldo, `.slot allin` paralel hanya satu yang tereksekusi, dan baris `GroupMemberTransaction` tercatat akurat.

---

<a id="log-02"></a>

### LOG-02 — Pencetakan Limit Massal `.addlimitall` oleh Tenant Owner/Admin Tanpa Transaksi & Ledger

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Business Logic` — **Critical** (_Alasan_: Mengizinkan penyewa maupun admin biasa mencetak limit gratis tanpa batas untuk seluruh grup tanpa jejak buku besar).
- **Lokasi**: `src/commands/member/memberAdmin.command.ts:204-255`, `src/services/member/memberAdmin.service.ts:138-165`.
- **Bukti / Kondisi Aktual**: `.addlimitall` mengizinkan `TENANT_OWNER` dan `TENANT_ADMIN` menambah hingga `+100` limit berkali-kali tanpa batas, di luar `$transaction`, dan tanpa membuat entri `GroupMemberTransaction`.
- **Root Cause**: Ketidakkonsistenan aturan otorisasi dengan `.addlimit`/`.setlimit` (yang khusus `SUPER_OWNER`) serta penggunaan `updateMany` langsung tanpa pencatatan transaksi.
- **Dampak & Risiko**: Penyalahgunaan fitur berat (`yt-dlp`, `ffmpeg`, `Sharp`) secara masif tanpa batas kuota ekonomi grup dan hilangnya jejak audit.
- **Rekomendasi Perbaikan**: Sesuai Keputusan Audit #1 (Opsi A), kunci `.addlimitall` **khusus `SUPER_OWNER`**, pindahkan logika pencarian grup ke `MemberAdminService`, bungkus pembaruan saldo dan pembuatan `GroupMemberTransaction` (`createMany`, tipe `SUPER_OWNER_ADD`) dalam `prisma.$transaction`, serta catat `TenantAuditLog`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-02` | Unit test memastikan `TENANT_OWNER` dan `TENANT_ADMIN` ditolak pada `.addlimitall`, dan eksekusi oleh `SUPER_OWNER` menghasilkan baris `GroupMemberTransaction` untuk setiap member terdampak.

---

<a id="log-03"></a>

### LOG-03 — `YOUTUBE_VIDEO_DOWNLOAD` Absen dari `HEAVY_FEATURE_COST` (`.yt` Gratis & Rusak di DM)

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Business Logic` — **Critical** (_Alasan_: Fitur paling berat secara bandwidth/CPU justru memotong `0` limit dan merusak resolusi grup di DM).
- **Lokasi**: `src/services/member/heavyFeatureCost.ts:7-17`, `src/services/member/heavyFeatureLimit.service.ts:94`.
- **Bukti / Kondisi Aktual**: `HEAVY_FEATURE_COST` bertipe `Partial<Record<HeavyFeatureType, number>>` dan tidak memiliki key `HeavyFeatureType.YOUTUBE_VIDEO_DOWNLOAD`, sehingga `getFeatureCost` mengembalikan `0`.
- **Root Cause**: Penggunaan tipe `Partial<>` membuat kompilator TypeScript tidak memberi peringatan ketika enum `YOUTUBE_VIDEO_DOWNLOAD` ditambahkan ke `schema.prisma`.
- **Dampak & Risiko**: Seluruh unduhan video YouTube oleh member reguler tidak memotong limit sama sekali.
- **Rekomendasi Perbaikan**: Ubah tipe `HEAVY_FEATURE_COST` menjadi `Record<HeavyFeatureType, number>` penuh dan isi `YOUTUBE_VIDEO_DOWNLOAD: 1` (serta `HD_AI_PHOTO: 1`, `HD_AI_PHOTO_DOCUMENT: 1`).
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-02` | Unit test mengiterasi seluruh nilai `Object.values(HeavyFeatureType)` dan memastikan semuanya memiliki biaya `>= 1`.

---

<a id="log-04"></a>

### LOG-04 — `.hd` Tanpa Potong Limit, Distorsi Rasio EXIF `fit: "fill"` & Kualitas Upscale Naif

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Business Logic / Media Quality` — **High** (_Alasan_: Fitur berat `.hd` tidak memotong limit, mendistorsi foto vertikal ber-EXIF rotasi, dan hasilnya tampak sama akibat amplifikasi noise & rekompresi WhatsApp).
- **Lokasi**: `src/commands/media/hd.command.ts:21-75`, `src/services/media/imageEnhance.service.ts:10-50`, `src/services/media/aiJobQueue.service.ts:1-39`, `src/config/env.ts:34`.
- **Bukti / Kondisi Aktual**: `hd.command.ts` tidak memanggil `executeWithHeavyFeatureLimit`; `imageEnhance.service.ts` membaca `metadata.width`/`height` pra-rotasi lalu memanggil `.rotate().resize({ fit: "fill" })` hingga `4096px` dengan `m1: 1.0`, menyebabkan foto potret kamera HP tertarik melebar dan gambar `4096px` yang dikirim via `{ image }` diturunkan ulang kualitasnya oleh WhatsApp; `AI_UPSCALE_BIN` mati.
- **Root Cause**: Kesalahpahaman terhadap perilaku `sharp.metadata()` pada tag EXIF Orientation, ketiadaan adaptasi plafon resolusi HD WhatsApp (`2560px`), dan ketiadaan kontras adaptif lokal (`CLAHE`) maupun proteksi noise area rata.
- **Dampak & Risiko**: Penggunaan CPU Sharp tanpa batas limit oleh member biasa, keluhan pengguna karena foto tampak gepeng atau tidak bertambah jernih.
- **Rekomendasi Perbaikan**: Sesuai Keputusan Audit #2, hubungkan `hd.command.ts` ke `executeWithHeavyFeatureLimit` (**1 Limit**, gratis bagi `TENANT_OWNER` & `SUPER_OWNER`), hapus `AI_UPSCALE_BIN`, dan terapkan pipeline _Sharp Super-Clarity_ (`autoOrient: true`, `metadata.autoOrient`, `fit: "inside"`, kernel `mks2021`, target `2560px` standar / `3840px` mode `doc`, `.clahe({ width: 64, height: 64, maxSlope: 2 })`, `.linear(1.04, -5)`, `.modulate({ brightness: 1.01, saturation: 1.08 })`, `.sharpen({ sigma: 0.9, m1: 0.35, m2: 2.8, x1: 3.5, y2: 12, y3: 20 })`, MozJPEG `quality: 95` `4:4:4` `overshootDeringing: true`).
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-02` | Unit test menguji foto potret ber-EXIF `Orientation: 6` menghasilkan rasio vertikal benar (`width < height`), resolusi tepat (`<= 2560` standar, `<= 3840` doc), ketajaman meningkat terukur (`sharp.stats().sharpness`), dan memotong `1` Limit pada `MEMBER`.

---

<a id="log-05"></a>

### LOG-05 — `AntiDelete` Mem-posting Ulang Hasil Hapus Moderasi & Membongkar `viewOnceMessage*`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Moderation / Privacy` — **Critical** (_Alasan_: Menggagalkan sistem keamanan `AntiLink`/`AntiSpam`/Admin delete dengan menyebarkan ulang konten berbahaya secara permanen, serta melanggar privasi pesan _View-Once_).
- **Lokasi**: `src/services/moderation/antiDelete.service.ts:125-130,181-291`, `src/utils/mediaTarget.ts:145-151`, `src/services/moderation/antiLink.service.ts:98`, `src/services/moderation/antiSpam.service.ts:207`, `src/services/moderation/manualModeration.service.ts:93`.
- **Bukti / Kondisi Aktual**: `AntiDelete` mencache pesan di prioritas `20` sebelum `AntiLink` (`50`)/`AntiSpam` (`60`), lalu saat pesan dihapus bot/admin, `handleRevoke` memeriksa imunitas pengirim pesan asli (pelanggar) sehingga konten terlarang langsung diposting ulang oleh bot; selain itu `unwrapMessage` dan `unwrapQuotedContent` masih membongkar `viewOnceMessage*`.
- **Root Cause**: Urutan pipeline mencache pesan sebelum moderasi tanpa mekanisme eviksi saat pesan dihapus oleh sistem/admin, ditambah sisa kode _unwrap_ View-Once.
- **Dampak & Risiko**: Penyebaran permanen tautan penipuan/konten dewasa oleh bot sendiri (tidak bisa dihapus lagi oleh member) dan pelanggaran ekspektasi privasi _View-Once_ anggota grup.
- **Rekomendasi Perbaikan**: Panggil `antiDeleteService.markModerationDeleted(chatJid, msgId)` pada `AntiLink`, `AntiSpam`, dan `.del`; abaikan `handleRevoke` apabila pelaku revoke `!== cached.senderJid` atau `fromMe === true`; hapus seluruh pembongkaran `viewOnceMessage*` di `antiDelete.service.ts` dan `mediaTarget.ts`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-01` | Unit test memastikan pesan yang dihapus `AntiLink`/Admin tidak pernah di-repost oleh `AntiDelete`, dan media `viewOnceMessageV2` mengembalikan `null` pada `mediaTarget` serta diabaikan `AntiDelete`.

---

<a id="log-06"></a>

### LOG-06 — Kegagalan Sistemik Dual-JID (`@lid` vs `@s.whatsapp.net`) Lintas 10 Modul Fitur

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Identity / Business Logic` — **Critical** (_Alasan_: Menyebabkan eksploitasi pembuatan profil ganda +10 Limit pada `.gift`, tuduhan sider palsu 100% pada `.silent`, gagalnya `.warn`/`.tictactoe`, dan pecahnya saldo member).
- **Lokasi**: `src/commands/member/gift.command.ts:52-59`, `src/services/member/gift.service.ts:106-147`, `src/services/stats/groupStats.service.ts:128-167`, `src/services/moderation/warn.service.ts:37,139,221,262,337-345`, `src/services/game/game.service.ts:241-243,294-350,375`, `src/services/member/heavyFeatureAccess.service.ts:54-59,74-86`, `src/services/tenant/tenantPanel.service.ts:140-146`, `src/services/tenant/tenantFeature.service.ts:71`, `src/services/reminder/reminder.service.ts:105`, `src/services/afk/afk.service.ts:56-114`, `src/commands/member/profile.command.ts:55-104`, `src/utils/jid.ts:84-92`.
- **Bukti / Kondisi Aktual**: Lihat matriks lengkap 10 modul di [`03-logic-and-flow-audit.md` §6](./03-logic-and-flow-audit.md#6-kegagalan-sistemik-identitas-ganda-whatsapp-lid-vs-swhatsappnet-log-06--critical), ditambah bug teks literal `$\ge$` pada `groupStats.service.ts:162` dan `normalizeUserJid("...@g.us")` yang menghasilkan JID user palsu.
- **Root Cause**: Tidak adanya layanan kanonik yang meresolusi pasangan `{ id, jid, lid }` dari metadata grup WhatsApp menjadi satu Phone JID standar sebelum masuk ke logika bisnis/repository.
- **Dampak & Risiko**: Fitur sosial, moderasi, analitik, dan ekonomi gagal bekerja pada grup WhatsApp yang menggunakan mode LID, serta membuka celah self-gift limit gratis.
- **Rekomendasi Perbaikan**: Bangun `IdentityResolverService` berbasis cache metadata grup yang menormalisasi seluruh JID pengirim, mention, quoted participant, dan JID bot (`socket.user.id` + `socket.user.lid`) ke `@s.whatsapp.net` kanonik; perbaiki `normalizeUserJid` agar menolak `@g.us`/`@broadcast`; perbaiki fallback member di `heavyFeatureAccess.service.ts:74-86` dan teks `>=` di `.silent`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-02` | Suite unit test khusus Dual-JID menguji `.gift`, `.silent`, `.warn`, `.tictactoe`, `.panel`, `.afk`, dan `heavyFeatureAccess` dengan partisipan campuran `@lid` dan `@s.whatsapp.net`.

---

<a id="log-07"></a>

### LOG-07 — Klaim `.daily` Non-Atomik, TOCTOU `P2002` Idempotensi & Double-Settlement `.play`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Economy Atomicity` — **Critical** (_Alasan_: Melanggar aturan mutlak atomisitas finansial `AGENTS.md` §8.2; memungkinkan klaim ganda, kehilangan hadiah harian, atau pencurian `reservedLimit` lewat refund pasca-consume).
- **Lokasi**: `src/services/member/dailyClaim.service.ts:84-137`, `src/services/member/memberEconomy.service.ts:161,206,289,375-465,497,605`, `src/services/member/gift.service.ts:125`, `src/commands/media/play.command.ts:44-95`.
- **Bukti / Kondisi Aktual**: `claimDaily` mengeksekusi 4 transaksi terpisah; pengecekan `idempotencyKey` rentan race `P2002`; `play.command.ts:80` tidak mereset `reserved = false` setelah `consumeLimit` dan menjalankan pencarian sebelum cek limit; `refundLimit` tidak memeriksa keberadaan `FEATURE_CONSUME` pada `correlationId` yang sama.
- **Root Cause**: Orkestrasi multi-aset di `DailyClaimService` memanggil metode repository terpisah alih-alih satu transaksi komposit, dan state machine `correlationId` belum divalidasi silang antara `CONSUME` dan `REFUND`.
- **Dampak & Risiko**: Ketidakkonsistenan saldo `limitBalance` vs `reservedLimit`, duplikasi klaim harian, dan unhandled error `P2002`.
- **Rekomendasi Perbaikan**: Bungkus seluruh operasi `claimDaily` dalam satu `prisma.$transaction` dengan syarat atomik `lastDailyClaimAt < startOfTodayWib`; tangkap `P2002` menjadi `DuplicateOperationError`; tolak `refundLimit` bila `FEATURE_CONSUME` sudah ada pada `correlationId` tersebut; migrasikan `play.command.ts` sepenuhnya ke `executeWithHeavyFeatureLimit`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-02` | Unit test konkurensi `Promise.all([claimDaily(), claimDaily()])` memastikan tepat 1 klaim berhasil dan test `consumeLimit` diikuti `refundLimit` pada `correlationId` sama ditolak tanpa mengubah saldo.

---

<a id="log-08"></a>

### LOG-08 — Cacat `TenantGuard`, `FeatureGuard`, Transisi Status Tenant & Invalidasi Cache

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Guards / Tenant Lifecycle` — **High** (_Alasan_: Sakelar fitur penyewa gagal mematikan `.yt`/`.play`/`.slot`/`.hidetag`, grup `BLOCKED` masih merespons pesan, dan `unblockTenant` dapat mengaktifkan grup `PENDING` tanpa owner).
- **Lokasi**: `src/guards/tenantGuard.ts:8,30-106`, `src/bot/messageHandler.ts:85`, `src/guards/featureGuard.ts:10-27`, `src/services/tenant/tenantFeature.service.ts:174-185`, `src/repositories/tenantGroup.repository.ts:152-160`, `src/services/tenant/superOwnerTenant.service.ts:97-222`, `src/services/tenant/tenantOwnerTransfer.service.ts:150-172`.
- **Bukti / Kondisi Aktual**: Lihat rincian lengkap di [`03-logic-and-flow-audit.md` §8](./03-logic-and-flow-audit.md#8-cacat-guard-peta-fitur-siklus-hidup-tenant--invalidasi-cache-log-08--high).
- **Root Cause**: Penambahan fitur baru tidak didaftarkan ke peta guard dan fungsi `invalidateCache` tidak dihubungkan ke metode mutasi layanan tenant/moderasi.
- **Dampak & Risiko**: Penyewa kehilangan kendali atas modul yang ingin dimatikan di grupnya, perubahan status sewa terlambat berlaku karena cache basi, dan potensi grup aktif tanpa penyewa sah.
- **Rekomendasi Perbaikan**: Tambahkan bypass `SUPER_OWNER` & pengecekan `BLOCKED` senyap paling awal di `TenantGuard`; periksa eksistensi command di `CommandRouter` sebelum `TenantGuard`; lengkapi `COMMAND_FEATURE_MAP` & `isTenantFeatureKey`; panggil `invalidateCache` di seluruh mutasi tenant & fitur; hitung ulang status yang benar (`PENDING`/`ACTIVE`/`EXPIRED`) saat `unblockTenant`, validasi `ownerJid` pada `extendTenant`/`setTenantExpire`, dan bungkus `transferOwner` dalam `$transaction`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-02` | Unit test seluruh kombinasi status grup (`PENDING`, `ACTIVE`, `EXPIRED`, `BLOCKED`, `REMOVED`), toggle setiap fitur, dan transisi `unblockTenant` pada grup tanpa owner.

---

<a id="log-09"></a>

### LOG-09 — Cacat Sekunder Moderasi, Game/TicTacToe, Profil Hantu, Cooldown, `INT4` & Zona WIB

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Business Logic / Moderation / Games` — **High** (_Alasan_: Kumpulan bug fungsional nyata seperti penonton luar bisa membubarkan game TicTacToe orang lain, penghapusan link milik Owner sendiri, lockdown palsu saat Admin menambah member, dan melesetnya tanggal kedaluwarsa WIB +7 jam).
- **Lokasi**: `src/services/moderation/antiLink.service.ts:98`, `src/bot/pipeline/interceptors/antiLink.interceptor.ts:9-10`, `src/services/moderation/antiSpam.service.ts:182,302-309`, `src/services/moderation/antiRaid.service.ts:33,50,150,173,202`, `src/services/moderation/manualModeration.service.ts:83,93-98`, `src/services/moderation/warn.service.ts:57-76,275`, `src/services/game/game.service.ts:235-260,514-606`, `src/commands/game/game.command.ts:58-61`, `src/services/game/interactiveReply.service.ts:58-100,142-173`, `src/commands/member/profile.command.ts:317-332`, `src/services/afk/afk.service.ts:52-53`, `src/services/utility/tagAll.service.ts:34-56,78-100`, `src/services/media/downloader.service.ts:469-470`, `src/commands/media/downloader.command.ts:315-320`, `src/services/member/memberEconomy.service.ts:101-111`, `src/services/member/leaderboard.service.ts:38-69`, `src/utils/time.ts:21-95,121-141`, `src/utils/format.ts:6-10`.
- **Bukti / Kondisi Aktual**: Lihat rincian per item di [`03-logic-and-flow-audit.md` §9](./03-logic-and-flow-audit.md#9-cacat-sekunder-moderasi-mini-games-profil--zona-waktu-wib-log-09--high).
- **Root Cause**: Urutan validasi yang terbalik (hapus/mutasi sebelum cek hak/kepemilikan), absennya penguncian mutex in-memory per sesi game/cooldown, dan penggunaan zona waktu UTC default pada fungsi tanggal.
- **Dampak & Risiko**: Gangguan UX harian pada moderasi grup, permainan interaktif, akurasi masa sewa WIB, dan potensi error `INT4` / `Invalid Date`.
- **Rekomendasi Perbaikan**: Terapkan seluruh perbaikan terarah sesuai spesifikasi detail di `audit/phases/PHASE-02-logic-and-architecture.md`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-02` | Unit test regresi untuk masing-masing skenario (spectator `.nyerah`, admin bulk-add `AntiRaid`, `parseDateOnly` `23:59:59+07:00`, batas `MAX_SAFE_DB_INT`, dll.).

---

<a id="perf-01"></a>

### PERF-01 — Badai 5–7 Query SQL Per-Pesan, Pipeline di Grup Mati & Cache RAM `AntiDelete` 1 GB

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Performance` — **Critical** (_Alasan_: Menguras koneksi pool PostgreSQL pada trafik chat grup normal dan memungkinkan satu cache in-memory menghabiskan >1 GB RAM hingga VPS crash OOM).
- **Lokasi**: `src/bot/pipeline/interceptors/activityTracker.interceptor.ts:43`, `src/services/tenant/pendingTenantRegistration.service.ts:29,93`, `src/services/afk/afk.service.ts:46-54`, `src/services/moderation/antiLink.service.ts:36`, `src/services/moderation/antiSpam.service.ts:157-165`, `src/services/moderation/antiDelete.service.ts:45-48,93-179`.
- **Bukti / Kondisi Aktual**: Setiap pesan grup memicu kueri pengaturan berulang dan `upsert` langsung ke `GroupMemberProfile`, tetap berjalan di grup `PENDING`/`EXPIRED`/`BLOCKED`/`REMOVED`, memanggil `groupMetadata` berulang bila `name === null`, serta `AntiDelete` mencache hingga `500 × 2 MB = 1 GB` tanpa cek `mediaBuffer.byteLength` pasca-unduh.
- **Root Cause**: Ketiadaan interceptor konteks tenant ter-cache di awal pipeline, ketiadaan _write-behind batching_ untuk hitungan chat, dan batas LRU berbasis jumlah item tanpa kuota byte total.
- **Dampak & Risiko**: Latensi respons bot meningkat tajam saat grup ramai, kejenuhan IOPS database, dan _Out-Of-Memory_ pada VPS 1–2 GB RAM.
- **Rekomendasi Perbaikan**: Tambahkan `TenantContextInterceptor` ter-cache di awal pipeline yang langsung menghentikan pemrosesan grup non-aktif; ubah `ActivityTracker` menjadi batch flush tiap 15 detik (+ flush saat shutdown); cache hasil percobaan `groupMetadata` gagal; batasi total byte media `AntiDelete` maks `64 MB` dengan validasi `byteLength` pasca-unduh.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-03` | Pengujian unit membuktikan 100 pesan berturut-turut di grup aktif hanya memicu 1 pembacaan konteks tenant dan 1 batch flush DB, serta grup `BLOCKED`/`EXPIRED` dihentikan di interceptor pertama; uji batas `64 MB` `AntiDelete` mengeviski buffer lama secara akurat.

---

<a id="perf-02"></a>

### PERF-02 — Konkurensi Media Tanpa Semaphore, Alokasi Buffer Penuh, Sync I/O & HoL Blocking

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Performance` — **High** (_Alasan_: Eksekusi serentak beberapa perintah `.yt`/`.tt`/`.hd` dapat menumbangkan CPU/RAM server dan memblokir seluruh pesan grup lain).
- **Lokasi**: `src/services/media/downloader.service.ts:118,140,208,669-709`, `src/services/media/playAudio.service.ts:30`, `src/services/media/aiJobQueue.service.ts:1-39`, `src/commands/member/profile.command.ts:118,168,179`, `src/services/member/profileCard.service.ts:256`, `src/services/welcome/welcome.service.ts:425`, `src/commands/media/quoteCard.command.ts:140`, `src/services/media/quoteCard.service.ts:126-131`, `src/commands/media/lyrics.command.ts:137-154`, `src/bot/messageHandler.ts:24-26`.
- **Bukti / Kondisi Aktual**: Subprocess berat dan Sharp berjalan tanpa batas konkurensi; `res.arrayBuffer()` dan `fs.readFile()` memuat ratusan MB ke RAM sebelum `assertFileSizeAllowed`; `fetch` avatar tanpa timeout; `fs.readFileSync` pada jalur panas; double WebP encode di `.quote -s`; loop `for..of` sekuensial di `messageHandler.ts`.
- **Root Cause**: Ketergantungan pada alokasi buffer penuh di memori dan belum diaktifkannya antrean pekerja terbatas.
- **Dampak & Risiko**: Lonjakan RAM/CPU ekstrem, event loop lag, dan _Head-of-Line blocking_ lintas grup.
- **Rekomendasi Perbaikan**: Terapkan `BoundedSemaphoreQueue` untuk subprocess media & Sharp `.hd`; gunakan pembacaan stream berbatas byte + `AbortSignal.timeout` untuk HTTP fetch; cek `fs.stat().size` sebelum membaca file (atau teruskan `{ url: filePath }` ke Baileys); cache avatar fallback secara async di memori; hapus double WebP encode & file temp lirik; proses `messages.upsert` dengan konkurensi terbatas (`5`).
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-03` | Unit test semaphore memastikan job ke-(N+1) mengantre atau ditolak cepat saat antrean penuh, dan test stream reader membatalkan unduhan segera ketika ukuran melewati batas.

---

<a id="perf-03"></a>

### PERF-03 — Indeks `.silent` Absen, FK `TenantPrivateSession`, Query Duplikat & Map Tak Terbatas

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Database / Performance` — **Medium** (_Alasan_: Menyebabkan _sequential scan_ saat grup membesar, data sesi yatim, dan query N+1 yang tidak perlu).
- **Lokasi**: `prisma/schema.prisma:163-174,249-254`, `src/services/stats/groupStats.service.ts:138,143`, `src/guards/roleGuard.ts:43-50,86-93`, `src/guards/moderationGuard.ts:36-41`, `src/services/media/lastPlayed.service.ts:11`.
- **Bukti / Kondisi Aktual**: Ketiadaan `@@index([groupJid, lastActiveAt])`; duplikasi `@@index([userJid])` dan ketiadaan FK `TenantGroup` pada `TenantPrivateSession`; pemanggilan ganda `findInactiveMembers`; loop query JID sekuensial di guard; `Map` tanpa batas di `lastPlayedService`.
- **Root Cause**: Penambahan fitur baru (`.silent`, Dual-JID alt list, `.play` cache) tanpa penyesuaian indeks dan query `IN`.
- **Dampak & Risiko**: Penurunan kecepatan kueri bertahap dan pertumbuhan memori perlahan pada uptime panjang.
- **Rekomendasi Perbaikan**: Buat migrasi Prisma penambahan indeks & FK (dengan pembersihan baris yatim terlebih dahulu), hapus kueri duplikat, ubah loop kandidat JID menjadi satu query `{ in: candidateJids }`, dan ganti `Map` di `lastPlayedService` dengan `LruCache` (kapasitas `500`, TTL `6 jam`).
- **Prioritas, Fase & Metode Verifikasi**: `P2` | `PHASE-03` | Validasi skema `npx prisma validate`, uji migrasi bersih, dan unit test `RoleGuard`/`GroupStatsService`.

---

<a id="rel-01"></a>

### REL-01 — Risiko Deadlock Pipe `stdout` 64 KB di 5 `spawn()`, Proses Yatim & Guard `tempFile`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Reliability` — **High** (_Alasan_: Proses eksternal dapat menggantung hingga timeout penuh dan meninggalkan sub-proses `ffmpeg` yatim di server).
- **Lokasi**: `src/services/media/downloader.service.ts:815,852`, `src/services/media/playAudio.service.ts:125`, `src/services/media/audioEffect.service.ts:77`, `src/services/media/sticker.service.ts:264`, `src/services/media/videoNormalize.service.ts:79`, `src/utils/tempFile.ts:26-61`.
- **Bukti / Kondisi Aktual**: Kelima pemanggilan `spawn()` membiarkan `stdout` bertipe `"pipe"` tanpa listener data; `stderr` tidak dibatasi panjangnya; timeout `child.kill("SIGKILL")` tidak mematikan _process group_ anak (`ffmpeg` milik `yt-dlp`) dan langsung menghapus direktori temp sebelum proses benar-benar keluar; `tempFile.ts` menyapu seluruh isi `TEMP_DIR` tanpa filter prefix/subdirektori khusus.
- **Root Cause**: Duplikasi kode helper `spawn` manual di lima tempat tanpa utilitas eksekutor proses terpusat yang aman.
- **Dampak & Risiko**: Unduhan media macet (deadlock pipe), akumulasi proses zombie/yatim `ffmpeg` di VPS, error `EBUSY` di Windows, dan risiko salah hapus file jika `TEMP_DIR` menunjuk ke direktori bersama.
- **Rekomendasi Perbaikan**: Bangun satu utilitas terpusat `src/utils/processRunner.ts` dengan `stdio: ["ignore", "ignore", "pipe"]` (atau drain `stdout` terbatas bila diperlukan), batas cincin `stderr` maks `16 KB`, pembunuhan seluruh _process tree_ (`process.kill(-child.pid, "SIGKILL")` dengan `detached: true` di Linux & `taskkill /PID /T /F` di Windows), menunggu event `close` sebelum keluar, serta mengisolasi `tempFile.ts` di dalam subdirektori khusus ber-prefix `minji-`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-03` | Unit test `processRunner` menguji proses yang menulis `> 256 KB` ke `stdout` selesai dalam `< 1 detik` tanpa deadlock dan timeout mematikan sub-proses anak dengan bersih.

---

<a id="rel-02"></a>

### REL-02 — Kebocoran Permanen `reservedLimit` Saat Crash/Restart & Race `P2002` pada `upsert`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Reliability` — **High** (_Alasan_: Setiap restart/deploy saat ada unduhan berjalan membuat limit pengguna hilang permanen di kolom `reservedLimit`).
- **Lokasi**: `src/index.ts:12-65`, `src/utils/heavyFeatureHelper.ts:87-104`, `src/repositories/groupMemberProfile.repository.ts:21,141`.
- **Bukti / Kondisi Aktual**: Tidak ada fungsi pemulihan reservasi menggantung saat startup aplikasi; `heavyFeatureHelper.ts` menelan error `consumeLimit`/`refundLimit` dalam `catch {}` kosong; `upsert` profil baru belum menangkap benturan `P2002` paralel.
- **Root Cause**: Koordinasi reservasi disimpan di DB tetapi siklus penyelesaiannya hanya dipegang di variabel lokal memori proses yang mudah hilang saat restart.
- **Dampak & Risiko**: Akumulasi `reservedLimit > 0` permanen pada member aktif dan kegagalan sporadis pesan pertama anggota baru.
- **Rekomendasi Perbaikan**: Jalankan `reconcileOrphanedReservations()` saat startup (dan periodik tiap 30 menit untuk reservasi berumur `> 15 menit`), tambahkan retry + `logger.error` pada `heavyFeatureHelper.ts`, dan tambahkan penanganan `P2002` pada `findOrCreate`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-03` | Unit test simulasi transaksi `FEATURE_RESERVE` menggantung dipulihkan otomatis oleh `reconcileOrphanedReservations()` lengkap dengan baris `FEATURE_REFUND`.

---

<a id="rel-03"></a>

### REL-03 — Absennya `cachedGroupMetadata` & `getMessage`, Guard `BotLifecycle` & Retry Reminder

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Reliability / WhatsApp Connection` — **High** (_Alasan_: Tanpa `cachedGroupMetadata`, Baileys memukul server WhatsApp pada setiap pengiriman pesan grup — pemicu utama error 429 & pemblokiran nomor).
- **Lokasi**: `src/bot/connection.ts:24,35-43`, `src/bot/lifecycle.ts:48-111`, `src/services/reminder/reminder.service.ts:145-149`, `src/services/reminder/reminderScheduler.ts:35-61`.
- **Bukti / Kondisi Aktual**: `makeWASocket` tidak menyertakan `cachedGroupMetadata` dan mengisi `getMessage` dengan stub `undefined`; `fetchLatestBaileysVersion()` tanpa timeout/fallback; `BotLifecycle` tidak memeriksa kesamaan referensi soket maupun `isStopping` pasca-await; `ReminderScheduler` mengulang pengiriman ke grup ter-kick tiap 30 detik selamanya dan mengabaikan `remindAllCooldownSec`.
- **Root Cause**: Konfigurasi soket Baileys masih menggunakan template minimal awal pengembangan.
- **Dampak & Risiko**: Trafik WebSocket berlebih ke WhatsApp, pesan gagal didekripsi ulang oleh penerima ("Waiting for this message"), soket ganda saat reconnect cepat, dan spam error log abadi pada reminder grup lama.
- **Rekomendasi Perbaikan**: Sediakan cache metadata grup bersama (`GroupMetadataCache`, TTL 5 menit + update otomatis dari event `groups.update` & `group-participants.update`) ke `cachedGroupMetadata`, simpan ringkasan pesan keluar terakhir di LRU ringan untuk `getMessage`, pasang timeout 5 detik + fallback versi lokal pada `fetchLatestBaileysVersion()`, tambahkan guard `socket === this.socket` & `this.isStopping` di `BotLifecycle`, serta batalkan otomatis reminder pada grup non-aktif/`403` dan terapkan `remindAllCooldownSec`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-03` | Unit test `BotLifecycle` (stale socket event diabaikan, `stop()` membatalkan koneksi in-flight), test `getMessage` store, dan test `ReminderScheduler` menandai selesai/batal pada error `403`.

---

<a id="rel-04"></a>

### REL-04 — SQL Migrasi `DO \$\$` Rusak, Duplikasi Timestamp `20260905010000` & Absennya Konfig PM2

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Database / Operations` — **Critical** (_Alasan_: `npx prisma migrate deploy` gagal total pada instalasi database baru mana pun).
- **Lokasi**: `prisma/migrations/20260903010000_remove_legacy_owner_quota/migration.sql:11-21`, `prisma/migrations/20260905010000_add_group_member_warning/`, `prisma/migrations/20260905010000_remove_antiviewonce/`.
- **Bukti / Kondisi Aktual**: Baris `11` dan `21` menulis `DO \$\$ BEGIN ... END \$\$;` yang tidak valid di PostgreSQL; dua folder migrasi memakai timestamp identik `20260905010000`; repositori tidak memiliki `ecosystem.config.cjs` untuk mengatur `instances: 1`, `exec_mode: "fork"`, dan `kill_timeout: 10000`.
- **Root Cause**: Escaping shell yang tidak disengaja saat menulis file SQL migrasi manual dan ketergantungan pada `prisma db push` selama pengembangan.
- **Dampak & Risiko**: Pengguna baru gagal menjalankan `npm run prisma:deploy`, CI gagal membangun DB uji, dan PM2 dapat memutus proses sebelum transaksi database selesai saat restart.
- **Rekomendasi Perbaikan**: Perbaiki `\$\$` menjadi `$$`, rapikan urutan timestamp migrasi secara aman beserta panduan rekonsiliasi checksum `_prisma_migrations` untuk DB produksi eksisting, dan tambahkan `ecosystem.config.cjs`.
- **Prioritas, Fase & Metode Verifikasi**: `P0` | `PHASE-05` | Eksekusi `npx prisma migrate deploy` pada database PostgreSQL kosong berjalan 100% sukses dari migrasi pertama hingga terakhir.

---

<a id="rel-05"></a>

### REL-05 — Penulisan `saveCreds()` Paralel Tanpa Antrean Berpotensi Merusak JSON `creds.json`

- **Klasifikasi**: `Potential Finding`
- **Kategori & Severity**: `Reliability / WhatsApp Session` — **Medium** (_Alasan_: Belum terjadi di pengujian ringan, namun secara teknis terbukti `useMultiFileAuthState` memanggil `fs.writeFile` non-atomik tanpa serialisasi saat event `creds.update` beruntun).
- **Lokasi**: `src/bot/subscribers/index.ts:22-26`, `src/bot/connection.ts:22`.
- **Bukti / Kondisi Aktual**: Listener `socket.ev.on("creds.update", () => { void saveCreds(); })` langsung menembakkan penulisan asinkron paralel setiap kali Signal merotasi pre-key atau sesi.
- **Root Cause**: Implementasi bawaan `useMultiFileAuthState` di Baileys memang dirancang sederhana dan mendokumentasikan perlunya kehati-hatian pada beban produksi tinggi.
- **Dampak & Risiko**: Apabila dua `fs.writeFile` ke `creds.json` bertumpukan atau proses mati di tengah penulisan, `creds.json` menjadi kosong/terpotong dan bot kehilangan sesi login (`loggedOut`).
- **Rekomendasi Perbaikan**: Bungkus pemanggilan `saveCreds()` di dalam _async sequential promise chain_ (antrean 1-per-1 dengan _coalescing_) dan tunggu antrean selesai sebelum `BotLifecycle.stop()` keluar.
- **Prioritas, Fase & Metode Verifikasi**: `P2` | `PHASE-03` | Unit test menembakkan 20 event `creds.update` serentak dan memverifikasi `saveCreds` tidak pernah berjalan tumpang-tindih secara paralel.

---

<a id="arch-01"></a>

### ARCH-01 — Pelanggaran Layering Command-ke-Repository, Duplikasi Avatar & 10 Command Tanpa Catch

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Architecture` — **Medium** (_Alasan_: Melanggar aturan arsitektur `AGENTS.md` §8.1 dan meninggalkan celah silent failure saat terjadi exception di command).
- **Lokasi**: `src/commands/member/memberAdmin.command.ts:4-5,12-13,205,211,236`, `src/commands/member/profile.command.ts:10,12,250`, `src/commands/commandRouter.ts:36-46`, `src/commands/tenant/superOwnerTenant.command.ts:65,158,218`, `src/commands/tenant/tenantOwner.command.ts:40`, `src/commands/utility/reminder.command.ts:42,68`, `src/commands/moderation/welcome.command.ts:34-82`.
- **Bukti / Kondisi Aktual**: Dua file command memanggil repository langsung; logika fetch avatar & fallback file diduplikasi di 4 tempat; 10 fungsi handler command tidak memiliki `try/catch` dan `CommandRouter.dispatch` tidak menangkap error untuk memberi respons aman ke pengguna.
- **Root Cause**: Penambahan fitur bertahap langsung di dalam command handler tanpa mengekstrak helper/metode service.
- **Dampak & Risiko**: Kebocoran logika bisnis ke lapisan presentasi, perilaku timeout avatar tidak konsisten, dan perintah tampak "mati tidak merespons" jika terjadi gagal jaringan/DB.
- **Rekomendasi Perbaikan**: Pindahkan seluruh akses repository dari command ke service terkait, sentralisasikan `AvatarService`, dan pasang _unified error boundary_ di `CommandRouter.dispatch()`.
- **Prioritas, Fase & Metode Verifikasi**: `P2` | `PHASE-02` | Verifikasi statis tidak ada `import ... from "../../repositories/..."` di seluruh `src/commands/` dan unit test `CommandRouter` menangkap exception handler dengan `formatUserSafeError`.

---

<a id="qual-01"></a>

### QUAL-01 — 278 Masalah ESLint, 104 File Unformatted, Ignore Kurang & 38 Paket Extraneous

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Code Quality` — **High** (_Alasan_: Seluruh _static quality gates_ (`lint` dan `format:check`) saat ini gagal total sehingga regresi tipe/kualitas tidak terbendung).
- **Lokasi**: `src/services/moderation/antiDelete.service.ts` (29 error), `scratch/test_web_routes.ts` (1 parse error), `tests/*.test.ts` (234 error), `eslint.config.mjs`, `.gitignore`, `.prettierignore`, `package.json`.
- **Bukti / Kondisi Aktual**: `npm run lint` gagal dengan `278` masalah; `npm run format:check` gagal pada `104` file; `tmp-test/` & `sessions-test/` belum di-ignore; `package.json` belum memiliki `engines` & `typecheck`; terdapat `38` paket extraneous di `node_modules`.
- **Root Cause**: Pengembangan cepat tanpa pipeline CI otomatis yang memblokir kode yang melanggar aturan ESLint/Prettier.
- **Dampak & Risiko**: Penggunaan `any` menyembunyikan potensi `TypeError` saat membaca objek pesan Baileys, diff Git kotor, dan lingkungan lokal tidak deterministik.
- **Rekomendasi Perbaikan**: Hapus penggunaan `any` di `antiDelete.service.ts` dan `tests/` dengan tipe `proto.IMessage` & pabrik test bertipe, jalankan Prettier, perbarui `.gitignore`/`.prettierignore`/`eslint.config.mjs`/`package.json`, dan jalankan `npm ci` bersih.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-04` | `npm run lint`, `npm run format:check`, `npm run typecheck`, dan `npm run build` semuanya keluar dengan kode `0` (`0` error, `0` warning).

---

<a id="doc-01"></a>

### DOC-01 — Ketidaksinkronan `AGENTS.md`, `README.md`, `PLAN.md`, `.env.example`, `.menu` & `.panel`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Maintainability / UX` — **High** (_Alasan_: Dokumentasi sistem utama dan teks `.menu` memberikan informasi salah kepada pengguna, penyewa, dan AI Agent berikutnya).
- **Lokasi**: `AGENTS.md:30,40-53,83-121`, `README.md`, `PLAN.md`, `.env.example`, `src/services/general/menu.service.ts:25,73,88-97,172,215,248,270,280-299`, `src/services/tenant/tenantPanel.service.ts:75`, `src/services/member/experienceRank.ts:12`, `src/services/member/profileCard.service.ts:297`.
- **Bukti / Kondisi Aktual**: Lihat tabel perbandingan lengkap 8 area drift pada [`05-code-quality-and-maintainability.md` §3](./05-code-quality-and-maintainability.md#3-ketidaksinkronan-dokumentasi--tampilan-menu-terhadap-kode-aktual-doc-01--high).
- **Root Cause**: Perubahan nilai ekonomi, nama tier rank, dan penambahan command tidak diikuti pembaruan dokumen dan teks menu statis.
- **Dampak & Risiko**: Kebingungan pengguna saat mengetik command yang salah dari `.menu` (mis. `.delwarn`), ekspektasi poin/harga salah, serta risiko AI Agent berikutnya mengubah logika bisnis ke arah yang keliru karena membaca `AGENTS.md` lama.
- **Rekomendasi Perbaikan**: Selaraskan seluruh dokumen, `.env.example`, JSDoc, dan `menu.service.ts` 100% mengikuti perilaku kode aktual yang telah disepakati, serta tambahkan bagian `## Audit Remediation Workflow` ke `AGENTS.md`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-04` | Cross-check otomatis seluruh command yang tertulis di `menu.service.ts` terdaftar di `src/commands/index.ts`, serta audit manual `AGENTS.md` & `README.md`.

---

<a id="comp-01"></a>

### COMP-01 — Bug `PATH` Windows, `.mp4` Non-H.264 Gagal Putar di HP, `fromMe: false` & Font Linux

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Compatibility` — **Medium** (_Alasan_: Mempengaruhi kelancaran pemutaran video hasil unduhan di iOS/Android, pengembangan di Windows, dan tampilan teks SVG di server Linux minimal).
- **Lokasi**: `src/services/media/playAudio.service.ts:129`, `src/services/media/downloader.service.ts:756`, `src/utils/mediaTarget.ts:46,83`, `src/utils/moderationTarget.ts:44-46`.
- **Bukti / Kondisi Aktual**: Penduplikasian key `PATH` vs `Path` di Windows; `normalizeVideoIfNeeded` meloloskan semua `.mp4` meskipun ber-codec VP9/AV1/HEVC; `mediaTarget` meng-hardcode `fromMe: false` untuk media pesan bot yang di-reply; `moderationTarget` menolak nomor non-`62`; kebutuhan font Linux belum terdokumentasi.
- **Root Cause**: Asumsi lingkungan tunggal (Linux dengan video sumber selalu H.264 dan nomor selalu Indonesia).
- **Dampak & Risiko**: Video `.tt`/`.ig` tertentu tampil layar hitam di iPhone, gagal re-upload media pesan bot yang di-reply, dan karakter kotak-kotak (_tofu_) pada `.brat`/`.profile` di VPS baru.
- **Rekomendasi Perbaikan**: Buat helper `buildSubprocessEnv()` yang memperbarui kunci `PATH` secara _case-preserving_; deteksi codec video `.mp4` (`avc1`/`h264`) sebelum melewati normalisasi FFmpeg; hitung `fromMe` akurat di `mediaTarget.ts`; dukung nomor E.164 `7–15` digit di `moderationTarget.ts`; dokumentasikan instalasi paket font Linux.
- **Prioritas, Fase & Metode Verifikasi**: `P2` | `PHASE-03` | Unit test `buildSubprocessEnv` pada objek mock `{ Path: "C:\\Windows" }`, test deteksi MP4 non-AVC1 memicu normalisasi, dan test `mediaTarget` `fromMe: true` saat me-reply pesan bot.

---

<a id="comp-02"></a>

### COMP-02 — Penyediaan `Dockerfile`, `.dockerignore` & `docker-compose.yml` Multi-Platform

- **Klasifikasi**: `Improvement`
- **Kategori & Severity**: `Portability / DevOps` — **Low** (_Alasan_: Aplikasi dapat berjalan langsung di host Node.js, namun kontainerisasi sangat memudahkan pengguna lain menjalankan seluruh dependensi biner secara instan).
- **Lokasi**: Root repositori (`Dockerfile`, `.dockerignore`, `docker-compose.yml` — belum ada).
- **Bukti / Kondisi Aktual**: Pengguna _open-source_ harus menginstal Node 20, PostgreSQL, FFmpeg, Python, `yt-dlp`, `gallery-dl`, dan paket font secara manual satu per satu.
- **Root Cause**: Proyek awalnya hanya di-deploy pada satu VPS tetap menggunakan PM2.
- **Dampak & Risiko**: Hambatan adopsi (_onboarding friction_) dan perbedaan versi biner antar pengguna.
- **Rekomendasi Perbaikan**: Tambahkan `Dockerfile` multi-stage ringan berbasis `node:20-bookworm-slim` (non-root user `node`), `.dockerignore`, dan `docker-compose.yml` opsional.
- **Prioritas, Fase & Metode Verifikasi**: `P3` | `PHASE-05` | Verifikasi struktur `Dockerfile` dan `docker-compose config` valid tanpa mengekspos secret.

---

<a id="acc-01"></a>

### ACC-01 — WCAG & SEO Tidak Berlaku pada Headless WhatsApp Bot Tanpa Antarmuka Web Publik

- **Klasifikasi**: `Not Applicable`
- **Kategori & Severity**: `Accessibility / SEO` — **Informational** (_Alasan_: Tidak terdapat antarmuka web/DOM publik pada arsitektur sasaran MinjiBot).
- **Lokasi**: Seluruh repositori (`src/`).
- **Bukti / Kondisi Aktual**: Setelah penghapusan utilitas internal `qrExporter.ts` dan `alertServer.ts` (`SEC-01`), aplikasi murni berjalan sebagai klien protokol pesan WhatsApp berbasis teks & media.
- **Root Cause**: Karakteristik alami arsitektur bot chat _headless_.
- **Dampak & Risiko**: Tidak ada risiko ketidakpatuhan WCAG web maupun indeksasi mesin pencari.
- **Rekomendasi Perbaikan**: Tidak memerlukan perubahan kode; pertahankan rasio kontras tinggi pada kartu SVG (`.profile`, `.quote`) dan struktur pesan teks yang rapi.
- **Prioritas, Fase & Metode Verifikasi**: `N/A` | `Not Applicable` | Diverifikasi melalui ketiadaan HTTP/HTML server pada kode sumber pasca `PHASE-01`.

---

<a id="uxl-01"></a>

### UXL-01 — Berkas `LICENSE` MIT Tidak Ada (Link Rusak di `README.md:280`) & `"private": true`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Legal / Licensing` — **High** (_Alasan_: Tanpa file `LICENSE`, repositori publik secara hukum tidak memberikan hak pakai open-source kepada publik meskipun klaim di README menyebut MIT).
- **Lokasi**: `README.md:280`, `package.json:4`.
- **Bukti / Kondisi Aktual**: Tautan `./LICENSE` di `README.md:280` menghasilkan 404 karena berkas tidak ada; `package.json` memuat `"private": true` tanpa field `"license"`.
- **Root Cause**: Berkas lisensi belum dibuat saat repositori pertama kali diinisialisasi.
- **Dampak & Risiko**: Ketidakpastian hukum bagi pengguna/kontributor eksternal dan tautan dokumentasi rusak.
- **Rekomendasi Perbaikan**: Tambahkan berkas `LICENSE` (MIT License) di root repositori dan sesuaikan metadata `"license": "MIT"` di `package.json`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-04` | Verifikasi keberadaan `LICENSE` dan kecocokan field `license` di `package.json`.

---

<a id="uxl-02"></a>

### UXL-02 — Risiko Banned Nomor WhatsApp Unofficial API (`Baileys`) Tanpa Disclaimer Operator

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Legal / ToS Compliance` — **High** (_Alasan_: Operator baru yang memasang nomor WhatsApp utamanya berisiko mengalami pemblokiran permanen oleh Meta tanpa peringatan risiko yang jelas).
- **Lokasi**: `README.md`, `src/commands/moderation/moderation.command.ts` (`.add`, `.kick`, `.tagall`).
- **Bukti / Kondisi Aktual**: Proyek memakai pustaka tidak resmi `@whiskeysockets/baileys` dan menyediakan aksi sensitif seperti `.add` member via nomor tanpa _disclaimer_ risiko ToS WhatsApp di `README.md`.
- **Root Cause**: Dokumentasi baru berfokus pada fitur teknis, belum mencakup peringatan operasional platform pihak ketiga.
- **Dampak & Risiko**: Pemblokiran nomor WhatsApp operator/pengguna dan potensi tuntutan keluhan dari pengguna _open-source_.
- **Rekomendasi Perbaikan**: Cantumkan peringatan tegas mengenai penggunaan Unofficial WhatsApp Web API, rekomendasi nomor khusus bot, dan etika penggunaan fitur moderasi/mention massal di `README.md`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-04` | Pemeriksaan bagian _Disclaimer & Acceptable Use_ pada `README.md`.

---

<a id="uxl-03"></a>

### UXL-03 — Risiko Impersonasi Centang Biru & Fitnah Pihak Ketiga pada `.tweet @user <teks>`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Legal / UX Safety` — **High** (_Alasan_: Memungkinkan pembuatan tangkapan layar palsu realistis bercentang biru menggunakan wajah dan nama asli anggota grup lain dengan kalimat bebas karangan pemanggil).
- **Lokasi**: `src/commands/media/quoteCard.command.ts:88-127`, `src/services/media/quoteCard.service.ts:169-219`.
- **Bukti / Kondisi Aktual**: `.tweet @target kalimat palsu` menarik foto profil dan pushName asli `@target` serta menaruh centang verifikasi biru tanpa persetujuan target dan tanpa penanda parodi.
- **Root Cause**: Desain awal fitur menyalin fleksibilitas mockup tweet tanpa mempertimbangkan penyalahgunaan pencemaran nama baik di grup publik.
- **Dampak & Risiko**: Penyalahgunaan _hoax_/fitnah antar anggota grup (risiko UU ITE) dan pelanggaran filosofi keamanan sosial di `AGENTS.md` §5.3.
- **Rekomendasi Perbaikan**: Hapus dukungan `@user <teks karangan>`; `.tweet <teks>` hanya merender identitas pengirim perintah sendiri, atau jika me-reply pesan orang lain maka wajib menggunakan teks asli dari pesan yang di-reply tersebut, ditambah watermark footer `GENERATED BY MINJIBOT • PARODY`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-02` | Unit test memastikan `.tweet @target teks` tidak lagi meminjam profil `@target`, dan hasil SVG memuat watermark parodi.

---

<a id="uxl-04"></a>

### UXL-04 — Retensi PII Tanpa Batas, Absennya `.deletemydata`/`.purgetenant` & `PRIVACY.md`

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Privacy / Compliance` — **Medium** (_Alasan_: Menyimpan nomor telepon dan log aktivitas pengguna tanpa batas retensi, tanpa fitur penghapusan mandiri, serta masih menyisakan nomor nyata di fixture test).
- **Lokasi**: `prisma/schema.prisma`, `tests/` (fixture JID), dokumentasi root (`PRIVACY.md` belum ada).
- **Bukti / Kondisi Aktual**: Tidak ada perintah penghapusan data pribadi member atau pembersihan grup `REMOVED`, tidak ada pemangkasan `TenantAuditLog` lama, belum ada pengungkapan API pihak ketiga (`tikwm.com`, `lrclib.net`), dan beberapa file test memakai string nomor HP nyata.
- **Root Cause**: Fokus pengembangan awal pada fitur fungsional tanpa siklus hidup penghapusan data akhir (_data lifecycle retirement_).
- **Dampak & Risiko**: Ketidakpatuhan terhadap prinsip minimalisasi/penghapusan data UU PDP No. 27/2022 dan pembengkakan tabel log dari waktu ke waktu.
- **Rekomendasi Perbaikan**: Implementasikan `.deletemydata` (dengan proteksi agar tidak menghapus catatan `GroupMemberWarning` aktif di grup tempat ia masih tergabung) dan `.purgetenant <kode>` (khusus `SUPER_OWNER` untuk grup `REMOVED`/`EXPIRED`), jadwal pemangkasan log `> 90 hari`, anonymisasi seluruh nomor telepon di `tests/`, serta publikasikan `PRIVACY.md` (Phase 4).
- **Prioritas, Fase & Metode Verifikasi**: `P2` | `PHASE-02` (kode & sanitasi nomor test) + `PHASE-04` (`PRIVACY.md`) | Unit test `.deletemydata` & `.purgetenant` serta `grep` memastikan seluruh JID di `tests/` memakai prefix dummy sintetis.

---

<a id="uxl-05"></a>

### UXL-05 — Potensi Klaim Hak Cipta/Publisitas Foto Selebritas `assets/minji.png` & `src/Minji.png`

- **Klasifikasi**: `Potential Finding`
- **Kategori & Severity**: `Legal / Intellectual Property` — **Medium** (_Alasan_: Berkas foto potret artis komersial didistribusikan langsung di dalam repositori publik yang akan berlisensi MIT).
- **Lokasi**: `assets/minji.png`, `src/Minji.png`, `src/services/welcome/welcome.service.ts:16`, `src/commands/member/profile.command.ts:24`, `src/services/member/profileCard.service.ts:251`.
- **Bukti / Kondisi Aktual**: Terdapat dua salinan gambar PNG potret selebritas (~1.1 MB × 2) di dalam pohon Git yang dijadikan fallback avatar resmi bot.
- **Root Cause**: Penggunaan gambar karakter/idola inspirasi nama proyek secara langsung di dalam kode sumber.
- **Dampak & Risiko**: Risiko DMCA notice pada repositori GitHub publik dan ketidakcocokan lisensi aset dengan MIT License kode.
- **Rekomendasi Perbaikan**: Hapus `src/Minji.png`, ganti `assets/minji.png` dengan avatar vektor/maskot orisinal bebas hak cipta buatan sendiri (`assets/default-avatar.png`), dan tambahkan variabel `BOT_AVATAR_PATH` di `.env` agar operator dapat menunjuk file kustom lokal di luar Git.
- **Prioritas, Fase & Metode Verifikasi**: `P2` | `PHASE-02` | Verifikasi `src/Minji.png` terhapus, `assets/default-avatar.png` termuat via `AvatarService`, dan override `BOT_AVATAR_PATH` berfungsi.

---

<a id="qa-01"></a>

### QA-01 — `tsconfig.json` Mengecualikan `tests/`, Menyembunyikan 39 Error TypeScript di 15 File Test

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Testing / Type Safety` — **High** (_Alasan_: Menciptakan rasa aman palsu di mana `npm run build` dan `npm test` lulus padahal 15 file test tidak lagi sesuai kontrak tipe aplikasi).
- **Lokasi**: `tsconfig.json:21`, `tsconfig.eslint.json`, dan `15` file di `tests/` (`dailyClaim`, `gift`, `groupMemberProfile`, `heavyFeatureLimit`, `memberEconomy`, `profileLeaderboard`, `profileCard`, `groupStats`, `levelUp`, `phase2Features`, `qaHardening`, `welcomeGoodbye`, `addLimitAll`, `tenantAdminService`, `featureGuard`, `tenantGuard`, `lyricsService`, `afkService`, `slotGame`).
- **Bukti / Kondisi Aktual**: Menjalankan `npx tsc -p tsconfig.eslint.json --noEmit` menghasilkan `39` error kompilasi TypeScript (`exit code 2`).
- **Root Cause**: `tsx --test` tidak melakukan typechecking sementara `npm run build` hanya memeriksa `tsconfig.json` yang mengecualikan `tests/`.
- **Dampak & Risiko**: Mock di dalam unit test menyimpang dari skema database dan kontrak fungsi nyata sehingga bug seperti `LOG-03` dan `LOG-06` lolos ke produksi.
- **Rekomendasi Perbaikan**: Buat `tests/helpers/factories.ts` bertipe ketat, perbaiki seluruh `39` error TS di seluruh file test, tambahkan script `"typecheck": "tsc -p tsconfig.eslint.json --noEmit"`, dan jadikan wajib di CI.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-05` | `npm run typecheck` lulus `0` error.

---

<a id="qa-02"></a>

### QA-02 — Cakupan Test Command 10% (`3/30`), Downloader/HD/Lifecycle 0% & Asersi Semu

- **Klasifikasi**: `Confirmed Finding`
- **Kategori & Severity**: `Testing / Production Readiness` — **High** (_Alasan_: Lapisan integrasi pengguna terluar (`CommandRouter` & `26` command handler), seluruh pemrosesan downloader/HD, serta rekoneksi soket Baileys belum memiliki jaring pengaman otomatis).
- **Lokasi**: `tests/gift.test.ts:179-184`, `tests/qaHardening.test.ts:106`, `tests/heavyFeatureLimit.test.ts:19-28`, serta ketiadaan test untuk `src/commands/**`, `src/services/media/downloader.service.ts`, `src/services/media/imageEnhance.service.ts`, `src/bot/lifecycle.ts`, `src/services/game/interactiveReply.service.ts`, `src/services/reminder/reminderScheduler.ts`.
- **Bukti / Kondisi Aktual**: Hanya `3` dari `30` file di `src/commands/` yang memiliki unit test; beberapa test eksisting memiliki asersi tautologis/unawaited dan tidak menguji kelengkapan enum.
- **Root Cause**: Pengujian ditulis terfokus pada sebagian service awal tanpa kerangka mock `CommandContext` yang ergonomis.
- **Dampak & Risiko**: Regresi pada parsing argumen command, kesalahan reservasi/settlement limit di handler, dan bug siklus hidup soket tidak terdeteksi sebelum rilis.
- **Rekomendasi Perbaikan**: Perbaiki asersi lemah pada test eksisting dan tambahkan suite pengujian terstruktur untuk `CommandRouter`, command utama, `heavyFeatureHelper`, `DownloaderService` (validasi URL/SSRF & normalisasi), `ImageEnhanceService` (orientasi EXIF & kualitas HD), `IdentityResolver`, `BotLifecycle`, `InteractiveReplyService`, dan `ReminderScheduler`.
- **Prioritas, Fase & Metode Verifikasi**: `P1` | `PHASE-05` | Seluruh test lama + suite regresi baru lulus 100% di bawah `npm run typecheck && npm test` dan tervalidasi terhadap database PostgreSQL bersih di CI.
