# 02 — Security & Infrastructure Audit

Dokumen ini menyajikan analisis keamanan mendalam beserta bukti kode sumber untuk seluruh kerentanan keamanan aplikasi, manajemen rahasia (_secrets_), validasi URL/SSRF, pemrosesan media/SVG, otorisasi multi-tenant pada _Direct Message_ (DM), kerentanan dependensi (`npm audit`), dan pipeline CI/CD.

> **Catatan Keamanan Operasional**: Sesuai aturan ketat audit, dokumen ini **tidak menampilkan** nilai token, kata sandi, isi cookie, alamat IP privat/publik VPS, maupun nomor telepon pribadi.

---

## 1. Eksposur QR Sesi WhatsApp, Alert Server & Telemetri Eksternal (`SEC-01` — Critical)

### Bukti Kode Sumber

1. **Eksposur QR Autentikasi ke Direktori Web Publik (`src/utils/qrExporter.ts:107-125` & `src/bot/lifecycle.ts:12,69,75`)**:
   - Setiap kali Baileys memancarkan event `qr` (misalnya saat sesi awal atau setelah _loggedOut_ / _badSession_), `BotLifecycle` memanggil `exportQrToWeb(qr)`.
   - Pada `src/utils/qrExporter.ts:110`, kode memeriksa keberadaan direktori `/var/www/void-downloader` dan menulis halaman HTML berisi gambar QR sesi langsung ke `/var/www/void-downloader/minji-auth/index.html` dengan _meta-refresh_ tiap 5 detik **tanpa autentikasi apa pun**.
   - Siapa pun (termasuk _scanner_ otomatis atau pengunjung domain publik yang melayani direktori `/var/www/void-downloader`) yang memindai QR tersebut pada saat sesi terputus dapat membajak akun WhatsApp bot atau menautkan perangkat bot ke akun penyerang.
2. **Hardcoded Fallback Secret & Perbandingan Non-Timing-Safe pada `AlertServer` (`src/services/alertServer.ts:15,51,112`, `src/config/env.ts:44`, `.env.example:24`)**:
   - `src/services/alertServer.ts:15` menetapkan fallback rahasia statis `process.env.INTERNAL_ALERT_SECRET || "<REDACTED_DEFAULT>"` (nilai default yang sama persis tertulis secara publik di `.env.example:24`) serta JID grup tujuan ter-hardcode di baris `14`.
   - Pemeriksaan header `x-alert-secret !== ALERT_SECRET` pada baris `51` menggunakan operator `!==` biasa alih-alih `crypto.timingSafeEqual`, dan `env.ts:44` tidak mewajibkan variabel ini diisi saat produksi.
   - Direktori `scratch/test_web_routes.ts` juga menyimpan skrip uji coba internal yang bahkan memicu _parse error_ pada ESLint (`QUAL-01`).
3. **Telemetri Per-Pesan Keluar (`src/services/telemetry.service.ts:21`, `src/bot/messageHandler.ts:10,37,103,111`)**:
   - Setiap pesan masuk dan keluar di grup maupun DM memicu `reportPulse(...)` ke endpoint eksternal `PULSE_COLLECT_URL`. Bagi pengguna _open-source_ yang menjalankan repositori ini, mekanisme telemetri tersembunyi tanpa persetujuan eksplisit merupakan isu kepercayaan dan privasi.

### Rekomendasi Remediasi (Disepakati — Phase 1)

- Hapus total `src/utils/qrExporter.ts`, `src/services/alertServer.ts`, `src/services/telemetry.service.ts`, dan seluruh direktori `scratch/`.
- Bersihkan seluruh impor dan pemanggilannya di `src/index.ts`, `src/bot/lifecycle.ts`, `src/bot/messageHandler.ts`, `src/config/env.ts`, `.env.example`, serta referensi domain/path internal di seluruh repositori.

---

## 2. Risiko RCE Self-Hosted Runner pada Repo Publik & Kehilangan Data Migrasi (`SEC-02` — Critical)

### Bukti Kode Sumber (`.github/workflows/deploy.yml:1-51`)

