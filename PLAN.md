# PLAN.md — MinjiBot Architectural Refactor & Next-Gen Roadmap

> **Dokumen Resmi Arsitektur, QA Hardening, & Roadmap Pengembangan MinjiBot**  
> Dokumen ini adalah **Single Source of Truth** untuk tahapan refactoring kode, stabilisasi performa (*hardening*), serta pengembangan fitur baru. Dilarang mengubah arsitektur atau mengabaikan prinsip layering yang telah ditentukan di `AGENTS.md`.

---

## 1. Ringkasan Eksekutif & Keputusan Strategis

Setelah sukses menyelesaikan implementasi **Watermark Engine, Brat Sticker, Audio FX Studio, Hidetag, Anti-Delete, Anti-ViewOnce, serta Formal Welcome & GoodBye**, codebase MinjiBot diaudit secara komprehensif dari kacamata **Senior Software Engineer & Lead QA**.

Hasil audit menemukan bahwa selain masalah "God Handler", terdapat **9 area kritis (critical smells, memory leaks, dan WhatsApp ban risks)** yang wajib diperbaiki dalam fase refactoring sebelum menambahkan fitur baru:

1. **Refactoring Arsitektur (Anti "God Handler")**:
   - Memecah alur monolitik `src/bot/messageHandler.ts` menjadi **Modular Interceptor Pipeline (Chain of Responsibility)**.
   - Mendekopel logika game reply ke **Interactive Session Service** terpisah.
   - Memecah event listener Baileys di `src/bot/lifecycle.ts` ke dalam **Event Subscribers**.
2. **Hardening Stabilitas & Performa (Temuan Audit QA Mendalam)**:
   - **Eliminasi Badai `groupMetadata` di Pesan Masuk**: Menghapus pemanggilan `socket.groupMetadata` pada setiap pesan masuk di `pendingTenantRegistrationService` yang berisiko ban WhatsApp.
   - **Pemberantasan Bug Overwrite Setting Startup**: Menghapus `prisma.tenantFeatureSetting.updateMany` di `lifecycle.ts` yang selama ini me-reset paksa konfigurasi kustom tenant saat bot restart.
   - **Pencegahan Memory Leak**: Membersihkan map in-memory tanpa batas di `AntiSpamService`, `AfkService`, `TagAllService`, dan `GameService` menggunakan TTL / LRU cache.
   - **Penanganan Zombie Reminder**: Memperbaiki polling loop reminder pada tenant expired yang saat ini berulang tanpa henti setiap 5 detik.
   - **Asynchronous Media Caching**: Mengubah download media `antiDelete` menjadi non-blocking agar tidak menahan antrean pesan masuk.
   - **Guard Layer Caching**: Menambahkan cache in-memory jangka pendek (30–60 detik) untuk query role & tenant guard guna memangkas beban database PostgreSQL hingga 80%.
   - **Welcome Burst Protection**: Mencegah spam dan rate limit saat puluhan member masuk sekaligus dalam satu event.
3. **Prioritas 0 (P0) — "The Rental Dealbreakers"**:
   - Fitur esensial moderasi dan manajemen tenant yang menjadi alasan utama penyewa membayar sewa:
     - Sistem Warning Terpadu (`.warn`, `.unwarn`, `.warns`, `.resetwarn` + Auto-Kick).
     - Anti-Raid / Anti-Bot Surge Protection (`.antiraid` + Emergency Lockdown).
     - SaaS Tenant Dashboard (`.panel` / `.tenantstatus`).
4. **Prioritas 1 (P1) — "Engagement & Social Status"**:
   - Profile 2.0 Visual Card via Sharp.
   - Group Stats & Sider Hunter (`.stats`, `.topaktif`, `.silent`).
   - Viral Studio: Aesthetic Quote (`.quote`) & Tweet Meme (`.tweet`).
   - Level-Up & Rank Tier Announcement.
5. **Keputusan Fitur Fake WhatsApp (`.fakechat`) ➔ DROPPED / DIBATALKAN**:
   - **Alasan Hukum & Keamanan**: Sangat berisiko pelanggaran UU ITE (fitnah, drama palsu, rekayasa bukti transfer) dan memicu *mass-report* yang menyebabkan nomor bot dibanned permanen oleh WhatsApp.
   - **Kompleksitas & Resource**: Rendering bubble chat asli membutuhkan Puppeteer (boros RAM 300MB+) atau SVG rumit yang tampak kaku di HP.
   - **Digantikan**: 100% oleh `.quote` dan `.tweet` yang aman, viral, disukai member, dan legal.

