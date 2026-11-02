# PHASE-01 — Security Hardening, Legacy Purge & Abuse Prevention

> **Prasyarat Wajib Sebelum Memulai**: Baca [`audit/README.md`](../README.md), [`audit/REMEDIATION_PLAN.md`](../REMEDIATION_PLAN.md), dan verifikasi seluruh bukti kode untuk ID temuan fase ini di [`audit/09-audit-findings.md`](../09-audit-findings.md).

---

## 1. Tujuan dan Ruang Lingkup

Fase pertama ini menutup seluruh celah keamanan kritis pada permukaan serangan eksternal dan internal MinjiBot sebelum perubahan logika bisnis dilakukan. Ruang lingkup mencakup:

1. Penghapusan total modul eksposur QR web, server alert lokal ber-secret statis, telemetri per-pesan, dan direktori `scratch/`.
2. Pengerasan validasi URL eksternal & pencegahan SSRF/kebocoran cookie pada `yt-dlp`, `gallery-dl`, dan API downloader pihak ketiga.
3. Pembaruan dependensi rentan (`sharp`, `@whiskeysockets/baileys`, dll.) serta pemasangan batas keamanan piksel/frame (`limitInputPixels`) di seluruh pemanggilan `sharp()`.
4. Penutupan celah otorisasi Direct Message (DM) bagi publik maupun mantan penyewa yang grupnya telah `EXPIRED` / `BLOCKED` / `REMOVED`.
5. Perbaikan bug kritis `AntiDelete` yang mem-posting ulang pesan hasil hapus moderasi (`AntiLink`/`AntiSpam`/Admin) dan penghentian total pembongkaran pesan privasi _View-Once_ (`viewOnceMessage*`).
6. Sanitasi penuh interpolasi XML/SVG beserta pembatasan panjang teks, serta perombakan `userSafeError.ts` berbasis kelas `AppUserError`.

---

## 2. ID Temuan yang Ditangani

