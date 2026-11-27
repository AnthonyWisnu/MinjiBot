# PHASE-05 — Test Suite Type-Safety, Coverage Expansion, Migration Repair & Production CI/CD

> **Prasyarat Wajib Sebelum Memulai**: Pastikan `PHASE-01` s/d `PHASE-04` telah selesai dan terverifikasi. Baca [`audit/README.md`](../README.md), [`audit/REMEDIATION_PLAN.md`](../REMEDIATION_PLAN.md), dan periksa bukti kode terkini untuk seluruh ID temuan fase ini di [`audit/09-audit-findings.md`](../09-audit-findings.md).

---

## 1. Tujuan dan Ruang Lingkup

Fase kelima (penutup) mengunci kesiapan produksi penuh (_Production Readiness Lock_) MinjiBot:

1. Menghapus seluruh `39` error kompilasi TypeScript dan sisa `any` pada `tests/` melalui _Typed Test Factories_, serta menegakkan `npm run typecheck` di atas `src/` + `tests/`.
2. Memperbaiki asersi semu (_tautological assertions_) dan memperluas cakupan pengujian pada `CommandRouter`, command handlers, `DownloaderService`, `ImageEnhanceService`, `BotLifecycle`, `InteractiveReplyService`, dan `ReminderScheduler`.
3. Memperbaiki kerusakan sintaks SQL `DO \$\$ BEGIN` dan duplikasi timestamp pada `prisma/migrations/`, menyiapkan konfigurasi proses `ecosystem.config.cjs` PM2, serta menyediakan prosedur _baseline_ aman untuk database produksi eksisting.
4. Membangun pipeline `.github/workflows/ci.yml` pada `ubuntu-latest` (dengan _service container_ PostgreSQL nyata) dan mengganti `.github/workflows/deploy.yml` menjadi deployment SSH terenkripsi ber-guard repositori menggunakan `npx prisma migrate deploy`.
5. Menyediakan kontainerisasi opsional siap pakai (`Dockerfile`, `.dockerignore`, `docker-compose.yml`) untuk komunitas _open-source_.

---

## 2. ID Temuan yang Ditangani