---

## 2. FASE 1: Architectural Refactor — Membasmi "God Handler"

### 2.1. Permasalahan Codebase Saat Ini
1. **`src/bot/messageHandler.ts` (347 baris)**:
   - Memanggil 6+ service moderasi secara berurutan dan kaku.
   - Tercemar oleh **~220 baris kode game reply** (`handleQuizReply` dan `handleTicTacToeReply`), lengkap dengan duplikasi boilerplate `roleGuard`, `tenantGuard`, dan `featureGuard`.
2. **`src/bot/lifecycle.ts`**:
   - Listener Baileys (`messages.update`, `group-participants.update`) dicampur langsung di dalam `bindSocketEvents`.
3. **`src/bot/groupParticipantsHandler.ts`**:
   - Menghubungkan event peserta grup hanya ke `welcomeService`. Belum siap menerima modul moderasi peserta seperti `antiRaidService`.

### 2.2. Solusi Arsitektur: Interceptor Pipeline Pattern

```
                       [Incoming WhatsApp Message]
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │   MessageInterceptorPipeline   │
                   └───────────────┬───────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼ (Order: 10)             ▼ (Order: 20)             ▼ (Order: 30)
 ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
 │ PendingTenant │         │  AntiDelete   │         │ AntiViewOnce  │
 │  Interceptor  │         │  Interceptor  │         │  Interceptor  │
 └───────────────┘         └───────────────┘         └───────────────┘
         │                         │                         │
         ▼ (Order: 40)             ▼ (Order: 50)             ▼ (Order: 60)
 ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
 │ActivityTracker│         │      AFK      │         │   AntiLink    │
 │  Interceptor  │         │  Interceptor  │         │  Interceptor  │
 └───────────────┘         └───────────────┘         └───────────────┘
         │                         │                         │
         ▼ (Order: 70)             ▼ (Order: 80)             │
 ┌───────────────┐         ┌───────────────┐                 │
 │   AntiSpam    │         │  Interactive  │                 │
 │  Interceptor  │         │ReplyHandler*  │                 │
 └───────────────┘         └───────┬───────┘                 │
                                   │                         │
                       (Jika pesan adalah balasan           │
                        game / sesi interaktif)              │
                                   │ (Handled: Stop)         ▼ (Lolos semua)
                                   ▼                 ┌───────────────┐
                                [SELESAI]            │ Parse Command │
                                                     └───────┬───────┘
                                                             ▼
                                                    [ Command Router ]
```

### 2.3. Rincian File Refactoring
1. **`src/bot/pipeline/`**:
   - `types.ts`: Definisi interface `MessageInterceptor` dan `PipelineContext`.
   - `messagePipeline.ts`: Engine eksekusi interceptor terurut.
   - `interceptors/pendingTenant.interceptor.ts`
   - `interceptors/antiDelete.interceptor.ts`
   - `interceptors/antiViewOnce.interceptor.ts`
   - `interceptors/activityTracker.interceptor.ts` (Persiapan data `.stats` P1)
   - `interceptors/afk.interceptor.ts`
   - `interceptors/antiLink.interceptor.ts`
   - `interceptors/antiSpam.interceptor.ts`
   - `interceptors/interactiveReply.interceptor.ts`
2. **`src/services/interactiveSession/`**:
   - Memindahkan seluruh logika `handleQuizReply` dan `handleTicTacToeReply` ke service terisolasi.
3. **`src/bot/subscribers/`**:
   - `messageRevoke.subscriber.ts`: Listener Baileys `messages.update` untuk Anti-Delete.
   - `groupParticipants.subscriber.ts`: Dispatcher event Baileys `group-participants.update` menuju `welcomeService` dan `antiRaidService`.

---

## 3. FASE 2: QA Audit Hardening & Performance Stabilization

Berikut adalah 9 area perbaikan hasil audit mendalam yang dieksekusi bersamaan dengan refactoring:

