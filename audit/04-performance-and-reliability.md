# 04 — Performance, Concurrency & Reliability Audit

Dokumen ini menganalisis efisiensi basis data per pesan, konsumsi memori (RAM), manajemen konkurensi _child process_ (`yt-dlp`, `gallery-dl`, `ffmpeg`, `Sharp`), pemulihan saldo tercadang (`reservedLimit`), serta ketahanan siklus hidup koneksi `@whiskeysockets/baileys` dan penjadwal pengingat (`ReminderScheduler`).

---

## 1. Badai Query SQL Per-Pesan, Eksekusi pada Grup Mati & Konsumsi RAM 1 GB (`PERF-01` — Critical)

### Bukti Kode Sumber

1. **5–7 Query SQL + 1 Hot-Row `upsert` untuk Setiap Pesan Chat Biasa**:
   - Pada grup aktif yang ramai (mis. `30` pesan obrolan biasa/detik lintas beberapa grup penyewa), setiap pesan melewati urutan interceptor berikut tanpa berbagi konteks tenant ter-cache:
     - `PendingTenantInterceptor` (`pendingTenantRegistration.service.ts:29`): `findByGroupJid` (dan jika kolom `name` masih `null`, baris `93` memanggil jaringan WebSocket `socket.groupMetadata(groupJid)` **pada setiap pesan**!).
     - `AntiDeleteInterceptor` (`antiDelete.service.ts:93`): membaca `TenantFeatureSetting` (memiliki cache lokal terpisah).
     - `ActivityTrackerInterceptor` (`activityTracker.interceptor.ts:43` ➔ `groupMemberProfile.repository.ts:141`): langsung mengeksekusi **write `upsert` ke PostgreSQL pada setiap satu pesan chat** (`messageCount: { increment: 1 }, lastActiveAt: now`).
     - `AfkInterceptor` (`afk.service.ts:46-54`): menjalankan `DELETE` / `SELECT` tabel `AfkStatus` pada setiap pesan.
     - `AntiLinkInterceptor` (`antiLink.service.ts:36`) & `AntiSpamInterceptor` (`antiSpam.service.ts:157`): kembali melakukan query `TenantFeatureSetting` dan `TenantGroupSetting` ke PostgreSQL tanpa cache!
2. **Interceptor Tetap Memproses Grup `PENDING`, `EXPIRED`, `BLOCKED`, dan `REMOVED`**:
   - Karena `TenantGuard` baru dipanggil **setelah** `MessagePipeline.run()` selesai dan hanya untuk pesan ber-prefix command (`messageHandler.ts:39,85`), seluruh grup yang sudah habis masa sewanya atau sudah diblokir tetap memicu pencatatan aktivitas DB, kueri AFK, anti-spam, serta penyimpanan gambar `AntiDelete` di memori!
3. **Konsumsi RAM `AntiDelete` Mencapai >1 GB Tanpa Validasi Pasca-Unduh (`src/services/moderation/antiDelete.service.ts:45-48, 171`)**:
   - `MAX_CACHED_MESSAGES = 500` dengan `MAX_MEDIA_BYTES = 2 * 1024 * 1024` (`2 MB`). Dalam kondisi terburuk (`500` foto/stiker), cache tunggal ini memakan **hingga `1.000 MB` (`1 GB`) RAM** pada proses Node.js!
   - Lebih buruk lagi, baris `143` hanya memeriksa klaim header `fileLength` dari pengirim sebelum memanggil `downloadMediaMessage` di baris `171` **tanpa memeriksa `mediaBuffer.byteLength` setelah diunduh**. Header protobuf yang dimanipulasi (`fileLength: 100`) untuk payload `20 MB` akan langsung masuk ke RAM tanpa batas byte agregat!

### Rekomendasi Remediasi (Phase 3)

