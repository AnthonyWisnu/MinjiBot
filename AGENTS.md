# AGENTS.md — MinjiBot Master System Guide

> **Catatan Penting untuk AI Agent / Developer:**
> Dokumen ini adalah **sumber kebenaran tunggal (Single Source of Truth)** untuk seluruh arsitektur, domain bisnis, relasi database, siklus hidup koneksi WhatsApp, dan konvensi penulisan kode MinjiBot. Saat menambahkan fitur baru atau melakukan refactoring, wajib patuhi aturan dan prinsip yang tercantum di sini.

---

## 1. Identitas & Filosofi Proyek

- **Nama Proyek**: MinjiBot (MinjiBot V2)
- **Teknologi Utama**: Node.js (v20+), TypeScript (Strict Mode), Baileys (`@whiskeysockets/baileys`), Prisma ORM, PostgreSQL, PM2, Sharp, FFmpeg, yt-dlp.
- **Konsep Bisnis**: **Multi-Tenant Group Rental** (Sewa Bot per Grup WhatsApp).
  - Satu grup WhatsApp diisolasi sebagai **1 Tenant Group**.
  - Bot tidak menggunakan sistem pengguna premium global (*zero global premium users*). Seluruh hak akses fitur publik melekat pada status masa aktif sewa grup dan profil ekonomi member di dalam grup tersebut.
  - Setiap grup memiliki konfigurasi independen (fitur, antilink, antispam, welcome message, reminder, dll).

---

## 2. Hirarki Hak Akses & Peran (Role Hierarchy)

Sistem otentikasi dan otorisasi menggunakan `roleGuard` yang menyelesaikan peran pengirim pesan berdasarkan JID WhatsApp:

1. **SUPER_OWNER**:
   - Pemilik dan operator bot (didaftarkan melalui environment variable `SUPER_OWNER_JIDS`).
   - Memiliki bypass administratif penuh terhadap semua guard, batas limit, dan masa aktif tenant.
   - Dapat mengaktifkan, memperpanjang, memblokir grup tenant, serta menambah saldo/limit member secara paksa.
2. **TENANT_OWNER**:
   - Penyewa resmi bot untuk satu atau beberapa grup tenant (`ownerJid` pada `TenantGroup`).
   - Berhak mengubah pengaturan grup miliknya (fitur, antilink, antispam, welcome, reminder) dan menunjuk Tenant Admin.
   - Untuk fitur konsumsi berat (media downloader, AI photo, dll), Tenant Owner tetap tunduk pada profil member biasa dengan saldo limit normal.
3. **TENANT_ADMIN**:
   - Anggota grup yang ditunjuk oleh Tenant Owner untuk membantu mengelola grup tenant tertentu.
4. **MEMBER**:
   - Anggota reguler di dalam grup WhatsApp aktif. Menggunakan profil member per-grup untuk poin, limit, XP, dan game.

---

## 3. Siklus Hidup & Isolasi Tenant (Tenant Lifecycle)

Status tenant pada tabel `TenantGroup` memiliki enum `TenantStatus`:

```
   [Grup Baru Dideteksi]
             │
             ▼
        ┌─────────┐
        │ PENDING │ ── (Super Owner aktifkan: .tenant activate) ──┐
        └─────────┘                                               │
             │                                                    ▼
             │ (Abaikan/hapus)                               ┌────────┐
             ▼                                               │ ACTIVE │ ◄──┐
        ┌─────────┐                                          └────────┘    │
        │ REMOVED │                                               │        │ (Super Owner
        └─────────┘                                (Masa aktif    │        │  perpanjang:
             ▲                                      berakhir)     ▼        │  .tenant extend)
             │                                               ┌─────────┐   │
             │                                               │ EXPIRED │ ──┘
             │                                               └─────────┐
             │ (Super Owner hapus)                                │
             └────────────────────────────────────────────────────┤
                                                                  │ (Super Owner blokir:
                                                                  │  .tenant block)
                                                                  ▼
                                                             ┌─────────┐
                                                             │ BLOCKED │
                                                             └─────────┘
```

