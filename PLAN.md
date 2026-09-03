# PLAN.md

# MinjiBot V2 Implementation Plan

> REFACTOR IN PROGRESS - MEMBER ECONOMY
>
> This document partially describes the original architecture. Two legacy systems are now
> being replaced:
>
> 1. Tenant Owner shared quota (TenantOwnerQuota, TenantQuotaTransaction) - LEGACY, removal in Plan 009.
> 2. In-memory game profile inside game.service.ts (profilesByGroup, PlayerProfile) - TEMPORARY
>    STATE, will be replaced by persistent GroupMemberProfile in Plan 008.
>
> The authoritative refactor guide is CODEX_REFACTOR_INSTRUCTIONS.md. When this document
> conflicts with refactor documents, the refactor documents take precedence.

## 1. Tujuan Dokumen

Dokumen ini menjadi acuan kerja bertahap untuk membangun MinjiBot V2.

MinjiBot V2 adalah proyek baru. Jangan mengasumsikan ada implementasi lama, database lama, fitur lama, atau sistem premium lama.

Fokus utama:

- Bot WhatsApp multi-tenant berbasis sewa grup.
- Satu WhatsApp group adalah satu Tenant Group.
- Masa aktif tenant melekat ke Tenant Group.
- LEGACY: Kuota fitur berat melekat ke Tenant Owner (digantikan oleh member economy).
- NEW: Setiap member memiliki profil ekonomi independen per grup (poin, limit, XP, rank).
- Tenant Owner dapat memiliki banyak Tenant Group.
- NEW: Member dapat membeli limit dengan poin, klaim daily, dan gift ke member lain.

## 2. Prinsip Wajib

Semua tahap implementasi harus mengikuti aturan berikut:

1. Gunakan Node.js, TypeScript strict mode, Baileys, Prisma, PostgreSQL, dotenv, zod, pino, PM2, ESLint, Prettier, sharp, dan ffmpeg.
2. SQLite hanya boleh digunakan untuk local development bila diperlukan.
3. Jangan gunakan JSON file sebagai database production.
4. Semua konfigurasi penting wajib berasal dari `.env`.
5. Semua pesan bot untuk user menggunakan Bahasa Indonesia.
6. Jangan gunakan emoji di kode, komentar, logger, nama file, nama fungsi, internal string, dokumentasi, atau pesan bot.
7. Jangan gunakan em dash. Gunakan hyphen biasa jika perlu pemisah kalimat.
8. Jangan hardcode owner number, session path, database URL, command prefix, file size limit, atau konfigurasi penting lain.
9. Jangan campur business logic ke command handler.
10. Jangan akses Prisma langsung dari command handler.
11. Database access harus lewat repository atau service data access.
12. Semua command error harus tertangani dan tidak boleh membuat bot crash.
13. Gunakan pino logger, bukan `console.log`.
14. Jangan membangun fitur di luar `AGENT.md`, `DATABASE.md`, dan `TENANT_FLOW.md` tanpa instruksi eksplisit.

## 3. Arsitektur Target

Struktur proyek memakai modular feature-based structure.

```txt
src/
  bot/
  config/
  commands/
  services/
  repositories/
  guards/
  utils/
  types/
prisma/
```

Pembagian tanggung jawab:

- `commands`: parsing input command dan memanggil service.
- `services`: business logic tenant, quota, media, moderation, reminder, dan fitur lain.
- `repositories`: akses Prisma dan query database.
- `guards`: pengecekan status tenant, role, feature, dan quota.
- `utils`: helper teknis tanpa business logic.
- `types`: tipe domain.

Aturan isolasi:

- Data grup selalu scoped by `groupJid`.
- Data Tenant Owner dan kuota selalu scoped by `ownerJid`.
- Private session selalu scoped by `userJid`.
- Tenant Owner tidak boleh mengakses tenant milik Tenant Owner lain.
- Super Owner boleh mengakses semua tenant.

## 4. Model Data Baseline

Prisma schema harus memakai desain tenant-based dari `DATABASE.md`.

Model utama:

- `TenantGroup`
- `TenantAdmin`
- `TenantFeatureSetting`
- `TenantGroupSetting`
- `TenantOwnerQuota`
- `TenantQuotaTransaction`
- `TenantPrivateSession`
- `Reminder`
- `TenantAuditLog`

Enum utama:

- `TenantStatus`
- `TenantQuotaTransactionType`
- `TenantQuotaSource`
- `HeavyFeatureType`
- `TenantAuditAction`
- `AntiSpamMode`

Tabel yang tidak boleh dibuat:

- `PremiumUser`
- `UserDownloadLimit`
- `PrivateLimit`
- `MemberLimit`
- `belilimit`
- Database JSON production

## 5. Tahap 1 - Project Setup

Tujuan: membuat fondasi proyek yang stabil.

Checklist:

- Inisialisasi project Node.js dan TypeScript.
- Aktifkan TypeScript strict mode.
- Pasang dan konfigurasi ESLint dan Prettier.
- Pasang dependency utama.
- Buat struktur folder awal.
- Buat `.env.example`.
- Buat `src/config/env.ts` dengan validasi zod.
- Buat logger pino.
- Pastikan config penting tidak hardcoded.
- Tambahkan aturan ignore untuk session, media temp, cookies, token, credential, dan file rahasia.

Output tahap ini:

- Project dapat build TypeScript.
- Env tervalidasi.
- Logger tersedia.
- Struktur folder siap untuk tahap berikutnya.

## 6. Tahap 2 - Prisma dan Database

Tujuan: menyiapkan database tenant-based.

Checklist:

- Inisialisasi Prisma.
- Buat `prisma/schema.prisma` berdasarkan `DATABASE.md`.
- Tambahkan enum dan model baseline.
- Buat Prisma client wrapper yang aman.
- Buat migration awal.
- Buat repository dasar:
  - `tenantGroup.repository.ts`
  - `tenantAdmin.repository.ts`
  - `tenantFeature.repository.ts`
  - `tenantGroupSetting.repository.ts`
  - `tenantQuota.repository.ts`
  - `tenantSession.repository.ts`
  - `tenantAudit.repository.ts`
  - `reminder.repository.ts`
- Pastikan command handler tidak mengimpor Prisma langsung.

Output tahap ini:

- Database schema siap.
- Repository dasar tersedia.
- Migration dapat dijalankan.

## 7. Tahap 3 - Bot Connection dan Lifecycle

Tujuan: bot dapat terhubung ke WhatsApp dengan lifecycle yang aman.

Checklist:

- Buat koneksi Baileys di `src/bot/connection.ts`.
- Buat lifecycle handler di `src/bot/lifecycle.ts`.
- Ambil session path dari `.env`.
- Tangani reconnect dengan aman.
- Tangani QR dan auth state tanpa menyimpan data sensitif di log.
- Tangani error koneksi dengan logger.
- Jangan commit session file.

Output tahap ini:

- Bot bisa start.
- Bot bisa menjaga lifecycle koneksi.
- Error koneksi tidak membuat proses crash tanpa handling.

## 8. Tahap 4 - Message Parser dan Command Router

Tujuan: pesan WhatsApp dapat diubah menjadi command context yang konsisten.

Checklist:

- Buat `messageParser.ts`.
- Deteksi private chat dan group chat.
- Normalisasi sender JID, chat JID, dan quoted message.
- Ambil prefix dari `.env`.
- Buat tipe `CommandContext`.
- Buat registry command di `commands/index.ts`.
- Tambahkan middleware error handling command.
- Pastikan command tidak memproses pesan non-command kecuali event fitur seperti welcome, antilink, dan antispam.

Output tahap ini:

- Command router siap.
- Command context konsisten.
- Command error tidak crash.

## 9. Tahap 5 - Super Owner dan Role Guard

Tujuan: akses awal dapat dibedakan berdasarkan role.

Checklist:

- Ambil daftar Super Owner dari `.env`.
- Buat helper normalisasi nomor dan JID.
- Buat `roleGuard.ts`.
- Deteksi Super Owner.
- Deteksi Tenant Owner berdasarkan ownership tenant.
- Deteksi Tenant Admin berdasarkan tabel `TenantAdmin`.
- Siapkan tipe role:
  - `SUPER_OWNER`
  - `TENANT_OWNER`
  - `TENANT_ADMIN`
  - `MEMBER`

Output tahap ini:

- Role dasar tersedia.
- Command dapat memakai role guard.

## 10. Tahap 6 - Pending Tenant Registration

Tujuan: bot mendaftarkan grup baru sebagai tenant pending.

Checklist:

- Saat bot melihat group baru, load `groupJid` dan nama grup.
- Jika belum ada `TenantGroup`, buat status `PENDING`.
- Generate `tenantCode` format `MNJ-XXXX`.
- Pastikan `tenantCode` unik dan tidak mengekspos `groupJid`.
- Bot diam di grup secara default.
- Catat audit `TENANT_REGISTERED`.

Output tahap ini:

- Group baru otomatis masuk pending tenant.
- Super Owner dapat melihat calon tenant nanti.