- Tempatkan `TenantContextInterceptor` di paling depan pipeline (prioritas `5`) dengan `LruCache` ber-TTL singkat (`30–60` detik + invalidasi instan saat mutasi status/fitur) yang memuat `{ tenant, featureSetting, groupSetting }` dalam **1 query `include`**. Hentikan pipeline (`halt: true`) seketika jika grup berstatus `BLOCKED`, `REMOVED`, `EXPIRED`, atau `PENDING` (setelah registrasi awal tertangani sekali).
- Ubah `ActivityTrackerInterceptor` menjadi _in-memory write-behind buffer_ (`Map<`${groupJid}:${userJid}`, { deltaCount, lastActiveAt }>`) yang di-_flush_ secara batch dalam satu transaksi setiap `15` detik (serta saat _graceful shutdown_), memangkas beban `UPDATE` database hingga **>95%**.
- Tambahkan pelacak `totalMediaBytes` pada `AntiDeleteService` dengan plafon keras **`64 MB` total RAM** (eviksi entri media terlama saat penuh) serta wajib validasi `mediaBuffer.byteLength <= MAX_MEDIA_BYTES` pasca-unduh.

---

## 2. Konkurensi Media Tak Terbatas, Alokasi Buffer Penuh & Blocking Antrean Pesan (`PERF-02` — High)

### Bukti Kode Sumber

1. **Tidak Ada Semaphore Pembatas Proses Berat (`yt-dlp`, `gallery-dl`, `ffmpeg`, `Sharp .hd`)**:
   - Class `AiJobQueueService` (`src/services/media/aiJobQueue.service.ts`) dibuat tetapi tidak pernah dipakai di mana pun. Jika `15` anggota di berbagai grup mengirim `.yt`, `.tt`, `.ig`, `.play`, `.bass`, dan `.hd` secara bersamaan, Node.js langsung mem-fork puluhan proses `yt-dlp` + `ffmpeg` + thread `libvips` serentak, menyebabkan lonjakan CPU 100% dan _Out-Of-Memory_ pada VPS 1–2 vCPU.
2. **Pembacaan Seluruh File ke RAM Sebelum Cek Ukuran & Fetch Tanpa Timeout**:
   - `downloader.service.ts:118,140,208` memanggil `await res.arrayBuffer()` sepenuhnya ke RAM baru kemudian memanggil `assertFileSizeAllowed(buffer.byteLength)`; pola serupa terjadi pada `fs.readFile(filePath)` di `downloader.service.ts:669-709` dan `playAudio.service.ts:30`.
   - `profile.command.ts:168,179` dan `quoteCard.command.ts:140` memanggil `fetch(avatarUrl)` tanpa `AbortSignal.timeout(...)` dan tanpa batas byte stream.
3. **I/O Sinkron Pemblokir Event Loop & Encoding Ganda**:
   - `welcome.service.ts:425`, `profile.command.ts:118`, dan `profileCard.service.ts:256` memanggil `fs.readFileSync(DEFAULT_MINJI_AVATAR_PATH)` pada jalur panas pesan masuk.
   - `quoteCard.service.ts:126-131` (`.quote -s`) meng-encode SVG ke WebP lossy di `renderQuoteImage`, lalu mendekompresi dan meng-encode ulang ke WebP kedua kalinya di `stickerService.createImageSticker`.
   - `lyrics.command.ts:137-154` menulis teks lirik panjang ke disk sementara lalu langsung membacanya kembali dengan `readFile` padahal Baileys mendukung `{ document: Buffer.from(text, "utf8") }` langsung dari memori.
4. **Head-of-Line (HoL) Blocking pada Batch `messages.upsert` (`src/bot/messageHandler.ts:24-26`)**:
   - Loop `for (const message of event.messages) { await handleIncomingMessage(...) }` berjalan sekuensial murni. Satu perintah `.yt` berdurasi `45` detik di awal batch (mis. saat rekoneksi soket) akan menahan seluruh balasan `.ping` / `.menu` di belakangnya selama `45` detik.

