# MinjiBot Member Economy Refactor Authority

## Status

Dokumen ini adalah sumber aturan utama untuk refactor member economy. Selama refactor ini, setiap aturan lama di `AGENT.md`, `PLAN.md`, `DATABASE.md`, atau `TENANT_FLOW.md` yang menyatakan kuota fitur berat milik Tenant Owner, tidak ada profil member, tidak ada member limit, atau member tidak dapat membeli limit dinyatakan tidak berlaku.

Codex wajib membaca dokumen berikut sebelum mengubah kode:

1. `CODEX_REFACTOR_INSTRUCTIONS.md`
2. `REFACTOR_REQUIREMENTS.md`
3. `MEMBER_ECONOMY.md`
4. `MEMBER_DATABASE.md`
5. `MEMBER_COMMANDS.md`
6. `MEMBER_MIGRATION.md`
7. `MEMBER_TESTING.md`
8. `plans/MEMBER_ECONOMY_REFACTOR_PLAN.md`

## Tujuan

Mengganti shared quota berbasis Tenant Owner menjadi profil ekonomi member per grup tanpa menghapus sistem tenant rental.

## Aturan yang Tetap Berlaku

- Satu grup WhatsApp adalah satu Tenant Group.
- Masa aktif tenant tetap melekat pada grup.
- Tenant Owner tetap menyewa dan mengelola satu atau lebih grup.
- Tenant Admin tetap membantu pengelolaan grup.
- Feature setting, moderation, welcome, reminder, dan tenant lifecycle tetap dipertahankan.
- Semua command member economy hanya berjalan pada grup tenant aktif.
- TypeScript strict, Prisma, PostgreSQL, repository layer, service layer, pino, zod, dan aturan modular tetap berlaku.
- Jangan gunakan emoji atau em dash pada kode, dokumentasi, logger, dan pesan bot.

## Aturan Baru yang Wajib

- Profil ekonomi bersifat per grup dan diidentifikasi oleh kombinasi `groupJid` dan `userJid`.
- Setiap profil memiliki poin, limit, reserved limit, XP, statistik, dan status daily claim.
- Tenant Owner memakai profil member biasa pada setiap grup.
- Super Owner tidak memakai angka saldo tak terbatas. Bypass hanya berlaku pada command administratif.
- Semua perubahan poin, limit, reserved limit, dan XP harus melalui service transaksi.
- Command handler tidak boleh mengubah saldo atau mengakses Prisma secara langsung.
- Semua mutasi saldo wajib memiliki ledger transaction.
- Saldo poin, limit, reserved limit, dan XP tidak boleh negatif.
- Gift, purchase, reserve, consume, refund, dan reward game wajib atomik dan idempotent.
- Rank dihitung dari XP. Rank tidak menjadi sumber kebenaran yang disimpan.
- Daily claim memakai timezone `Asia/Jakarta` dan reset kalender pukul 00.00 WIB.
- Profil tetap disimpan ketika member keluar dari grup.
- Hanya Super Owner yang boleh melakukan koreksi saldo.

## Larangan Implementasi

- Jangan menggabungkan sistem baru dengan shared owner quota sebagai fallback permanen.
- Jangan menaruh business logic ekonomi di command handler atau game handler.
- Jangan menggunakan JSON file untuk saldo atau transaksi.
- Jangan mengandalkan random asli pada test.
- Jangan memberikan XP dari gift, pembelian limit, atau koreksi administratif.
- Jangan menghapus tabel owner quota sebelum seluruh caller sudah berpindah dan test lulus.
- Jangan mengerjakan seluruh refactor dalam satu perubahan besar.

## Definition of Done

- Seluruh fitur berat memotong limit profil member yang menjalankan command pada grup tersebut.
- Daily, pembelian limit, gift, reward game, profile, rank, dan leaderboard berjalan per grup.
- Tidak ada saldo negatif atau mutasi tanpa ledger.
- Tidak ada runtime reference ke `TenantOwnerQuota` setelah tahap penghapusan.
- Migration, lint, typecheck, test, build, dan Prisma validation lulus.
- Dokumentasi lama diperbarui pada tahap final agar tidak lagi bertentangan.