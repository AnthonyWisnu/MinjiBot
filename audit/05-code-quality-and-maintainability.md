# 05 — Code Quality, Architecture Hygiene & Maintainability Audit

Dokumen ini mengevaluasi kesehatan _static analysis_ (TypeScript, ESLint, Prettier), kebersihan dependensi & artefak repositori, konsistensi pola penulisan kode antarmodul, serta tingkat sinkronisasi antara kode aktual dengan dokumentasi proyek (`AGENTS.md`, `README.md`, `PLAN.md`, `.env.example`, dan tampilan `.menu`).

---

## 1. Kegagalan Gerbang Kualitas Statis & Kebersihan Paket (`QUAL-01` — High)

### Hasil Eksekusi Verifikasi Read-Only

1. **ESLint (`npm run lint`) — GAGAL (`278` masalah: `277` error, `1` warning)**:
   - `scratch/test_web_routes.ts`: `1` _Parsing error_ karena berada di luar `tsconfig.eslint.json` namun tidak dikecualikan di `eslint.config.mjs`.
   - `src/services/moderation/antiDelete.service.ts`: `29` pelanggaran `@typescript-eslint/no-explicit-any` dan `@typescript-eslint/no-unsafe-member-access` / `no-unsafe-assignment` saat menginspeksi struktur pesan protobuf Baileys.
   - `src/` lainnya (`14` masalah): variabel tidak terpakai, _unnecessary condition_, dan tipe longgar kecil.
   - `tests/` (`234` masalah): penggunaan luas `as any` pada mock `CommandContext`, `WASocket`, dan repositori, serta fungsi `async` tanpa `await`.
2. **Prettier (`npm run format:check`) — GAGAL (`104` file tidak terformat)**:
   - Lebih dari separuh file di `src/`, `tests/`, dan `README.md` tidak mengikuti aturan `.prettierrc`, menunjukkan belum adanya penegakan CI otomatis maupun _pre-commit check_.
3. **Konfigurasi Ignore & `package.json` Belum Lengkap**:
   - `.gitignore`, `.prettierignore`, dan `eslint.config.mjs` belum mengecualikan direktori artefak pengujian `tmp-test/` dan `sessions-test/` (serta `audit/` perlu dipastikan mengikuti standar format Markdown proyek).
   - `package.json` belum mencantumkan `"engines": { "node": ">=20.11.0" }` (padahal `AGENTS.md` mensyaratkan Node.js v20+ dan kode memakai fitur modern seperti `AbortSignal.timeout`), belum memiliki skrip `"typecheck": "tsc -p tsconfig.eslint.json --noEmit"`, dan masih berstatus `"private": true` tanpa field `"license": "MIT"`.
4. **38 Paket _Extraneous_ di `node_modules` Lokal**:
   - Hasil inspeksi `npm ls --all` / `npm audit` menemukan `38` paket terpasang di `node_modules` yang tidak terdaftar di `package.json` maupun `package-lock.json` (seperti `express@5.2.1`, `chess.js@1.4.0`, `body-parser`, dll. sisa eksperimen masa lalu).

---

## 2. Kepatuhan Layering, Duplikasi Kode & Penanganan Error (`ARCH-01` — Medium)

1. **Akses Repository Langsung di Command Handler**:
   - `src/commands/member/memberAdmin.command.ts:4-5,12-13,205,211,236` (`TenantGroupRepository`, `TenantAdminRepository`).
   - `src/commands/member/profile.command.ts:10,12,250` (`TenantGroupRepository`).
   - Keduanya wajib dipindahkan ke dalam _Service Layer_ (`MemberAdminService` dan `MemberProfileService`) agar konsisten 100% dengan `AGENTS.md` §8.1.
2. **Duplikasi Pengambilan Avatar & Fallback Gambar di 4 Modul**:
   - Logika `socket.profilePictureUrl(jid, "image")` + `fetch()` + fallback file avatar lokal ditulis ulang empat kali di `profile.command.ts:109-125`, `profileCard.service.ts:249-260`, `welcome.service.ts:404-432`, dan `quoteCard.command.ts:134-158`. Menyentralisasikannya ke `src/services/media/avatar.service.ts` mengeliminasi duplikasi sekaligus menerapkan timeout HTTP, batas ukuran stream, dan in-memory cache avatar fallback di satu tempat.
3. **10 Command Handler Tanpa `try/catch` & Router Tanpa Safety Net**:
   - Handler di `superOwnerTenant.command.ts`, `tenantOwner.command.ts`, `reminder.command.ts`, dan `welcome.command.ts` tidak memiliki blok `try/catch`. Menambahkan _centralized error boundary_ di `CommandRouter.dispatch()` yang mencatat `logger.error` terstruktur dan membalas melalui `formatUserSafeError(error)` memastikan tidak ada satu pun command yang gagal secara senyap (_silent failure_) di mata pengguna.
