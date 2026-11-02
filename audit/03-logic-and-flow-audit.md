# 03 — Business Logic, Economy, Moderation & Dual-JID Flow Audit

Dokumen ini menguraikan hasil audit mendalam terhadap aturan bisnis inti MinjiBot: buku besar ekonomi member, sistem limit fitur berat, kualitas pemrosesan `.hd`, celah moderasi `AntiDelete` & _View-Once_, masalah sistemik identitas ganda WhatsApp (`@lid` vs `@s.whatsapp.net`), _guards_, mini-games, serta utilitas zona waktu WIB.

---

## 1. Eksploitasi Finansial Mesin Slot & Ketiadaan Audit Ledger (`LOG-01` — Critical)

### Bukti Kode Sumber (`src/services/game/slotGame.service.ts:39-177`)

1. **Pencetakan Poin & Limit Tak Terbatas oleh `TENANT_OWNER` (Baris `39-99, 133, 166`)**:
   - Baris `40`: `const isOwner = isSuperOwner || isTenantOwner;` menggabungkan hak `TENANT_OWNER` dengan `SUPER_OWNER`.
   - Baris `45-53`: Jika saldo `TENANT_OWNER` `< 5` poin, bot otomatis menyuntikkan `+100` poin gratis ke database.
   - Baris `75`: Pemeriksaan kecukupan saldo `if (!isOwner && profile.pointsBalance < parsedBet)` **dilewati** bagi `TENANT_OWNER`!
   - Baris `166`: Jika taruhan kalah, ekspresi `const netPoints = (!isOwner || profile.pointsBalance < bet) ? payout - bet : payout;` bernilai `0 - bet = -bet` ketika `pointsBalance < bet`, sehingga `pointsBalance: { increment: -bet }` menurunkan saldo ke **angka negatif** (melanggar aturan mutlak `AGENTS.md` §8.2: saldo tidak boleh `< 0`)!
   - Lebih parah lagi: ketika `TENANT_OWNER` bersaldo `100` mengetik `.slot 100000000` (`100 juta` poin), karena `100000000 !== 100`, variabel `isAllIn` bernilai `false`! Mesin RNG di baris `84` memberikan _Beginner's Luck Win Rate ~65%_ (bukan ~6% mode ALL-IN). Dalam 1–2x putaran, `TENANT_OWNER` langsung mencetak **150 juta – 1 miliar Poin**, lalu menukarkannya lewat `.belilimit` dan membagikannya ke seluruh anggota grup lewat `.giftpoint` / `.giftlimit`!
2. **Race Condition Double-Spend pada `.slot allin` Paralel (Baris `60-80, 170-177`)**:
   - Pembacaan `profile.pointsBalance` dilakukan di luar transaksi tanpa _conditional debit_ (`updateMany` dengan `pointsBalance: { gte: bet }`). Dua pesan `.slot allin` yang dikirim serentak akan membaca saldo awal yang sama; jika satu kalah dan satu menang, mutasi `increment: netPoints` menghasilkan pencetakan poin ganda atau saldo negatif.
3. **32-Bit Integer Overflow (`INT4`) & Ketiadaan `GroupMemberTransaction` Ledger**:
   - `parsedBet` tidak memiliki batas atas (`MAX_BET`). Input `.slot 1000000000` dengan _Super Jackpot_ `10x` menghasilkan `10.000.000.000` (`> 2.147.483.647`), menyebabkan crash PostgreSQL `integer out of range`.
   - Seluruh mutasi poin dan XP di `slotGame.service.ts:170-177` langsung memutasi `prisma.groupMemberProfile.update` **tanpa menulis satu baris pun** ke `GroupMemberTransaction`, serta tidak memanggil `levelUpNotifierService.checkAndNotify` saat XP naik kelas.

### Rekomendasi Remediasi (Phase 2)