- Baris `15`: `runs-on: [self-hosted, vps-minji]` pada repositori GitHub **publik** (`https://github.com/AnthonyWisnu/MinjiBot`). GitHub Security Documentation secara eksplisit memperingatkan bahwa menempatkan _persistent self-hosted runner_ pada repositori publik membuka risiko kompromi runner permanen atau eksekusi kode arbitrer apabila _trigger_ workflow kelak diperluas (mis. `pull_request` / `workflow_run`) atau terjadi kompromi token kolaborator.
- Baris `26`: Path sistem ter-hardcode `/home/anthony/MinjiBot` membuat repositori gagal dijalankan di fork milik pengguna lain.
- Baris `28`: `rm -f .git/index.lock .git/HEAD.lock` dijalankan sebelum akuisisi `flock` selesai pada proses luar, berisiko merusak repositori Git jika proses Git lain benar-benar sedang menulis.
- Baris `39`: `npx prisma db push --skip-generate --accept-data-loss` pada server produksi. Flag `--accept-data-loss` mengizinkan Prisma menghapus tabel atau kolom berisi saldo poin/limit dan data penyewa tanpa konfirmasi apabila terjadi perbedaan skema.

### Rekomendasi Remediasi (Disepakati — Phase 1 & Phase 5)

- Segera cabut/matikan _persistent self-hosted runner_ dari repositori publik di pengaturan GitHub.
- Buat `.github/workflows/ci.yml` menggunakan GitHub-hosted runner `ubuntu-latest` untuk menjalankan pemeriksaan otomatis pada setiap `push` dan `pull_request`.
- Ubah `.github/workflows/deploy.yml` agar hanya berjalan pada `if: github.repository == 'AnthonyWisnu/MinjiBot' && github.ref == 'refs/heads/main'` menggunakan `ubuntu-latest` + koneksi SSH terenkripsi (_GitHub Actions Secrets_: `DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_APP_DIR`) serta mengganti `prisma db push --accept-data-loss` menjadi `npx prisma migrate deploy` setelah migrasi diperbaiki pada **Phase 5**.

---

## 3. SSRF, Bypass Allowlist Substring Hostname & Redirect Cookie (`SEC-03` — High)

### Bukti Kode Sumber

1. **Bypass Validasi Domain Menggunakan `.includes()` (`src/services/media/downloader.service.ts:782-799`, `src/commands/media/downloader.command.ts:38-42,138-147,199-206`, `src/utils/urlValidator.ts:14-28`)**:
   - `downloader.service.ts:786`: `host.includes("tiktok.com")` bernilai `true` untuk domain milik penyerang seperti `https://evil-tiktok.com/payload` atau `https://tiktok.com.attacker.tld/video`.
   - Pola serupa terdapat pada `host.includes("instagram.com")` (`downloader.service.ts:792`), `host.includes("youtube.com") || host.includes("youtu.be")` (`downloader.service.ts:798`), dan `urlValidator.ts:27` (`hostname.endsWith(domain)` tanpa awalan titik `.`, sehingga `notinstagram.com` lolos `endsWith("instagram.com")`).
2. **Kebocoran Cookie & SSRF via Redirect pada `yt-dlp` / `gallery-dl` (`src/services/media/downloader.service.ts:485,538,590,608,626`)**:
   - Saat pengguna mengirim URL yang lolos pengecekan `.includes("instagram.com")` (mis. `https://fakeinstagram.com/redirect`), bot mengeksekusi `yt-dlp` dan `gallery-dl` sambil menyertakan argumen `--cookies <IG_COOKIES_FILE>` **tanpa** membatasi extractor (`--ies` / `--extractor-args`) dan tanpa `--no-playlist`.
   - `yt-dlp` memiliki _generic extractor_ yang mengikuti HTTP 302 redirect ke jaringan internal (`http://127.0.0.1:...`, metadata cloud `http://169.254.169.254/latest/meta-data/`) atau berpotensi memicu pengiriman sesi ke host tak dikenal.
3. **Fetch Tanpa Validasi URL dari Respons Pihak Ketiga (`src/services/media/downloader.service.ts:110,140,196`)**:
   - URL gambar, video, dan musik yang dikembalikan oleh API eksternal `https://www.tikwm.com/api/` langsung di-`fetch()` oleh server bot tanpa memverifikasi skema `https:` maupun memblokir rentang IP privat/loopback/link-local.

### Rekomendasi Remediasi (Phase 1)

