# PHASE-04 — Static Quality Gates, Legal Compliance & Full Documentation Sync

> **Prasyarat Wajib Sebelum Memulai**: Pastikan `PHASE-01`, `PHASE-02`, dan `PHASE-03` telah selesai dan terverifikasi. Baca [`audit/README.md`](../README.md), [`audit/REMEDIATION_PLAN.md`](../REMEDIATION_PLAN.md), dan periksa bukti kode terkini untuk seluruh ID temuan fase ini di [`audit/09-audit-findings.md`](../09-audit-findings.md).

---

## 1. Tujuan dan Ruang Lingkup

Setelah seluruh perubahan keamanan, logika bisnis, dan performa stabil pada tiga fase pertama, fase keempat ini menghijaukan seluruh gerbang kualitas statis (_Static Quality Gates_), melengkapi kepatuhan hukum & privasi untuk publikasi repositori _open-source_ sekaligus operasional komunitas/sewa, serta menyelaraskan 100% dokumentasi dan tampilan menu terhadap kode aktual.

---

## 2. ID Temuan yang Ditangani

| ID Temuan                                    | Severity | Judul Singkat                                                                            |
| :------------------------------------------- | :------: | :--------------------------------------------------------------------------------------- |
| [`QUAL-01`](../09-audit-findings.md#qual-01) |   High   | 278 Masalah ESLint, 104 File Unformatted, Ignore Kurang & 38 Paket Extraneous            |
| [`DOC-01`](../09-audit-findings.md#doc-01)   |   High   | Ketidaksinkronan `AGENTS.md`, `README.md`, `PLAN.md`, `.env.example`, `.menu` & `.panel` |
| [`UXL-01`](../09-audit-findings.md#uxl-01)   |   High   | Berkas `LICENSE` MIT Tidak Ada (Link Rusak di `README.md:280`) & `"private": true`       |
| [`UXL-02`](../09-audit-findings.md#uxl-02)   |   High   | Risiko Banned Nomor WhatsApp Unofficial API (`Baileys`) Tanpa Disclaimer Operator        |

_(Serta penyelesaian dokumen transparansi privasi `PRIVACY.md` yang melengkapi implementasi teknis [`UXL-04`](../09-audit-findings.md#uxl-04) dari `PHASE-02`)._

---

## 3. File dan Modul yang Terdampak

- **Dibuat Baru (Create)**:
  - `LICENSE` (teks resmi MIT License di root repositori)
  - `PRIVACY.md` (kebijakan privasi data member, cache RAM sementara, pihak ketiga, dan hak penghapusan `.deletemydata`)
- **Dimodifikasi (Modify)**:
  - `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`
  - `src/services/moderation/antiDelete.service.ts` (eliminasi seluruh `any` & unsafe member access dengan tipe `proto.IMessage`)
  - Seluruh file di `src/` dan `tests/` yang memiliki pelanggaran ESLint / format Prettier
  - `src/services/general/menu.service.ts`, `src/services/tenant/tenantPanel.service.ts`, `src/services/member/experienceRank.ts`, `src/services/member/profileCard.service.ts`
  - `AGENTS.md`, `README.md`, `PLAN.md`, `.env.example`

---

## 4. Analisis Root Cause

1. **Akumulasi Utang Statis (`QUAL-01`)**: Tidak adanya pipeline CI yang menjalankan `npm run lint` dan `npm run format:check` membiarkan penggunaan `as any` pada struktur pesan Baileys/test dan ketidakkonsistenan format terakumulasi di `>100` berkas, serta meninggalkan `38` paket sisa eksperimen di `node_modules`.
2. **Pergeseran Dokumentasi & Menu (`DOC-01`)**: Penyesuaian konstanta ekonomi (`.daily` `10–30` poin, `.belilimit` `100` poin, rank `Warrior`..`Mythic`, gratis limit `TENANT_OWNER`) dilakukan langsung di kode sumber tanpa memperbarui `AGENTS.md`, `README.md`, maupun daftar string di `menu.service.ts`.
3. **Kelengkapan Publikasi Open-Source (`UXL-01`, `UXL-02`)**: Berkas `LICENSE`, `PRIVACY.md`, dan _disclaimer_ protokol tidak resmi WhatsApp belum dibuat sebelum repositori dibuka ke publik.

---

## 5. Pendekatan Implementasi yang Direkomendasikan (Instruksi Presisi)

### Langkah 5.1 — Konfigurasi Proyek, Ignore & Pembersihan Paket (`QUAL-01`, `UXL-01`)

1. Perbarui `package.json`:
   - Ubah `"private": false` (atau hapus `"private": true` bila siap dipublikasikan penuh) dan tambahkan `"license": "MIT"`.
   - Tambahkan `"engines": { "node": ">=20.11.0" }`.
   - Tambahkan skrip `"typecheck": "tsc -p tsconfig.eslint.json --noEmit"`.
2. Perbarui `.gitignore`, `.prettierignore`, dan `eslint.config.mjs` (`ignores`):
   - Pastikan ketiganya secara konsisten mengabaikan: `node_modules/`, `dist/`, `sessions/`, `sessions-test/`, `tmp/`, `tmp-test/`, `coverage/`, `*.log`, `.env`, `.env.*` (kecuali `!.env.example`), dan `ig_cookies*.txt`.
3. Jalankan `npm ci` untuk menyapu bersih seluruh **38 paket extraneous** (`express`, `chess.js`, dll.) dari `node_modules` sehingga pohon dependensi lokal identik 100% dengan `package-lock.json`.

### Langkah 5.2 — Perbaikan Seluruh Pelanggaran ESLint & Format Prettier (`QUAL-01`)

1. Di `src/services/moderation/antiDelete.service.ts`:
   - Ganti tipe `any` pada inspeksi pesan dengan `proto.IMessage` dari `@whiskeysockets/baileys`.
   - Gunakan _optional chaining_ bertipe ketat (`message.ephemeralMessage?.message ?? message.documentWithCaptionMessage?.message ?? message`) sehingga ke-29 error `no-explicit-any` / `no-unsafe-member-access` hilang tanpa penonaktifan aturan (`eslint-disable`).
2. Bersihkan sisa pelanggaran ESLint pada `src/` (variabel tak terpakai, `require-await`, kondisi tak perlu). _(Catatan: perbaikan penuh tipe mock pada `tests/` disinkronkan bersama `tests/helpers/factories.ts` pada transisi menuju `PHASE-05` agar tidak ada `eslint-disable` sembarangan; target akhir `npm run lint` wajib `0` error dan `0` warning)._
3. Hapus cabang mati `"Immortal [MAX]"` di `src/services/member/profileCard.service.ts:297` dan perbaiki JSDoc `src/services/member/experienceRank.ts:12`.
4. Jalankan `npm run format` (`prettier --write .`) dan pastikan `npm run format:check` menghasilkan `0` file bermasalah.

### Langkah 5.3 — Berkas Lisensi, Disclaimer WhatsApp & Kebijakan Privasi (`UXL-01`, `UXL-02`, `UXL-04`)

1. Buat berkas `LICENSE` di root repositori berisi teks standar **MIT License** (`Copyright (c) 2026 MinjiBot Contributors / Anthony Wisnu`).
2. Buat berkas `PRIVACY.md` di root repositori (dalam Bahasa Indonesia & ringkasan Inggris) yang memuat:
   - Kategori data yang disimpan (`groupJid`, `userJid` dinormalisasi, saldo poin/limit/XP, `messageCount` agregat tanpa menyimpan isi chat biasa ke database, pengingat grup, status AFK, log peringatan moderasi, dan log audit perubahan pengaturan).
   - Penjelasan cache `AntiDelete` yang **100% hanya berada di RAM volatil** (maks 2 jam / maks 64 MB, otomatis lenyap saat kadaluwarsa atau bot restart, dan tidak pernah membongkar pesan _View-Once_).
   - Transparansi pemrosesan URL/pencarian ke pihak ketiga (`tikwm.com` untuk TikTok, `lrclib.net` untuk lirik, pencarian YouTube) yang hanya dipicu saat pengguna menjalankan perintah terkait.
   - Panduan penghapusan data mandiri melalui `.deletemydata` bagi pengguna dan `.purgetenant` bagi pengelola sistem.
3. Tambahkan bagian **"Disclaimer Penting (Unofficial WhatsApp API)"** di `README.md`:
   - Jelaskan bahwa MinjiBot dibangun menggunakan `@whiskeysockets/baileys` (bukan Official WhatsApp Business API), sehingga penyalahgunaan spam/broadcast atau pemakaian berlebihan fitur sensitif (`.add`, `.tagall`) berisiko menyebabkan pemblokiran nomor oleh pihak WhatsApp/Meta. Sarankan penggunaan nomor khusus bot sekunder.

### Langkah 5.4 — Sinkronisasi Penuh Menu, `.env.example` & Dokumentasi (`DOC-01`)

1. **`src/services/general/menu.service.ts` & `src/services/tenant/tenantPanel.service.ts`**:
   - Ganti `.delwarn` menjadi `.unwarn` (nama command terdaftar yang sebenarnya).
   - Lengkapi seluruh perintah yang belum tercantum sesuai kategori perannya: `.ceksaldo`, `.riwayat`, `.nyerah`, `.deletemydata` (member); `.unwarn`, `.resetwarn`, `.setwarn`, `.goodbye`, `.setgoodbye`, `.antidelete`, `.antiraid`, `.grup` (admin/tenant owner); serta pastikan menu khusus Super Owner menampilkan `.activatetenant`, `.extendtenant`, `.settenantexpire`, `.blocktenant`, `.unblocktenant`, `.listtenant`, `.tenantdetail`, `.addlimitall`, `.purgetenant`.
   - Perbarui informasi biaya `.hd` menjadi **1 Limit** dengan deskripsi _"HD Photo Enhancer (Sharp Super-Clarity)"_ (hapus klaim AI/GFPGAN dan hapus klaim salah _"tanpa mengurangi limit"_ pada fitur yang memang memotong limit).
2. **`.env.example`**:
   - Sertakan variabel lengkap yang benar-benar dibaca `src/config/env.ts` dengan nilai contoh aman (placeholder): `DATABASE_URL`, `NODE_ENV`, `LOG_LEVEL`, `BOT_NAME`, `BOT_PREFIX`, `SESSION_DIR`, `SUPER_OWNER_JIDS`, `TEMP_DIR`, `YT_DLP_BIN`, `GALLERY_DL_BIN`, `FFMPEG_BIN`, `IG_COOKIES_FILE`, `BOT_AVATAR_PATH`, `MAX_DOWNLOAD_FILE_MB=100`, `HD_MAX_INPUT_MB=10`, `DOWNLOAD_TIMEOUT_MS=60000`, dll. Pastikan tidak ada lagi `INTERNAL_ALERT_SECRET`, `AI_UPSCALE_BIN`, atau kredensial asli.
3. **`AGENTS.md`, `README.md`, dan `PLAN.md`**:
   - Perbarui `AGENTS.md` agar 100% sesuai keputusan pemilik proyek:
     - Bagian 2 (`TENANT_OWNER`): jelaskan bahwa `TENANT_OWNER` mendapatkan fasilitas bebas limit (`skipLimit: true`) untuk fitur berat di grup aktif miliknya, namun tetap memakai saldo poin normal untuk game `.slot`.
     - Bagian 4.1 (`Tier Rank`): perbarui ke `Warrior` (`0`), `Elite` (`100`), `Master` (`300`), `Grandmaster` (`700`), `Epic` (`1.500`), `Legend` (`3.000`), `Mythic` (`6.000+`).
     - Bagian 4.2: `.daily` memberikan `10–30 Poin` + `50 XP` + peluang 10% `1 Limit`; `.belilimit` seharga `100 Poin per 1 Limit`.
     - Bagian 4.3: nama tabel buku besar yang benar adalah `GroupMemberTransaction` dengan kolom `amount`.
     - Bagian 5: `.hd` mengonsumsi **1 Limit** menggunakan pipeline _Sharp Super-Clarity_ (`mks2021` + `CLAHE` + LAB Sharpening).
     - Bagian 3 & Super Owner: gunakan nama command asli (`.activatetenant`, `.extendtenant`, `.blocktenant`, dll.).
     - Tambahkan bagian wajib **`## Audit Remediation Workflow`** (persis seperti tercantum di [`audit/REMEDIATION_PLAN.md` §4](../REMEDIATION_PLAN.md#4-aturan-wajib-ai-agent-untuk-agentsmd-audit-remediation-workflow)).
   - Perbarui `README.md` dengan prasyarat paket sistem Linux (`ffmpeg`, `yt-dlp`, `gallery-dl`, `fonts-liberation`, `fonts-noto-color-emoji`), langkah migrasi `npm run prisma:deploy`, panduan konfigurasi `.env`, tautan `LICENSE` & `PRIVACY.md`, serta disclaimer Baileys.

---

## 6. Urutan Pengerjaan dan Dependensi

1. **Tahap 4A**: Pembaruan `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, dan `npm ci` bersih.
2. **Tahap 4B**: Refactor tipe `antiDelete.service.ts` dan perbaikan pelanggaran ESLint di seluruh `src/`.
3. **Tahap 4C**: Pembuatan `LICENSE`, `PRIVACY.md`, dan pembaruan `menu.service.ts` + `tenantPanel.service.ts` + `.env.example`.
4. **Tahap 4D**: Sinkronisasi menyeluruh `AGENTS.md`, `README.md`, dan `PLAN.md`, diakhiri `npm run format`.

---

## 7. Risiko Perubahan & Mitigasi

- **Risiko**: Menjalankan `prettier --write .` menyentuh banyak baris kode sekaligus, yang dapat menyulitkan pelacakan diff logika bisnis jika digabung dengan perubahan fitur.
  - _Mitigasi_: Lakukan pemformatan massal Prettier pada commit terpisah khusus di dalam `PHASE-04` setelah seluruh logika `PHASE-01` s/d `PHASE-03` selesai diuji.

---

## 8. Test Case yang Diperlukan

1. **`tests/menuRegistryConsistency.test.ts`**: Pengujian otomatis yang mengekstrak seluruh token ber-prefix `.namacommand` dari output `menuService` (member, admin, super owner) dan `tenantPanelService`, lalu memverifikasi bahwa **100% nama command tersebut benar-benar terdaftar** di `allCommands` (`src/commands/index.ts`) — mencegah salah ketik seperti `.delwarn` selamanya!
2. **`tests/envConfig.test.ts`**: Memverifikasi bahwa seluruh variabel di `.env.example` dapat diparsing dengan bersih oleh skema Zod `src/config/env.ts`.

---

## 9. Acceptance Criteria

- [x] Berkas `LICENSE` dan `PRIVACY.md` tersedia di root repositori dan tertaut valid dari `README.md`.
- [x] `npx eslint src/` menghasilkan **0 error dan 0 warning** tanpa penyalahgunaan `eslint-disable`.
- [x] `npm run format:check` menghasilkan **0 file belum terformat**.
- [x] `npm ls` tidak lagi melaporkan satu pun paket `extraneous`.
- [x] Test konsistensi registri `.menu` lulus 100%, dan seluruh angka ekonomi/rank/command di `AGENTS.md` & `README.md` cocok dengan kode sumber.

---

## 10. Kriteria Penyelesaian Fase

1. Seluruh _Acceptance Criteria_ di atas terpenuhi.
2. `npm run build` dan `npm test` lulus `100%`.
3. Status `QUAL-01`, `DOC-01`, `UXL-01`, dan `UXL-02` diperbarui menjadi `[x] Completed` pada `audit/REMEDIATION_PLAN.md`.