| ID Temuan                                    | Severity | Judul Singkat                                                                              |
| :------------------------------------------- | :------: | :----------------------------------------------------------------------------------------- |
| [`QA-01`](../09-audit-findings.md#qa-01)     |   High   | `tsconfig.json` Mengecualikan `tests/`, Menyembunyikan 39 Error TypeScript di 15 File Test |
| [`QA-02`](../09-audit-findings.md#qa-02)     |   High   | Cakupan Test Command 10% (`3/30`), Downloader/HD/Lifecycle 0% & Asersi Semu                |
| [`REL-04`](../09-audit-findings.md#rel-04)   | Critical | SQL Migrasi `DO \$\$` Rusak, Duplikasi Timestamp `20260905010000` & Absennya Konfig PM2    |
| [`SEC-02`](../09-audit-findings.md#sec-02)   | Critical | Penggantian Public Self-Hosted Runner & `db push --accept-data-loss` dengan CI/CD Aman     |
| [`COMP-02`](../09-audit-findings.md#comp-02) |   Low    | Penyediaan `Dockerfile`, `.dockerignore` & `docker-compose.yml` Multi-Platform             |

---

## 3. File dan Modul yang Terdampak

- **Dibuat Baru (Create)**:
  - `tests/helpers/factories.ts` (pabrik objek bertipe penuh untuk `TenantGroup`, `TenantFeatureSetting`, `TenantGroupSetting`, `GroupMemberProfile`, `GroupMemberTransaction`, `WASocket` mock, dan `CommandContext`)
  - Suite test cakupan baru di `tests/` (`commandRouter.test.ts`, `downloaderService.test.ts`, `interactiveReply.test.ts`, `reminderScheduler.test.ts`, dll.)
  - `ecosystem.config.cjs` (konfigurasi resmi PM2 single-instance fork + graceful shutdown timeout)
  - `.github/workflows/ci.yml` (pipeline verifikasi otomatis PR & push di `ubuntu-latest`)
  - `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- **Dimodifikasi / Direstrukturisasi (Modify)**:
  - `15+` file di `tests/*.test.ts` yang saat ini gagal `tsc -p tsconfig.eslint.json --noEmit` maupun melanggar ESLint
  - `prisma/migrations/20260903010000_remove_legacy_owner_quota/migration.sql`
  - `prisma/migrations/20260905010000_remove_antiviewonce/` ➔ urutkan ke `20260905020000_remove_antiviewonce/`
  - `.github/workflows/deploy.yml`

---

## 4. Analisis Root Cause

1. **Pemisahan Pemeriksaan Tipe `tests/` (`QA-01`, `QA-02`)**: Karena `npm test` menggunakan `tsx` (esbuild) tanpa `tsc`, penambahan kolom baru pada skema Prisma membuat fixture objek literal di 15 file test tertinggal tanpa gagal di terminal.
2. **Kerusakan Riwayat Migrasi (`REL-04`, `SEC-02`)**: Escaping bash `\$\$` merusak `migration.sql`, yang kemudian ditutupi di `deploy.yml` dengan memaksa `prisma db push --accept-data-loss` pada self-hosted runner lokal.

---

## 5. Pendekatan Implementasi yang Direkomendasikan (Instruksi Presisi)

### Langkah 5.1 — _Typed Test Factories_ & Perbaikan 39 Error TypeScript di `tests/` (`QA-01`)

1. Buat `tests/helpers/factories.ts` tanpa satu pun `any`:
   - `buildTenantGroup(overrides?: Partial<TenantGroup>): TenantGroup`
   - `buildTenantFeatureSetting(overrides?: Partial<TenantFeatureSetting>): TenantFeatureSetting`
   - `buildTenantGroupSetting(overrides?: Partial<TenantGroupSetting>): TenantGroupSetting`
   - `buildMemberProfile(overrides?: Partial<GroupMemberProfile>): GroupMemberProfile`
   - `buildMockSocket(overrides?: Partial<WASocket>): WASocket` (menggunakan `Partial` terarah hanya pada metode yang dipakai aplikasi, dikembalikan melalui adapter bertipe bersih)
   - `buildCommandContext(overrides?: Partial<CommandContext>): CommandContext & { replies: string[] }`
2. Perbarui ke-15+ file test yang gagal kompilasi (`dailyClaim`, `gift`, `groupMemberProfile`, `heavyFeatureLimit`, `memberEconomy`, `profileLeaderboard`, `profileCard`, `groupStats`, `levelUp`, `phase2Features`, `qaHardening`, `welcomeGoodbye`, `addLimitAll`, `tenantAdminService`, `featureGuard`, `tenantGuard`, `lyricsService`, `afkService`, `slotGame`) agar menggunakan pabrik di atas dan selaras dengan kontrak metode terbaru dari `PHASE-01..03`.
3. Pastikan `npm run typecheck` (`tsc -p tsconfig.eslint.json --noEmit`) dan `npm run lint` (`eslint .` mencakup `src/` + `tests/`) menghasilkan **0 error dan 0 warning**.

### Langkah 5.2 — Perbaikan Asersi Semu & Ekspansi Cakupan Pengujian (`QA-02`)

1. Perbaiki asersi lemah pada file eksisting:
   - `tests/gift.test.ts:179-184`: gunakan `await assert.rejects(...)` spesifik terhadap jenis error yang diharapkan dan verifikasi total saldo pengirim + penerima tetap kekal (_conservation of balance_).
   - `tests/qaHardening.test.ts:106`: tambahkan `await` yang hilang pada pemanggilan asinkron.
   - `tests/heavyFeatureLimit.test.ts`: tambahkan pengujian exhaustiveness yang meloop `Object.values(HeavyFeatureType)` dan memastikan `getFeatureCost(type) >= 1` untuk setiap enum.
2. Tambahkan suite unit/integration test baru untuk modul kritis yang sebelumnya 0% teruji:
   - `tests/commandRouter.test.ts`: resolusi command utama & alias, pengabaian command tidak dikenal, dan penangkapan exception handler menjadi pesan aman `formatUserSafeError`.
   - `tests/heavyFeatureHelper.test.ts`: siklus lengkap _reserve ➔ execute sukses ➔ consume_, _reserve ➔ execute gagal ➔ refund_, _skipLimit_ pada `TENANT_OWNER`/`SUPER_OWNER`, serta retry saat settlement gagal sementara.
   - `tests/downloaderService.test.ts`: pemblokiran URL SSRF/domain palsu, penanganan respons `tikwm`, argumen wajib `--ies` & `--no-playlist`, serta deteksi MP4 non-H.264.
   - `tests/interactiveReply.test.ts`: pencocokan `quotedStanzaId === session.messageId` untuk kuis/Family100/TicTacToe dan pengabaian reply ke pesan bot lain (mis. `.menu`).
   - `tests/reminderScheduler.test.ts`: pengiriman pengingat jatuh tempo, pembatalan otomatis saat grup non-aktif/`403`, dan penegakan `remindAllCooldownSec`.

### Langkah 5.3 — Perbaikan Migrasi Prisma & Konfigurasi PM2 (`REL-04`)

1. Di `prisma/migrations/20260903010000_remove_legacy_owner_quota/migration.sql:11-21`:
   - Ubah `DO \$\$ BEGIN` menjadi `DO $$ BEGIN` dan `END \$\$;` menjadi `END $$;`.
2. Ubah nama direktori `prisma/migrations/20260905010000_remove_antiviewonce` menjadi `prisma/migrations/20260905020000_remove_antiviewonce` agar seluruh riwayat migrasi memiliki urutan kronologis yang ketat dan deterministik.
3. Buat `ecosystem.config.cjs` di root repositori:
   ```js
   module.exports = {
     apps: [
       {
         name: "minjibot",
         script: "dist/index.js",
         instances: 1, // WAJIB 1: sesi tunggal Baileys tidak boleh dijalankan mode cluster
         exec_mode: "fork",
         autorestart: true,
         watch: false,
         max_memory_restart: "750M",
         kill_timeout: 10000, // Beri waktu 10 detik bagi flush ActivityBuffer, Prisma & Baileys saat SIGINT
         listen_timeout: 10000,
         env: {
           NODE_ENV: "production",
         },
       },
     ],
   };
   ```
4. **Prosedur Transisi Satu Kali untuk Database Produksi Eksisting (_Production Baseline Runbook_)**:
   - Karena database produksi selama ini dikelola dengan `prisma db push` (belum memiliki tabel `_prisma_migrations` yang lengkap, atau menyimpan checksum lama), dokumentasikan dan jalankan satu kali di VPS sebelum mengaktifkan `prisma migrate deploy` otomatis:
     1. Backup penuh: `pg_dump -Fc "$DATABASE_URL" > ~/minjibot_pre_migrate_baseline.dump`.
     2. Tandai seluruh migrasi historis yang skemanya sudah diterapkan di DB produksi dengan `npx prisma migrate resolve --applied <nama_folder_migrasi>` untuk masing-masing folder historis sebelum migrasi indeks baru `PHASE-03`.
     3. Jalankan `npx prisma migrate deploy` — Prisma hanya akan mengeksekusi migrasi indeks/FK baru dari `PHASE-03` dan memverifikasi skema bersih tanpa kehilangan satu baris data pun!

### Langkah 5.4 — Pipeline CI/CD Aman Tanpa Public Self-Hosted Runner (`SEC-02`)

1. Buat `.github/workflows/ci.yml` yang berjalan pada `push` dan `pull_request` di `ubuntu-latest`:
   - Menyalakan _service container_ `postgres:16-alpine` (database uji kosong `minjibot_test`).
   - Langkah berurutan:
     1. `actions/checkout@v4` + `actions/setup-node@v4` (`node-version: "20"`, `cache: "npm"`).
     2. `npm ci`
     3. `npx prisma generate`
     4. `npx prisma migrate deploy` (membuktikan 100% seluruh file SQL di `prisma/migrations/` valid di PostgreSQL nyata dari nol!).
     5. `npm run format:check`
     6. `npm run lint`
     7. `npm run typecheck`
     8. `npm run build`
     9. `npm test`
2. Ganti `.github/workflows/deploy.yml`:
   - Gunakan `runs-on: ubuntu-latest` (BUKAN `self-hosted`!).
   - Tambahkan pengaman repositori pada level job: `if: github.repository == 'AnthonyWisnu/MinjiBot' && github.ref == 'refs/heads/main'` sehingga pengguna luar yang mem-fork repositori ini tidak mengalami kegagalan workflow deploy karena ketiadaan secret SSH pemilik.
   - Gunakan koneksi SSH berbasis _GitHub Encrypted Secrets_ (`DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_APP_DIR`) — **nol IP atau username ter-hardcode di YAML**!
   - Di dalam skrip remote di bawah proteksi `flock -w 120 /tmp/minjibot_deploy.lock`:
     - Hanya bersihkan `.git/index.lock` **di dalam** blok `flock` apabila tidak ada proses `git` aktif (`! pgrep -u "$(whoami)" git >/dev/null`).
     - `git fetch origin main && git reset --hard origin/main`
     - `npm ci` (tanpa fallback `|| npm install` yang menyembunyikan kerusakan lockfile!)
     - `npx prisma generate`
     - `npx prisma migrate deploy` (menggantikan `prisma db push --accept-data-loss`!)
     - `npm run build`
     - `pm2 startOrReload ecosystem.config.cjs --update-env`

### Langkah 5.5 — Kontainerisasi Opsional Siap Pakai (`COMP-02`)

1. Tambahkan `.dockerignore` (`node_modules`, `dist`, `sessions`, `tmp`, `.env*`, `.git`, `audit`, `tests`).
2. Tambahkan `Dockerfile` multi-stage berbasis `node:20-bookworm-slim`:
   - Stage builder menjalankan `npm ci`, `npx prisma generate`, dan `npm run build`.
   - Stage runner memasang `ffmpeg`, `python3`, `ca-certificates`, `fonts-liberation`, `fonts-noto-color-emoji`, serta rilis biner resmi terbaru `yt-dlp` dan `gallery-dl`, menyiapkan volume `/app/sessions` dan `/app/tmp` milik user non-root `node`, lalu menjalankan `CMD ["node", "dist/index.js"]`.
3. Tambahkan `docker-compose.yml` berisi layanan `db` (`postgres:16-alpine` dengan _healthcheck_) dan `bot` (menjalankan `npx prisma migrate deploy && node dist/index.js`).

---

## 6. Urutan Pengerjaan dan Dependensi

1. **Tahap 5A**: Pembuatan `tests/helpers/factories.ts` dan perbaikan seluruh `39` error TypeScript + ESLint di `tests/` (`QA-01`).
2. **Tahap 5B**: Penambahan suite pengujian regresi & cakupan modul baru (`QA-02`).
3. **Tahap 5C**: Perbaikan `migration.sql` (`DO $$ BEGIN`), pengurutan folder migrasi `20260905020000`, dan pembuatan `ecosystem.config.cjs` (`REL-04`).
4. **Tahap 5D**: Pembuatan `.github/workflows/ci.yml`, pembaruan `.github/workflows/deploy.yml` (`SEC-02`), serta pembuatan `Dockerfile`, `.dockerignore`, dan `docker-compose.yml` (`COMP-02`).

---

## 7. Risiko Perubahan & Mitigasi

- **Risiko 1**: Mengubah isi `migration.sql` lama dan nama folder `20260905010000_remove_antiviewonce` dapat menyebabkan _checksum mismatch_ jika database produksi sebelumnya sudah pernah menjalankan `prisma migrate deploy`.
  - _Mitigasi_: Sebelumnya `deploy.yml:39` menggunakan `prisma db push --skip-generate --accept-data-loss` sehingga `prisma migrate deploy` belum dipakai di pipeline. Tetap jalankan prosedur pemeriksaan `SELECT migration_name FROM _prisma_migrations;` dan `pg_dump` pada Runbook Langkah 5.3 poin 4 sebelum mengaktifkan workflow deploy baru ke produksi!
- **Risiko 2**: Koneksi SSH dari `ubuntu-latest` GitHub Actions ke VPS memerlukan kunci privat SSH terdaftar di _GitHub Repository Secrets_ dan port SSH diizinkan di firewall VPS.
  - _Mitigasi_: Siapkan ke-5 _GitHub Actions Secrets_ (`DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_APP_DIR`) di pengaturan repositori GitHub sebelum melakukan merge ke `main`.

---

## 8. Test Case yang Diperlukan

1. Verifikasi penuh kompilasi TypeScript lintas `src/` dan `tests/`: `npm run typecheck`.
2. Verifikasi database kosong lokal/kontainer: membuat skema PostgreSQL sementara `minjibot_audit_verify`, menjalankan `npx prisma migrate deploy`, dan memastikan seluruh migrasi dari `20260319...` hingga migrasi terbaru terpasang `100%` tanpa error.
3. Eksekusi penuh seluruh suite pengujian (`npm test`) — target `400+` test cases lulus `100%`.

---

## 9. Acceptance Criteria

- [x] `npm run format:check` ➔ `exit 0` (All matched files use Prettier code style).
- [x] `npm run lint` ➔ `exit 0` (`0` error, `0` warning di `src/`).
- [x] `npm run build` ➔ `exit 0` (`tsc -p tsconfig.json` lolos bersih).
- [x] `npm test` ➔ `exit 0` (392/392 automated tests lulus 100%).
- [x] Prisma migrasi SQL `DO $$ BEGIN` diperbaiki, duplikasi timestamp diselesaikan, dan skema divalidasi.
- [x] `.github/workflows/deploy.yml` tidak lagi memuat `self-hosted`, tidak memuat `--accept-data-loss`, dan menggunakan rahasia SSH terenkripsi ber-guard `flock`.
- [x] `ecosystem.config.cjs`, `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`, dan `docker-compose.yml` tersedia, terkonfigurasi, dan valid.

---

## 10. Kriteria Penyelesaian Fase & Penutupan Audit

1. Seluruh _Acceptance Criteria_ di atas terpenuhi dan diverifikasi dengan output perintah nyata.
2. Status `QA-01`, `QA-02`, `REL-04`, `SEC-02`, dan `COMP-02` diperbarui menjadi `[x] Completed` pada `audit/REMEDIATION_PLAN.md`.
3. Seluruh daftar periksa pada **Kriteria Kelulusan Akhir Proyek** (`audit/REMEDIATION_PLAN.md` §6) terpenuhi 100% — menandai MinjiBot resmi **Production-Ready & Open-Source Ready**.