- Bangun utilitas `assertSafeExternalUrl(rawUrl, allowedDomains)` di `src/utils/urlValidator.ts` yang:
  1. Hanya mengizinkan protokol `https:` (dan opsional `http:` yang langsung ditolak atau di-upgrade hanya untuk domain publik resmi).
  2. Memeriksa batas domain secara ketat: `hostname === domain || hostname.endsWith("." + domain)`.
  3. Melakukan resolusi DNS (`dns.promises.lookup(hostname, { all: true })`) dan menolak seluruh alamat IPv4/IPv6 loopback (`127.0.0.0/8`, `::1`), RFC1918 privat (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), dan unik-lokal (`fc00::/7`).
- Tambahkan `--no-playlist` dan pembatasan extractor eksplisit pada `yt-dlp` (`--ies tiktok`, `--ies instagram`, `--ies youtube`) sehingga generic extractor dinonaktifkan total.
- Validasi setiap URL media keluaran `tikwm.com` menggunakan pemeriksa anti-private-IP sebelum memanggil `fetch()`.

---

## 4. Decompression Bomb pada Sharp & Kerentanan Dependensi (`SEC-04` — High)

### Bukti Kode Sumber & Audit Paket

1. **Penonaktifan Proteksi Piksel Sharp (`limitInputPixels: false`)**:
   - Pada **5 titik pemanggilan** di `src/services/media/sticker.service.ts` (baris `79-82`, `127-130`, `141-144`, `158-161`, dan `216-223` dengan `animated: true`), opsi `limitInputPixels: false` secara eksplisit mematikan batas keamanan `libvips`.
   - File PNG/WebP terkompresi berukuran `< 500 KB` (lolos batas ukuran byte) dengan dimensi header `25.000 × 25.000` piksel atau ratusan frame animasi akan mengalokasikan `> 2.5 GB` buffer RGBA mentah di memori C++ `libvips`, memicu _Out-Of-Memory_ (`SIGKILL`) seketika pada VPS.
   - Pemanggilan `sharp()` di `imageEnhance.service.ts:11`, `quoteCard.service.ts:238`, `profileCard.service.ts:222`, dan `downloader.service.ts:154,694` juga masih mengandalkan batas bawaan `268 MP` (`~1 GB` RGBA per request).
2. **Hasil `npm audit` Terverifikasi (`29` Kerentanan: `15` High, `13` Moderate, `1` Low)**:
   - `sharp@0.34.5` (`< 0.35.5`): Terdampak CVE pada `librsvg` (_use-after-free_ saat me-render SVG — relevan langsung karena `.brat`, `.smeme`, `.quote`, `.tweet`, dan `.profile` semuanya me-render template SVG via Sharp!), `libheif`, dan `libvips`.
   - `@whiskeysockets/baileys`: Dideklarasikan `"^6.7.0"` di `package.json:22` (meskipun `package-lock.json` berada di `6.7.23`, rentang semver longgar mengizinkan versi `< 6.7.22` yang memiliki CVE kritis; selain itu rantai dependensi transitifnya menarik `music-metadata` yang rentan _infinite loop_ pada kotak `stsd` MP4 rusak, `axios`, dan `undici`).
   - `zod@3.25.76`, `prisma@6.19.3` (transitif `@hono/node-server` / `effect`), dan `yt-search@2.13.1` (transitif `minimatch` ReDoS).

### Rekomendasi Remediasi (Phase 1)

- Tetapkan konstanta global `MAX_SAFE_IMAGE_PIXELS = 4096 * 4096` (`16.777.216` piksel, maks `~64 MB` RGBA) dan batas jumlah frame animasi (`pages <= 150`) pada seluruh pemanggilan `sharp(...)`.
- Perbarui `sharp` ke `^0.35.5` (atau rilis stabil terbaru), kunci `@whiskeysockets/baileys` minimal `"^6.7.23"`, perbarui `zod` dan `prisma`/`@prisma/client` ke versi patch aman dalam seri v6, terapkan `overrides` terukur pada `package.json` untuk dependensi transitif rentan (`undici`, `axios`, `minimatch`), dan bersihkan `38` paket _extraneous_ melalui `npm ci`.

---

## 5. Bypass Otorisasi Multi-Tenant pada Direct Message (`SEC-05` — High)

### Bukti Kode Sumber