## 11. Tahap 7 - Super Owner Tenant Commands

Tujuan: Super Owner dapat mengelola tenant dari private chat.

Checklist command:

- `.pendinggroup`
- `.activatetenant <nomorList/kode> <nomorOwner> <durasi> <quota>`
- `.listtenant`
- `.tenantinfo <kode>`
- `.extendtenant <kode> <durasi>`
- `.settenantexpire <kode> <YYYY-MM-DD>`
- `.blocktenant <kode>`
- `.unblocktenant <kode>`
- `.removetenant <kode>`

Aturan:

- Command aktivasi wajib private chat.
- Owner number dinormalisasi ke WhatsApp JID.
- Aktivasi membuat atau memperbarui:
  - `TenantGroup`
  - `TenantFeatureSetting`
  - `TenantGroupSetting`
  - `TenantOwnerQuota`
  - `TenantAuditLog`
- Durasi harus tervalidasi.
- Tenant blocked dan removed tidak boleh memakai fitur normal.

Output tahap ini:

- Tenant lifecycle dapat dikendalikan Super Owner.

## 12. Tahap 8 - Tenant Status Guard

Tujuan: semua command grup menghormati status tenant.

Checklist:

- Buat `tenantGuard.ts`.
- Cek tenant berdasarkan `groupJid`.
- Cek status `ACTIVE`.
- Cek `expiresAt`.
- Cek `isBlocked`.
- Ubah status ke `EXPIRED` bila masa aktif habis.
- Izinkan command info tertentu pada tenant expired:
  - `.menu`
  - `.status`
  - `.tenantstatus`
  - `.owner`
- Tolak fitur normal pada tenant `PENDING`, `EXPIRED`, `BLOCKED`, dan `REMOVED`.

Output tahap ini:

- Tenant inactive tidak bisa memakai fitur normal.
- Pesan penolakan sesuai flow.

## 13. Tahap 9 - Role-Aware Menu

Tujuan: `.menu` menampilkan menu sesuai role dan konteks chat.

Checklist:

- Private Super Owner melihat Super Owner menu.
- Private Tenant Owner melihat Tenant Owner menu.
- Private Member melihat basic help.
- Group Member melihat public group menu.
- Tenant Owner di grup melihat tenant owner group menu.
- Tenant Admin di grup melihat tenant admin menu.
- Super Owner dapat memakai:
  - `.ownermenu`
  - `.tenantmenu`
  - `.featuremenu`
  - `.quotamenu`
- Menu grup sebisa mungkin hanya menampilkan fitur enabled.

Output tahap ini:

- Menu tidak bocor antar role.
- User mendapat command yang relevan.

## 14. Tahap 10 - Tenant Owner Private Session

Tujuan: Tenant Owner dapat memilih tenant untuk pengaturan private.

Checklist command:

- `.mytenant`
- `.usetenant <nomor/kode>`
- `.currenttenant`
- `.cleartenant`

Aturan:

- Tenant Owner hanya melihat tenant miliknya.
- Session berlaku untuk pengaturan group-specific.
- Session expire setelah 7 hari tidak aktif.
- Private heavy feature tidak membutuhkan selected tenant.

Output tahap ini:

- Tenant Owner dapat mengatur tenant miliknya dari private chat.

## 15. Tahap 11 - Quota Core

Tujuan: kuota fitur berat aman dan transaksional.

Checklist command:

- `.addquota <nomorOwner> <jumlah>`
- `.setownerquota <nomorOwner> <jumlah>`
- `.ownerquota <nomorOwner>`
- `.listownerquota`
- `.quota`

Checklist service:

- Create quota record jika belum ada.
- Add quota.
- Set quota.
- Reserve quota.
- Consume reserved quota.
- Refund reserved quota.
- Semua operasi pakai Prisma transaction.
- Quota tidak boleh negatif.
- Semua perubahan membuat `TenantQuotaTransaction`.
- Tambahkan `correlationId` untuk reserve, consume, dan refund.

Output tahap ini:

- Kuota Tenant Owner siap dipakai fitur berat.
- Reserve dan refund sudah aman.

## 16. Tahap 12 - Feature Gate

Tujuan: command fitur mematuhi setting tenant.

Checklist:

- Buat `featureGuard.ts`.
- Buat `tenantFeature.service.ts`.
- Tambahkan command pengaturan fitur untuk Tenant Owner, Tenant Admin bila diizinkan, dan Super Owner.
- Dukung setting:
  - downloader
  - hd
  - hdai
  - game
  - welcome
  - antilink
  - antispam
  - reminder
  - tagall