### Rekomendasi Remediasi (Phase 3)

- Aktifkan `BoundedTaskQueue` / Semaphore terukur: maks `2–3` job subprocess berat (`yt-dlp`/`gallery-dl`/`ffmpeg` video) dan maks `3` job `Sharp` berat (`.hd`), dengan batas panjang antrean (`maxQueueSize: 15`) yang langsung menolak cepat (_fast-fail_ ramah pengguna) sebelum mereservasi limit jika server sedang penuh.
- Gunakan pembacaan stream terukur (`ReadableStream` reader dengan penghitung byte + `AbortSignal.timeout(15_000)`) untuk seluruh `fetch` eksternal, dan periksa `fs.stat(filePath).size` **sebelum** `fs.readFile(filePath)` (atau kirim via `{ url: filePath }` ke Baileys agar tidak menyalin video 80 MB ke heap V8!).
- Cache buffer default avatar sekali di memori secara asinkron saat startup, hindari double-WebP encode pada `.quote -s`, dan jalankan pemrosesan `messages.upsert` dengan konkurensi terbatas (`CONCURRENCY = 5`).

---

## 3. Indeks Database, Query Duplikat & Kebocoran Map Tak Terbatas (`PERF-03` — Medium)

### Bukti Kode Sumber

- **`prisma/schema.prisma:249-254`**: Tabel `GroupMemberProfile` belum memiliki `@@index([groupJid, lastActiveAt])` untuk fitur `.silent`.
- **`prisma/schema.prisma:163-174`**: `TenantPrivateSession` memiliki indeks duplikat `@@index([userJid])` di atas `@unique` dan belum memiliki relasi FK `onDelete: Cascade` ke `TenantGroup`.
- **`src/services/stats/groupStats.service.ts:138,143`**: Memanggil `findInactiveMembers` **dua kali berturut-turut** dengan argumen identik hanya untuk menghitung total sebelum memotong 50 baris.
- **`src/guards/roleGuard.ts:43-50,86-93` & `moderationGuard.ts:36-41`**: Melakukan loop query `for (const jid of candidateJids) { await ... }` secara sekuensial alih-alih satu query `where: { userJid: { in: candidateJids } }`.
- **`src/services/media/lastPlayed.service.ts:11`**: Menggunakan `new Map<string, LastPlayedTrack>()` tanpa batas kapasitas maupun TTL (tumbuh tanpa batas seiring bertambahnya grup).

---

## 4. Risiko Deadlock Pipe `stdout` 64 KB, Proses Anak Yatim & Temp File (`REL-01` — High)

### Bukti Kode Sumber

1. **`child.stdout` Tidak Dibaca pada 5 Wrapper `spawn()`**:
   - Di `downloader.service.ts:815,852` (`runYtDlp` & `runGalleryDl`), `playAudio.service.ts:125`, `audioEffect.service.ts:77`, `sticker.service.ts:264`, dan `videoNormalize.service.ts:79`, `spawn()` dipanggil dengan konfigurasi default `stdio: ["pipe", "pipe", "pipe"]`, tetapi hanya `child.stderr` yang memiliki listener `.on("data")` sedangkan **`child.stdout` tidak pernah dikonsumsi maupun di-`ignore`**!
   - Jika `yt-dlp` atau `gallery-dl` mencetak progres/log `> 64 KB` (ukuran buffer pipe OS pada Linux/Windows) ke `stdout`, proses anak akan **terkunci (_deadlock_ memblokir syscall `write`) selamanya** hingga timeout tercapai. Selain itu akumulasi string `stderr += chunk` tidak dibatasi ukurannya.
2. **Proses Anak Yatim (_Orphaned Child Process_) & Race `removeTempDir`**:
   - Saat timeout terpicu, `child.kill("SIGKILL")` hanya membunuh proses induk `yt-dlp`, meninggalkan sub-proses `ffmpeg` yang di-spawn oleh `yt-dlp` tetap berjalan di latar belakang dan memegang kunci file pada direktori sementara (memicu `EBUSY` pada Windows atau kebocoran CPU pada Linux) karena `finally { await removeTempDir(tempDir) }` dieksekusi segera setelah promise timeout reject tanpa menunggu event `close` proses anak.
