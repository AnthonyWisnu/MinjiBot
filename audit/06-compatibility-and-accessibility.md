# 06 — Cross-Platform, Mobile Client Compatibility & Accessibility Audit

Dokumen ini mengevaluasi kompatibilitas lintas sistem operasi server (Windows pengembangan lokal vs Linux VPS produksi), kompatibilitas format media pada klien WhatsApp Mobile (Android, iOS, WhatsApp Desktop/Web), ketersediaan font untuk rendering SVG Sharp, serta status relevansi _Web Accessibility (WCAG)_ dan _SEO_.

---

## 1. Kompatibilitas Lintas OS & Klien WhatsApp Mobile (`COMP-01` — Medium)

### Bukti Kode Sumber

1. **Kerusakan Variabel Lingkungan `PATH` pada Windows (`src/services/media/playAudio.service.ts:129`)**:
   - Saat mengeksekusi `yt-dlp` untuk fitur `.play`, kode menyusun environment objek proses anak dengan:
     ```ts
     env: {
       ...process.env,
       PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ""}`,
     }
     ```
   - Pada Windows (seperti lingkungan pengembangan lokal Laragon/PowerShell), nama variabel lingkungan sistem di `process.env` sering kali bernama **`Path`** (huruf besar-kecil campuran), bukan `PATH`. Ketika sebuah objek JavaScript biasa (`{ ...process.env, PATH: ... }`) diteruskan ke `child_process.spawn`, objek tersebut kehilangan sifat _case-insensitive_ khusus milik `process.env` dan memiliki dua kunci berbeda (`Path` lama tanpa `ffmpegDir` dan `PATH` baru), sehingga pada beberapa versi Windows API / `yt-dlp` lokasi `ffmpeg` gagal ditemukan atau `Path` sistem tertimpa kosong.
   - _Perbaikan_: Temukan kunci `PATH` eksisting secara _case-insensitive_ (`Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"`), perbarui kunci tersebut tanpa menduplikasi kunci kedua.
2. **Video `.mp4` Ber-Codec VP9 / AV1 / HEVC Melewati Normalisasi H.264 (`src/services/media/downloader.service.ts:756`)**:
   - `AGENTS.md` §5 menjanjikan seluruh video dijamin memakai codec **AVC1/H.264 + AAC** agar langsung lancar diputar di WhatsApp Android & iOS tanpa layar hitam atau patah-patah.
   - Namun pada `downloader.service.ts:756` (`normalizeVideoIfNeeded`), pengecekan hanya memeriksa ekstensi nama file:
     ```ts
     if (ext === ".mp4") {
       return filePath;
     }
     ```
   - Kontainer `.mp4` modern hasil unduhan TikTok (ByteVC1/HEVC), Instagram (VP9/AV1 dalam MP4), atau fallback `yt-dlp` sering kali ber-ekstensi `.mp4` tetapi di dalamnya berisi video **HEVC (`hev1`), VP9 (`vp09`), atau AV1 (`av01`)** yang **gagal diputar (hanya keluar suara tanpa gambar)** di WhatsApp iOS dan berbagai perangkat Android menengah!
   - _Perbaikan_: Inspeksi codec video aktual pada kontainer `.mp4` (membaca _fourcc atom_ `avc1` di kotak `stsd` MP4 atau menggunakan pemeriksaan cepat `ffmpeg -i`), dan jalankan `videoNormalizeService` (`libx264 -pix_fmt yuv420p -movflags +faststart + aac`) apabila codec video bukan `h264`/`avc1`.
3. **Hardcoded `fromMe: false` Saat Mengunduh Media yang Di-Reply (`src/utils/mediaTarget.ts:46,83`)**:
   - Saat pengguna me-reply sebuah gambar/stiker/audio yang **dikirim oleh bot sendiri** (misalnya me-reply hasil `.quote` dengan `.s`, atau me-reply hasil `.tt` dengan `.bass`), `buildQuotedWebMessageInfo` memaksa `fromMe: false` dan menaruh `participant: contextInfo.participant`. Apabila Baileys harus memicu `reuploadRequest` (`socket.updateMediaMessage`) untuk media milik bot, kunci pesan yang salah (`fromMe: false`) menyebabkan kegagalan re-upload.
   - _Perbaikan_: Bandingkan `contextInfo.participant` terhadap JID/LID bot (`socket.user?.id` & `socket.user?.lid`) untuk menentukan nilai `fromMe` yang akurat.