- Jika feature disabled, reply:

```txt
Fitur ini sedang dinonaktifkan untuk grup ini.
```

Output tahap ini:

- Fitur dapat dinyalakan dan dimatikan per tenant group.

## 17. Tahap 13 - HD Photo Fast Mode

Tujuan: `.hd` berjalan tanpa konsumsi kuota.

Checklist:

- Implement `.hd`.
- Implement `.hd doc`.
- Ambil media dari reply photo atau photo dengan caption.
- Validasi input image only.
- Max input size 7 MB.
- Scale output 2x dengan sharp.
- Output kompatibel WhatsApp Android dan iPhone.
- Document mode mengirim image sebagai dokumen.
- Error diproses tanpa crash.

Output tahap ini:

- HD photo ringan siap dipakai pada tenant aktif.

## 18. Tahap 14 - Downloader

Tujuan: downloader berjalan dengan quota reserve dan refund.

Checklist command:

- `.tt <link>`
- `.ig <link>`
- `.igstory <link>`

Aturan group:

- Tenant harus `ACTIVE`.
- `downloaderEnabled` harus true.
- Quota diambil dari Tenant Owner grup.
- Result dikirim ke grup.

Aturan private:

- Hanya Tenant Owner dan Super Owner.
- Tenant Owner harus memiliki minimal satu tenant aktif.
- Member private chat ditolak.
- Tenant Owner tidak perlu `.usetenant`.
- Result dikirim ke private chat.

Aturan media:

- File size limit dari `.env`.
- Output MP4 bila memungkinkan.
- Normalisasi ke H.264 dan AAC bila perlu.
- Gunakan faststart bila normalisasi diperlukan.
- Refund quota bila proses gagal setelah reserve.

Output tahap ini:

- Downloader fitur berat siap dipakai dengan quota aman.

## 19. Tahap 15 - HD AI Photo

Tujuan: `.hdai` berjalan lewat queue dan quota aman.

Checklist:

- Implement `.hdai`.
- Implement `.hdai doc`.
- Input dari reply photo atau photo dengan caption.
- Validasi image only.
- Max input size 7 MB.
- Scale output 4x.
- Gunakan dependency local AI upscale jika tersedia.
- Jika dependency tidak tersedia, bot tidak crash.
- Hanya satu job berjalan dalam satu waktu secara default.
- Reserve quota sebelum proses.
- Consume quota saat sukses.
- Refund quota saat gagal.
- Document mode mengirim image sebagai dokumen.

Output tahap ini:

- HD AI siap dipakai tanpa membahayakan proses bot.

## 20. Tahap 16 - Welcome

Tujuan: welcome message berjalan per tenant group.

Checklist command:

- `.welcome on`
- `.welcome off`
- `.setwelcome <pesan>`

Aturan:

- Tenant harus `ACTIVE`.
- `welcomeEnabled` mengontrol perilaku.
- `welcomeMessage` disimpan per `groupJid`.
- Event welcome tidak mempengaruhi tenant lain.

Output tahap ini:

- Welcome dapat dikonfigurasi per grup tenant.

## 21. Tahap 17 - Antilink

Tujuan: proteksi link undangan grup WhatsApp aktif per tenant.

Checklist command:

- `.antilink on`
- `.antilink off`

Aturan:

- Tenant harus `ACTIVE`.
- `antiLinkEnabled` mengontrol perilaku.
- Deteksi WhatsApp group invite link.
- Delete link jika bot adalah admin.
- Auto kick hanya jika setting mengizinkan dan bot admin.
- Jangan kick Super Owner, Tenant Owner, atau Tenant Admin.
- Catat audit `MODERATION_UPDATED` saat setting berubah.

Output tahap ini:

- Antilink aktif per tenant group.

## 22. Tahap 18 - Antispam

Tujuan: proteksi spam dasar aktif per tenant.

Checklist command:

- `.antispam on`
- `.antispam off`
- `.antispam status`
- `.antispam mode normal`
- `.antispam mode strict`

Deteksi:

- Message flood.
- Command flood.
- Repeated text.
- Media spam.

Aturan:

- Tenant harus `ACTIVE`.
- `antiSpamEnabled` mengontrol perilaku.
- Normal mode memberi warning atau bot-timeout.
- Strict mode boleh delete atau kick jika bot admin.
- Jangan kick Super Owner, Tenant Owner, atau Tenant Admin.
- Catat audit `MODERATION_UPDATED` saat setting berubah.

Output tahap ini:

- Antispam aktif per tenant group dengan mode normal dan strict.

## 23. Tahap 19 - Reminder

Tujuan: reminder berjalan sekali dan scoped per tenant group.

Checklist command:

- `.remind <waktu> <pesan>`
- `.remindall <waktu> <pesan>`
- `.listreminder`
- `.delreminder <nomor>`

Aturan:

- Tenant harus `ACTIVE`.
- `reminderEnabled` mengontrol perilaku.
- Reminder disimpan per `groupJid`.
- `.remindall` memakai Baileys mentions array.
- Jangan bergantung pada native `@semua`.
- Scheduler mengecek tenant status sebelum mengirim.
- Jangan kirim reminder jika tenant expired atau blocked.
- Mark reminder sebagai sent setelah sukses.

Output tahap ini:

- Reminder tenant berjalan tanpa pengiriman berulang.

## 24. Tahap 20 - Tag All

Tujuan: tag all berjalan dengan cooldown dan permission.

Checklist command:

- `.tagall <pesan>`

Aturan:

- Tenant harus `ACTIVE`.
- `tagAllEnabled` harus true.
- Gunakan Baileys mentions array.
- Jangan list semua user di body text.
- Terapkan cooldown dari setting grup.
- Hanya role yang diizinkan bisa memakai.

Output tahap ini:

- Tag all siap digunakan secara terkendali.

## 25. Tahap 21 - Stabilization

Tujuan: memastikan fitur inti stabil sebelum fitur opsional.

Checklist:

- Audit semua command terhadap role, tenant status, feature gate, dan quota.
- Audit semua repository agar tidak ada Prisma access dari command.
- Audit semua pesan bot agar Bahasa Indonesia dan tanpa emoji.
- Audit codebase agar tidak ada em dash.
- Audit `.env.example`.
- Tambahkan test untuk parsing command, guard, quota transaction, tenant activation, dan feature gate.
- Jalankan lint, format, typecheck, dan test.
- Dokumentasikan cara start development dan production dengan PM2.

Output tahap ini:

- Tenant core, quota, media, moderation, reminder, dan tag all siap dipakai.

## 26. Tahap 22 - Game Later

Game belum boleh dikerjakan sampai tenant core, quota, media, dan moderation stabil.

Jika nanti dikerjakan, game harus:

- Tenant-aware.
- Scoped by `groupJid`.
- Menghormati `gameEnabled`.
- Tidak mencampur state antar tenant.

Command kandidat:

- `.kuis`
- `.family100`
- `.tebakkata`
- `.tebakemoji`
- `.tebakangka`
- `.tictactoe`
- `.nyerah`
- `.rank`
- `.poin`
- `.profile`
- `.daily`

## 27. Urutan Eksekusi Ringkas

1. Project setup, env validation, logger.
2. Prisma setup dan repository dasar.
3. Baileys connection dan lifecycle.
4. Message parser dan command router.
5. Super Owner detection dan role guard.
6. Pending tenant registration.
7. Super Owner tenant commands.
8. Tenant status guard.
9. Role-aware menu.
10. Tenant Owner private session.
11. Quota core.
12. Feature gate.
13. HD photo fast mode.
14. Downloader.
15. HD AI photo.
16. Welcome.
17. Antilink.
18. Antispam.
19. Reminder.
20. Tag all.
21. Stabilization.
22. Game later.

## 28. Definition of Done Per Tahap

Setiap tahap dianggap selesai hanya jika:

- Build TypeScript berhasil.
- Lint tidak menunjukkan masalah baru.
- Command yang relevan diuji manual atau otomatis.
- Error path diuji minimal untuk kasus utama.
- Tidak ada akses tenant lintas owner.
- Tidak ada quota yang dapat menjadi negatif.
- Tidak ada fitur normal yang berjalan pada tenant expired, blocked, pending, atau removed.
- Tidak ada perubahan di luar scope tahap tanpa instruksi eksplisit.

## 29. Catatan Kerja Untuk Codex

Saat mengerjakan tahap berikutnya:

1. Baca ulang `AGENT.md`, `DATABASE.md`, `TENANT_FLOW.md`, dan `PLAN.md`.
2. Kerjakan satu tahap atau satu subfitur pada satu waktu.
3. Jangan implement semua fitur sekaligus.
4. Gunakan pola modular yang sudah ditentukan.
5. Jika perlu memilih desain detail, pilih yang paling sederhana dan sesuai dokumen.
6. Setelah edit, jalankan verifikasi yang relevan.
7. Laporkan file yang diubah, hasil verifikasi, dan sisa risiko.