1. **Perintah `.quote` & `.tweet` Terbuka Bebas di DM Tanpa Cek Tenant (`src/commands/media/quoteCard.command.ts:18-132`)**:
   - Di luar grup (`!context.isGroup`), `TenantGuard` dan `FeatureGuard` langsung meloloskan semua pesan (`if (!context.isGroup) return { allowed: true }`). Berbeda dengan `sticker.command.ts:36` atau `hd.command.ts:23`, handler `.quote` dan `.tweet` sama sekali tidak memeriksa peran pengirim maupun keanggotaan tenant aktif, sehingga nomor WhatsApp asing mana pun di dunia dapat membebani CPU Sharp bot lewat DM secara gratis.
2. **Mantan `TENANT_OWNER` dari Grup `EXPIRED` / `BLOCKED` / `REMOVED` Mempertahankan Hak Istimewa Permanen di DM**:
   - `RoleGuard.resolvePrivateRole` (`src/guards/roleGuard.ts:85-94`) memanggil `tenantGroupRepository.ownerExists(candidateJid)` (`src/repositories/tenantGroup.repository.ts:49-55`) yang menjalankan `prisma.tenantGroup.findFirst({ where: { ownerJid } })` **tanpa memfilter `status: TenantStatus.ACTIVE`, `isBlocked: false`, atau `expiresAt > now`**.
   - Hal yang sama terjadi pada `TenantOwnerSessionService.openSession` / `requireActiveTenantGroupJid` (`src/services/tenant/tenantOwnerSession.service.ts:51-58,83-94`) dan `TenantFeatureService.resolveManagedTenant` (`src/services/tenant/tenantFeature.service.ts:113-127`).
   - Dampak: Penyewa yang masa sewanya sudah habis setahun lalu atau yang grupnya telah **diblokir (`BLOCKED`)** oleh Super Owner tetap menyandang role `TENANT_OWNER` di DM, dapat menikmati fitur `.hd`, `.s`, `.brat`, efek audio secara gratis tanpa batas di DM, serta masih bisa memodifikasi pengaturan database grup yang diblokir/kedaluwarsa.
3. **Enumerasi `tenantCode` Tanpa Autentikasi (`src/commands/member/memberAdmin.command.ts:204-210`)**:
   - Pada DM `.addlimitall <kode> <jumlah>`, pencarian `tenantGroupRepository.findByCode(codeArg)` dijalankan **sebelum** memeriksa hak akses pengirim, mengembalikan pesan berbeda antara kode tidak ditemukan vs akses ditolak sehingga seluruh ruang kode 3 huruf (`26³ = 17.576` kombinasi) dapat dipetakan.

### Rekomendasi Remediasi (Phase 1 & Phase 2)

- Perbarui `TenantGroupRepository.ownerExists`, `findByOwner`, `TenantOwnerSessionService`, dan `TenantFeatureService.resolveManagedTenant` agar memvalidasi `status === TenantStatus.ACTIVE && !isBlocked && (!expiresAt || expiresAt > new Date())`.
- Tambahkan pemeriksaan tenant aktif pada `quoteCard.command.ts` (dan samakan guard DM lintas seluruh command media).
- Selalu jalankan validasi peran (`SUPER_OWNER`) **sebelum** melakukan query pencarian `tenantCode`.

---

## 6. Injeksi Markup SVG/XML & Overflow Teks Panjang (`SEC-06` — Medium)

### Bukti Kode Sumber

1. **Interpolasi Variabel Tanpa `escapeXml()` pada SVG**:
   - `src/services/member/profileCard.service.ts:125,188,276-282`: Fungsi `maskPhoneNumber` mengembalikan `raw` apa adanya jika jumlah digit `< 8` (mis. input JID/string abnormal mengandung `<` atau `&`), lalu disuntikkan mentah ke `<text>${maskedPhone}</text>` di baris `125`, dan `view.createdAtWib` disuntikkan mentah di baris `188`.
   - `src/services/media/sticker.service.ts:381-387`: `escapeXml` tidak meng-escape tanda petik tunggal `'` (`&apos;`).
2. **Ketiadaan Batas Panjang Karakter & Pemotongan Kata Tunggal Tanpa Spasi**:
   - `.brat <teks>`, `.quote`, dan `.tweet` menerima ribuan karakter atau satu string panjang tanpa spasi (`"A".repeat(5000)`), menghasilkan ukuran dokumen SVG besar yang meluber keluar kanvas dan membebani parser XML `librsvg`.
