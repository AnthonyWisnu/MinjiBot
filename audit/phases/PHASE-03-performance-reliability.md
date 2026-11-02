# PHASE-03 — Performance Optimization, Subprocess Safety & Baileys Resilience

> **Prasyarat Wajib Sebelum Memulai**: Pastikan `PHASE-01` dan `PHASE-02` telah selesai dan terverifikasi. Baca [`audit/README.md`](../README.md), [`audit/REMEDIATION_PLAN.md`](../REMEDIATION_PLAN.md), dan periksa bukti kode terkini untuk seluruh ID temuan fase ini di [`audit/09-audit-findings.md`](../09-audit-findings.md).

---

## 1. Tujuan dan Ruang Lingkup

Fase ketiga ini menyiapkan MinjiBot menghadapi beban produksi grup WhatsApp multi-tenant secara berkelanjutan pada VPS ber-resource terbatas (1–2 vCPU, 1–2 GB RAM). Ruang lingkup mencakup:

1. Eliminasi badai query SQL per pesan melalui `TenantContextInterceptor` ter-cache dan _write-behind batching_ `ActivityTracker`, serta pembatasan total memori cache media `AntiDelete` (`64 MB`).
2. Pemasangan semaphore konkurensi untuk _child process_ media & `Sharp`, pembacaan stream HTTP berbatas ukuran byte dengan timeout, dan paralelisme terkendali pada `messages.upsert`.
3. Penambahan indeks database yang hilang (`GroupMemberProfile`, FK `TenantPrivateSession`) dan penghapusan query N+1 / duplikat.
4. Sentralisasi eksekutor proses eksternal (`processRunner.ts`) yang bebas deadlock pipe `stdout` 64 KB, memutus seluruh _process tree_ saat timeout, serta isolasi direktori kerja `tempFile.ts`.
5. Rekonsiliasi startup untuk `reservedLimit` menggantung pasca-crash/restart.
6. Pengerasan soket `@whiskeysockets/baileys` (`cachedGroupMetadata`, `getMessage` retry store, serialisasi `saveCreds()`, guard soket `BotLifecycle`, dan perbaikan `ReminderScheduler`) serta kompatibilitas lintas OS/codec H.264 mobile (`COMP-01`).

---

## 2. ID Temuan yang Ditangani