- Hapus pengecualian saldo dan suntikan poin gratis untuk `TENANT_OWNER` pada `.slot` (fasilitas gratis `TENANT_OWNER` hanya berlaku pada `skipLimit` fitur berat, bukan mencetak mata uang game). Bagi `SUPER_OWNER`, gunakan mode simulasi murni atau pastikan tidak memicu saldo negatif.
- Batasi `MAX_SLOT_BET = 100_000` poin.
- Bungkus debit taruhan (`pointsBalance: { gte: bet }`), kredit kemenangan, penambahan XP, dan pencatatan `GroupMemberTransaction` (`GAME_REWARD` / debit taruhan) secara atomik di dalam satu `prisma.$transaction`, lalu panggil `levelUpNotifierService`.

---

## 2. Pencetakan Limit Massal Tanpa Otorisasi Ketat & Tanpa Ledger pada `.addlimitall` (`LOG-02` — Critical)

### Bukti Kode Sumber (`src/commands/member/memberAdmin.command.ts:204-255` & `src/services/member/memberAdmin.service.ts:138-165`)

- Berbeda dengan `.addlimit`, `.setlimit`, `.addpoint`, `.setpoint`, `.addxp`, dan `.setxp` yang dikunci ketat hanya untuk `SUPER_OWNER`, perintah `.addlimitall` mengizinkan `TENANT_OWNER` **dan bahkan `TENANT_ADMIN`** mencetak hingga `+100` limit per eksekusi tanpa batas frekuensi atau _cooldown_ (bahkan pada grup berstatus `PENDING`/`EXPIRED`/`BLOCKED` melalui kode tenant di DM).
- Di `memberAdmin.service.ts:154-160`, `prisma.groupMemberProfile.updateMany` dijalankan di luar `$transaction` dan **tidak menulis catatan audit apa pun** ke tabel `GroupMemberTransaction`.

### Rekomendasi Remediasi (Disepakati — Opsi A, Phase 2)

- Kunci `.addlimitall` **eksklusif hanya untuk `SUPER_OWNER`** (periksa `context.role === "SUPER_OWNER"` paling awal sebelum query database apa pun).
- Pindahkan resolusi kode grup ke _Service Layer_ (`ARCH-01`), bungkus pembaruan saldo seluruh profil anggota grup beserta `prisma.groupMemberTransaction.createMany` (`type: SUPER_OWNER_ADD`, `asset: LIMIT`) di dalam satu `prisma.$transaction`, dan tulis log audit `TenantAuditLog`.

---

## 3. `.yt` Tidak Memotong Limit & Gagal di DM Member (`LOG-03` — Critical)

### Bukti Kode Sumber (`src/services/member/heavyFeatureCost.ts:7-17` & `src/services/member/heavyFeatureLimit.service.ts:94`)

- Enum `HeavyFeatureType` memiliki `YOUTUBE_VIDEO_DOWNLOAD`, dan `downloader.command.ts:253` sudah memanggil `executeWithHeavyFeatureLimit` dengan tipe tersebut.
- Namun objek `HEAVY_FEATURE_COST` bertipe `Partial<Record<HeavyFeatureType, number>>` dan **lupa mendaftarkan `[HeavyFeatureType.YOUTUBE_VIDEO_DOWNLOAD]: 1`**!
- Akibatnya:
  1. Di dalam grup, `getFeatureCost(YOUTUBE_VIDEO_DOWNLOAD)` mengembalikan `0`, sehingga `executeWithHeavyFeatureLimit` langsung melewati reservasi limit (`cost <= 0`) — anggota biasa mengunduh video YouTube 720p **tanpa dipotong limit sama sekali**!
  2. Di DM bagi anggota reguler yang tergabung di beberapa grup aktif, `resolvePrivateChatGroupJid` memeriksa `profile.limitBalance >= cost` (`0`), berpotensi memilih grup kedaluwarsa/salah atau gagal konsisten dengan fitur downloader lain.

### Rekomendasi Remediasi (Phase 2)

- Ubah tipe `HEAVY_FEATURE_COST` menjadi `Record<HeavyFeatureType, number>` (tanpa `Partial<>`) agar kompilator TypeScript wajib menolak build jika ada enum baru yang belum diberi harga, dan set `YOUTUBE_VIDEO_DOWNLOAD: 1`, `HD_AI_PHOTO: 1`, serta `HD_AI_PHOTO_DOCUMENT: 1`.

---

## 4. Fitur `.hd`: Bypass Limit, Distorsi Rasio EXIF, & Hasil Terlihat Sama (`LOG-04` — High)

