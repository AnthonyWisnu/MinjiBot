# PHASE-02 — Business Logic, Dual-JID, Economy Atomicity, HD Enhancer & Architecture

> **Prasyarat Wajib Sebelum Memulai**: Pastikan `PHASE-01` telah selesai dan terverifikasi. Baca [`audit/README.md`](../README.md), [`audit/REMEDIATION_PLAN.md`](../REMEDIATION_PLAN.md), dan periksa bukti kode terkini untuk seluruh ID temuan fase ini di [`audit/09-audit-findings.md`](../09-audit-findings.md).

---

## 1. Tujuan dan Ruang Lingkup

Fase kedua ini menuntaskan seluruh cacat logika bisnis inti, celah ekonomi/buku besar, masalah sistemik identitas ganda WhatsApp (`@lid` vs `@s.whatsapp.net`), kualitas fitur `.hd`, aturan guard & transisi siklus hidup tenant, kepatuhan arsitektur berlapis (_Command ➔ Service ➔ Repository_), serta keamanan fitur sosial/privasi (`.tweet`, avatar bebas hak cipta, `.deletemydata` / `.purgetenant`).

---

## 2. ID Temuan yang Ditangani

| ID Temuan                                    | Severity | Judul Singkat                                                                                    |
| :------------------------------------------- | :------: | :----------------------------------------------------------------------------------------------- |
| [`LOG-01`](../09-audit-findings.md#log-01)   | Critical | Eksploitasi Pencetakan Poin/Limit Tak Terbatas di `.slot`, Race Double-Spend & Tanpa Ledger      |
| [`LOG-02`](../09-audit-findings.md#log-02)   | Critical | Pencetakan Limit Massal `.addlimitall` oleh Tenant Owner/Admin Tanpa Transaksi & Ledger          |
| [`LOG-03`](../09-audit-findings.md#log-03)   | Critical | `YOUTUBE_VIDEO_DOWNLOAD` Absen dari `HEAVY_FEATURE_COST` (`.yt` Gratis & Rusak di DM)            |
| [`LOG-04`](../09-audit-findings.md#log-04)   |   High   | `.hd` Tanpa Potong Limit, Distorsi Rasio EXIF `fit: "fill"` & Kualitas Upscale Naif              |
| [`LOG-06`](../09-audit-findings.md#log-06)   | Critical | Kegagalan Sistemik Dual-JID (`@lid` vs `@s.whatsapp.net`) Lintas 10 Modul Fitur                  |
| [`LOG-07`](../09-audit-findings.md#log-07)   | Critical | Klaim `.daily` Non-Atomik, TOCTOU `P2002` Idempotensi & Double-Settlement `.play`                |
| [`LOG-08`](../09-audit-findings.md#log-08)   |   High   | Cacat `TenantGuard`, `FeatureGuard`, Transisi Status Tenant & Invalidasi Cache                   |
| [`LOG-09`](../09-audit-findings.md#log-09)   |   High   | Cacat Sekunder Moderasi, Game/TicTacToe, Profil Hantu, Cooldown, `INT4` & Zona WIB               |
| [`ARCH-01`](../09-audit-findings.md#arch-01) |  Medium  | Pelanggaran Layering Command-ke-Repository, Duplikasi Avatar & 10 Command Tanpa Catch            |
| [`UXL-03`](../09-audit-findings.md#uxl-03)   |   High   | Risiko Impersonasi Centang Biru & Fitnah Pihak Ketiga pada `.tweet @user <teks>`                 |
| [`UXL-04`](../09-audit-findings.md#uxl-04)   |  Medium  | Retensi PII Tanpa Batas, Absennya `.deletemydata`/`.purgetenant` & Sanitasi Nomor Test           |
| [`UXL-05`](../09-audit-findings.md#uxl-05)   |  Medium  | Penggantian Foto Selebritas `assets/minji.png` & Penghapusan `src/Minji.png` + `BOT_AVATAR_PATH` |

---

## 3. File dan Modul yang Terdampak

- **Dihapus (Delete)**:
  - `src/Minji.png` (duplikat tidak terpakai)
- **Dibuat Baru (Create)**:
  - `src/services/identity/identityResolver.service.ts` (layanan kanonik resolusi `@lid` <-> `@s.whatsapp.net` & deteksi admin/bot di grup)
  - `src/services/media/avatar.service.ts` (pengambilan foto profil WA + in-memory cache fallback avatar + dukungan `BOT_AVATAR_PATH`)
  - `src/services/privacy/dataPrivacy.service.ts` & `src/commands/member/privacy.command.ts` (`.deletemydata` & `.purgetenant`)
  - `assets/default-avatar.png` (avatar vektor/ilustrasi maskot orisinal bebas hak cipta menggantikan foto selebritas `assets/minji.png`)
- **Dimodifikasi (Modify)**:
  - `src/utils/jid.ts`, `src/bot/contextBuilder.ts`
  - `src/services/member/heavyFeatureCost.ts`, `src/services/member/heavyFeatureAccess.service.ts`, `src/services/member/heavyFeatureLimit.service.ts`
  - `src/services/member/memberEconomy.service.ts`, `src/services/member/dailyClaim.service.ts`, `src/services/member/gift.service.ts`, `src/services/member/memberAdmin.service.ts`, `src/services/member/leaderboard.service.ts`
  - `src/commands/member/memberAdmin.command.ts`, `src/commands/member/gift.command.ts`, `src/commands/member/profile.command.ts`
  - `src/commands/media/hd.command.ts`, `src/services/media/imageEnhance.service.ts`, `src/config/env.ts`
  - `src/commands/media/play.command.ts`, `src/commands/media/downloader.command.ts`, `src/services/media/downloader.service.ts`
  - `src/commands/media/quoteCard.command.ts`, `src/services/media/quoteCard.service.ts`
  - `src/services/game/slotGame.service.ts`, `src/services/game/game.service.ts`, `src/services/game/interactiveReply.service.ts`, `src/commands/game/game.command.ts`
  - `src/guards/tenantGuard.ts`, `src/guards/featureGuard.ts`, `src/bot/messageHandler.ts`, `src/commands/commandRouter.ts`, `src/commands/index.ts`
  - `src/repositories/tenantGroup.repository.ts`, `src/services/tenant/superOwnerTenant.service.ts`, `src/services/tenant/tenantOwnerTransfer.service.ts`, `src/services/tenant/tenantFeature.service.ts`, `src/services/tenant/tenantPanel.service.ts`
  - `src/services/moderation/antiLink.service.ts`, `src/bot/pipeline/interceptors/antiLink.interceptor.ts`, `src/services/moderation/antiSpam.service.ts`, `src/services/moderation/antiRaid.service.ts`, `src/services/moderation/manualModeration.service.ts`, `src/services/moderation/warn.service.ts`
  - `src/services/stats/groupStats.service.ts`, `src/services/afk/afk.service.ts`, `src/services/utility/tagAll.service.ts`, `src/services/reminder/reminder.service.ts`, `src/services/welcome/welcome.service.ts`
  - `src/utils/time.ts`, `src/utils/format.ts`

---

## 4. Analisis Root Cause

1. **Fragmentasi Identitas Dual-JID (`LOG-06`)**: Baileys v6 mengirimkan `participant` / `mentionedJid` dalam bentuk `@lid` pada banyak grup modern, sedangkan sebagian kode mengasumsikan seluruh string selalu `@s.whatsapp.net`.
2. **Ketidaklengkapan Invariant Transaksi Ekonomi (`LOG-01`, `LOG-02`, `LOG-03`, `LOG-07`)**: Operasi `.slot`, `.addlimitall`, dan `.daily` ditulis di luar kontrak transaksi atomik tunggal `MemberEconomyService`, sementara `HEAVY_FEATURE_COST` memakai `Partial<>` dan `refundLimit` belum memvalidasi keberadaan `FEATURE_CONSUME`.
3. **Kesalahan Pipeline Gambar `.hd` (`LOG-04`)**: Penggunaan `metadata.width/height` pra-rotasi bersama `fit: "fill"` merusak rasio foto EXIF vertikal, dan resolusi `4096px` mengalami rekompresi agresif saat dikirim lewat `{ image }` WhatsApp.
4. **Urutan Guard & Imunitas Terbalik (`LOG-08`, `LOG-09`)**: Penghapusan pesan/sesi game dilakukan sebelum memvalidasi imunitas/kepemilikan pemain, dan perubahan pengaturan tidak memanggil `invalidateCache`.

---

## 5. Pendekatan Implementasi yang Direkomendasikan (Instruksi Presisi)

### Langkah 5.1 — Fondasi `IdentityResolverService` & Perbaikan `normalizeUserJid` (`LOG-06`)

1. Di `src/utils/jid.ts:84-92`:
   - Pada `normalizeUserJid(jid)`: jika input kosong atau berakhiran `@g.us`, `@broadcast`, `@newsletter`, atau `status@broadcast`, **kembalikan `""`** (jangan pernah mengubah JID grup menjadi `@s.whatsapp.net`!).
   - Sediakan helper `getBotCanonicalJids(socket): Set<string>` yang menormalisasi `socket.user?.id` dan `(socket.user as { lid?: string } | undefined)?.lid`.
2. Buat `src/services/identity/identityResolver.service.ts`:
   - Simpan cache metadata grup ringan (`LruCache<string, GroupMetadata>` TTL `5` menit, yang juga akan dipakai `makeWASocket.cachedGroupMetadata` pada `PHASE-03`).
   - Setiap entri `GroupParticipant` di Baileys memiliki `{ id: string, jid?: string, lid?: string, admin?: "admin" | "superadmin" | null }`.
   - Metode `resolveCanonicalUserJid(socket, groupJid, rawJidOrLid): Promise<string>`:
     - Jika `rawJidOrLid` sudah `@s.whatsapp.net`, normalisasi perangkat (`:xx`) dan kembalikan.
     - Jika `@lid`, cari di daftar partisipan grup (`p.id === raw || p.lid === raw`); apabila `p.jid` (`@s.whatsapp.net`) tersedia, kembalikan `normalizeUserJid(p.jid)`.
   - Metode `getCanonicalCandidateSet(groupMetadata, rawJid): Set<string>`: mengembalikan himpunan seluruh representasi milik user tersebut (`@s.whatsapp.net` + `@lid`).
   - Metode `isGroupMember`, `isGroupAdmin`, dan `isBotGroupAdmin` yang selalu mencocokkan seluruh kandidat `{ p.id, p.jid, p.lid }`.
3. Terapkan `IdentityResolverService` pada ke-10 modul terdampak:
   - `contextBuilder.ts`: pastikan `senderUserJid` selalu mengutamakan Phone JID `@s.whatsapp.net` dan `senderAltJids` memuat `@lid` pasangannya.
   - `gift.command.ts` & `gift.service.ts`: resolusi target ke kanonik sebelum cek `sender === recipient` (menutup celah self-gift `@lid` +10 Limit!), cek `getBotCanonicalJids(socket)`, dan validasi keanggotaan grup dengan `IdentityResolver`.
   - `groupStats.service.ts` (`.silent`): petakan setiap partisipan grup ke Phone JID kanonik + kecualikan semua JID bot, periksa terhadap `activeSet` (`p.id`, `p.jid`, `p.lid`), dan ganti teks literal `$\ge$` di baris `162` menjadi simbol Unicode `≥` atau `>=`.
   - `warn.service.ts`, `game.service.ts` (`.tictactoe`), `tenantPanel.service.ts` (`checkBotIsAdmin`), `tenantFeature.service.ts`, `reminder.service.ts`, `afk.service.ts`, dan `profile.command.ts` (pastikan `.poin`, `.daily`, dan `.profile` membaca profil kanonik yang sama).
   - `heavyFeatureAccess.service.ts`: periksa `ownerJid` terhadap seluruh `[context.senderUserJid, ...context.senderAltJids]`; dan pada DM (baris `74-86`), jika pengirim bukan owner aktif di grup mana pun, **jangan langsung menolak** — lanjutkan fallback ke resolusi profil `MEMBER` di grup aktif tempat ia tergabung!

### Langkah 5.2 — Perbaikan Atomisitas Ekonomi, `.slot`, `.addlimitall`, `.yt` & `.play` (`LOG-01`, `LOG-02`, `LOG-03`, `LOG-07`, `LOG-09`)

1. **Biaya Eksplisit `HEAVY_FEATURE_COST` (`LOG-03` & `LOG-04`)**:
   - Di `src/services/member/heavyFeatureCost.ts`: ubah deklarasi menjadi:
     ```ts
     export const HEAVY_FEATURE_COST: Record<HeavyFeatureType, number> = {
       [HeavyFeatureType.TIKTOK_DOWNLOAD]: 1,
       [HeavyFeatureType.INSTAGRAM_REELS_DOWNLOAD]: 1,
       [HeavyFeatureType.INSTAGRAM_STORY_DOWNLOAD]: 1,
       [HeavyFeatureType.YOUTUBE_VIDEO_DOWNLOAD]: 1,
       [HeavyFeatureType.HD_AI_PHOTO]: 1,
       [HeavyFeatureType.HD_AI_PHOTO_DOCUMENT]: 1,
       [HeavyFeatureType.PLAY_SONG]: 1,
       [HeavyFeatureType.SONG_LYRICS]: 1,
     };
     ```
2. **Batas Integer Aman & Guard Settlement di `MemberEconomyService` (`LOG-07`, `LOG-09`)**:
   - Tetapkan `export const MAX_SAFE_ECONOMY_INT = 1_000_000_000;` (`1 Miliar`, aman di bawah batas `INT4` PostgreSQL `2.147.483.647`). Validasi `Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_SAFE_ECONOMY_INT` dan pastikan `balanceAfter <= MAX_SAFE_ECONOMY_INT`.
   - Tangkap `Prisma.PrismaClientKnownRequestError` dengan `code === "P2002"` pada `idempotencyKey` di seluruh metode mutasi (`MemberEconomyService` & `GiftService`), lalu lempar `DuplicateOperationError`.
   - Di `consumeLimit(input)` dalam `$transaction`: periksa transaksi ber-`correlationId` sama — harus ada `FEATURE_RESERVE`, belum boleh ada `FEATURE_CONSUME`, dan **belum boleh ada `FEATURE_REFUND`** (jika sudah di-refund, lempar error agar tidak mengurangi `reservedLimit` milik proses lain).
   - Di `refundLimit(input)` dalam `$transaction`: harus ada `FEATURE_RESERVE`, belum boleh ada `FEATURE_REFUND`, dan **belum boleh ada `FEATURE_CONSUME`** (jika sudah di-consume, kembalikan status _already consumed / no-op_ secara aman).
3. **Klaim Harian Atomik (`DailyClaimService.claimDaily` — `LOG-07`)**:
   - Eksekusi seluruh alur `.daily` di dalam **satu `prisma.$transaction(async (tx) => { ... })`**:
     - Pastikan baris profil ada, lalu lakukan pembaruan kondisional atomik `tx.groupMemberProfile.updateMany({ where: { id: profile.id, OR: [{ lastDailyClaimAt: null }, { lastDailyClaimAt: { lt: startOfTodayWib } }] }, data: { ...poin, xp, opsional limit, streak, lastDailyClaimAt: now } })`.
     - Jika `count === 0`, lempar `AlreadyClaimedTodayError` (menutup 100% celah klaim ganda paralel).
     - Tulis seluruh baris `tx.groupMemberTransaction.createMany` (`DAILY_REWARD` untuk `POINT`, `EXPERIENCE`, dan `LIMIT` bila dapat bonus) di transaksi yang sama.
4. **Perombakan `.slot` Anti-Eksploitasi (`LOG-01`)**:
   - Di `src/services/game/slotGame.service.ts`:
     - **Hapus total** `isTenantOwner` dari pengecualian saldo (`isOwner` dihapus; `TENANT_OWNER` bermain menggunakan saldo poin pribadinya sendiri seperti member normal). Untuk `SUPER_OWNER`, jika saldo `< bet`, jalankan dalam mode simulasi (`netPoints = 0` saat kalah) atau tetap wajibkan saldo nyata tanpa pernah menurunkan saldo `< 0`.
     - Batasi `MAX_SLOT_BET = 100_000` poin (`AppUserError("Maksimal taruhan slot adalah 100.000 Poin.")`).
     - Jalankan seluruh putaran di dalam satu `prisma.$transaction`: lakukan _conditional debit_ `updateMany({ where: { id: profile.id, pointsBalance: { gte: bet } }, data: { pointsBalance: { increment: payout - bet }, experience: { increment: xpReward }, totalPointsEarned: { increment: payout }, totalGamesPlayed: { increment: 1 }, totalGamesWon: { increment: isWin ? 1 : 0 } } })`. Jika `count === 0`, batalkan dengan pesan saldo tidak cukup!
     - Tulis baris `GroupMemberTransaction` untuk perubahan bersih poin (`type: MemberTransactionType.GAME_REWARD`, `amount: payout - bet`, lengkap `balanceBefore` & `balanceAfter`) dan XP (`EXPERIENCE`, `GAME_REWARD`).
     - Panggil `levelUpNotifierService.checkAndNotify(...)` apabila `xpReward > 0`.
5. **Penguncian `.addlimitall` Khusus `SUPER_OWNER` (`LOG-02`)**:
   - Di `memberAdmin.command.ts`: tolak semua role selain `SUPER_OWNER` di baris pertama.
   - Di `memberAdmin.service.ts`: resolusi grup (baik dari grup langsung maupun `tenantCode` di DM), ambil profil anggota di dalam `prisma.$transaction`, perbarui `limitBalance` & `totalLimitsEarned` (dibatasi `MAX_SAFE_ECONOMY_INT`), masukkan catatan buku besar `tx.groupMemberTransaction.createMany` (`asset: LIMIT`, `type: SUPER_OWNER_ADD`) untuk setiap profil yang diperbarui, dan catat `TenantAuditLog` (`QUOTA_ADDED`). Perbaiki juga `setLimit` agar `balanceBefore` memakai nilai saldo awal aktual (`10` pada profil baru, bukan `0`).
6. **Perbaikan Alur `.play` (`LOG-07`)**:
   - Ubah `src/commands/media/play.command.ts` agar memakai helper standar `executeWithHeavyFeatureLimit` (mencakup pencarian `youtubeSearchService` + pengunduhan `playAudioService` di dalam callback eksekusi) sehingga tidak ada lagi variabel manual `reserved` yang lupa di-reset!

### Langkah 5.3 — Upgrade Fitur `.hd` (1 Limit + Pipeline _Sharp Super-Clarity_) (`LOG-04`)

1. Hapus `AI_UPSCALE_BIN` dari `src/config/env.ts` dan `.env.example`.
2. Di `src/services/media/imageEnhance.service.ts`:
   - Ubah signature menjadi `enhanceImage(inputBuffer: Buffer, options?: { documentMode?: boolean }): Promise<EnhanceImageResult>`:
     ```ts
     const MAX_STANDARD_EDGE = 2560; // Plafon resmi WhatsApp HD Photo agar tidak di-downscale ulang oleh WA
     const MAX_DOCUMENT_EDGE = 3840; // 4K UHD penuh untuk .hd doc
     ```
   - Baca metadata terlebih dahulu dengan `sharp(inputBuffer, { failOn: "error", limitInputPixels: MAX_SAFE_IMAGE_PIXELS })`:
     - Ambil dimensi efektif pasca-rotasi EXIF: `const srcWidth = metadata.autoOrient?.width ?? metadata.width;` dan `const srcHeight = metadata.autoOrient?.height ?? metadata.height;`.
     - Hitung sisi terpanjang `maxSrcEdge = Math.max(srcWidth, srcHeight)` dan target `targetMaxEdge = options?.documentMode ? MAX_DOCUMENT_EDGE : MAX_STANDARD_EDGE`.
     - Hitung skala terukur: jika gambar kecil (`maxSrcEdge < targetMaxEdge`), perbesar proporsional hingga `Math.min(targetMaxEdge, maxSrcEdge * 3)` (maksimal 3x agar piksel asli tidak pecah berlebihan); jika sudah besar, jaga pada `Math.min(maxSrcEdge, targetMaxEdge)`.
   - Jalankan pipeline ketajaman tinggi:
     ```ts
     const { data, info } = await sharp(inputBuffer, {
       failOn: "error",
       limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
     })
       .autoOrient()
       .resize({
         width: targetEdgeWidth,
         height: targetEdgeHeight,
         fit: "inside",
         kernel: "mks2021",
         fastShrinkOnLoad: false,
       })
       .clahe({
         width: 64,
         height: 64,
         maxSlope: 2,
       })
       .linear(1.04, -5)
       .modulate({
         brightness: 1.01,
         saturation: 1.08,
       })
       .sharpen({
         sigma: 0.9,
         m1: 0.35, // Tahan penajaman noise blok JPEG di area rata/kulit
         m2: 2.8, // Tajamkan garis tepi detail nyata di kanal LAB Luminance
         x1: 3.5,
         y2: 12,
         y3: 20,
       })
       .jpeg({
         quality: 95,
         mozjpeg: true,
         chromaSubsampling: "4:4:4",
         trellisQuantisation: true,
         overshootDeringing: true,
       })
       .toBuffer({ resolveWithObject: true });
     ```
   - Kembalikan `{ buffer: data, width: info.width, height: info.height }`.
3. Di `src/commands/media/hd.command.ts`:
   - Validasi keberadaan target gambar (`resolveImageMediaTarget`) dan batas `fileLength` **sebelum** mereservasi limit.
   - Bungkus pengunduhan media, `imageEnhanceService.enhanceImage(inputBuffer, { documentMode })`, dan `socket.sendMessage` di dalam `executeWithHeavyFeatureLimit` menggunakan `HeavyFeatureType.HD_AI_PHOTO_DOCUMENT` (jika `doc`) atau `HeavyFeatureType.HD_AI_PHOTO` (biaya **1 Limit**; otomatis gratis bagi `TENANT_OWNER` & `SUPER_OWNER`, dan izinkan juga `MEMBER` grup aktif di DM seperti `.tt`/`.ig`).

### Langkah 5.4 — Perbaikan `TenantGuard`, `FeatureGuard`, Lifecycle & Invalidasi Cache (`LOG-08`)

1. `src/bot/messageHandler.ts`: periksa `if (!commandRouter.has(parsedCommand.commandName)) return;` **sebelum** menjalankan `tenantGuard`, `featureGuard`, dan `rateLimitGuard` agar pesan seperti `...` atau `.999` diabaikan tanpa memicu pesan error sewa.
2. `src/guards/tenantGuard.ts`:
   - Paling awal: `if (context.role === "SUPER_OWNER") return { allowed: true };`.
   - Kedua: jika `tenant.isBlocked || tenant.status === TenantStatus.BLOCKED`, langsung kembalikan `{ allowed: false }` **tanpa `reason`** (diabaikan senyap sesuai `AGENTS.md` §3, termasuk untuk `.menu`/`.ping`).
   - Perbarui `EXPIRED_ALLOWED_COMMANDS` menjadi `new Set(["menu", "help", "ping", "whoami", "panel", "tenantstatus", "infosewa", "sewa"])`.
3. `src/guards/featureGuard.ts` & `src/services/tenant/tenantFeature.service.ts`:
   - Tambahkan ke `COMMAND_FEATURE_MAP`: `yt: "downloaderEnabled"`, `play: "downloaderEnabled"`, `lirik: "downloaderEnabled"`, `mtk: "gameEnabled"`, `math: "gameEnabled"`, `slot: "gameEnabled"`, `hidetag: "tagAllEnabled"`.
   - Tambahkan `"antidelete"`, `"goodbye"`, dan `"antiraid"` ke daftar `TENANT_FEATURE_KEYS` / `isTenantFeatureKey`.
   - Panggil `tenantFeatureService.invalidateCache(groupJid)` dan `tenantGuard.invalidateCache(groupJid)` di seluruh mutasi status tenant (`SuperOwnerTenantService`, `TenantOwnerTransferService`) dan seluruh mutasi modul (`AntiDeleteService`, `AntiRaidService`, `AntiLinkService`, `AntiSpamService`, `WelcomeService`).
4. `src/repositories/tenantGroup.repository.ts` & `src/services/tenant/superOwnerTenant.service.ts`:
   - Pada `unblockTenant`: tentukan status pemulihan secara dinamis — jika `!tenant.ownerJid` ➔ `TenantStatus.PENDING`; jika `tenant.expiresAt && tenant.expiresAt <= now` ➔ `TenantStatus.EXPIRED`; selain itu ➔ `TenantStatus.ACTIVE`.
   - Pada `extendTenant` & `setTenantExpire`: tolak dengan `AppUserError` apabila `tenant.status === PENDING` atau `!tenant.ownerJid` (arahkah Super Owner memakai `.activatetenant` terlebih dahulu).
   - Bungkus `TenantOwnerTransferService.transferOwner` di dalam `prisma.$transaction` dan hapus sesi privat pemilik lama (`TenantPrivateSession`).

### Langkah 5.5 — Perbaikan Sekunder Moderasi, Game, Profil & Zona Waktu WIB (`LOG-09`)

1. **Moderasi**:
   - `antiLink.service.ts` & `antiLink.interceptor.ts`: cek imunitas (`SUPER_OWNER`, `TENANT_OWNER`, `TENANT_ADMIN`, Admin Grup WA) **paling awal sebelum menghapus pesan**; kembalikan `{ halt: true }` saat pesan terbukti melanggar dan dihapus/di-kick.
   - `antiSpam.service.ts`: kecualikan `SUPER_OWNER` & `TENANT_OWNER` dari seluruh mode (`NORMAL`, `SOFT`, `STRICT`); baca prefix dari `env.BOT_PREFIX`; unwrap `ephemeralMessage` / `documentWithCaptionMessage` saat menghitung banjir media.
   - `antiRaid.service.ts`: abaikan grup non-`ACTIVE`/diblokir/expired; abaikan event `add` jika `update.author` adalah Admin Grup WA / `TENANT_OWNER` / `SUPER_OWNER` / Bot sendiri; panggil `ensureForGroup` sebelum `update`; pada `.grup buka|tutup`, periksa apakah bot adalah Admin Grup sebelum memanggil `groupSettingUpdate`.
   - `manualModeration.service.ts` (`.del`): izinkan Admin Grup WA aktif, dan set `fromMe` secara akurat jika pesan yang dihapus dikirim oleh bot sendiri.
   - `warn.service.ts`: panggil `ensureForGroup` di `setWarnThreshold` dan cegah _double-kick_ paralel dengan kunci in-memory per `${groupJid}:${targetJid}` atau penghapusan atomik di dalam `$transaction` sebelum eksekusi `groupParticipantsUpdate`.
2. **Mini-Games & Interactive Reply**:
   - `game.service.ts`: di `surrender` (`.nyerah`), cek terlebih dahulu apakah sesi TicTacToe ada — jika ada, **wajib validasi pemanggil adalah `player1Jid` atau `player2Jid`** sebelum menghapus sesi! Samakan teks poin kemenangan TicTacToe dengan konstanta `TICTACTOE_REWARD` (`25 / 10 / 5 Poin`), tolak tantangan ke JID bot sendiri, pisahkan penanganan command `.slot` agar tidak menyentuh `quizSession.messageId`, dan tambahkan `Set<string>` kunci grup _in-flight_ pada penyelesaian jawaban kuis / `Family100` agar dua jawaban serentak di milidetik sama tidak dibayar dua kali.
   - `interactiveReply.service.ts`: terapkan rate-limit ringan dan pastikan _swipe/reply_ hanya diperlakukan sebagai jawaban game apabila `quotedStanzaId === activeSession.messageId`!
3. **Profil, AFK, Cooldown, Downloader & WIB**:
   - `profile.command.ts:317-332`: ubah pencarian profil orang lain menjadi `getTargetProfile` (jangan `findOrCreate` profil hantu).
   - `leaderboard.service.ts`: kecualikan `SUPER_OWNER_JIDS` juga dari query penghitungan `callerPosition` agar peringkat konsisten dengan daftar top 10.
   - `afk.service.ts`: jalankan pembersihan status AFK pengirim **sebelum** mengecek daftar mention.
   - `tagAll.service.ts`: catat timestamp cooldown sebelum `await` pengiriman (rollback timestamp jika pengiriman gagal karena error).
   - `downloader.service.ts:469`: tambahkan `"--break-on-reject"` bersama `"--match-filter"` dan gunakan kode error terstruktur (`YT_DURATION_OR_SIZE_REJECTED`) alih-alih `message.includes("720")` di `downloader.command.ts:315`.
   - `src/utils/time.ts` & `src/utils/format.ts`: ubah `parseDateOnly("YYYY-MM-DD")` agar memakai akhir hari WIB (`${dateStr}T23:59:59.999+07:00`), tambahkan `timeZone: "Asia/Jakarta"` pada `formatDateId`, dan validasi `!Number.isNaN(targetDate.getTime())` serta batas maksimum durasi pengingat (`365 hari`).

### Langkah 5.6 — Refactoring Layering, `.tweet` Aman, Avatar Bebas Hak Cipta & Privasi Data (`ARCH-01`, `UXL-03`, `UXL-04`, `UXL-05`)

1. **`ARCH-01`**:
   - Hapus seluruh impor `Repository` dari `memberAdmin.command.ts` dan `profile.command.ts` (pindahkan ke `MemberAdminService` & `MemberProfileService`).
   - Buat `src/services/media/avatar.service.ts` dengan dukungan `env.BOT_AVATAR_PATH` (opsional) dan fallback `assets/default-avatar.png` ter-cache di memori. Gunakan di `welcome.service.ts`, `profile.command.ts`, `profileCard.service.ts`, dan `quoteCard.command.ts`.
   - Di `CommandRouter.dispatch()`: bungkus `await command.execute(context)` dengan `try/catch` yang mencatat `logger.error` dan mengirim balasan `await context.reply(formatUserSafeError(error, "Terjadi kendala saat memproses perintah."))`. Tambahkan juga metode `has(commandName: string): boolean`.
2. **`UXL-05`**: Hapus `src/Minji.png` dan ganti `assets/minji.png` dengan `assets/default-avatar.png` (render avatar maskot geometris bersih `512x512` PNG bebas hak cipta — perbarui referensi path default di `AvatarService`).
3. **`UXL-03` (`.tweet` Anti-Impersonasi)**:
   - Di `quoteCard.command.ts`: hapus pemakaian `@mention` untuk mengarang teks atas nama orang lain. Jika `.tweet <teks>` diketik tanpa reply, selalu gunakan nama & avatar pengirim sendiri. Jika `.tweet` digunakan sambil me-reply pesan anggota lain tanpa teks tambahan, kutip **teks asli dari pesan yang di-reply** milik pengirim pesan tersebut. Tolak kombinasi mention/teks palsu dengan penjelasan singkat etika anti-hoax.
   - Di `quoteCard.service.ts`: tambahkan baris footer halus namun terbaca jelas `GENERATED BY MINJIBOT • PARODY MOCKUP` pada SVG `.tweet`.
4. **`UXL-04` (Penghapusan Data & Sanitasi Nomor Test)**:
   - Tambahkan command `.deletemydata` (meminta konfirmasi `.deletemydata confirm`): menghapus `AfkStatus`, `TenantPrivateSession`, serta mereset/menghapus `GroupMemberProfile` (beserta `GroupMemberTransaction` cascade) milik pengirim — namun **menolak penghapusan di dalam grup apabila pengirim sedang memiliki catatan `GroupMemberWarning` aktif** di grup tersebut agar tidak dipakai mengakali hukuman _auto-kick_.
   - Tambahkan command Super Owner `.purgetenant <kode>` yang hanya mengizinkan penghapusan permanen `TenantGroup` (beserta seluruh relasi cascade) apabila statusnya `REMOVED` atau `EXPIRED`.
   - Ganti seluruh nomor telepon berformat nyata di direktori `tests/` dengan JID sintetis standar (`628000000101@s.whatsapp.net`, dst.).

---

## 6. Urutan Pengerjaan dan Dependensi

1. **Tahap 2A**: `jid.ts` + `IdentityResolverService` + `AvatarService` + penggantian aset avatar (`LOG-06`, `UXL-05`).
2. **Tahap 2B**: `HEAVY_FEATURE_COST` + `MemberEconomyService` + `DailyClaimService` + `SlotGameService` + `MemberAdminService` + `play.command.ts` (`LOG-01`, `LOG-02`, `LOG-03`, `LOG-07`).
3. **Tahap 2C**: Upgrade `ImageEnhanceService` (_Sharp Super-Clarity_) + integrasi limit `hd.command.ts` (`LOG-04`).
4. **Tahap 2D**: Perbaikan `TenantGuard`, `FeatureGuard`, `SuperOwnerTenantService`, `TenantOwnerTransferService`, dan `CommandRouter` (`LOG-08`, `ARCH-01`).
5. **Tahap 2E**: Perbaikan moderasi, mini-games, `InteractiveReplyService`, `time.ts`/`format.ts`, `.tweet`, dan `.deletemydata`/`.purgetenant` (`LOG-09`, `UXL-03`, `UXL-04`).

---

## 7. Risiko Perubahan & Mitigasi

- **Risiko 1**: Perubahan `parseDateOnly` dari UTC `23:59:59Z` ke WIB `+07:00` menggeser timestamp Unix sebesar `-7 jam`, yang dapat mematahkan asersi hardcode UTC pada unit test waktu lama.
  - _Mitigasi_: Perbarui unit test waktu agar menguji ekspektasi pukul `23:59:59 WIB` (`16:59:59.999Z`) secara eksplisit.
- **Risiko 2**: Pembatasan `.addlimitall` khusus `SUPER_OWNER` mengubah ekspektasi test lama `tests/addLimitAll.test.ts` yang sebelumnya mengizinkan `TENANT_OWNER`/`TENANT_ADMIN`.
  - _Mitigasi_: Perbarui `tests/addLimitAll.test.ts` sesuai Keputusan Produk #1 (Opsi A) bahwa `TENANT_OWNER` & `TENANT_ADMIN` wajib ditolak.

---

## 8. Test Case yang Diperlukan

1. **`tests/identityResolver.test.ts`**: Pengujian `.gift` self-mention `@lid` ditolak, transfer ke teman ber-`@lid` berhasil ke profil `@s.whatsapp.net`, `.silent` tidak menuduh member aktif ber-`@lid` sebagai sider, dan `.tictactoe` menerima balasan `"gas"` lintas `@lid`/`@s.whatsapp.net`.
2. **`tests/slotAndEconomyAtomicity.test.ts`**: `TENANT_OWNER` gagal bertaruh di atas saldo, `.slot` menulis baris `GroupMemberTransaction`, `.daily` paralel hanya sukses 1 kali, dan `refundLimit` pasca-`consumeLimit` ditolak.
3. **`tests/hdEnhancer.test.ts`**: Foto vertikal ber-EXIF `Orientation: 6` (`800x600` raw ➔ `600x800` tampil) menghasilkan output portrait (`width < height`), resolusi standar `<= 2560px` & mode `doc` `<= 3840px`, ketajaman tepi (`sharp.stats().sharpness`) meningkat nyata dibanding gambar sumber buram, serta memotong `1` Limit pada `MEMBER`.
4. **`tests/guardsAndLifecycle.test.ts`**: Grup `BLOCKED` mengabaikan `.menu` tanpa balasan, `SUPER_OWNER` menembus grup `PENDING`, `.feature game off` memblokir `.slot` & `.mtk`, dan `unblockTenant` pada grup tanpa owner kembali ke `PENDING` (bukan `ACTIVE`).
5. **`tests/tweetAndPrivacy.test.ts`**: `.tweet @target hoax` ditolak, `.deletemydata confirm` ditolak jika user punya warning aktif namun sukses jika bersih.

---

## 9. Acceptance Criteria

- [x] `grep -rn "repositories/" src/commands/` menghasilkan **0 baris** (100% patuh arsitektur berlapis `AGENTS.md` §8.1).
- [x] `HEAVY_FEATURE_COST` bertipe `Record<HeavyFeatureType, number>` tanpa `Partial<>` dan mencakup seluruh 8 fitur berat.
- [x] Seluruh mutasi saldo di `.slot`, `.daily`, `.addlimitall`, `.belilimit`, dan `.gift*` berjalan di dalam `prisma.$transaction` dan menulis baris `GroupMemberTransaction`.
- [x] `.hd` memotong `1` Limit bagi `MEMBER` (gratis bagi `TENANT_OWNER` & `SUPER_OWNER`) dan menghasilkan gambar ber-orientasi EXIF akurat dengan ketajaman `CLAHE` + `mks2021` + `4:4:4` MozJPEG.
- [x] `src/Minji.png` terhapus dan `assets/default-avatar.png` bebas hak cipta aktif digunakan.

---

## 10. Kriteria Penyelesaian Fase

1. Seluruh _Acceptance Criteria_ di atas terpenuhi.
2. `npm run build` selesai dengan `0` error.
3. Seluruh unit test yang terdampak telah disesuaikan dan lulus bersama test baru Bagian 8 (`npm test`).
4. Status ke-12 ID temuan fase ini diperbarui menjadi `[x] Completed` pada `audit/REMEDIATION_PLAN.md`.