| No | Area / File | Permasalahan | Solusi Hardening |
|---|---|---|---|
| **1** | `pendingTenantRegistration.service.ts` | `socket.groupMetadata(groupJid)` dipanggil pada **setiap pesan masuk** untuk update nama grup. Membebani koneksi Baileys & memicu ban WhatsApp. | Hanya ambil metadata saat registrasi awal pending atau saat menerima event Baileys `groups.update`. Pasang cache 6 jam. |
| **2** | `lifecycle.ts` (lines 22-36) | `prisma.tenantFeatureSetting.updateMany` dijalankan setiap bot start. Me-reset paksa setelan tenant yang sudah dimatikan owner (`.antidelete off`, dll). | Hapus pemanggilan `updateMany` di `lifecycle.ts`. Serahkan nilai default pada skema database dan repository `ensureForGroup()`. |
| **3** | `antiSpam.service.ts` | `buckets = new Map<string, SpamBucket>()` tidak pernah dibersihkan. Memori membengkak (*memory leak*) seiring waktu. | Terapkan interval pembersihan berkala (TTL 10 menit) atau batasi kapasitas dengan LRU cache. |
| **4** | `afk.service.ts` & `tagAll.service.ts` | Map cooldown (`notificationCooldowns`, `cooldownUntilByGroup`) tidak pernah di-prune. | Bersihkan entri cooldown yang sudah kedaluwarsa secara otomatis. |
| **5** | `game.service.ts` | Sesi kuis & tictactoe hanya dihapus saat ada yang bermain di grup yang sama. Sesi game terbengkalai mengendap di RAM. | Tambahkan global sweep scheduler setiap 15 menit untuk membatalkan game yang sudah melewati batas TTL. |
| **6** | `reminder.service.ts` | Jika tenant kadaluarsa/diblokir, reminder pending tidak ditandai `CANCELLED`, sehingga di-query terus tiap 5 detik (*zombie loop*). | Tandai reminder pada tenant non-aktif sebagai `CANCELLED` agar database tidak di-polling tanpa henti. |
| **7** | `antiDelete.service.ts` | Download media $\le 2\text{MB}$ dijalankan secara synchronous di pipeline pesan masuk, menahan eksekusi bot hingga 2-3 detik jika CDN WA lambat. | Jalankan download buffer media secara non-blocking / background task tanpa mem-block antrean pesan. |
| **8** | `guards/` (`role`, `tenant`, `feature`) | Menjalankan 4–5 query PostgreSQL identik pada setiap command yang masuk. | Pasang in-memory cache berdurasi 30–60 detik untuk status tenant dan setting fitur grup aktif. |
| **9** | `welcome.service.ts` | Jika 10+ member masuk sekaligus, bot melakukan spam 10+ foto sambutan dan memicu rate limit WA. | Tambahkan *burst limiter*: jika $>3$ member masuk bersamaan, gabungkan dalam 1 pesan sambutan ringkas tanpa foto individual. |

---

## 4. FASE 3: PRIORITAS 0 (P0) — "The Rental Dealbreakers"

### 4.1. Modul 1: Sistem Warning Terpadu (Tiered Member Discipline)
- **Tujuan**: Penegakan aturan grup secara bertahap tanpa harus kick manual.
- **Skema Database (Prisma)**:
  ```prisma
  model GroupMemberWarning {
    id          String   @id @default(uuid())
    groupJid    String
    userJid     String
    issuerJid   String
    reason      String
    createdAt   DateTime @default(now())

    tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)

    @@index([groupJid, userJid])
  }
  ```
- **Konfigurasi Tenant (`TenantFeatureSetting`)**:
  - `warnThreshold`: Int @default(3)
  - `warnAction`: String @default("KICK") // KICK atau MUTE
- **Commands**:
  - `.warn @user <alasan>`: Memberikan 1 poin peringatan. Jika mencapai threshold (3), bot otomatis kick member dari grup.
  - `.unwarn @user`: Menghapus 1 poin peringatan terakhir.
  - `.warns [@user]`: Melihat riwayat peringatan dan alasan pelanggaran.
  - `.resetwarn @user`: Mereset seluruh peringatan member menjadi 0.
- **Role Guard**: Khusus `SUPER_OWNER`, `TENANT_OWNER`, dan `TENANT_ADMIN`.

---

### 4.2. Modul 2: Anti-Raid & Bot Surge Protection
- **Tujuan**: Melindungi grup sewaan dari serangan spam bot / serbuan akun penyusup saat link grup bocor ke publik.
- **Mekanisme Teknis (Zero-Lag In-Memory Sliding Window)**:
  - Dipantau pada `groupParticipants.subscriber.ts` (action: `add`).
  - Cache sliding window mencatat timestamp kedatangan member per `groupJid`.
  - **Kondisi Trigger**: $\ge 4$ member baru bergabung dalam rentang waktu $\le 10$ detik (dapat dikonfigurasi).
  - **Aksi Mitigasi Darurat (Emergency Protocol)**:
    1. **Lockdown Grup**: Bot otomatis mengubah setelan grup menjadi hanya admin yang dapat mengirim pesan (`socket.groupSettingUpdate(groupJid, 'announcement')`).
    2. **Cabut Link Undangan**: Bot langsung me-reset tautan undangan grup lama (`socket.groupRevokeInvite(groupJid)`) agar bot penyerang berikutnya tidak bisa masuk.
    3. **Broadcast Alert**: Mengirim peringatan darurat ke chat grup me-mention para admin dan Tenant Owner:
       ```text
       🚨 *[ EMERGENCY ANTI-RAID LOCKDOWN ]* 🚨
       Terdeteksi serbuan {count} member baru dalam {window} detik!
       Grup telah dikunci otomatis dan tautan undangan grup telah di-reset.
       ```