### Bukti Kode Sumber (`src/commands/media/hd.command.ts:21-75` & `src/services/media/imageEnhance.service.ts:10-50`)

1. **Bypass Limit & Modul Mati**: `hd.command.ts` langsung memanggil `imageEnhanceService.enhanceFast(inputBuffer)` tanpa `executeWithHeavyFeatureLimit` (`0` limit terpotong) dan tanpa antrean konkurensi (`AiJobQueueService` di `src/services/media/aiJobQueue.service.ts` serta `AI_UPSCALE_BIN` di `env.ts:34` tidak pernah dipanggil di mana pun).
2. **Root Cause Mengapa Hasil `.hd` Terlihat Sama Saja atau Gepeng**:
   - **Bug Distorsi Orientasi EXIF (`imageEnhance.service.ts:13-35`)**: `image.metadata()` pada Sharp selalu mengembalikan dimensi sensor mentah **sebelum** rotasi EXIF (`metadata.width` & `metadata.height` tidak memperhitungkan tag EXIF `Orientation: 6/8`, sebagaimana terdokumentasi di `sharp/lib/index.d.ts:1213-1223`). Ketika `.rotate()` dipasangkan dengan `.resize({ width: rawW * scale, height: rawH * scale, fit: "fill" })`, foto vertikal kamera HP (`Orientation: 6`) ditarik paksa (`fit: "fill"`) ke rasio horizontal!
   - **Amplifikasi Noise JPEG & Re-Kompresi Agresif WhatsApp**: Merentangkan foto kompresi WhatsApp (`~800–1280px`) langsung 4x ke `4096px` lalu menerapkan `.sharpen({ sigma: 1.2, m1: 1.0, m2: 3.0 })` menajamkan artefak kotak-kotak (_mosquito/block noise_) pada area kulit/langit (`m1: 1.0`). Kemudian saat buffer `4096px` dikirim lewat `{ image }` biasa (`hd.command.ts:64-71`), klien/server WhatsApp **langsung men-downscale dan mengompres ulang** gambar >2560px kembali ke kualitas standar (~1280–1600px, chroma 4:2:0), sehingga ketajaman yang baru dibuat lenyap!

### Rekomendasi Remediasi: Pipeline _Sharp Super-Clarity_ + 1 Limit (Disepakati — Phase 2)

- Hubungkan `hd.command.ts` ke `executeWithHeavyFeatureLimit` (**1 Limit** untuk `.hd` dan `.hd doc`; gratis bagi `TENANT_OWNER` & `SUPER_OWNER`) di dalam semaphore konkurensi media.
- Rombak `ImageEnhanceService` menjadi pipeline multi-tahap berbasis `Sharp` murni:
  1. **Keamanan & Orientasi Akurat**: `sharp(inputBuffer, { failOn: "error", limitInputPixels: 4096 * 4096, autoOrient: true })` dan baca dimensi efektif pasca-orientasi dari `metadata.autoOrient`.
  2. **Target Resolusi Cerdas Anti-Rekompresi WA**:
     - Mode standar (`.hd`): target sisi terpanjang **`2560px`** (`fit: "inside"`, rasio asli terjaga 100%) — tepat di plafon resolusi _WhatsApp HD Photo_ sehingga WhatsApp tidak melakukan downscale merusak.
     - Mode dokumen (`.hd doc`): target sisi terpanjang **`3840px` (4K UHD)** tanpa kompresi ulang WhatsApp.
  3. **Interpolasi Presisi Tinggi**: Gunakan kernel `mks2021` (_Magic Kernel Sharp 2021_) yang menghasilkan ketajaman tepi jauh lebih bersih tanpa _ringing_ dibanding `lanczos3` biasa.
  4. **Pemulihan Detail Lokal (_Local Micro-Contrast_)**: Terapkan `.clahe({ width: 64, height: 64, maxSlope: 2 })` untuk mengangkat tekstur halus pada wajah, rambut, pakaian, dan area bayangan tanpa membakar _highlight_, diikuti kurva tonal ringan `.linear(1.04, -5)` dan `.modulate({ brightness: 1.01, saturation: 1.08 })`.
  5. **Edge-Aware LAB Sharpening (Anti-Noise)**: Terapkan `.sharpen({ sigma: 0.9, m1: 0.35, m2: 2.8, x1: 3.5, y2: 12, y3: 20 })` — nilai `m1: 0.35` dengan ambang `x1: 3.5` menahan penajaman noise di permukaan rata/kulit, sementara `m2: 2.8` menajamkan garis tepi nyata pada kanal luminansi `L` secara tegas.
  6. **Encoding Kualitas Tinggi**: `.jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4", trellisQuantisation: true, overshootDeringing: true })`.