- **PENDING**: Bot dimasukkan ke grup baru. Fitur publik terkunci hingga Super Owner mengaktifkan sewa.
- **ACTIVE**: Grup aktif dan dapat mengakses semua fitur yang diizinkan sesuai masa sewa (`expiresAt`).
- **EXPIRED**: Masa sewa habis. Perintah biasa ditolak dengan pesan peringatan sewa habis (hanya perintah info/sewa yang terbuka).
- **BLOCKED**: Grup diblokir oleh Super Owner karena pelanggaran. Seluruh perintah diabaikan.
- **REMOVED**: Grup dikeluarkan dari pencatatan aktif.

---

## 4. Sistem Ekonomi Member (Group-Scoped Member Economy)

Setiap anggota memiliki profil ekonomi yang **terisolasi per-grup** (`GroupMemberProfile`). Seorang pengguna yang bergabung di dua grup berbeda akan memiliki dua profil saldo yang terpisah total. Identitas profil menggunakan composite key: `(groupJid, userJid)`.

### 4.1. Komponen Saldo (Balances)
- **Points (`pointsBalance`)**: Mata uang virtual untuk membeli limit (`.belilimit`), bermain slot taruhan (`.slot`), atau dihadiahkan ke sesama member (`.giftpoint`).
- **Limit (`limitBalance` & `reservedLimit`)**: Bahan bakar untuk mengeksekusi fitur berat (Heavy Features).
  - Pola Transaksi: **Reserve** ➔ **Execute** ➔ **Consume** (jika sukses) / **Refund** (jika gagal).
  - Fitur berat tidak boleh mengonsumsi limit jika eksekusi gagal di tengah jalan.
- **Experience (`experience`)**: Poin progres permanen (tidak bisa dibelanjakan/ditransfer) yang diperoleh dari game, klaim harian, dan aktivitas grup.
- **Tier Rank (Otomatis dari XP)**:
  - **Bronze**: 0 – 999 XP
  - **Silver**: 1.000 – 4.999 XP
  - **Gold**: 5.000 – 14.999 XP
  - **Platinum**: 15.000 – 39.999 XP
  - **Diamond**: 40.000 – 99.999 XP
  - **Master**: 100.000 – 249.999 XP
  - **Grandmaster**: 250.000+ XP

### 4.2. Fitur Klaim Harian & Pembelian
- **Daily Claim (`.daily` / `.claim`)**:
  - Memberikan 100 – 300 Poin acak + 50 XP.
  - Peluang 10% mendapatkan bonus 1 Limit tambahan.
  - Reset setiap pukul **00:00 WIB** (`Asia/Jakarta`).
  - Sistem streak berturut-turut tercatat di database.
- **Beli Limit (`.belilimit <jumlah>`)**:
  - Harga tetap: **1.000 Poin per 1 Limit**.
  - Transaksi atomic: Poin didebet dan Limit dikreditkan dalam 1 transaksi Prisma.
- **Kirim Hadiah (`.giftpoint`, `.giftlimit`)**:
  - Hanya dapat dikirimkan ke sesama anggota di dalam grup yang sama.
  - Tidak bisa transfer ke bot atau ke diri sendiri.

### 4.3. Buku Besar Transaksi (Audit Ledger)
Setiap perubahan saldo wajib mencatat baris baru pada tabel `MemberTransactionLedger` dengan:
- `asset`: `POINT` | `LIMIT` | `EXPERIENCE`
- `type`: `DAILY_REWARD`, `GAME_REWARD`, `LIMIT_PURCHASE_*`, `GIFT_*`, `FEATURE_*`, dll.
- `amountDelta`: nominal perubahan (+/-).
- `correlationId`: UUID pelacak untuk mengaitkan operasi reserve ➔ consume/refund.

---

## 5. Fitur Berat (Heavy Features) & Konsumsi Limit

Fitur berat mengonsumsi Limit Member dengan pola isolasi akses:
- **TikTok Media Downloader (`.tt <link>`)**: Mengonsumsi **1 Limit**. Mendukung download video tanpa watermark, serta foto slide carousel (hingga 12 foto) beserta audio/musik pengiring (BGM) via direct API dan fallback gallery-dl / yt-dlp.
- **Instagram Downloader (`.ig <link>`)**: Mengonsumsi **1 Limit**. Mendukung single reel/post, carousel foto/video (multi-item), dan story.
- **YouTube Video Downloader (`.yt <link>`)**: Mengonsumsi **1 Limit**. Menggunakan **Adaptive Smart Resolution**: Prioritas 1 **720p 60fps** dan Prioritas 2 **720p 30fps** (jika estimasi ukuran <= 100MB), dengan fallback dinamis ke **480p** untuk video berdurasi hingga 12 menit. Seluruh video dijamin menggunakan codec **AVC1/H.264 + AAC** mobile-safe agar langsung bisa diputar lancar di WhatsApp tanpa lag.
- **HD AI Photo (`.hd`)**: Mengonsumsi **2 Limit**. Meningkatkan ketajaman foto menggunakan model AI / GFPGAN.
- **Play Song & Lyrics (`.play <judul>`, `.lirik <judul>`)**: Mengonsumsi **1 Limit**. Streaming audio MP3 dan pencarian lirik musik.