4. **Pembatasan Nomor Telepon Khusus Indonesia `62` (`src/utils/moderationTarget.ts:44-46`)**:
   - Fungsi ekstraksi target moderasi berdasarkan nomor teks menolak nomor internasional non-`62` (seperti member ekspatriat/komunitas luar negeri `+60`, `+65`, `+1`), padahal grup WhatsApp multi-tenant dapat berisi nomor E.164 internasional (`7–15` digit).
5. **Ketergantungan Font Sistem Linux untuk SVG Sharp (`.brat`, `.smeme`, `.profile`, `.quote`, `.tweet`)**:
   - Seluruh generator visual SVG memanggil keluarga font `Arial, Helvetica, Liberation Sans, DejaVu Sans, sans-serif` dan merender emoji/karakter Unicode pada kartu. Pada instalasi minimal Ubuntu/Debian Server tanpa paket `fonts-liberation` / `fonts-dejavu-core` dan `fonts-noto-color-emoji`, `librsvg`/`fontconfig` menampilkan kotak tahu (`□□□` / _tofu glyphs_) atau metrik spasi huruf yang meleset. Kebutuhan paket sistem ini wajib didokumentasikan di `README.md` dan dibundel dalam `Dockerfile`.

---

## 2. Rekomendasi Peningkatan Portabilitas Deployment (`COMP-02` — Low / Improvement)

- **Klasifikasi**: `Improvement` (`Low`).
- Karena MinjiBot bergantung pada kombinasi Node.js 20+, PostgreSQL, `libvips` (`sharp`), `ffmpeg`, Python `yt-dlp`, Python `gallery-dl`, serta paket font sistem Linux, pengguna eksternal yang ingin melakukan _self-hosting_ dari GitHub sering mengalami kegagalan instalasi biner eksternal.
- Menyediakan `Dockerfile` multi-stage berbasis `node:20-bookworm-slim` (lengkap dengan `ffmpeg`, `python3`, `yt-dlp`, `gallery-dl`, `fonts-liberation`, `fonts-noto-color-emoji`), `.dockerignore`, dan `docker-compose.yml` (bersama kontainer `postgres:16-alpine`) pada **Phase 5** akan membuat proyek langsung _turn-key_ di platform mana pun (Linux, macOS, Windows WSL2, Railway, Fly.io, atau VPS).

---

## 3. Penilaian Web Accessibility (WCAG) & SEO (`ACC-01` — Not Applicable)

- **Klasifikasi**: `Not Applicable` (`Informational`).
- **Bukti Verifikasi**:
  - MinjiBot adalah aplikasi _headless backend_ murni yang berkomunikasi melalui protokol pesan instan WhatsApp (`@whiskeysockets/baileys`) tanpa antarmuka web publik (_zero frontend UI / zero public web pages_).
  - Satu-satunya penghasil HTML yang ditemukan di repositori adalah utilitas internal `src/utils/qrExporter.ts` dan endpoint lokal `src/services/alertServer.ts`, yang keduanya merupakan temuan keamanan kritis (`SEC-01`) dan telah diputuskan untuk **dihapus sepenuhnya pada Phase 1**.
  - Dengan demikian, standar _Web Content Accessibility Guidelines_ (WCAG 2.1/2.2 ARIA/DOM) dan _Search Engine Optimization_ (meta tags, `robots.txt`, `sitemap.xml`, OpenGraph) berstatus **Tidak Berlaku (`Not Applicable`)** pada aplikasi runtime.
  - Sebagai praktik aksesibilitas percakapan (_Conversational UX_) di WhatsApp, seluruh pesan bot tetap disarankan menjaga kontras teks pada kartu gambar (`.profile`, `.quote` — sudah menggunakan teks putih `#FFFFFF` di atas latar gelap `#0F172A`, rasio kontras `> 15:1`) dan menyertakan teks caption informatif pendamping media.

---

## 4. Referensi Temuan Terkait

- [`COMP-01`](./09-audit-findings.md#comp-01), [`COMP-02`](./09-audit-findings.md#comp-02), [`ACC-01`](./09-audit-findings.md#acc-01).