---

## 5. Sabotase Moderasi oleh `AntiDelete` & Kebocoran Privasi _View-Once_ (`LOG-05` — Critical)

### Bukti Kode Sumber

1. **`AntiDelete` Mengirim Ulang Link Spam/Konten Terlarang yang Dihapus Bot/Admin (`src/services/moderation/antiDelete.service.ts:181-291`)**:
   - Di `MessagePipeline`, `AntiDeleteInterceptor` berjalan di prioritas `20` (menyimpan teks/gambar masuk ke cache), _sebelum_ `AntiLinkInterceptor` (prioritas `50`) dan `AntiSpamInterceptor` (prioritas `60`).
   - Saat pelanggar mengirim tautan grup WA terlarang atau banjir stiker/gambar tak pantas, `AntiLink` / `AntiSpam` (atau Admin lewat `.del` / hapus admin WA) menghapus pesan tersebut dari grup.
   - Penghapusan itu memicu event `messages.update` (revoke) ke `AntiDeleteService.handleRevoke`. Pada baris `204-213`, kode memeriksa imunitas pada `cached.senderJid` (**si pelanggar**), bukan siapa yang menghapus pesan! Karena si pelanggar adalah `MEMBER` biasa (tidak kebal), bot **langsung mem-posting ulang tautan spam / foto terlarang tersebut secara permanen ke grup atas nama bot sendiri**!
2. **Pembongkaran Paksa Pesan Sekali Lihat (`viewOnceMessage*`)**:
   - Meskipun migrasi `20260905010000_remove_antiviewonce` menunjukkan fitur anti-view-once sengaja dihapus demi privasi, `antiDelete.service.ts:125-130` (`unwrapMessage`) dan `src/utils/mediaTarget.ts:145-151` (`unwrapQuotedContent`) masih membongkar `viewOnceMessage`, `viewOnceMessageV2`, dan `viewOnceMessageV2Extension`. Akibatnya, pesan _View-Once_ dapat disalin permanen oleh anggota lain dengan me-reply `.s`, `.hd`, atau `.toimg`, serta di-repost permanen oleh `AntiDelete`.

### Rekomendasi Remediasi (Disepakati — Phase 1)

- Tambahkan metode `antiDeleteService.markModerationDeleted(chatJid, messageId)` dan panggil setiap kali `AntiLink`, `AntiSpam`, atau `.del` menghapus pesan.
- Pada `handleRevoke`, abaikan event apabila penghapus (_actor/participant_ pada protokol revoke) `!== cached.senderJid` atau berasal dari bot sendiri (`key.fromMe`), sehingga penghapusan oleh Admin Grup tidak pernah di-repost.
- Hapus seluruh pembongkaran `viewOnceMessage*` di `antiDelete.service.ts` dan `mediaTarget.ts` (kembalikan `null` / tolak konversi media _View-Once_).

---

## 6. Kegagalan Sistemik Identitas Ganda WhatsApp (`@lid` vs `@s.whatsapp.net`) (`LOG-06` — Critical)

Pada grup WhatsApp modern (terutama komunitas atau pengguna dengan privasi nomor), metadata grup dan event Baileys sering mengirimkan `id` berakhiran `@lid` sementara database profil menyimpan `@s.whatsapp.net` (atau sebaliknya). Tabel berikut merangkum **10 titik kegagalan terverifikasi**:

|  #  | Modul & Lokasi Baris                                      | Kondisi Aktual & Dampak                                                                                                                                                                                                                                                                                                                                            |
| :-: | :-------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | `gift.command.ts:52-59` & `gift.service.ts:106-147`       | Mention ke diri sendiri yang menghasilkan `@lid` lolos dari cek `sender === recipient` (`@s.whatsapp.net`), membuat profil kedua `@lid` dengan bonus awal **+10 Limit gratis**! Sebaliknya, transfer ke teman valid gagal _"Penerima bukan anggota grup"_ ketika `groupMetadata.participants[].id` berupa `@lid`, dan `botJid` tidak memeriksa `socket.user?.lid`. |
|  2  | `groupStats.service.ts:128-167` (`.silent`)               | `activeSet` berisi `@s.whatsapp.net` dari DB, lalu dibandingkan dengan `participants[].id` yang berupa `@lid`. Akibatnya **100% member paling aktif (termasuk bot)** dituduh sebagai _sider_ pasif! Pesan baris `162` juga menampilkan teks mentah LaTeX `$\ge$`.                                                                                                  |
|  3  | `warn.service.ts:37,139,221,262,337-345`                  | `isGroupMember`, `isBotAdmin`, dan proteksi Owner hanya mencocokkan `p.id` tanpa `p.jid`/`p.lid`/`senderAltJids`; peringatan member terbelah di dua ID sehingga lolos _auto-kick_.                                                                                                                                                                                 |
|  4  | `game.service.ts:241-243,294-350,375`                     | Tantangan `.tictactoe @lawan` menyimpan `player2Jid` sebagai `@lid`, tetapi saat lawan membalas `"gas"`, `senderUserJid` lawan ter-normalisasi ke `@s.whatsapp.net` sehingga ditolak bukan pemain yang ditantang.                                                                                                                                                  |
|  5  | `heavyFeatureAccess.service.ts:54-59,74-86`               | Pengecekan `tenant.ownerJid === context.senderUserJid` mengabaikan `context.senderAltJids`, sehingga Tenant Owner ber-`@lid` tetap dipotong limit. Selain itu di DM (baris `74-86`), mantan Tenant Owner yang sewanya habis langsung dilempar ditolak tanpa fallback ke profil `MEMBER` di grup aktif lain tempat ia bergabung.                                    |
|  6  | `tenantPanel.service.ts:140-146`                          | `checkBotIsAdmin` hanya memeriksa `socket.user?.id` terhadap `p.id`; jika grup memakai `@lid`, dashboard `.panel` selalu melaporkan bot **Bukan Admin** meskipun bot sudah admin.                                                                                                                                                                                  |
|  7  | `profile.command.ts:55-104` vs `economy.command.ts`       | `.profile` menggabungkan `senderAltJids` melalui `findProfileByCandidates`, sedangkan `.daily`, `.belilimit`, dan `.poin` langsung memakai `senderUserJid`, menyebabkan angka di kartu `.profile` bisa berbeda dengan saldo aktual `.poin`.                                                                                                                        |
|  8  | `tenantFeature.service.ts:71` & `reminder.service.ts:105` | Pengecekan `ownerJid` tidak menyertakan `senderAltJids`.                                                                                                                                                                                                                                                                                                           |
|  9  | `afk.service.ts:56-114`                                   | Status AFK yang disimpan dengan `@s.whatsapp.net` tidak terpanggil saat member di-tag menggunakan `@lid` di grup.                                                                                                                                                                                                                                                  |
| 10  | `src/utils/jid.ts:84-92` (`normalizeUserJid`)             | Jika tidak sengaja diberi input grup `120363xxx@g.us`, fungsi memotong `@g.us` dan menempelkan `@s.whatsapp.net`, menciptakan user palsu `120363xxx@s.whatsapp.net`!                                                                                                                                                                                               |

### Rekomendasi Remediasi (Phase 2)

- Bangun `IdentityResolverService` terpusat yang memanfaatkan cache `groupMetadata` (`participants` memuat `{ id, jid, lid, admin }`) dan `socket.user` (`id` & `lid`) untuk selalu meresolusi setiap JID/mention/target ke **satu Phone JID kanonik `@s.whatsapp.net`** (dengan fallback ke `@lid` hanya bila nomor telepon benar-benar tidak tersedia di metadata WA).
- Tolak atau kembalikan `""` pada `normalizeUserJid` apabila input berakhiran `@g.us`, `@broadcast`, atau `status@broadcast`.