### 5.1. Studio Kreatif & Media Ringan
- **Sticker Branding & Watermark Engine**: Seluruh stiker yang dihasilkan bot (`.s`, `.smeme`, `.brat`) disuntik metadata EXIF resmi WhatsApp menggunakan `node-webpmux` dengan identitas:
  - Pack Name: `MinjiBot Official Pack`
  - Author / Publisher: `MinjiBot`
  - **Dilarang keras** memuat nama personal developer pada EXIF stiker publik.
- **Stiker Teks Brat (`.brat <teks>`)**: Dibuat secara dinamis melalui Sharp SVG template (warna hijau limau `#8ACE00`, font sans-serif tebal hitam, efek blur khas album Charli XCX) ke WebP 512×512 berkecepatan tinggi tanpa dependensi canvas berat.
- **Reverse Sticker Converter (`.toimg`, `.tovideo`)**:
  - `.toimg`: Mengonversi stiker statis menjadi gambar PNG.
  - `.tovideo` / `.tovid`: Mengonversi stiker bergerak/animasi WebP menjadi video MP4 via FFmpeg.
- **Audio Effects Studio (`.bass`, `.chipmunk`, `.slowed`, `.nightcore`, `.tovn`)**:
  - Manipulasi file audio dan voice note lokal menggunakan FFmpeg tanpa biaya API eksternal.
  - `.tovn` / `.vn`: Mentranscode audio menjadi format resmi WhatsApp Voice Note (PTT) dengan gelombang suara hijau.
- **Welcome Photo & GoodBye Member Notifications**:
  - **Welcome (`.welcome [on|off]`, `.setwelcome <pesan>`)**: Saat ada member baru bergabung di grup aktif (`welcomeEnabled === true`), bot mengambil foto profil WhatsApp member tersebut dan mengirimkannya dengan caption kalimat sambutan kustom dari `.setwelcome`. Jika member tidak memasang foto profil atau privasinya tertutup, bot secara otomatis menggunakan foto avatar resmi Minji (`assets/minji.png`) sebagai fallback. Menggunakan template default formal Opsi 2 (tertib aturan & panduan `.menu`).
  - **GoodBye (`.goodbye [on|off]`, `.setgoodbye <pesan>`)**: Saat ada member keluar atau dikeluarkan dari grup (`goodbyeEnabled === true`), bot mengirimkan notifikasi perpisahan formal dan elegan ke grup dengan mention member tersebut tanpa mencoba menarik foto (mencegah error privasi WA). Otomatis diabaikan jika yang keluar adalah bot itu sendiri.

### 5.2. Alat Moderasi & Pengawasan Tenant (The Admin Powerhouse)
Fitur kontrol grup eksklusif untuk penyewa bot (`TENANT_OWNER` & `TENANT_ADMIN`) dan `SUPER_OWNER`:
- **HideTag (`.hidetag <pesan>`)**:
  - Mengirim pesan pengumuman berformat bersih (`📢 *[ PENGUMUMAN ]*`) dengan me-mention seluruh anggota grup secara tersembunyi (*invisible mentions* di background pesan) tanpa mengotori layar chat dengan ratusan nomor HP.
  - Mengikuti sistem cooldown tag-all yang dikonfigurasi per grup (`tagAllCooldownSec`).
- **Anti-Delete (`.antidelete [on|off]`)**:
  - Mendeteksi pesan yang ditarik/dihapus (*revoke*) oleh pengirim di dalam grup.
  - Memanfaatkan in-memory LRU Cache berkecepatan tinggi (kapasitas 500 pesan, batas ukuran media 2MB, TTL 2 jam) untuk menjaga konsumsi RAM VPS tetap minimal dan aman.
  - Saat pesan ditarik, bot secara otomatis mengirimkan ulang isi pesan asli (teks, gambar, atau stiker) dengan mencantumkan identitas pengirim (`@user`) dan waktu pengiriman (WIB).