3. **Ketiadaan Guard Path pada Penghapusan Direktori Sementara (`src/utils/tempFile.ts:26-61`)**:
   - Jika suatu saat operator salah mengisi `TEMP_DIR=/tmp` atau `TEMP_DIR=.` di `.env`, `sweepStaleTempFiles` dan `cleanAllStaleTempDirs` akan menghapus file/folder lain yang bukan milik MinjiBot di dalam direktori tersebut (seharusnya membuat dan mengunci subdirektori khusus `path.join(resolvedTempRoot, "minjibot-work")` atau memfilter prefix `minji-`).

---

## 5. Kebocoran Permanen `reservedLimit` Saat Restart/Crash & Race `upsert` (`REL-02` — High)

### Bukti Kode Sumber

1. **`reservedLimit` Menggantung Selamanya Jika Proses Restart di Tengah Unduhan**:
   - Saat member menjalankan `.yt` atau `.tt`, `reserveLimit` mengurangi `limitBalance` (`-1`) dan menaikkan `reservedLimit` (`+1`) di PostgreSQL. Jika proses Node.js mengalami restart PM2, deploy baru, atau crash OOM sebelum blok `catch`/`consume` sempat berjalan, tidak ada mekanisme rekonsiliasi saat `src/index.ts` menyala kembali — `reservedLimit` pengguna tertahan permanen selamanya!
   - Selain itu, `src/utils/heavyFeatureHelper.ts:87-104` menelan kegagalan `consumeLimit` dan `refundLimit` di dalam blok `catch {}` tanpa retry maupun log terstruktur yang memadai.
2. **Race Condition `P2002` pada `upsert` Pesan Pertama Member Baru (`src/repositories/groupMemberProfile.repository.ts:21,141`)**:
   - Pada PostgreSQL `READ COMMITTED`, dua `prisma.groupMemberProfile.upsert` paralel untuk pasangan `(groupJid, userJid)` yang belum pernah ada di tabel dapat sama-sama melihat baris kosong lalu berbenturan pada constraint unik (`P2002`).

### Rekomendasi Remediasi (Phase 3)

- Tambahkan rutinitas startup `memberEconomyService.reconcileOrphanedReservations()` di `src/index.ts` yang mencari seluruh transaksi `FEATURE_RESERVE` berumur `> 10 menit` yang belum memiliki pasangan `FEATURE_CONSUME` maupun `FEATURE_REFUND`, lalu mengembalikan `limitBalance` dan menurunkan `reservedLimit` secara atomik beserta catatan `FEATURE_REFUND` (`note: "Auto-refund on startup recovery"`).
- Tangani `P2002` dengan _retry_ `findUnique` / `update` pada `findOrCreate`, serta tambahkan _exponential retry_ singkat (2x) dan `logger.error` terstruktur pada kegagalan settlement di `heavyFeatureHelper.ts`.

---

## 6. Ketahanan Soket Baileys, Siklus Hidup & Reminder Scheduler (`REL-03` — High & `REL-05` — Potential Medium)

### Bukti Kode Sumber

1. **Ketiadaan `cachedGroupMetadata` & `getMessage` pada `makeWASocket` (`src/bot/connection.ts:35-43`) — Confirmed (`REL-03`)**:
   - Dokumentasi resmi Baileys sangat mewajibkan penyediaan `cachedGroupMetadata` pada bot grup. Tanpa opsi ini, **setiap kali bot mengirim 1 pesan balasan ke grup**, Baileys secara internal melakukan query `groupMetadata` ke server WhatsApp untuk mengambil daftar perangkat enkripsi Signal peserta grup — melipatgandakan trafik WebSocket dan meningkatkan risiko `rate-overlimit` (`429`) / pemblokiran nomor!
   - Baris `42`: `getMessage: () => Promise.resolve(undefined)` membuat permintaan _retry_ dekripsi pesan dari anggota grup selalu gagal ("Waiting for this message. This may take a while").
   - Baris `24`: `await fetchLatestBaileysVersion()` melakukan request HTTP ke GitHub tanpa _timeout_ atau _fallback_ ke versi bawaan paket jika GitHub sedang gangguan.