---

## 7. Cacat Atomisitas Klaim Harian, Race `P2002` Idempotensi & Double-Settlement `.play` (`LOG-07` — Critical)

### Bukti Kode Sumber

1. **`DailyClaimService.claimDaily` Tidak Atomik (`src/services/member/dailyClaim.service.ts:84-137`)**:
   - Menjalankan **4 operasi terpisah di luar satu transaksi induk**: `findOrCreate` ➔ `updateDailyClaimMeta` ➔ `creditPoints` ➔ `creditExperience` ➔ opsional `creditLimit`. Dua pesan `.daily` paralel pada pukul `00:00:01 WIB` lolos cek `hasClaimedToday` secara bersamaan (klaim ganda), atau jika kredit XP gagal di tengah jalan, tanggal `lastDailyClaimAt` sudah telanjur tercatat sehingga member kehilangan hak klaim hari itu.
2. **TOCTOU Race pada `idempotencyKey` (`src/services/member/memberEconomy.service.ts:161,206,289,497,605` & `gift.service.ts:125`)**:
   - Mengecek `findTransactionByIdempotencyKey` dengan `SELECT` sebelum `INSERT` tanpa menangkap error unik Prisma `P2002` dan menerjemahkannya ke `DuplicateOperationError`.
3. **Kebocoran Limit Ganda (`consume` + `refund`) pada `.play` (`src/commands/media/play.command.ts:80-90` & `memberEconomy.service.ts:422`)**:
   - Di `play.command.ts:80-90`: variabel lokal `reserved` bernilai `true`. Pada baris `80`, `consumeLimit` berhasil dieksekusi, **tetapi `reserved` tidak diubah menjadi `false`**! Apabila baris `87` (`lastPlayedService.set`) atau proses setelahnya melempar error, blok `catch` di baris `93` memanggil `refundLimit` untuk `correlationId` yang sama!
   - Di `memberEconomy.service.ts:422`: `refundLimit` hanya mengecek apakah ada transaksi `FEATURE_REFUND` sebelumnya, **tanpa mengecek apakah `FEATURE_CONSUME` sudah tercatat** untuk `correlationId` tersebut! Jika user sedang menjalankan fitur berat kedua secara bersamaan (`reservedLimit >= 1`), `refundLimit` tersebut akan mencuri `reservedLimit` milik proses kedua dan menambah `limitBalance` secara ilegal!
   - Selain itu, `play.command.ts:44-59` menjalankan `youtubeSearchService` sebelum mengecek/mereservasi limit.

### Rekomendasi Remediasi (Phase 2)

- Satukan seluruh langkah `claimDaily` di dalam satu `prisma.$transaction` menggunakan kunci kondisional pada `lastDailyClaimAt` (`updateMany` dengan `OR: [{ lastDailyClaimAt: null }, { lastDailyClaimAt: { lt: startOfTodayWib } }]`).
- Tangkap `PrismaClientKnownRequestError` (`code === "P2002"`) pada `idempotencyKey` dan konversi menjadi `DuplicateOperationError`.
- Di `consumeLimit` dan `refundLimit`, validasi status akhir `correlationId` di dalam `$transaction` (tolak `refund` jika `FEATURE_CONSUME` sudah ada, dan tolak `consume` jika `FEATURE_REFUND` sudah ada), serta pastikan `play.command.ts` memakai `executeWithHeavyFeatureLimit` standar (termasuk mencakup pencarian lagu).

---

## 8. Cacat Guard, Peta Fitur, Siklus Hidup Tenant & Invalidasi Cache (`LOG-08` — High)

### Bukti Kode Sumber

