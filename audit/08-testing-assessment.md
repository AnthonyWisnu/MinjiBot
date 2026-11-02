# 08 — Testing Assessment & Production Readiness Gate

Dokumen ini menganalisis kondisi aktual suite pengujian otomatis MinjiBot (`38` file di `tests/`), penyebab tersembunyinya `39` error kompilasi TypeScript saat `npm test` dijalankan, kelemahan kualitas asersi pada beberapa pengujian eksisting, matriks cakupan pengujian per lapisan arsitektur, serta strategi verifikasi menuju kesiapan produksi.

---

## 1. Ilusi Kelulusan Pengujian: 39 Error TypeScript Tersembunyi di `tests/` (`QA-01` — High)

### Bukti Verifikasi Aktual

Saat audit melakukan pemeriksaan statis secara terpisah antara `tsconfig.json` dan `tsconfig.eslint.json`, ditemukan kontradiksi kritis:

- `npm run build` (`tsc -p tsconfig.json`): **LULUS (`0` error)** — karena `tsconfig.json:21` mengecualikan direktori pengujian (`"exclude": ["node_modules", "dist", "tests"]`).
- `npm test` (`tsx --test tests/**/*.test.ts`): **LULUS (`333/333` test pass)** — karena `tsx` menggunakan transpiler `esbuild` yang langsung membuang anotasi tipe TypeScript (_type stripping_) **tanpa melakukan pemeriksaan tipe sama sekali**!
- `npx tsc -p tsconfig.eslint.json --noEmit` (mencakup `src/` + `tests/`): **GAGAL (`exit code 2`) dengan `39` error TypeScript di `15` file pengujian!**

### Rincian File Pengujian yang Gagal Kompilasi TypeScript

Pergeseran kontrak tipe pada `src/` tidak diikuti pembaruan pada `tests/`, meliputi:

1. **Perubahan Kontrak `TenantGroup` / `GroupMemberProfile` / `CommandContext`**:
   - `tests/dailyClaim.test.ts`, `tests/gift.test.ts`, `tests/groupMemberProfile.test.ts`, `tests/heavyFeatureLimit.test.ts`, `tests/memberEconomy.test.ts`, `tests/profileLeaderboard.test.ts`, `tests/profileCard.test.ts`: Objek fixture kehilangan field baru pada model Prisma (`messageCount`, `lastActiveAt`, `antiDeleteEnabled`, `goodbyeEnabled`, `antiRaidEnabled`, `warnThreshold`, `warnAction`, `antiRaidThreshold`, `antiRaidWindowSec`) atau memakai argumen lama.
2. **Ketidakcocokan Signature Service & Guard**:
   - `tests/addLimitAll.test.ts`, `tests/tenantAdminService.test.ts`, `tests/featureGuard.test.ts`, `tests/tenantGuard.test.ts`, `tests/groupStats.test.ts`, `tests/levelUp.test.ts`, `tests/phase2Features.test.ts`, `tests/qaHardening.test.ts`, `tests/welcomeGoodbye.test.ts`, `tests/lyricsService.test.ts`, `tests/afkService.test.ts`, `tests/slotGame.test.ts`.

Dampak dari kondisi ini sangat berbahaya: pengujian unit dapat tetap berwarna hijau (`PASS`) di terminal meskipun memanggil fungsi dengan tipe argumen yang sudah salah atau mengembalikan objek mock yang tidak mungkin ada di runtime produksi!

---

## 2. Kelemahan Kualitas Pengujian & Cakupan Modul (`QA-02` — High)

### 2.1. Asersi Semu (_Tautological / Unawaited Assertions_)

1. **`tests/gift.test.ts:179-184`**: Pengujian bermaksud memvalidasi kasus percobaan transfer paralel/gagal, namun membungkus asersi di dalam `try { ... } catch { assert.ok(true); }` atau memvalidasi nilai mock itu sendiri tanpa memastikan mutasi saldo akhir dan baris `GroupMemberTransaction` tetap konsisten.
2. **`tests/qaHardening.test.ts:106`**: Memanggil fungsi asinkron tanpa `await` / tanpa menangkap penolakan promise secara penuh pada skenario batas.
3. **`tests/heavyFeatureLimit.test.ts:19-28`**: Menguji konstanta biaya fitur satu per satu secara selektif tanpa mengiterasi `Object.values(HeavyFeatureType)`, sehingga ketiadaan harga `YOUTUBE_VIDEO_DOWNLOAD` (`LOG-03`) tidak terdeteksi oleh unit test!