- **Anti-ViewOnce (`.antiviewonce [on|off]`)**:
  - Mendeteksi pesan gambar atau video 1x lihat (*View Once*) yang dikirimkan ke grup.
  - Mengunduh stream buffer media secara instan via `downloadMediaMessage` dan mengirimkannya kembali ke grup sebagai media foto/video reguler dengan menyertakan kredit pengirim dan caption aslinya.
- **Sistem Warning Terpadu (`.warn`, `.unwarn`, `.warns`, `.resetwarn`, `.setwarn`)**:
  - Penegakan disiplin berjenjang terhadap member pelanggar aturan. Memberikan akumulasi poin peringatan hingga batas ambang (`warnThreshold`, default: 3).
  - Saat batas tercapai, bot secara otomatis mengeluarkan member dari grup (*Auto-Kick*) jika bot berstatus admin, dan mereset riwayat pelanggarannya secara atomik.
  - Akun terproteksi (`Bot`, `Tenant Owner`, dan `Super Owner`) kebal terhadap peringatan.
- **Anti-Raid & Bot Surge Protection (`.antiraid`, `.grup <buka|tutup>`)**:
  - Deteksi serbuan bot penyerang menggunakan *zero-lag in-memory sliding window* (default: $\ge 4$ member baru bergabung dalam interval $\le 10$ detik).
  - Memicu protokol mitigasi darurat: otomatis mengunci grup ke mode pengumuman (*Announcement*), mencabut tautan undangan grup (*Revoke Invite Link*), dan menyiarkan peringatan darurat ke chat dengan me-mention seluruh admin grup.
  - Dilengkapi *lockdown cooldown* 60 detik untuk mencegah badai siaran darurat berulang.
- **SaaS Tenant Dashboard (`.panel` / `.tenantstatus`)**:
  - Dashboard eksekutif bergaya SaaS premium untuk `TENANT_OWNER`, `TENANT_ADMIN`, dan `SUPER_OWNER`.
  - Menyajikan informasi lengkap: identitas grup, kode tenant, sisa masa aktif sewa (hari & jam WIB), status izin admin bot di grup, susunan tim pengelola, matriks switch ON/OFF seluruh modul (moderasi, notifikasi, utilitas), dan panduan kontrol cepat admin.