1. **`TenantGuard` (`src/guards/tenantGuard.ts:8,30-106`) & `messageHandler.ts:85`**:
   - Tidak memiliki bypass paling awal untuk `SUPER_OWNER` (melanggar `AGENTS.md` §2.1: perintah Super Owner di dalam grup `PENDING` atau `BLOCKED` ikut tertahan jika tidak masuk daftar info).
   - Pengecekan `isInfoCommand` (`baris 55`) berada **sebelum** pengecekan `BLOCKED` (`baris 61`), sehingga grup yang sudah diblokir (`BLOCKED`) masih bisa memanggil `.menu`, `.help`, `.ping`, `.whoami`, `.tenantstatus`, dan untuk command lain bot masih **membalas pesan penolakan** alih-alih mengabaikan secara senyap (_silent ignore_ sesuai `AGENTS.md` §3).
   - `EXPIRED_ALLOWED_COMMANDS` mencantumkan `"status"` dan `"owner"` yang tidak terdaftar di router, namun lupa mencantumkan `"panel"` dan `"infosewa"`.
   - `messageHandler.ts:85` menjalankan `tenantGuard` sebelum memastikan nama command valid di `commandRouter` — mengetik `...` atau `.123` di grup kedaluwarsa memicu balasan peringatan sewa habis.
   - `tenantGuard.invalidateCache` memiliki **0 pemanggil** di seluruh kode sumber! Saat Super Owner mengaktifkan/memperpanjang/memblokir grup, status lama tertahan di cache hingga TTL habis.
2. **`FeatureGuard` (`src/guards/featureGuard.ts:10-27`) & `TenantFeatureService` (`src/services/tenant/tenantFeature.service.ts:174-185`)**:
   - `COMMAND_FEATURE_MAP` lupa memetakan `yt`, `play`, `lirik` ke `downloaderEnabled`, lupa memetakan `mtk`, `math`, `slot` ke `gameEnabled`, serta lupa memetakan `hidetag` ke `tagAllEnabled`! Mematikan `.feature game off` atau `.feature downloader off` **tidak mematikan** perintah-perintah tersebut!
   - `isTenantFeatureKey` lupa menyertakan `antidelete`, `goodbye`, dan `antiraid`, serta 5 layanan modul (`.antidelete`, `.antiraid`, `.antilink`, `.antispam`, `.welcome`/`.goodbye`) memutasi tabel `TenantFeatureSetting` tanpa memanggil `tenantFeatureService.invalidateCache(groupJid)`.
3. **Transisi Status Tenant Ilegal (`src/repositories/tenantGroup.repository.ts:152-160` & `src/services/tenant/superOwnerTenant.service.ts:97-222`)**:
   - `unblockTenant` memaksa `status: TenantStatus.ACTIVE` tanpa memeriksa apakah grup sebelumnya masih `PENDING` (belum punya `ownerJid`) atau sudah `EXPIRED` (`expiresAt < now`) — membuka celah grup gratis aktif tanpa penyewa!
   - `extendTenant` dan `setTenantExpire` dapat mengubah grup `PENDING` atau `REMOVED` langsung menjadi `ACTIVE` tanpa menetapkan `ownerJid`.
   - `tenantOwnerTransfer.service.ts:150-172` menjalankan transfer kepemilikan dan pencatatan audit tanpa satu `$transaction` dan tanpa invalidasi cache sesi/role.

---

## 9. Cacat Sekunder Moderasi, Mini-Games, Profil & Zona Waktu WIB (`LOG-09` — High)

Ringkasan temuan logika sekunder yang terverifikasi dan dijadwalkan untuk diperbaiki pada **Phase 2**:

- **Moderasi**:
  - `antiLink.service.ts:98` & `antiLink.interceptor.ts:9-10`: Menghapus pesan tautan milik Owner/Admin **sebelum** memeriksa imunitas mereka (hanya _auto-kick_ yang dicegah di baris `105`), serta tidak menghentikan pipeline (`halt: true`) setelah pelanggar di-kick.
  - `antiSpam.service.ts:182,302-309`: Mengirim pesan peringatan spam ke `SUPER_OWNER`/`TENANT_OWNER` pada mode `NORMAL`, meng-hardcode prefix `"."` alih-alih `env.BOT_PREFIX`, dan gagal mendeteksi banjir media di dalam pembungkus `ephemeralMessage` (_disappearing messages_).
  - `antiRaid.service.ts:33,50,150,173,202`: Tetap berjalan pada grup terblokir/kedaluwarsa, memicu _lockdown_ darurat saat **Admin Grup sendiri** menambahkan >=4 anggota sekaligus (`update.author` tidak diperiksa), melempar error Prisma `P2025` jika baris `TenantGroupSetting` belum dibuat (`ensureForGroup` absen), dan `.grup buka|tutup` tidak memeriksa apakah bot berstatus Admin Grup terlebih dahulu.
  - `manualModeration.service.ts:83,93-98` (`.del`): Menolak Admin Grup bawaan WhatsApp yang belum didaftarkan sebagai `TenantAdmin`, serta meng-hardcode `fromMe: false` sehingga `.del` gagal menghapus pesan milik bot sendiri.
  - `warn.service.ts:57-76,275`: Dua perintah `.warn` bersamaan dapat memicu _double-kick_, serta `.setwarn` belum memanggil `ensureForGroup`.