4. **Kode Mati (_Dead Code_) yang Siap Dibersihkan**:
   - `src/utils/qrExporter.ts`, `src/services/alertServer.ts`, `src/services/telemetry.service.ts`, `scratch/`, dan duplikat gambar `src/Minji.png` (`SEC-01`, `UXL-05`).
   - Variabel lingkungan `AI_UPSCALE_BIN` (`src/config/env.ts:34`, `.env.example`) yang tidak pernah direferensikan oleh service mana pun (`LOG-04` — sedangkan `AiJobQueueService` direfaktor menjadi semaphore konkurensi media aktif pada **Phase 3**).
   - Cabang kode tak terjangkau `"Immortal [MAX]"` di `src/services/member/profileCard.service.ts:297` (karena rank tertinggi di `experienceRank.ts` adalah `Mythic`, sehingga `nextRank` sudah `null` saat mencapai `Mythic`).

---

## 3. Ketidaksinkronan Dokumentasi & Tampilan Menu terhadap Kode Aktual (`DOC-01` — High)

Ditemukan perbedaan substansial antara dokumentasi (`AGENTS.md`, `README.md`, `PLAN.md`, `.env.example`) maupun teks `.menu` (`src/services/general/menu.service.ts`) terhadap perilaku kode sumber aktual. Sesuai keputusan pemilik proyek (**Opsi A**), perilaku kode aktual dipertahankan dan seluruh dokumentasi + menu diselaraskan:

| Area Konfigurasi / Fitur                           | Tertulis di `AGENTS.md` / `README.md` / `.menu` Saat Ini                                                                                                                                                                                                                                                                | Perilaku Aktual di Kode Sumber (Acuan Benar)                                                                                                                       |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Limit Fitur Berat `TENANT_OWNER`**               | `AGENTS.md:30`: _"Tenant Owner tetap tunduk pada profil member biasa dengan saldo limit normal."_                                                                                                                                                                                                                       | `heavyFeatureAccess.service.ts:54-65`: **`skipLimit: true` (GRATIS)** bagi `TENANT_OWNER` di grup sewaannya.                                                       |
| **Tier Rank XP**                                   | `AGENTS.md:83-90` & `experienceRank.ts:12` (JSDoc): `Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster` (`0` s/d `250.000+`).                                                                                                                                                                                | `experienceRank.ts:24-32`: **`Warrior` (0), `Elite` (100), `Master` (300), `Grandmaster` (700), `Epic` (1.500), `Legend` (3.000), `Mythic` (6.000+)**.             |
| **Hadiah `.daily` & Harga `.belilimit`**           | `AGENTS.md:94,100`: Daily `100–300 Poin` + `50 XP`; Beli Limit `1.000 Poin / 1 Limit`.                                                                                                                                                                                                                                  | `dailyClaim.service.ts:12`: **`10–30 Poin`** + `50 XP` + 10% `1 Limit`; `memberEconomy.service.ts:18`: **`100 Poin / 1 Limit`**.                                   |
| **Nama Tabel & Kolom Ledger**                      | `AGENTS.md:107-110`: `MemberTransactionLedger` (`amountDelta`).                                                                                                                                                                                                                                                         | `prisma/schema.prisma:256-265`: **`GroupMemberTransaction`** (`amount`).                                                                                           |
| **Biaya & Deskripsi `.hd`**                        | `AGENTS.md:120` & `menu.service.ts:172`: `2 Limit`, _"menggunakan model AI / GFPGAN"_.                                                                                                                                                                                                                                  | Keputusan Audit: **1 Limit** (`HD_AI_PHOTO: 1`), **Sharp Super-Clarity lokal** (_HD Photo Enhancer_, bukan AI/GFPGAN).                                             |
| **Perintah Super Owner**                           | `AGENTS.md:40-53`: `.tenant activate`, `.tenant extend`, `.tenant block`.                                                                                                                                                                                                                                               | `superOwnerTenant.command.ts:24-61`: **`.activatetenant`, `.extendtenant`, `.settenantexpire`, `.blocktenant`, `.unblocktenant`, `.listtenant`, `.tenantdetail`**. |
| **Daftar Perintah di `.menu` (`menu.service.ts`)** | Mencantumkan `.delwarn` (`L88`, nama asli: `.unwarn`), `.tenantstatus` di menu publik (`L25`), kehilangan `.nyerah`, `.ceksaldo`, `.riwayat`, `.resetwarn`, `.setwarn`, `.goodbye`, `.setgoodbye`, `.antidelete`, `.antiraid`, `.grup`, serta mengklaim _"tanpa mengurangi limit"_ di beberapa baris yang tidak akurat. | Seluruh nama command di `menu.service.ts` dan panduan cepat di `tenantPanel.service.ts:75` wajib mencerminkan registri `src/commands/index.ts` secara 100% akurat. |
| **Variabel Lingkungan (`.env.example`)**           | Tidak mencantumkan `GALLERY_DL_BIN`; memuat `INTERNAL_ALERT_SECRET` & `AI_UPSCALE_BIN`; `MAX_DOWNLOAD_FILE_MB` tertulis berbeda antara `env.ts` (`100`), `.env.example` (`50`), dan teks error YouTube (`120`).                                                                                                         | Tambahkan `GALLERY_DL_BIN=gallery-dl`, `BOT_AVATAR_PATH=`, hapus variabel mati, dan seragamkan `MAX_DOWNLOAD_FILE_MB=100`.                                         |

---

## 4. Referensi Temuan Terkait

- [`QUAL-01`](./09-audit-findings.md#qual-01), [`ARCH-01`](./09-audit-findings.md#arch-01), [`DOC-01`](./09-audit-findings.md#doc-01).