| ID Temuan                                    | Severity | Judul Singkat                                                                        |
| :------------------------------------------- | :------: | :----------------------------------------------------------------------------------- |
| [`PERF-01`](../09-audit-findings.md#perf-01) | Critical | Badai 5–7 Query SQL Per-Pesan, Pipeline di Grup Mati & Cache RAM `AntiDelete` 1 GB   |
| [`PERF-02`](../09-audit-findings.md#perf-02) |   High   | Konkurensi Media Tanpa Semaphore, Alokasi Buffer Penuh, Sync I/O & HoL Blocking      |
| [`PERF-03`](../09-audit-findings.md#perf-03) |  Medium  | Indeks `.silent` Absen, FK `TenantPrivateSession`, Query Duplikat & Map Tak Terbatas |
| [`REL-01`](../09-audit-findings.md#rel-01)   |   High   | Risiko Deadlock Pipe `stdout` 64 KB di 5 `spawn()`, Proses Yatim & Guard `tempFile`  |
| [`REL-02`](../09-audit-findings.md#rel-02)   |   High   | Kebocoran Permanen `reservedLimit` Saat Crash/Restart & Race `P2002` pada `upsert`   |
| [`REL-03`](../09-audit-findings.md#rel-03)   |   High   | Absennya `cachedGroupMetadata` & `getMessage`, Guard `BotLifecycle` & Retry Reminder |
| [`REL-05`](../09-audit-findings.md#rel-05)   |  Medium  | Serialisasi Penulisan `saveCreds()` untuk Mencegah Korupsi JSON `creds.json`         |
| [`COMP-01`](../09-audit-findings.md#comp-01) |  Medium  | Bug `PATH` Windows, `.mp4` Non-H.264 Gagal Putar di HP, `fromMe: false` & Font Linux |

---

## 3. File dan Modul yang Terdampak

- **Dibuat Baru (Create)**:
  - `src/utils/processRunner.ts` (eksekutor `spawn` aman lintas Windows/POSIX dengan drain `stdout`, cap `stderr`, & process-tree kill)
  - `src/utils/boundedQueue.ts` (atau perombakan `src/services/media/aiJobQueue.service.ts` menjadi `MediaConcurrencyService` generik)
  - `src/utils/httpStream.ts` (`fetchBufferWithLimit(url, { maxBytes, timeoutMs })`)
  - `src/bot/pipeline/interceptors/tenantContext.interceptor.ts` & `src/services/tenant/tenantRuntimeCache.service.ts`
  - `src/services/stats/activityBuffer.service.ts` (_in-memory write-behind batcher_ untuk `ActivityTrackerInterceptor`)
  - `src/bot/messageRetryStore.ts` (LRU ringan untuk `makeWASocket.getMessage`)
  - Migrasi Prisma baru di `prisma/migrations/<timestamp>_add_perf_indexes_and_session_fk/migration.sql`
- **Dimodifikasi (Modify)**:
  - `prisma/schema.prisma`
  - `src/index.ts`, `src/bot/connection.ts`, `src/bot/lifecycle.ts`, `src/bot/subscribers/index.ts`, `src/bot/messageHandler.ts`
  - `src/bot/pipeline/index.ts` & seluruh interceptor di `src/bot/pipeline/interceptors/*`
  - `src/services/moderation/antiDelete.service.ts`, `src/services/tenant/pendingTenantRegistration.service.ts`
  - `src/services/media/downloader.service.ts`, `src/services/media/playAudio.service.ts`, `src/services/media/audioEffect.service.ts`, `src/services/media/sticker.service.ts`, `src/services/media/videoNormalize.service.ts`, `src/services/media/quoteCard.service.ts`, `src/services/media/lastPlayed.service.ts`, `src/commands/media/lyrics.command.ts`
  - `src/services/member/memberEconomy.service.ts`, `src/utils/heavyFeatureHelper.ts`, `src/repositories/groupMemberProfile.repository.ts`
  - `src/guards/roleGuard.ts`, `src/guards/moderationGuard.ts`, `src/services/stats/groupStats.service.ts`
  - `src/services/reminder/reminder.service.ts`, `src/services/reminder/reminderScheduler.ts`
  - `src/utils/tempFile.ts`, `src/utils/mediaTarget.ts`, `src/utils/moderationTarget.ts`

---

## 4. Analisis Root Cause

1. **Absennya Konteks Pipeline Terpadu & Write-Behind Buffer (`PERF-01`)**: Setiap interceptor mengkueri PostgreSQL secara independen untuk pesan yang sama, dan setiap pesan langsung mengeksekusi `UPDATE` baris `GroupMemberProfile`.
2. **Penanganan I/O & Subprocess Naif (`PERF-02`, `REL-01`)**: `spawn()` meninggalkan `stdout` dalam mode `"pipe"` tanpa pembaca (rawan _deadlock_ kernel 64 KB), `res.arrayBuffer()` memuat seluruh respons ke RAM sebelum mengecek batas ukuran, dan tidak ada batas jumlah proses `yt-dlp`/`ffmpeg` paralel.
3. **Kehilangan State In-Flight Saat Restart (`REL-02`)**: `reservedLimit` dicatat persisten di PostgreSQL tanpa _sweeper_ pemulihan saat proses Node.js hidup kembali.
4. **Konfigurasi Minimal Soket Baileys (`REL-03`, `REL-05`)**: Tidak disediakannya `cachedGroupMetadata` dan `getMessage` membuat Baileys melakukan kueri jaringan ekstra di setiap pengiriman pesan grup dan gagal melayani retry dekripsi.

---

## 5. Pendekatan Implementasi yang Direkomendasikan (Instruksi Presisi)

### Langkah 5.1 — `TenantContextInterceptor`, Batching Aktivitas & Plafon RAM `AntiDelete` (`PERF-01`)

1. **`TenantRuntimeCacheService` + `TenantContextInterceptor` (Prioritas `5`)**:
   - Memuat `{ tenant, featureSetting, groupSetting }` dalam **1 query `findUnique({ include: { featureSetting: true, groupSetting: true } })`** dan menyimpannya di `LruCache` (`maxSize: 500`, `ttlMs: 45_000`), di-invalidasi otomatis setiap ada perubahan tenant/fitur.
   - Lampirkan snapshot ini ke `PipelineContext` (`ctx.tenantSnapshot`).
   - Jika grup belum terdaftar di DB, panggil `PendingTenantRegistrationService` sekali (dan jika `groupMetadata` gagal/mengembalikan nama kosong, simpan cooldown negatif `10` menit di LRU agar tidak memanggil `socket.groupMetadata` pada setiap pesan berikutnya!).
   - **Gerbang Penghentian Dini (_Early Pipeline Gate_)**: Untuk pesan non-command di grup yang berstatus `PENDING`, `EXPIRED`, `BLOCKED`, atau `REMOVED` (atau `expiresAt <= now`), langsung kembalikan `{ halt: true }`! Dengan demikian `AntiDelete`, `ActivityTracker`, `AFK`, `AntiLink`, dan `AntiSpam` **0% menyentuh CPU/RAM/DB** pada grup mati/terblokir, dan pada grup aktif ketiganya cukup membaca `ctx.tenantSnapshot` dari memori (`0` query tambahan!).
2. **`ActivityBufferService` (Write-Behind Batching)**:
   - Saat pesan masuk di grup aktif, `ActivityTrackerInterceptor` cukup menambah akumuator di memori `Map<string, { groupJid: string; userJid: string; count: number; lastActiveAt: Date }>`.
   - Timer periodik setiap `15_000 ms` (serta dipanggil eksplisit `await activityBufferService.flush()` di `shutdown()` `src/index.ts`) menyalin dan mengosongkan buffer, lalu menulis pembaruan secara terkelompok per grup.
3. **Plafon Byte Total `AntiDelete` (`64 MB`)**:
   - Tambahkan properti `private currentMediaBytes = 0;` dengan `MAX_TOTAL_MEDIA_BYTES = 64 * 1024 * 1024` di `AntiDeleteService`.
   - Setelah `downloadMediaMessage` selesai, **wajib periksa `if (mediaBuffer.byteLength > MAX_SINGLE_MEDIA_BYTES) return;`** (`2 MB`).
   - Sebelum menyimpan buffer baru, eviksi entri media paling tua dari LRU selama `currentMediaBytes + mediaBuffer.byteLength > MAX_TOTAL_MEDIA_BYTES`, dan kurangi `currentMediaBytes` pada callback `onEvict` / `delete` di `LruCache`.

### Langkah 5.2 — `processRunner.ts`, Semaphore Media, Stream Limit & Paralelisme `upsert` (`PERF-02`, `REL-01`, `COMP-01`)

1. **Utilitas Tunggal `src/utils/processRunner.ts` (`REL-01` & `COMP-01`)**:
   - Sediakan fungsi `runExternalProcess(cmd, args, { timeoutMs, cwd, extraPathDirs, captureStdout })`:
     - Bangun `env` menggunakan helper `buildSubprocessEnv(extraPathDirs)` yang mencari kunci `PATH`/`Path` secara _case-insensitive_ di `process.env` dan memperbaruinya tanpa membuat kunci duplikat di Windows (`COMP-01`).
     - Jika `captureStdout !== true`, gunakan `stdio: ["ignore", "ignore", "pipe"]` sehingga kernel OS membuang `stdout` ke `/dev/null` (`NUL` di Windows) — **mustahil terjadi deadlock pipe 64 KB**! Jika `captureStdout === true`, baca `stdout` dengan batas maksimum byte (`maxStdoutBytes = 1024 * 1024`).
     - Batasi penyimpanan `stderr` maksimal `16 KB` terakhir (_tail ring buffer_) untuk keperluan log diagnostik.
     - Pada Linux/macOS (`process.platform !== "win32"`), jalankan `spawn` dengan `detached: true` sehingga proses memiliki PGID sendiri; saat timeout terpicu, kirim `process.kill(-child.pid, "SIGKILL")` untuk mematikan seluruh pohon sub-proses (termasuk `ffmpeg` yang dipanggil `yt-dlp`). Pada Windows, jalankan `spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })`.
     - **Selalu tunggu event `close`** (dengan batas tunggu pengaman 2 detik pasca-kill) sebelum meresolusi/me-reject promise sehingga `finally { await removeTempDir(tempDir) }` tidak pernah berbenturan dengan file yang masih dikunci proses anak!
   - Ganti kelima pemanggilan `spawn` manual di `downloader.service.ts`, `playAudio.service.ts`, `audioEffect.service.ts`, `sticker.service.ts`, dan `videoNormalize.service.ts` agar menggunakan `runExternalProcess`.
2. **Pengamanan `src/utils/tempFile.ts` (`REL-01`)**:
   - Kunci seluruh pembuatan dan penyapuan direktori sementara di dalam subdirektori terdedikasi `path.join(path.resolve(env.TEMP_DIR), "minjibot-work")` dan hanya hapus entri yang berawalan prefix `minji-`.
3. **Semaphore Konkurensi Media & Pembacaan Stream Terbatas (`PERF-02`)**:
   - Konversi `aiJobQueue.service.ts` menjadi `mediaQueueService` dengan dua kanal:
     - `heavySubprocessQueue` (`concurrency: 2`, `maxQueue: 15`) untuk `.tt`, `.ig`, `.yt`, `.play`, dan normalisasi video.
     - `imageComputeQueue` (`concurrency: 3`, `maxQueue: 20`) untuk `.hd` dan konversi stiker video.
     - Jika antrean penuh, lempar `AppUserError("Server sedang memproses banyak media. Silakan coba beberapa saat lagi.")` **sebelum** atau dengan refund instan.
   - Buat `fetchBufferWithLimit(url, { maxBytes, timeoutMs: 20_000 })` di `src/utils/httpStream.ts` yang memeriksa header `Content-Length` DAN menghitung akumulasi chunk `response.body` secara streaming (langsung `controller.abort()` detik itu juga jika melebihi `maxBytes`). Gunakan pada `downloader.service.ts` dan `AvatarService`.
   - Sebelum membaca hasil file lokal `yt-dlp`/`gallery-dl`, panggil `const stat = await fs.stat(filePath); assertFileSizeAllowed(stat.size);` terlebih dahulu!
   - Di `quoteCard.service.ts`: saat flag `-s` (`.quote -s`) aktif, render SVG ke PNG/raw sekali lalu teruskan ke `stickerService` agar tidak mengalami kompresi lossy WebP dua kali. Di `lyrics.command.ts`, kirim dokumen langsung via `Buffer.from(documentText, "utf8")` tanpa menulis file temp.
   - Di `src/bot/messageHandler.ts`: ganti loop `for..of` murni pada `event.messages` dengan worker pool konkurensi terbatas (`CONCURRENCY = 5`), namun tetap urutkan pesan yang berasal dari pengirim `(chatJid, senderJid)` yang sama secara berurutan agar urutan perintah satu orang tidak terbalik.
4. **Verifikasi Codec Video H.264 `.mp4` & Perbaikan `mediaTarget` / `moderationTarget` (`COMP-01`)**:
   - Di `downloader.service.ts` (`normalizeVideoIfNeeded`): untuk file `.mp4`, periksa apakah stream video sudah `h264`/`avc1` (dapat membaca keberadaan box atom ASCII `"avc1"`/`"avcC"` pada `ftyp`/`moov` MP4 atau menjalankan probe cepat `ffmpeg -hide_banner -i <file>`). Jika file `.mp4` memakai `hev1`/`hvc1` (HEVC), `vp09` (VP9), atau `av01` (AV1), jalankan `videoNormalizeService` agar dijamin kompatibel di WhatsApp iOS & Android!
   - Di `src/utils/mediaTarget.ts`: hitung `fromMe` secara akurat dengan mencocokkan `contextInfo.participant` terhadap `getBotCanonicalJids(context.socket)`.
   - Di `src/utils/moderationTarget.ts`: izinkan nomor telepon E.164 internasional `7–15` digit (tetap konversi awalan lokal `08...` ke `628...` sebagai kemudahan pengguna Indonesia).

### Langkah 5.3 — Rekonsiliasi `reservedLimit`, Penanganan `P2002` & Optimasi Skema DB (`REL-02`, `PERF-03`)

1. **Rekonsiliasi Startup & Periodik `reservedLimit` (`REL-02`)**:
   - Tambahkan metode `memberEconomyService.reconcileOrphanedReservations(olderThanMinutes = 15)`:
     - Cari transaksi `FEATURE_RESERVE` dengan `createdAt < cutoff` dan `correlationId != null` yang belum memiliki transaksi pasangan `FEATURE_CONSUME` maupun `FEATURE_REFUND` pada `correlationId` yang sama.
     - Untuk setiap reservasi yatim, jalankan transaksi pengembalian (`limitBalance: +amount`, `reservedLimit: Math.max(0, reserved - amount)`) dan catat baris `FEATURE_REFUND` (`idempotencyKey: `orphan-refund:${correlationId}``).
   - Panggil sekali saat `bootstrap()` di `src/index.ts` setelah `prisma.$connect()` dan jadwalkan tiap `30` menit.
   - Di `heavyFeatureHelper.ts:87-104`: tambahkan helper retry 2x (jeda `300 ms`) untuk `consumeLimit`/`refundLimit` dan wajib tulis `logger.error({ err, correlationId, groupJid, userJid }, "Failed to settle heavy feature limit")` jika tetap gagal.
   - Di `groupMemberProfile.repository.ts`: tangkap `P2002` pada `upsert` pertama kali dan fallback ke `findUnique` / `update`.
2. **Migrasi Indeks, FK & Penghapusan N+1 (`PERF-03`)**:
   - Perbarui `prisma/schema.prisma`:
     - Tambahkan `@@index([groupJid, lastActiveAt])` pada `GroupMemberProfile`.
     - Pada `TenantPrivateSession`: hapus `@@index([userJid])` yang redundan terhadap `@unique`, dan tambahkan relasi `tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)` (pada SQL migrasi, jalankan `DELETE FROM "TenantPrivateSession" WHERE "groupJid" NOT IN (SELECT "groupJid" FROM "TenantGroup");` terlebih dahulu sebelum `ADD CONSTRAINT` agar aman 100% di DB eksisting!).
   - Hapus pemanggilan ganda `findInactiveMembers` di `groupStats.service.ts:138,143`.
   - Ubah loop query kandidat JID di `RoleGuard` dan `ModerationGuard` menjadi satu query `where: { groupJid, userJid: { in: candidateJids } }`.
   - Ganti `Map` tak terbatas di `lastPlayed.service.ts` dengan `LruCache<string, LastPlayedTrack>(500, 6 * 60 * 60 * 1000)`.

### Langkah 5.4 — Ketahanan Soket Baileys, Serialisasi `saveCreds` & `ReminderScheduler` (`REL-03`, `REL-05`)

1. **`src/bot/connection.ts` & `src/bot/messageRetryStore.ts`**:
   - Bungkus `fetchLatestBaileysVersion()` dengan `Promise.race` timeout `5_000 ms`; apabila gagal/timeout, tangkap dengan `logger.warn` dan gunakan versi bawaan `DEFAULT_CONNECTION_CONFIG.version` dari `@whiskeysockets/baileys` agar bot tetap bisa menyala saat GitHub down.
   - Pasang `cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid)` pada `makeWASocket`. Perbarui cache ini pada event `groups.update` dan `group-participants.update`.
   - Buat `messageRetryStore` (`LruCache<string, proto.IMessage>(1000, 30 * 60 * 1000)`) yang menyimpan konten pesan keluar bot dan hubungkan ke `getMessage: async (key) => messageRetryStore.get(key.id ?? "")`.
2. **Serialisasi `saveCreds()` (`REL-05`)**:
   - Di `src/bot/subscribers/index.ts`, bungkus `saveCreds` dalam antrean berurutan (_coalescing mutex_ — jika saat menulis ada 5 event `creds.update` baru, cukup jadwalkan 1 penulisan berikutnya setelah penulisan aktif selesai) dan sediakan fungsi `flushCredsQueue()` yang ditunggu pada `BotLifecycle.stop()`.
3. **Guard `BotLifecycle` & `ReminderScheduler` (`REL-03`)**:
   - Di `src/bot/lifecycle.ts`: simpan referensi lokal `const currentSocket = socket;` di `connect()`, abaikan semua event `connection.update` jika `currentSocket !== this.socket`, dan periksa `if (this.isStopping)` tepat setelah `await createBotConnection()` (langsung tutup soket jika proses sedang berhenti).
   - Di `src/services/reminder/reminder.service.ts` & `reminderScheduler.ts`: jika grup tujuan sudah tidak `ACTIVE`/diblokir/expired, atau pengiriman gagal dengan kode status `403` / `404` / pesan `"not-authorized"` (bot sudah dikeluarkan dari grup), tandai pengingat selesai/dibatalkan di DB agar tidak mengulang tiap 30 detik selamanya; terapkan juga validasi `remindAllCooldownSec` saat membuat pengingat dengan opsi `mentionAll: true`.

---

## 6. Urutan Pengerjaan dan Dependensi

1. **Tahap 3A**: `processRunner.ts`, `tempFile.ts`, `httpStream.ts`, dan `BoundedQueue` (`REL-01`, `PERF-02`, `COMP-01`).
2. **Tahap 3B**: `TenantRuntimeCacheService` + `TenantContextInterceptor` + `ActivityBufferService` + plafon `64 MB` `AntiDelete` (`PERF-01`).
3. **Tahap 3C**: Perubahan skema `prisma/schema.prisma` + file migrasi indeks/FK + optimasi query N+1 + rekonsiliasi `reservedLimit` (`PERF-03`, `REL-02`).
4. **Tahap 3D**: Pengerasan `connection.ts`, `messageRetryStore.ts`, `saveCreds` queue, `BotLifecycle`, dan `ReminderScheduler` (`REL-03`, `REL-05`).

---

## 7. Risiko Perubahan & Mitigasi

- **Risiko 1**: Penundaan penulisan `ActivityBufferService` (15 detik) membuat angka total chat di `.stats` / `.topaktif` tertunda maksimal 15 detik dari pesan detik terakhir.
  - _Mitigasi_: Panggil `await activityBufferService.flushGroup(groupJid)` secara instan tepat di awal eksekusi perintah `.stats`, `.topaktif`, dan `.silent` sehingga admin/member **selalu melihat angka real-time 100% akurat** tanpa mengorbankan performa chat harian!
- **Risiko 2**: Penambahan Foreign Key pada `TenantPrivateSession` dapat gagal jika terdapat baris sesi lama yang merujuk ke `groupJid` yang sudah tidak ada.
  - _Mitigasi_: Sertakan pernyataan `DELETE FROM "TenantPrivateSession" WHERE "groupJid" NOT IN (SELECT "groupJid" FROM "TenantGroup");` di baris paling atas migrasi SQL sebelum `ALTER TABLE ... ADD CONSTRAINT`.

---

## 8. Test Case yang Diperlukan

1. **`tests/processRunner.test.ts`**: Menjalankan skrip Node anak `node -e "process.stdout.write('x'.repeat(300_000))"` selesai cepat tanpa deadlock pipe 64 KB; menguji timeout membunuh proses anak dan membatasi `stderr` ke `<= 16 KB`; menguji pelestarian kunci `Path` pada Windows.
2. **`tests/pipelinePerfAndMemory.test.ts`**: Grup `EXPIRED`/`BLOCKED` berhenti di `TenantContextInterceptor` (`0` panggilan ke `ActivityTracker`/`AFK`/`AntiSpam`); `AntiDelete` tidak pernah melewati batas `64 MB` total buffer media; `ActivityBufferService` menggabungkan 50 pesan menjadi 1 batch flush.
3. **`tests/orphanReservationRecovery.test.ts`**: Transaksi `FEATURE_RESERVE` berumur 20 menit tanpa pasangan `CONSUME`/`REFUND` dikembalikan saldonya secara utuh oleh `reconcileOrphanedReservations()` dan tidak memproses ulang pada pemanggilan kedua (idempoten).
4. **`tests/lifecycleAndCredsQueue.test.ts`**: Event `connection.update` dari soket lama diabaikan; 10 panggilan `creds.update` serentak dieksekusi berurutan tanpa overlap; `ReminderScheduler` menghentikan retry saat grup melempar `403 Forbidden`.

---

## 9. Acceptance Criteria

- [x] Seluruh pemanggilan `child_process.spawn` di `src/services/media/` telah digantikan oleh `runExternalProcess` dari `src/utils/processRunner.ts`.
- [x] Pesan chat biasa di grup aktif tidak lagi memicu `SELECT` berulang antar interceptor maupun `UPDATE` DB per pesan tunggal.
- [x] Total pemakaian RAM media `AntiDelete` terkunci keras `<= 64 MB`.
- [x] `makeWASocket` terkonfigurasi dengan `cachedGroupMetadata` dan `getMessage` berbasis LRU store.
- [x] Video `.mp4` ber-codec non-H.264 terdeteksi dan dinormalisasi ke `libx264 + aac`.
- [x] Rekonsiliasi reservasi limit menggantung berjalan otomatis saat startup.

---

## 10. Kriteria Penyelesaian Fase

1. Seluruh _Acceptance Criteria_ di atas terpenuhi.
2. `npx prisma generate` dan `npm run build` selesai dengan `0` error.
3. Seluruh pengujian lama + suite performa/reliabilitas baru Bagian 8 lulus (`npm test`).
4. Status ke-8 ID temuan fase ini diperbarui menjadi `[x] Completed` pada `audit/REMEDIATION_PLAN.md`.