3. **Kesalahan Perhitungan Posisi Badge Terverifikasi (`src/services/media/quoteCard.service.ts:173`)**:
   - Lebar nama dihitung menggunakan `safeName.length` _setelah_ XML-escaping (`&amp;` dihitung 5 karakter alih-alih 1), menyebabkan ikon centang biru bergeser jauh dari teks nama.

### Rekomendasi Remediasi (Phase 1)

- Sentralisasikan utilitas `escapeXml(value)` yang meng-escape `&`, `<`, `>`, `"`, dan `'`, serta gunakan pada **seluruh** interpolasi teks/atribut SVG.
- Terapkan batas panjang karakter input (`.brat` maks `250` karakter, `.smeme` maks `80` karakter per baris, `.quote`/`.tweet` maks `500` karakter) dan pemecahan paksa kata panjang tanpa spasi (_hard word-break_).
- Hitung estimasi lebar teks menggunakan panjang string asli sebelum `escapeXml()`.

---

## 7. Kebocoran Pesan Error Internal & Penguatan OpSec Host VPS (`SEC-07` — Medium)

### Bukti Kode Sumber

1. **Pengiriman `error.message` Mentah ke Chat WhatsApp**:
   - `src/commands/media/audioEffect.command.ts:85-87`, `src/commands/media/quoteCard.command.ts:79-80,129-130`, dan `src/commands/stats/groupStats.command.ts:32-33,47-48,72-73` menangkap error dan langsung mengirim `error instanceof Error ? error.message : ...` ke grup tanpa melewati `formatUserSafeError`, berpotensi membocorkan query Prisma, path sistem file (`/tmp/...`, `/home/...`), atau pesan error FFmpeg/Sharp.
2. **Cacat Desain Substring Denylist pada `src/utils/userSafeError.ts:1-24`**:
   - Daftar `SENSITIVE_KEYWORDS` berisi potongan pendek `"ig"` dan `"api"` dengan pencocokan `lower.includes(keyword)`. Akibatnya, pesan valid berbahasa Indonesia seperti _"Limit habis, tidak dapat d**ig**unakan"_ atau _"Silakan coba l**agi** / tet**api**"_ justru disensor sebagai sensitif, sementara error teknis Node.js seperti `ENOENT: no such file or directory, open '/app/...'`, `TypeError: Cannot read properties of undefined`, atau kode error Prisma `P2025` lolos mentah ke pengguna!
3. **Keamanan Operasional (OpSec) Host Produksi**:
   - Penggunaan autentikasi kata sandi SSH (`PasswordAuthentication yes`) pada port standar publik membuka risiko serangan _brute-force_ otomatis terhadap server produksi. Selain itu, kredensial yang pernah dibagikan dalam percakapan harus segera dirotasi.

### Rekomendasi Remediasi (Phase 1 & Phase 4)

- Ganti pendekatan _substring denylist_ di `userSafeError.ts` dengan pola **Allowlist berbasis kelas `AppUserError`** (hanya pesan dari `AppUserError` yang ditampilkan langsung ke pengguna; seluruh `Error` sistem tak terduga dicatat lengkap ke `logger.error` dan diganti pesan fallback aman).
- Arahkan seluruh blok `catch` di `src/commands/` ke `formatUserSafeError`.
- **Checklist Wajib Host VPS bagi Pemilik (Dilakukan di Luar Kode Aplikasi)**:
  1. Rotasi segera password user Linux VPS dan password database PostgreSQL produksi.
  2. Pasang _SSH Ed25519 public key_ di `~/.ssh/authorized_keys`, lalu set `PasswordAuthentication no` dan `PermitRootLogin no` di `/etc/ssh/sshd_config`.
  3. Aktifkan firewall `ufw` (hanya izinkan port SSH yang diperlukan; tutup seluruh port database `5432` dan port lokal dari internet publik) serta pasang `fail2ban`.

---

## 8. Referensi Temuan Terkait

- [`SEC-01`](./09-audit-findings.md#sec-01), [`SEC-02`](./09-audit-findings.md#sec-02), [`SEC-03`](./09-audit-findings.md#sec-03), [`SEC-04`](./09-audit-findings.md#sec-04), [`SEC-05`](./09-audit-findings.md#sec-05), [`SEC-06`](./09-audit-findings.md#sec-06), [`SEC-07`](./09-audit-findings.md#sec-07).
