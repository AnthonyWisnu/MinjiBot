# MinjiBot Member Economy Requirements

## 1. Tujuan

Refactor mengubah kuota fitur berat yang sebelumnya dimiliki Tenant Owner menjadi sistem profil member per grup. Sistem tenant rental tetap dipertahankan.

## 2. Scope yang Dipertahankan

- Tenant Group dan tenant code.
- Status PENDING, ACTIVE, EXPIRED, BLOCKED, dan REMOVED.
- Masa aktif dan penyewaan per grup.
- Tenant Owner dan Tenant Admin.
- Feature setting per grup.
- Welcome, moderation, reminder, tag all, dan AFK.
- Super Owner sebagai operator bot.

## 3. Profil Member

- Profil bersifat per grup.
- Kunci unik adalah `groupJid + userJid`.
- User yang sama pada dua grup memiliki dua profil berbeda.
- Profil dibuat ketika user pertama kali memakai command ekonomi, bermain game, menerima gift, atau menerima transaksi.
- Melihat `.profile @user` tidak otomatis membuat profil.
- Profil tetap disimpan saat user keluar dan digunakan kembali saat masuk ke grup yang sama.
- Profil terhapus ketika Tenant Group dihapus permanen melalui cascade yang terkontrol.

## 4. Saldo Awal

- Poin: 0.
- Limit: 3.
- Reserved limit: 0.
- XP: 0.
- Rank: Bronze.

## 5. Poin

Poin diperoleh dari daily claim, reward game, gift, dan koreksi Super Owner. Poin dapat dipakai membeli limit dan dapat dikirim ke member lain pada grup yang sama.

## 6. Limit

Limit dipakai oleh fitur berat. Limit diperoleh dari saldo awal, bonus daily, pembelian dengan poin, gift, dan koreksi Super Owner.

## 7. XP dan Rank

- XP adalah progres permanen.
- XP tidak dapat dibelanjakan atau ditransfer.
- Gift dan pembelian tidak memberi XP.
- Rank dihitung dari XP.

## 8. Daily Claim

- Hanya di grup tenant aktif.
- Sekali per user per grup per tanggal WIB.
- Reset pukul 00.00 dengan timezone `Asia/Jakarta`.
- Selalu mendapat 100 sampai 300 poin.
- Selalu mendapat 50 XP.
- Peluang 10 persen mendapat bonus 1 limit.
- Random provider harus dapat diinjeksi untuk test.
- Streak disiapkan pada model, tetapi bonus streak boleh dikerjakan setelah core stabil.

## 9. Pembelian Limit

- Command `.belilimit <jumlah>`.
- Harga 1 limit adalah 1.000 poin.
- Jumlah harus integer positif.
- Pembelian gagal jika poin kurang.
- Pengurangan poin dan penambahan limit harus atomik.

## 10. Gift

- Command `.giftpoint @user <jumlah>` dan `.giftlimit @user <jumlah>`.
- Hanya di grup.
- Pengirim dan penerima harus participant aktif pada grup yang sama.
- Tidak boleh gift ke diri sendiri.
- Tidak ada biaya, minimum saldo tersisa, atau batas harian.
- Saldo boleh menjadi 0 tetapi tidak boleh negatif.
- Tenant Owner tetap kehilangan saldo pribadinya.
- Super Owner menggunakan command administratif, bukan gift bypass.

## 11. Fitur yang Memakai Limit

- TikTok downloader: 1 limit.
- Instagram Reels: 1 limit.
- Instagram Story: 1 limit.
- Play lagu: 1 limit.
- Lirik lagu: 1 limit.
- HD AI Photo: 2 limit.
- HD AI Photo Document: 2 limit.

Setiap fitur wajib memakai reserve, consume, dan refund.

## 12. Profile dan Leaderboard

- `.profile` melihat profil sendiri.
- `.profile @user` dapat digunakan semua member untuk melihat profil member lain pada grup yang sama.
- `.toprank` mengurutkan XP.
- `.toppoint` mengurutkan saldo poin.
- Leaderboard menampilkan 10 besar dan posisi pemanggil bila tidak masuk 10 besar.

## 13. Hak Akses

Semua member dapat memakai command ekonomi publik. Hanya Super Owner dapat menjalankan koreksi seperti add dan set poin, limit, atau XP.

## 14. Non-Goals

- Profil global lintas grup.
- Gift melalui private chat.
- Marketplace item.
- Payment gateway.
- Referral.
- Tenant Owner mencetak saldo gratis.
- XP dari transfer saldo.
- Penghapusan sistem tenant rental.

## 15. Acceptance Criteria

- User yang sama pada grup berbeda memiliki saldo terisolasi.
- Seluruh mutasi tercatat dan atomik.
- Tidak ada saldo negatif.
- Fitur berat tidak lagi membaca owner quota.
- Reward game tidak ganda saat event terulang.
- Daily mengikuti tanggal WIB, bukan timezone server.