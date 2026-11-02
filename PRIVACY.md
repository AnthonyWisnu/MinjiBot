# Kebijakan Privasi MinjiBot (Privacy Policy)

Dokumen ini menjelaskan bagaimana **MinjiBot** mengumpulkan, memproses, menyimpan, dan melindungi data pengguna dalam ekosistem bot WhatsApp berbasis penyewaan per-grup (_multi-tenant_).

---

## 1. Prinsip Utama Privasi Data

1. **Minimisasi Data (_Data Minimization_)**: MinjiBot hanya menyimpan data yang benar-benar esensial untuk fungsi bot, manajemen sewa grup, moderasi, dan fitur ekonomi per-grup.
2. **Tanpa Penyimpanan Percakapan Pribadi**: MinjiBot **TIDAK PERNAH** mencatat, merekam, atau menyimpan teks percakapan biasa anggota grup ke dalam database persisten.
3. **Isolasi Penuh Antar-Grup (_Multi-Tenant Isolation_)**: Data member (poin, limit, XP, level) terisolasi sepenuhnya di dalam grup tempat aktivitas berlangsung.

---

## 2. Kategori Data yang Disimpan dalam Database

Data yang disimpan dalam basis data PostgreSQL MinjiBot meliputi:

| Kategori Data                    | Deskripsi                                                                                                                                                      | Tujuan Penggunaan                                                              |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| **Identitas JID**                | WhatsApp JID Pengguna (`userJid`) dan JID Grup (`groupJid`) yang telah dinormalisasi.                                                                          | Identifikasi tenant grup dan akun member per-grup.                             |
| **Profil Ekonomi Member**        | Saldo poin, saldo limit, limit ter-reservasi, perolehan XP, tanggal klaim harian terakhir, dan streak harian.                                                  | Mendukung gamifikasi, sistem limit fitur berat, dan rank tier.                 |
| **Buku Besar Transaksi**         | Riwayat mutasi saldo (`GroupMemberTransaction`) berisi aset, jenis mutasi, nominal delta, saldo sebelum/sesudah, dan correlation ID.                           | Audit jejak transaksi finansial virtual dan pemulihan limit jika proses gagal. |
| **Konfigurasi Grup & Tenant**    | Pengaturan on/off fitur (antilink, antispam, welcome, goodbye, antidelete, antiraid), pesan kustom, batas ambang warning, dan masa berlaku sewa (`expiresAt`). | Pengelolaan preferensi grup oleh Tenant Owner / Admin.                         |
| **Log Moderasi & Disiplin**      | Catatan poin peringatan member (`warnCount`, alasan peringatan terakhir).                                                                                      | Penegakan aturan grup berjenjang hingga auto-kick.                             |
| **Pengingat Grup (_Reminders_)** | Teks pengingat, target waktu jatuh tempo, pembuat pengingat, dan status pengiriman.                                                                            | Menjalankan fungsi scheduler pengingat jadwal grup.                            |
| **Status AFK**                   | Alasan AFK dan waktu mulai AFK.                                                                                                                                | Memberitahukan member lain saat anggota yang sedang AFK di-mention.            |
| **Agregat Aktivitas Chat**       | Jumlah kumulatif pesan terkirim (`messageCount`) dan waktu pesan terakhir per member. _(Tanpa teks isi pesan)_.                                                | Menampilkan statistik keaktifan grup (`.stats`, `.topaktif`, `.silent`).       |

---

## 3. Cache Memori Sementara (_In-Memory Cache_) & Anti-Delete

Fitur **Anti-Delete** MinjiBot memiliki batasan keamanan dan privasi yang ketat:

- **100% Volatil di RAM**: Pesan chat grup yang dicadangkan disimpan sementara di memori RAM server menggunakan struktur data LRU (_Least Recently Used_).
- **Kapasitas & Waktu Terbatas**: Cache dibatasi maksimal 500 pesan atau total 64 MB data per instance, dengan masa simpan (_TTL_) maksimal **2 jam**.
- **Otomatis Dihapus**: Pesan yang ditarik oleh pengirim hanya diteruskan kembali ke grup jika fitur Anti-Delete grup diaktifkan oleh admin. Seluruh pesan dalam memori otomatis lenyap saat TTL berakhir atau saat bot di-restart.
- **Perlindungan Pesan _View-Once_**: MinjiBot **tidak pernah** membongkar, membaca ulang, atau meneruskan pesan sekali lihat (_View-Once_) yang dirancang khusus oleh pengirim untuk sekali buka.

---

## 4. Pemrosesan Pihak Ketiga (_Third-Party Services_)

MinjiBot hanya meneruskan kueri ke layanan pihak ketiga saat diperintahkan secara eksplisit oleh pengguna melalui perintah tertentu:

1. **TikTok Media Downloader (`.tt`)**: URL video publik diteruskan ke API ekstraksi publik (`tikwm.com`) untuk memperoleh tautan unduhan langsung tanpa watermark.
2. **Music & Lyrics (`.play`, `.lirik`)**: Judul musik dicari melalui pencarian publik YouTube dan database lirik publik `lrclib.net`.
3. **Instagram Downloader (`.ig`)**: URL post/reel publik diproses secara lokal menggunakan alat bantu `gallery-dl` / `yt-dlp`.

MinjiBot tidak membagikan nomor telepon, identitas pribadi, atau percakapan pengguna ke layanan pihak ketiga mana pun.

---

## 5. Hak Pengguna & Penghapusan Data (_Data Rights & Deletion_)

Setiap pengguna dan penyewa memiliki hak penuh atas data mereka di MinjiBot:

1. **Penghapusan Mandiri Member (`.deletemydata`)**:
   - Anggota grup dapat menjalankan perintah `.deletemydata` di dalam grup.
   - Perintah ini menghapus seluruh profil ekonomi, riwayat transaksi, catatan warning, dan status keaktifan pengguna di grup tersebut secara permanen.
2. **Penghapusan Tenant Grup (`.purgetenant`)**:
   - Super Owner dapat menghapus seluruh data konfigurasi grup, seluruh profil member, dan riwayat transaksi suatu grup saat masa sewa dihentikan permanen.

---

## English Summary

MinjiBot is an open-source, multi-tenant WhatsApp bot. It does not store user chat messages in persistent storage. Only essential data required for group rental management, moderation, and group-scoped virtual economies (points, limits, XP) are kept in PostgreSQL. Anti-Delete cache resides exclusively in volatile server RAM with strict limits (64 MB / 2 hours max) and does not bypass View-Once messages. Third-party calls are triggered solely on-demand for public media downloading and music search. Users can delete all their group-associated data at any time using the `.deletemydata` command.