2. **Race Soket Lama pada `BotLifecycle` (`src/bot/lifecycle.ts:48-111`) — Confirmed (`REL-03`)**:
   - Listener `connection.update` tidak memvalidasi `if (socket !== this.socket) return;`, dan `connect()` tidak memeriksa ulang `if (this.isStopping)` setelah `await createBotConnection()` selesai.
3. **`ReminderScheduler` Mengulang Grup Ter-Kick Selamanya & Mengabaikan Cooldown (`src/services/reminder/reminder.service.ts:145-149`, `reminderScheduler.ts:35-61`) — Confirmed (`REL-03`)**:
   - Jika bot sudah dikeluarkan dari grup (`403 Forbidden` / `not-authorized`), pengiriman pengingat melempar error tanpa menandai pengingat selesai/batal, sehingga scheduler terus mencoba ulang setiap `30` detik tanpa henti! Kolom `remindAllCooldownSec` di skema database juga belum pernah diperiksa di kode.
4. **Potensi Korupsi `creds.json` Akibat Penulisan `saveCreds()` Paralel (`src/bot/subscribers/index.ts:22-26`) — Potential Finding (`REL-05`)**:
   - _Hipotesis Berbasis Bukti_: `useMultiFileAuthState` bawaan Baileys menulis file JSON secara asinkron (`fs.writeFile`) setiap kali `creds.update` terpancar tanpa antrean tulis berurutan. Pada lonjakan negosiasi kunci Signal (_pre-key churn_ grup besar) atau penghentian proses mendadak tepat saat 2 penulisan `creds.json` bertumpukan, file `creds.json` berpotensi terpotong (_truncated JSON_) dan merusak sesi login. Membungkus `saveCreds()` dalam _async mutex_ berurutan menghilangkan risiko ini sepenuhnya.

---

## 7. Kerusakan Migrasi Prisma & Konfigurasi PM2 Produksi (`REL-04` — Critical)

- **`prisma/migrations/20260903010000_remove_legacy_owner_quota/migration.sql:11-21`**: Karakter `$` ter-escape menjadi `\$\$` (`DO \$\$ BEGIN ... END \$\$;`), menyebabkan kegagalan sintaks PostgreSQL saat `prisma migrate deploy` dijalankan pada database baru.
- **Duplikasi Timestamp `20260905010000_*`**: Dua folder migrasi menggunakan angka waktu yang sama persis.
- **Ketiadaan `ecosystem.config.cjs` PM2**: Tanpa konfigurasi eksplisit, PM2 memiliki `kill_timeout` bawaan hanya `1600 ms` (memutus `SIGINT` sebelum transaksi Prisma dan flush soket Baileys selesai) serta berisiko dijalankan dalam mode `cluster` multi-instans yang pasti memicu bentrokan sesi tunggal WhatsApp (`conflict` / `replaced`).

---

## 8. Referensi Temuan Terkait

- [`PERF-01`](./09-audit-findings.md#perf-01), [`PERF-02`](./09-audit-findings.md#perf-02), [`PERF-03`](./09-audit-findings.md#perf-03), [`REL-01`](./09-audit-findings.md#rel-01), [`REL-02`](./09-audit-findings.md#rel-02), [`REL-03`](./09-audit-findings.md#rel-03), [`REL-04`](./09-audit-findings.md#rel-04), [`REL-05`](./09-audit-findings.md#rel-05).