### 5.3. Fitur Engagement & Status Sosial (Social Currency Engine)
- **Profile 2.0 Visual Card (`.profile`)**:
  - Mengonversi tampilan profil teks polos menjadi kartu grafis *glassmorphism* modern (800×450 px) dalam format PNG siap share via Sharp lokal tanpa browser headless.
  - Menampilkan avatar bundar pengguna, nama panggilan, nomor HP tersamarkan, badge Tier Rank dengan aksen warna dinamis, progress bar XP ke tier berikutnya, serta 4 widget statistik (Poin, Limit, Streak Harian, Leaderboard Rank #X).
- **Group Activity Analytics & Sider Hunter (`.stats`, `.topaktif` / `.topchat`, `.silent [hari]`)**:
  - Mencatat aktivitas chat anggota secara non-blocking di database via `ActivityTrackerInterceptor`.
  - `.stats`: Ringkasan statistik aktivitas grup (total pesan, rentang tanggal, 5 pengirim pesan teraktif).
  - `.topaktif` / `.topchat`: Papan peringkat 10 anggota paling aktif di grup tenant.
  - `.silent [hari]`: Alat seleksi sider/koleksi nomor pasif untuk mendeteksi anggota yang tidak pernah mengirim pesan selama X hari terakhir (default: 7 hari).
- **Viral Studio: Aesthetic Quote & Meme Tweet (`.quote`, `.tweet`)**:
  - Alternatif legal, aman, dan viral tanpa risiko rekayasa fitnah fake-chat.
  - `.quote` [reply pesan]: Merender kartu kutipan editorial *dark glassmorphism* beresolusi tinggi dengan tipografi rapi, foto profil, dan watermark MinjiBot. Opsi flag `-s` untuk langsung dikirim sebagai stiker WhatsApp.
  - `.tweet <teks>` / `.tweet @user <teks>`: Merender mockup postingan X (Twitter) Dark Mode lengkap dengan foto profil, centang verifikasi biru, username @minjibot, dan statistik likes/retweets deterministik.
- **Automatic Level-Up & Rank Tier Announcement**:
  - Setiap kali member memperoleh XP (dari game kuis/tictactoe/daily) dan melompat ke tier rank yang lebih tinggi (Bronze ➔ Silver ➔ Gold ➔ Platinum ➔ Diamond ➔ Master ➔ Grandmaster), bot secara otomatis mengirim ucapan selamat selebrasi berformat elegan ke chat grup.

---

## 6. Mini Games & Mekanisme Interaktif

Semua mini game dirancang interaktif, ramah pengguna di WhatsApp, dan memberikan reward Poin & XP.

### 6.1. Mesin Slot Edukasi Anti-Judi (`.slot`)
- **Tiga Opsi Taruhan**:
  - `.slot` ➔ Taruhan default (5 Poin).
  - `.slot <jumlah>` ➔ Taruhan kustom sesuai saldo pengguna.
  - `.slot allin` ➔ Mempertaruhkan seluruh saldo poin yang dimiliki.
- **Simbol Murni Buah + Angka 7**: `🍒`, `🍇`, `🍉`, `🍊`, `🍋`, `7️⃣`.
- **Weighted RNG Dinamis (The Reality Trap)**:
  - Spin 1 – 3: Win Rate ~65% (sensasi *Beginner's Luck*).
  - Spin 4 – 10: Win Rate ~35% (*House Edge* mulai memangkas saldo).
  - Spin 11+: Win Rate ~20% (kemungkinan kalah tinggi).
  - Mode **ALL-IN**: Win Rate drop ke **~6%**. Jika kalah, bot menampilkan edukasi tegas mengenai bahaya kecanduan judi online.
- **Payout**:
  - Super Jackpot (`7️⃣ 7️⃣ 7️⃣`): 10x taruhan (+25 XP).
  - Jackpot 3 Buah Sama: 5x taruhan (+15 XP).
  - Match 2 Buah: 1.5x taruhan (+5 XP).

### 6.2. Family 100 Interaktif
- Format papan survey dengan slot tertutup:
  ```text
  1. ...............
  2. ...............
  3. ...............
  ```
- Jawaban yang ditebak pengguna **tidak harus berurutan**. Jawaban yang benar akan langsung membuka baris nomor tersebut dan mencantumkan nama penebak.
- **Dukungan Swipe / Reply**: Pengguna tidak perlu mengetik `.family100 <jawaban>`, cukup reply pesan pertanyaan dari bot dengan jawabannya langsung.

### 6.3. TicTacToe PvP (Player vs Player)
- Mulai tantangan: `.tictactoe @lawan`.
- **Terima Tantangan via Reply**: Pemain yang ditantang cukup **swipe/reply** pesan tantangan bot (bisa balas apa saja: "gas", "ok", dll).
- **Melangkah via Reply 1–9**: Pemain yang gilirannya tiba cukup **swipe/reply** pesan papan bot dengan angka `1` s/d `9`.
- Dilengkapi timeout 5 menit dan hadiah Poin/XP untuk pemenang, yang kalah, atau hasil seri.

### 6.4. Kuis & Asah Otak Lainnya
- `.mtk`, `.tebakkata`, `.tebakemoji`, `.tebakangka`: Semua mendukung mekanisme **Swipe / Reply** langsung tanpa prefix.

---

## 7. Penanganan Koneksi & Ketahanan Baileys (Lifecycle & Anti-Crash)

1. **Auto-Reconnect pada Status 500 / Network Glitch**:
   - Pada `src/bot/lifecycle.ts`, jika terjadi error `statusCode === 500` (misal *stream error*, *badSession ACK glitch*, atau *packet loss* sesaat dari server WhatsApp), bot **tidak menganggap sesi hangus**. Bot menjadwalkan reconnect otomatis secara berkala (exponential backoff) agar bot tidak mati permanen.
2. **Normalisasi JID WhatsApp**:
   - Mendukung resolusi Phone JID (`...s.whatsapp.net`) dan LID (`...lid`). Fungsi `getMessageSenderJid` dan `getPreferredUserJid` memastikan identitas pengirim selalu dinormalisasi secara konsisten.
3. **Pemberhentian Elegan (Graceful Shutdown)**:
   - Menangani `SIGINT` dan `SIGTERM` dengan menutup koneksi Baileys dan koneksi pool Prisma secara bersih.

### 7.1. Message Interceptor Pipeline & Event Subscribers
1. **Modular Interceptor Pipeline (`src/bot/pipeline/`)**:
   - Alur pesan masuk diproses secara berurutan menggunakan pola *Chain of Responsibility* terurut (`MessagePipeline`):
     - Priority `10`: `PendingTenantInterceptor` (Registrasi tenant pending, cache metadata 6 jam).
     - Priority `20`: `AntiDeleteInterceptor` (Penyimpanan cache pesan in-memory & background async media caching).
     - Priority `30`: `AntiViewOnceInterceptor` (Pencegat media 1x lihat).
     - Priority `35`: `ActivityTrackerInterceptor` (Pencatatan statistik chat grup non-blocking).
     - Priority `40`: `AfkInterceptor` (Deteksi mention member AFK & pembersihan status sender).
     - Priority `50`: `AntiLinkInterceptor` (Pembersih tautan grup WhatsApp).
     - Priority `60`: `AntiSpamInterceptor` (Rate limiting & flood control dengan LRU bounded bucket).
     - Priority `70`: `InteractiveReplyInterceptor` (Penangkap balasan swipe/reply kuis & tictactoe, mengembalikan `halt: true`).
   - Mencegah fenomena "God Handler" di `messageHandler.ts` (tetap ramping <100 baris).
2. **Event Subscribers (`src/bot/subscribers/`)**:
   - `groupParticipants.subscriber.ts`: Mengalirkan event member baru bergabung ke `antiRaidService` (pertahanan serbuan darurat) lalu ke `welcomeService` (sambutan formal & avatar fallback).
   - `messageRevoke.subscriber.ts`: Mendeteksi protokol penarikan pesan untuk fitur Anti-Delete.

---

## 8. Standar Kode & Aturan untuk AI Agent Berikutnya

Saat Anda (AI Agent) diminta memperbarui kode MinjiBot, patuhi aturan mutlak berikut:

1. **Layering Architecture (Wajib)**:
   - **Command Handler (`src/commands/`)**: Hanya bertanggung jawab mem-parsing argumen konteks, memanggil service layer, dan membalas pesan. **DILARANG KERAS memanggil Prisma Client langsung di dalam Command Handler!**
   - **Service Layer (`src/services/`)**: Mengandung seluruh logika bisnis dan orkestrasi domain.
   - **Repository Layer (`src/repositories/`)**: Bertanggung jawab penuh atas query basis data Prisma dan transaksi database.
2. **Keamanan Transaksi Finansial (Database Atomicity)**:
   - Semua mutasi saldo Poin, Limit, dan XP wajib berada di dalam satu transaksi Prisma (`prisma.$transaction`).
   - Selalu validasi saldo sebelum pengurangan: saldo poin dan limit tidak boleh bernilai negatif (`>= 0`).
3. **Logger & Error Handling**:
   - Gunakan `logger` dari `src/config/logger.ts` (Pino), jangan gunakan `console.log`.
   - Gunakan `formatUserSafeError` untuk pesan error yang ramah kepada pengguna tanpa membocorkan stack trace internal server.
4. **Verifikasi Pengujian**:
   - Sebelum menyetujui perubahan, pastikan `npm run build` bebas dari error tipe TypeScript (`0 error`).
   - Jalankan unit tests dengan `npm run test`. Seluruh test suite (314+ tests) **wajib lulus 100%**.
5. **Deployment & CI/CD**:
   - Seluruh perubahan yang di-push ke branch `main` di GitHub akan otomatis di-deploy ke VPS oleh GitHub Actions (`.github/workflows/deploy.yml`).
   - **DILARANG KERAS** menjalankan script deploy manual via SSH paralel tepat setelah `git push origin main`, karena akan memicu benturan proses (*race condition* / konflik kunci pada `.git/index.lock` dan `node_modules`). Cukup biarkan GitHub Actions mengeksekusi deployment secara otomatis dan pantau statusnya via API/web.
   - Script deployment di GitHub Actions dilindungi oleh antrean `concurrency` dan Linux `flock` (`/tmp/minjibot_deploy.lock`) serta pembersihan otomatis *stale git lock*.