### 2.2. Matriks Cakupan Pengujian Aktual per Lapisan

| Lapisan / Domain                                          | Total Modul di `src/` | Modul Memiliki Test | Cakupan Berkas | Celah Kritis yang Belum Diuji                                                                                                                                                                                        |
| :-------------------------------------------------------- | :-------------------: | :-----------------: | :------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command Handlers & Router (`src/commands/`)**           |          30           |          3          |    **10%**     | `CommandRouter`, `downloader.command`, `hd.command`, `play.command`, `quoteCard.command`, `superOwnerTenant.command`, `moderation.command`, `game.command` belum diuji.                                              |
| **Bot Core, Pipeline & Subscribers (`src/bot/`)**         |          16           |          4          |    **25%**     | `BotLifecycle` (reconnect backoff 500 vs 401), `connection.ts`, `messageHandler.ts`, `contextBuilder.ts`, `messageRevoke.subscriber.ts` belum memiliki test terisolasi.                                              |
| **Guards (`src/guards/`)**                                |           5           |          5          |    **100%**    | Sudah ada file test, tetapi skenario grup `BLOCKED` + `isInfoCommand`, `SUPER_OWNER` di grup `PENDING`, dan mantan `TENANT_OWNER` di DM belum tercakup (`SEC-05`, `LOG-08`).                                         |
| **Media & Subprocess Services (`src/services/media/`)**   |           9           |          3          |    **33%**     | `downloader.service.ts` (SSRF/allowlist URL, fallback TikTok/IG/YT, codec normalisasi), `playAudio.service.ts`, `imageEnhance.service.ts` (rotasi EXIF & kualitas `.hd`), `videoNormalize.service.ts` **0% teruji**. |
| **Economy, Tenant, Moderation & Games (`src/services/`)** |          39           |         21          |    **54%**     | `InteractiveReplyService`, `ReminderScheduler`, `TenantOwnerTransferService`, serta skenario Dual-JID (`@lid` vs `@s.whatsapp.net`) lintas `.gift`, `.silent`, `.warn`, dan `.tictactoe` belum teruji.               |
| **Repositories (`src/repositories/`)**                    |          12           |          2          |    **17%**     | `10` dari `12` repositori belum memiliki pengujian integrasi terhadap skema/migrasi PostgreSQL nyata (menyebabkan kerusakan `migration.sql` `REL-04` lolos tanpa terdeteksi).                                        |

---

## 3. Strategi Pengujian Menuju Production-Ready (Phase 5)

Untuk mencapai standar produksi yang andal tanpa memperlambat eksekusi lokal:

1. **Wajibkan `npm run typecheck` (`tsc -p tsconfig.eslint.json --noEmit`)**: Seluruh file di `src/` dan `tests/` wajib bebas dari error TypeScript (`0` error) dan bebas dari `as any` (`npm run lint` `0` error).
2. **Bangun _Typed Test Factories_ (`tests/helpers/factories.ts`)**: Sediakan pembuat objek `createTenantGroupFixture()`, `createMemberProfileFixture()`, `createCommandContextFixture()`, dan `createMockSocket()` bertipe penuh (`Prisma.TenantGroupGetPayload<...>`, `CommandContext`) sehingga penambahan kolom baru di masa depan hanya perlu diperbarui di **1 file pabrik**, bukan di `38` file test.
3. **Suite Pengujian Regresi Berbasis Temuan Audit**:
   - Setiap temuan `Critical` dan `High` (`SEC-03..07`, `LOG-01..09`, `PERF-01..02`, `REL-01..04`) wajib memiliki minimal 1 _regression test_ otomatis yang gagal sebelum perbaikan dan lulus sesudah perbaikan.
4. **Pengujian Integrasi Migrasi Database di CI (`.github/workflows/ci.yml`)**:
   - Jalankan _service container_ `postgres:16-alpine` di GitHub Actions, eksekusi `npx prisma migrate deploy` dari nol pada database bersih untuk memverifikasi keutuhan seluruh rantai `prisma/migrations/`, lalu jalankan `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, dan `npm test`.

---

## 4. Referensi Temuan Terkait

- [`QA-01`](./09-audit-findings.md#qa-01), [`QA-02`](./09-audit-findings.md#qa-02), [`QUAL-01`](./09-audit-findings.md#qual-01), [`REL-04`](./09-audit-findings.md#rel-04).