- **Commands**:
  - `.antiraid [on|off]`
  - `.antiraid setting <threshold> <detik>` (misal: `.antiraid setting 5 10`)

---

### 4.3. Modul 3: SaaS Tenant Dashboard (`.panel` / `.tenantstatus`)
- **Tujuan**: Menghadirkan tampilan status sewa bergaya SaaS premium untuk Tenant Owner dan Super Owner.
- **Informasi yang Ditampilkan**:
  - **Identitas Tenant**: Nama grup, ID grup, dan status sewa (`ACTIVE`, `PENDING`, `EXPIRED`).
  - **Masa Aktif Sewa**: Sisa hari sewa beserta tanggal berakhir (WIB) dengan progress bar status.
  - **Izin Bot**: Status apakah bot adalah Admin Grup (`✅ Aktif` / `⚠️ Bot Belum Admin`).
  - **Daftar Pengelola**: Nama/nomor Tenant Owner dan seluruh Tenant Admin.
  - **Matriks Modul & Fitur**:
    - 🛡️ Moderasi: AntiLink [ON/OFF], AntiSpam [ON/OFF], AntiDelete [ON/OFF], AntiViewOnce [ON/OFF], AntiRaid [ON/OFF]
    - 📢 Notifikasi: Welcome [ON/OFF], Goodbye [ON/OFF]
    - 🎮 Hiburan & Ekonomi: Game [ON/OFF], Media Downloader [ON/OFF]
  - **Panduan Cepat Admin**: Bantuan instruksi cara mengubah setelan grup.
- **Role Guard**: Terbuka untuk `TENANT_OWNER`, `TENANT_ADMIN`, dan `SUPER_OWNER`.

---

## 5. FASE 4: PRIORITAS 1 (P1) — "Engagement & Social Status"