- **Mini-Games & Interactive Reply**:
  - `game.service.ts:235-260,514-606` & `game.command.ts:58-61`: Anggota penonton luar yang mengetik `.nyerah` langsung **menghapus sesi TicTacToe pemain lain yang sedang berlangsung** (`delete` dipanggil sebelum mengecek apakah pengirim adalah `player1` atau `player2`!); teks hadiah TicTacToe tertulis `250 / 100 / 50 Poin` padahal konstanta `TICTACTOE_REWARD` bernilai `25 / 10 / 5`; pemain dapat menantang JID bot sendiri; jawaban sinonim paralel pada kuis & `Family100` belum dikunci mutex in-memory per grup; dan `.slot` tidak sengaja menimpa `quizSession.messageId`.
  - `interactiveReply.service.ts:58-100,142-173`: Balasan _swipe/reply_ tidak melewati `rateLimitGuard` dan mencocokkan _reply_ terhadap pesan bot **mana pun** (mis. membalas pesan `.menu` dianggap menebak kuis aktif).
- **Profil, Cooldown, Downloader & Zona Waktu**:
  - `profile.command.ts:317-332`: `.profile 628xxx` memanggil `getOwnProfile` (`findOrCreate`) alih-alih `getTargetProfile`, menciptakan baris profil hantu di database grup untuk nomor acak yang bahkan bukan anggota grup.
  - `afk.service.ts:52-53`: Saat member AFK mengirim pesan dan me-mention dirinya sendiri, bot mengirim notifikasi "sedang AFK" sebelum menghapus status AFK-nya.
  - `tagAll.service.ts:34-56,78-100`: Timestamp _cooldown_ baru disimpan **setelah** `await groupMetadata` & pengiriman selesai, memungkinkan 2 admin memicu 2 _mass-mention_ serentak.
  - `downloader.service.ts:469-470` & `downloader.command.ts:315-320`: `yt-dlp --match-filter` keluar dengan kode `0` tanpa mengunduh file apabila tidak diberi `--break-on-reject`, dan deteksi error `message.includes("720")` salah terpicu jika URL video kebetulan memuat angka `"720"`.
  - `memberEconomy.service.ts:101-111` & `leaderboard.service.ts:38-69`: Belum membatasi batas atas `INT4` PostgreSQL (`2.147.483.647`) maupun `Number.isSafeInteger`, `setLimit` mencatat `balanceBefore: 0` (seharusnya default `10`) pada profil baru, dan `callerPosition` di `.leaderboard` bergeser apabila `SUPER_OWNER` memiliki XP tinggi di grup tersebut.
  - `src/utils/time.ts:21-95,121-141` & `src/utils/format.ts:6-10`: `parseDateOnly("YYYY-MM-DD")` memakai `23:59:59.999Z` (UTC) yang setara pukul **06:59:59 WIB keesokan harinya** (meleset +7 jam dari ekspektasi penyewa Indonesia), `formatDateId` tidak menyertakan `timeZone: "Asia/Jakarta"`, dan input durasi sangat besar menghasilkan `Invalid Date` (`NaN`) yang lolos dari `NaN <= Date.now()` di `reminder.service.ts:45` lalu meledakkan `.toISOString()`.

---

## 10. Referensi Temuan Terkait

- [`LOG-01`](./09-audit-findings.md#log-01) s/d [`LOG-09`](./09-audit-findings.md#log-09).