| ID Temuan                                  | Severity | Judul Singkat                                                                          |
| :----------------------------------------- | :------: | :------------------------------------------------------------------------------------- |
| [`SEC-01`](../09-audit-findings.md#sec-01) | Critical | Eksposur Web QR Tanpa Auth, Rahasia Statis `AlertServer` & Telemetri Per-Pesan         |
| [`SEC-03`](../09-audit-findings.md#sec-03) |   High   | SSRF, Bypass Substring Hostname `.includes()` & Redirect Cookie `yt-dlp`/`gallery-dl`  |
| [`SEC-04`](../09-audit-findings.md#sec-04) |   High   | Sharp Pixel Bomb (`limitInputPixels: false`), 29 Advisory `npm audit` & Semver Baileys |
| [`SEC-05`](../09-audit-findings.md#sec-05) |   High   | Bypass Otorisasi DM Multi-Tenant (`.quote`/`.tweet`, Mantan Owner & Enumerasi Kode)    |
| [`SEC-06`](../09-audit-findings.md#sec-06) |  Medium  | Interpolasi XML/SVG Tanpa Escape, Input Tanpa Batas & Overflow Kata Panjang            |
| [`SEC-07`](../09-audit-findings.md#sec-07) |  Medium  | Kebocoran `error.message` Mentah, Cacat Substring `userSafeError` & OpSec SSH VPS      |
| [`LOG-05`](../09-audit-findings.md#log-05) | Critical | `AntiDelete` Mem-posting Ulang Hasil Hapus Moderasi & Membongkar `viewOnceMessage*`    |

> **Tindakan Manual Pra-Fase Terkait `SEC-02` & `SEC-07` (Oleh Pemilik Proyek)**:
> Sebelum mem-push perubahan ke GitHub publik, nonaktifkan/hapus _persistent self-hosted runner_ di _GitHub Repository Settings ➔ Actions ➔ Runners_, rotasi password user VPS & PostgreSQL, dan aktifkan autentikasi SSH berbasis kunci (`PasswordAuthentication no`).

---

## 3. File dan Modul yang Terdampak

- **Dihapus (Delete)**:
  - `src/utils/qrExporter.ts`
  - `src/services/alertServer.ts`
  - `src/services/telemetry.service.ts`
  - `scratch/test_web_routes.ts` (beserta direktori `scratch/`)
- **Dibuat Baru (Create)**:
  - `src/utils/xml.ts` (utilitas terpusat `escapeXml`, `clampText`, dan `wrapSvgLines` dengan _hard word-break_)
  - `src/errors/appUserError.ts` (atau diekspor dari `src/utils/userSafeError.ts` — kelas error domain ramah pengguna)
- **Dimodifikasi (Modify)**:
  - `package.json` & `package-lock.json`
  - `src/index.ts`, `src/bot/lifecycle.ts`, `src/bot/messageHandler.ts`, `src/config/env.ts`, `.env.example`
  - `src/utils/urlValidator.ts`, `src/services/media/downloader.service.ts`, `src/commands/media/downloader.command.ts`
  - `src/services/media/sticker.service.ts`, `src/services/media/imageEnhance.service.ts`, `src/services/media/quoteCard.service.ts`, `src/services/member/profileCard.service.ts`
  - `src/repositories/tenantGroup.repository.ts`, `src/guards/roleGuard.ts`, `src/services/tenant/tenantOwnerSession.service.ts`, `src/services/tenant/tenantFeature.service.ts`
  - `src/commands/media/quoteCard.command.ts`, `src/commands/media/sticker.command.ts`, `src/commands/media/audioEffect.command.ts`, `src/commands/stats/groupStats.command.ts`, `src/commands/member/memberAdmin.command.ts`
  - `src/services/moderation/antiDelete.service.ts`, `src/services/moderation/antiLink.service.ts`, `src/services/moderation/antiSpam.service.ts`, `src/services/moderation/manualModeration.service.ts`, `src/utils/mediaTarget.ts`
  - `src/utils/userSafeError.ts`

---

## 4. Analisis Root Cause

1. **Pencampuran Utilitas Server Pribadi (`SEC-01`)**: Fungsi penulisan HTML QR, listener TCP lokal, dan ping telemetri ditulis langsung di alur hidup utama bot tanpa gerbang otentikasi atau isolasi repositori.
2. **Validasi URL Berbasis Substring (`SEC-03`)**: Penggunaan `host.includes("tiktok.com")` dan `endsWith(domain)` tanpa batas titik DNS meloloskan domain penyerang, sementara `yt-dlp` mengikuti redirect dengan membawa `--cookies` pada generic extractor.
3. **Konfigurasi Tidak Aman pada Pustaka Native (`SEC-04`, `SEC-06`)**: `limitInputPixels: false` menonaktifkan pengaman RAM `libvips`, sedangkan pembuatan SVG manual belum meng-escape seluruh field dan belum membatasi ukuran teks.
4. **Ketiadaan Filter Status Aktif pada Resolusi DM (`SEC-05`)**: Query `ownerExists` dan sesi DM hanya mengecek keberadaan baris `ownerJid` tanpa memfilter `status === ACTIVE`, `isBlocked === false`, dan `expiresAt > now`.
5. **Ketidaksinkronan Pipeline `AntiDelete` vs Moderasi (`LOG-05`)**: Pesan disimpan di cache `AntiDelete` sebelum diperiksa `AntiLink`/`AntiSpam`, dan saat dihapus oleh bot/admin, `handleRevoke` hanya mengecek imunitas pengirim asli (si pelanggar).

---

## 5. Pendekatan Implementasi yang Direkomendasikan (Instruksi Presisi)

### Langkah 5.1 — Pembersihan Total Modul Legacy & Telemetri (`SEC-01`)

1. Hapus berkas `src/utils/qrExporter.ts`, `src/services/alertServer.ts`, `src/services/telemetry.service.ts`, dan direktori `scratch/`.
2. Pada `src/bot/lifecycle.ts`: hapus impor `exportQrToWeb` / `clearQrWeb` beserta pemanggilannya pada event `qr` dan `connection === "open"`. Pertahankan penampilan QR di terminal (`qrcode-terminal`) untuk mode login CLI.
3. Pada `src/index.ts`: hapus inisialisasi dan penghentian `alertServer`.
4. Pada `src/bot/messageHandler.ts`: hapus impor `reportPulse` dan ketiga pemanggilannya.
5. Pada `src/config/env.ts` dan `.env.example`: hapus `INTERNAL_ALERT_SECRET`, `ALERT_SERVER_PORT`, dan `PULSE_COLLECT_URL` jika ada.

### Langkah 5.2 — Upgrade Dependensi & Proteksi Memori Sharp (`SEC-04`)

1. Perbarui `package.json`:
   - `sharp`: upgrade ke `"^0.35.5"` (atau versi stabil terbaru `>=0.35.5` yang menutup CVE `librsvg`/`libvips`).
   - `@whiskeysockets/baileys`: ubah range dari `"^6.7.0"` menjadi `"^6.7.23"`.
   - `zod`: upgrade ke patch terbaru `^3.25.x`, `prisma` & `@prisma/client` ke patch terbaru `^6.19.x`.
   - Tambahkan blok `"overrides"` terarah pada `package.json` untuk dependensi transitif (`undici`, `axios`, `minimatch`) bila masih dilaporkan `npm audit`, lalu jalankan `npm install` dan pastikan `npm run build` sukses.
2. Buat konstanta bersama `export const MAX_SAFE_IMAGE_PIXELS = 4096 * 4096;` (`16_777_216`) dan `export const MAX_SAFE_ANIMATED_PAGES = 150;` (mis. di `src/utils/imageSafety.ts`).
3. Di `src/services/media/sticker.service.ts`: ganti seluruh **5 kemunculan** `limitInputPixels: false` menjadi `limitInputPixels: MAX_SAFE_IMAGE_PIXELS`. Sebelum memproses input `animated: true`, baca `metadata()` terlebih dahulu dan tolak dengan `AppUserError("Durasi/jumlah frame stiker terlalu panjang (maks 150 frame).")` apabila `(metadata.pages ?? 1) > MAX_SAFE_ANIMATED_PAGES`.
4. Tambahkan `limitInputPixels: MAX_SAFE_IMAGE_PIXELS` pada seluruh konstruktor `sharp(...)` di `imageEnhance.service.ts`, `quoteCard.service.ts`, `profileCard.service.ts`, dan `downloader.service.ts`.

### Langkah 5.3 — Validasi Ketat URL Eksternal, Anti-SSRF & Pembatasan `yt-dlp` (`SEC-03`)

1. Perombakan `src/utils/urlValidator.ts`:
   - Implementasikan fungsi sinkron `isAllowedDomainUrl(rawUrl: string, allowedDomains: readonly string[]): URL | null`:
     - Wajib `parsed.protocol === "https:"` (atau `http:` hanya bila langsung dinormalisasi sebelum validasi host resmi), `parsed.username === ""`, `parsed.password === ""`, dan port kosong atau `443`.
     - Hostname dinormalisasi `toLowerCase()` tanpa titik akhir, lalu wajib cocok `allowedDomains.some((d) => host === d || host.endsWith("." + d))`.
   - Implementasikan fungsi asinkron `assertSafeExternalUrl(rawUrl: string, allowedDomains?: readonly string[]): Promise<URL>`:
     - Jika `allowedDomains` diberikan, validasi domain terlebih dahulu.
     - Tolak literal IP privat/loopback dan lakukan `dns.promises.lookup(parsed.hostname, { all: true, verbatim: true })`.
     - Tolak alamat IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0/4`, `240.0.0.0/4`.
     - Tolak alamat IPv6: `::`, `::1`, `fc00::/7`, `fe80::/10`, serta IPv4-mapped IPv6 (`::ffff:127.0.0.1`, dll.).
2. Ganti seluruh `.includes("tiktok.com")`, `.includes("instagram.com")`, `.includes("youtube.com")`, `.includes("youtu.be")` di `downloader.service.ts` dan `downloader.command.ts` dengan `isAllowedDomainUrl` / `assertSafeExternalUrl` menggunakan daftar domain kanonik:
   - TikTok: `["tiktok.com", "vt.tiktok.com", "vm.tiktok.com", "m.tiktok.com"]`
   - Instagram: `["instagram.com", "instagr.am"]`
   - YouTube: `["youtube.com", "youtu.be", "music.youtube.com"]`
3. Pada `downloader.service.ts`:
   - Sebelum `fetch()` URL media/musik yang diterima dari JSON `tikwm.com`, jalankan `await assertSafeExternalUrl(mediaUrl)` (tanpa filter domain sempit karena CDN TikTok bervariasi seperti `tiktokcdn.com` / `byteoversea.com`, tetapi **wajib HTTPS & lolos blokir IP privat/loopback** dengan `redirect: "error"` atau validasi ulang target redirect).
   - Pada argumen CLI `yt-dlp`: tambahkan `"--no-playlist"` di semua pemanggilan, serta batasi extractor sesuai platform (`"--ies", "tiktok"` untuk TikTok; `"--ies", "instagram"` untuk Instagram; `"--ies", "youtube"` untuk YouTube) sehingga `--cookies` tidak pernah dikirim ke generic extractor.

### Langkah 5.4 — Perbaikan Otorisasi Multi-Tenant pada Direct Message (`SEC-05`)

1. Pada `src/repositories/tenantGroup.repository.ts`:
   - Tambahkan helper filter aktif:
     ```ts
     const activeTenantWhere = (now = new Date()): Prisma.TenantGroupWhereInput => ({
       status: TenantStatus.ACTIVE,
       isBlocked: false,
       OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
     });
     ```
   - Perbarui `ownerExists(ownerJid)` (atau sediakan `activeOwnerExists(ownerJidCandidates: string[])`) agar menggabungkan `activeTenantWhere()` dengan `ownerJid: { in: ownerJidCandidates }`.
   - Perbarui `findActiveByOwner(ownerJidCandidates: string[])` untuk dipakai oleh `TenantOwnerSessionService` dan `TenantFeatureService.resolveManagedTenant`.
2. Pada `src/guards/roleGuard.ts:85-94`: gunakan `activeOwnerExists` sehingga pemilik dari grup yang sudah `EXPIRED`, `BLOCKED`, atau `REMOVED` tidak lagi mendapatkan role `TENANT_OWNER` di DM.
3. Pada `src/services/tenant/tenantOwnerSession.service.ts` dan `src/services/tenant/tenantFeature.service.ts`: validasi grup target sesi DM masih memenuhi syarat aktif (`ACTIVE`, `!isBlocked`, belum lewat `expiresAt`); jika sudah kedaluwarsa/diblokir, hapus sesi privatnya dan tolak permintaan dengan pesan ramah.
4. Buat helper otorisasi DM ringan `assertActiveTenantMemberOrOwnerInDm(context)` untuk command kreatif non-limit (`.quote`, `.tweet`, `.s`, `.smeme`, `.brat`, `.toimg`, `.tovideo`, `.bass`, `.chipmunk`, `.slowed`, `.nightcore`, `.tovn`) yang memastikan pemanggil di DM minimal adalah `SUPER_OWNER`, `TENANT_OWNER` aktif, atau `MEMBER` yang terdaftar di setidaknya satu grup `ACTIVE` (tidak diblokir & belum expired). Pasang pada `quoteCard.command.ts`, `sticker.command.ts`, dan `audioEffect.command.ts`.
5. Pada `src/commands/member/memberAdmin.command.ts:204`: pindahkan pengecekan role ke baris paling atas fungsi sebelum membaca argumen `tenantCode`.

### Langkah 5.5 — Perbaikan `AntiDelete` Moderation Self-Sabotage & Penghapusan Unwrap _View-Once_ (`LOG-05`)

1. Pada `src/utils/mediaTarget.ts:145-151` (`unwrapQuotedContent`):
   - **Hapus** pembongkaran `content.viewOnceMessage`, `content.viewOnceMessageV2`, dan `content.viewOnceMessageV2Extension`. Jika pesan yang di-reply dibungkus di dalam salah satu field tersebut, langsung kembalikan `undefined` sehingga `.s`, `.hd`, `.toimg`, `.tovid`, atau efek audio tidak pernah bisa mengekstrak media _View-Once_.
2. Pada `src/services/moderation/antiDelete.service.ts`:
   - Di `unwrapMessage` (baris `125-130`): jika objek pesan memiliki `viewOnceMessage`, `viewOnceMessageV2`, atau `viewOnceMessageV2Extension`, langsung kembalikan `null` (jangan pernah di-cache).
   - Di `cacheIncomingMessage`: abaikan pesan milik bot sendiri (`message.key.fromMe === true`).
   - Tambahkan `private readonly suppressedMessageKeys = new LruCache<string, true>(1000, 10 * 60 * 1000);` dan metode publik `suppressModerationDelete(chatJid: string, messageId: string): void` yang sekaligus menghapus entri dari cache pesan dan menandai kunci `${chatJid}:${messageId}` di `suppressedMessageKeys`.
   - Panggil `antiDeleteService.suppressModerationDelete(chatJid, msgId)` di `antiLink.service.ts`, `antiSpam.service.ts`, dan `manualModeration.service.ts` (`.del`) tepat **sebelum** memanggil `socket.sendMessage(chatJid, { delete: ... })`.
   - Di `handleRevoke(socket, chatJid, revokedKey, revokerJid?)` (perbarui `messageRevoke.subscriber.ts` agar mengekstrak `revokerJid` dari `update.update?.messageStubParameters` / `key.participant` / `protocolMessage.key`):
     1. Jika `suppressedMessageKeys.get(cacheKey)` ada ➔ abaikan & return.
     2. Jika `revokedKey.fromMe === true` ➔ abaikan & return.
     3. Jika `revokerJid` teridentifikasi dan `normalizeUserJid(revokerJid) !== normalizeUserJid(cached.senderJid)` (**dihapus oleh Admin Grup untuk moderasi, bukan ditarik sendiri oleh pengirim!**) ➔ hapus dari cache & return tanpa mem-posting ulang!

### Langkah 5.6 — Sanitasi XML/SVG Terpusat & Perombakan `userSafeError.ts` (`SEC-06`, `SEC-07`)

1. Buat `src/utils/xml.ts`:
   - `escapeXml(input: string): string` meng-escape `&` ➔ `&amp;`, `<` ➔ `&lt;`, `>` ➔ `&gt;`, `"` ➔ `&quot;`, `'` ➔ `&apos;`, serta menghapus karakter kontrol XML ilegal (`[\x00-\x08\x0B\x0C\x0E-\x1F]`).
   - `clampAndWrapText(text: string, maxTotalChars: number, maxCharsPerLine: number, maxLines: number): string[]` yang memotong panjang maksimum dan memecah kata tunggal yang melebihi `maxCharsPerLine` (_hard break_).
2. Terapkan `escapeXml` dan `clampAndWrapText` di `profileCard.service.ts` (termasuk `maskedPhone` dan `createdAtWib`), `sticker.service.ts` (`.brat` maks 250 karakter, `.smeme` maks 80 karakter/baris), dan `quoteCard.service.ts` (`.quote` & `.tweet` maks 500 karakter; hitung offset `badgeX` memakai panjang nama mentah sebelum `escapeXml`).
3. Perombakan `src/utils/userSafeError.ts`:
   - Ekspor kelas `export class AppUserError extends Error { readonly isUserSafe = true; constructor(message: string) { super(message); this.name = "AppUserError"; } }`.
   - Di `formatUserSafeError(error: unknown, fallbackMessage: string): string`:
     - Jika `error instanceof AppUserError` (atau error domain ekonomi yang memang untuk user seperti `InsufficientBalanceError` / `InvalidAmountError`), kembalikan `error.message` secara utuh tanpa sensor substring `"ig"`/`"api"` yang merusak bahasa Indonesia!
     - Untuk `Error` lainnya, periksa apakah pola error sistem terdeteksi (seperti `PrismaClient`, kode `P2\d{3}`, `ENOENT`, `EACCES`, `ECONNREFUSED`, `ETIMEDOUT`, stack trace `\n    at `, atau path sistem `/home/`, `/var/`, `C:\\`); jika bukan `AppUserError`, catat `logger.warn`/`logger.error` dan kembalikan `fallbackMessage` (pastikan seluruh validasi input di command/service melempar `AppUserError` untuk pesan yang memang ditujukan kepada pengguna).
   - Ubah blok `catch` di `audioEffect.command.ts`, `quoteCard.command.ts`, dan `groupStats.command.ts` agar menggunakan `formatUserSafeError`.

---

## 6. Urutan Pengerjaan dan Dependensi

1. **Tahap 1A**: Hapus file legacy (`SEC-01`) ➔ pastikan `npm run build` bersih.
2. **Tahap 1B**: Buat fondasi `AppUserError` (`SEC-07`), `src/utils/xml.ts` (`SEC-06`), dan `imageSafety.ts` + upgrade paket `package.json` (`SEC-04`).
3. **Tahap 1C**: Implementasikan `urlValidator.ts` anti-SSRF dan perbarui `downloader.service.ts` + `downloader.command.ts` (`SEC-03`).
4. **Tahap 1D**: Perbarui otorisasi DM di `tenantGroup.repository.ts`, `roleGuard.ts`, `tenantOwnerSession.service.ts`, `tenantFeature.service.ts`, dan command media (`SEC-05`).
5. **Tahap 1E**: Perbaiki `AntiDelete` moderation suppression dan hapus pembongkaran `viewOnceMessage*` (`LOG-05`).

---

## 7. Risiko Perubahan & Mitigasi

- **Risiko 1**: Perubahan `formatUserSafeError` ke model allowlist `AppUserError` dapat menyembunyikan pesan validasi ramah pengguna pada service lama yang masih melempar `new Error("...")` biasa.
  - _Mitigasi_: Konversi pelemparan pesan validasi berbahasa Indonesia yang ditujukan ke pengguna menjadi `new AppUserError(...)`, atau tambahkan detektor transisi aman yang tetap menolak pola path/kode teknis (`ENOENT`, `Prisma`, `/`, `\`, `http`, `yt-dlp`, `ffmpeg`, `TypeError`) tanpa menyensor kata bahasa Indonesia `"digunakan"` / `"tetapi"`.
- **Risiko 2**: Resolusi DNS `dns.promises.lookup` pada `assertSafeExternalUrl` dapat gagal di dalam unit test offline apabila menguji domain palsu yang tidak punya record DNS.
  - _Mitigasi_: Pisahkan validasi sintaks & allowlist domain sinkron (`isAllowedDomainUrl`) dari resolusi DNS jaringan (`assertPublicHostnameIp`, injeksikan fungsi resolver untuk memudahkan mocking di unit test).

---

## 8. Test Case yang Diperlukan

1. **`tests/urlValidator.test.ts`**:
   - Menolak `https://evil-tiktok.com/v/1`, `https://tiktok.com.evil.org/v/1`, `https://notinstagram.com/p/1`, `http://127.0.0.1:3847/`, `https://169.254.169.254/latest/meta-data/`, `https://[::1]/`, dan hostname yang me-resolve ke `10.0.0.1` / `192.168.1.1`.
   - Menerima `https://www.tiktok.com/@u/video/1`, `https://vt.tiktok.com/ZS1/`, `https://www.instagram.com/reel/abc/`, `https://youtu.be/dQw4w9WgXcQ`.
2. **`tests/antiDeleteSecurity.test.ts`**:
   - Pesan grup yang dihapus melalui `suppressModerationDelete` (simulasi `AntiLink`/`AntiSpam`/`.del`) **tidak** diposting ulang saat `handleRevoke` terpanggil.
   - Pesan yang dihapus oleh Admin (`revokerJid !== cached.senderJid`) **tidak** diposting ulang.
   - Pesan `viewOnceMessageV2` tidak masuk ke cache `AntiDelete` dan `resolveImageMediaTarget` mengembalikan `null`.
3. **`tests/dmAuthz.test.ts`**:
   - Mantan `TENANT_OWNER` dengan grup berstatus `EXPIRED` atau `BLOCKED` tidak mendapatkan role `TENANT_OWNER` di DM dan ditolak saat memanggil `.hd`, `.quote`, `.tweet`, maupun `.feature`.
4. **`tests/svgAndSafeError.test.ts`**:
   - Input `<svg><script>&"'` pada `.profile`, `.brat`, `.quote`, `.tweet` di-escape sempurna dan merender gambar valid.
   - `formatUserSafeError` tidak lagi menyensor kalimat `"Limit ini tidak dapat digunakan tetapi bisa dibeli lagi"`, namun menyensor `"ENOENT: no such file /home/server/..."`.

---

## 9. Acceptance Criteria

- [x] Berkas `qrExporter.ts`, `alertServer.ts`, `telemetry.service.ts`, dan folder `scratch/` sudah tidak ada di workspace.
- [x] Seluruh pemanggilan `sharp()` memiliki `limitInputPixels: MAX_SAFE_IMAGE_PIXELS` (`16.777.216`) dan tidak ada lagi `limitInputPixels: false`.
- [x] Tidak ada lagi pencocokan domain menggunakan `.includes("tiktok.com" | "instagram.com" | "youtube.com")`.
- [x] `yt-dlp` selalu dipanggil dengan `--no-playlist` dan `--ies <platform>`.
- [x] Tidak ada pembongkaran `viewOnceMessage*` di seluruh kode sumber (`grep -rn "viewOnceMessage" src/` hanya merujuk pada pengecekan penolakan/skip).
- [x] `AntiDelete` terbukti tidak pernah mem-posting ulang pesan yang dihapus oleh `AntiLink`, `AntiSpam`, `.del`, atau Admin Grup.
- [x] DM `.quote`, `.tweet`, `.s`, `.hd`, dan sesi pengaturan menolak user non-tenant maupun mantan owner dari grup `EXPIRED`/`BLOCKED`/`REMOVED`.

---

## 10. Kriteria Penyelesaian Fase

1. [x] Seluruh _Acceptance Criteria_ di atas terpenuhi.
2. [x] `npm run build` selesai dengan `0` error.
3. [x] Seluruh unit test eksisting + unit test keamanan baru di Bagian 8 lulus (`npm test` — **347/347 tests passed 100%**).
4. [x] Status `SEC-01`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-06`, `SEC-07`, dan `LOG-05` diperbarui menjadi `[x] Completed` pada `audit/REMEDIATION_PLAN.md`.