### 5.1. Modul 4: Profile 2.0 Visual Card via Sharp
- **Tujuan**: Mengubah tampilan `.profile` teks polos menjadi kartu grafis PNG estetis (800×450 px) yang siap dipamerkan di grup atau story WhatsApp.
- **Komponen Kartu Grafis**:
  - Foto profil WhatsApp pengguna (lingkaran avatar dengan aksen warna sesuai Tier Rank).
  - Nama panggilan & nomor HP tersamarkan.
  - Tier Rank Badge: Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster.
  - Progress Bar XP menuju tier berikutnya.
  - Widget Saldo: Total Poin, Limit, Streak Harian, dan Posisi Leaderboard di grup (#X).
- **Performa**: Rendering SVG dinamis via **Sharp** lokal tanpa headless browser (<100ms response time).

---

### 5.2. Modul 5: Group Stats & Activity Analytics (`.stats`)
- **Tujuan**: Memberikan insight aktivitas chat kepada admin grup (mendeteksi member paling aktif dan mendeteksi sider/lurker).
- **Skema Database**:
  - Tambahan kolom pada `GroupMemberProfile`:
    - `messageCount`: Int @default(0)
    - `lastActiveAt`: DateTime @default(now())
- **Pencatatan Non-Blocking**:
  - Ditangani oleh `activityTracker.interceptor.ts` pada setiap pesan non-command yang masuk.
- **Commands**:
  - `.stats`: Ringkasan aktivitas grup (total pesan tercatat, waktu teramai, 5 member teraktif).
  - `.topaktif` / `.topchat`: Peringkat 10 member dengan jumlah chat terbanyak.
  - `.silent [hari]`: Menampilkan daftar member yang tidak pernah mengirim pesan selama X hari (alat seleksi sider/koleksi nomor pasif).

---

### 5.3. Modul 6: Viral Studio — Aesthetic Quote (`.quote`) & Meme Tweet (`.tweet`)
- **Tujuan**: Fitur hiburan visual viral sebagai alternatif resmi dari `.fakechat`.
- **Fitur**:
  - **`.quote` [reply chat]**:
    - Mengambil teks chat yang dibalas beserta foto profil & nama pengirim aslinya.
    - Me-render kartu kutipan elegan dengan latar belakang *dark glassmorphism*, tanda petik editorial, dan teks kutipan rapi.
    - Opsi: Dikirim sebagai gambar PNG atau stiker WhatsApp (`.quote -s`).
  - **`.tweet <teks>` / `.tweet @user <teks>`**:
    - Me-render mockup postingan X (Twitter) Dark Mode lengkap dengan centang verifikasi biru, username, dan statistik likes acak lucu.

---

### 5.4. Modul 7: Automatic Level-Up & Rank Tier Announcement
- **Tujuan**: Gamifikasi sosial otomatis saat member aktif bermain game atau beraktivitas di grup.
- **Mekanisme**:
  - Saat member menerima XP dan tier bertambah (misal dari *Silver* ke *Gold*):
  - Bot memicu pesan perayaan otomatis berdesain bersih ke grup:
    ```text
    🎉 *[ LEVEL UP! ]* 🏆
    Selamat kepada @user yang berhasil naik ke tier *GOLD* (5.000+ XP)!
    Gelar baru dan hak istimewa telah disematkan. Terus tingkatkan keaktifanmu!
    ```

---

## 6. Matrix Prioritas & Rencana Eksekusi

| Urutan | Modul / Pekerjaan | Pilar | Status | Target Files Terkait |
|---|---|---|---|---|
| **Step 1** | **Interceptor Pipeline & Decouple Replies** | Architectural Refactor | ✅ **SELESAI** | `src/bot/pipeline/`, `src/bot/messageHandler.ts` |
| **Step 2** | **Baileys Event Subscribers** | Architectural Refactor | ✅ **SELESAI** | `src/bot/subscribers/`, `src/bot/lifecycle.ts` |
| **Step 3** | **QA Audit Hardening & Bugfixes** | Performance & Stability | ✅ **SELESAI** | `pendingTenantRegistration.service.ts`, `lifecycle.ts`, `antiSpam.service.ts`, `reminder.service.ts`, `guards/` |
| **Step 4** | **Sistem Warning Terpadu (`.warn`)** | P0: Dealbreakers | ✅ **SELESAI** | `prisma/schema.prisma`, `src/services/moderation/warn.service.ts` |
| **Step 5** | **Anti-Raid Protection (`.antiraid`)** | P0: Dealbreakers | ✅ **SELESAI** | `src/services/moderation/antiRaid.service.ts` |
| **Step 6** | **SaaS Tenant Panel (`.panel`)** | P0: Dealbreakers | ✅ **SELESAI** | `src/services/tenant/tenantPanel.service.ts` |
| **Step 7** | **Profile 2.0 Card (Sharp)** | P1: Engagement | ✅ **SELESAI** | `src/services/member/profileCard.service.ts` |
| **Step 8** | **Group Analytics (`.stats`, `.silent`)** | P1: Engagement | ✅ **SELESAI** | `src/services/stats/groupStats.service.ts` |
| **Step 9** | **Viral Quote & Tweet (`.quote`, `.tweet`)** | P1: Engagement | ✅ **SELESAI** | `src/services/media/quoteCard.service.ts` |
| **Step 10** | **Level-Up Announcement** | P1: Engagement | ✅ **SELESAI** | `src/services/member/memberEconomy.service.ts` |

---

## 7. Standar Mutu, CI/CD, & Guardrails

1. **Layering Architecture (Wajib)**:
   - Command Handler ➔ Service Layer ➔ Repository Layer.
   - **Dilarang keras** memanggil Prisma langsung di dalam Command Handler atau Pipeline Interceptor.
2. **Kemandirian Dependency**:
   - Hanya menggunakan **Sharp** dan **FFmpeg** lokal. Dilarang menambah `node-canvas` atau `puppeteer`.
3. **Pembersihan Resource**:
   - Seluruh temporary file wajib menggunakan utility `createTempDir()` dan dibersihkan di blok `finally`.
4. **Verifikasi Pengujian**:
   - `npm run build` wajib 0 error TypeScript.
   - Seluruh test suite (277+ unit tests) wajib lulus 100%.
5. **Protokol Deployment CI/CD**:
   - Deploy dilakukan secara otomatis oleh GitHub Actions (`.github/workflows/deploy.yml`) saat commit di-push ke branch `main`.
   - Dilarang menjalankan skrip SSH deploy manual bersamaan dengan GitHub Actions untuk mencegah benturan file lock (`.git/index.lock`).
