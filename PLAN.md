# PLAN.md — MinjiBot Feature Expansion & Development Blueprint

> **Catatan Pengembang / AI Agent:**
> Dokumen ini adalah **Roadmap Eksekusi Resmi & Sumber Kebenaran** untuk pengembangan fitur baru MinjiBot (V2). Saat jendela konteks (*context window*) mengalami kompresi/reset, jadikan dokumen ini bersama `AGENTS.md` sebagai panduan mutlak agar tidak terjadi halusinasi atau degradasi kode.

---

## 1. Visi & Target Pengembangan

MinjiBot adalah bot WhatsApp berbasis **Multi-Tenant Group Rental** (sewa grup independen). Penambahan fitur pada roadmap ini berfokus pada dua pilar utama:
1. **The Engagement & Viral Studio**: Fitur hiburan visual dan audio yang paling sering di-spam dan dipakai harian oleh member grup (Stiker dengan Watermark Branding, Meme Brat, Converter, Audio FX, Sambutan Bergambar Profil).
2. **The Admin Powerhouse**: Fitur kontrol dan keamanan grup bernilai jual tinggi yang menjadi alasan utama Tenant Owner bersedia membayar sewa bulanan (Anti-Delete, Hidetag, Anti-ViewOnce).

---

## 2. Rincian Modul & Arsitektur Fitur

### 🏷️ Modul 1: Sticker Branding & Watermark Engine
Setiap stiker yang dihasilkan bot sebelumnya "polosan". Kita menambahkan injeksi metadata EXIF WebP resmi WhatsApp secara otomatis.

- **Aturan Identitas / Branding (Fixed)**:
  - **Pack Name**: `MinjiBot Official Pack`
  - **Author / Publisher**: `MinjiBot`
  - **DILARANG KERAS** menyisipkan nama personal developer (`anthony`) pada EXIF stiker publik.
- **Mekanisme Teknis**:
  - Menyuntikkan chunk `EXIF` di dalam kontainer RIFF WebP menggunakan header TIFF Little-Endian (`II*\0`) dan payload JSON standar WhatsApp:
    ```json
    {
      "sticker-pack-id": "com.minjibot.sticker",
      "sticker-pack-name": "MinjiBot Official Pack",
      "sticker-pack-publisher": "MinjiBot",
      "emojis": ["🤖", "✨"]
    }
    ```
  - Diterapkan otomatis pada seluruh generator stiker:
    1. `.s` / `.sticker` (gambar biasa & video animasi).
    2. `.smeme` (stiker meme teks atas & bawah).
    3. `.brat` (stiker teks estetika Brat).
- **Fitur Stiker Brat (`.brat <teks>`)**:
  - Menggunakan template SVG dinamis yang di-render langsung oleh **Sharp** ke format WebP 512×512 (ringan, instan <80ms, tanpa dependensi berat `node-canvas`).
  - Latar hijau limau khas Brat (`#8ACE00`), font sans-serif hitam, dan efek blur khas album Charli XCX.
- **Fitur Reverse Converter (`.toimg` & `.tovideo`)**:
  - `.toimg` ➔ Mengonversi stiker statis menjadi foto PNG (sudah ada di `sticker.service.ts`).
  - `.tovideo` ➔ Menambahkan alias dan handler resmi untuk mengonversi stiker bergerak (animasi WebP) menjadi video MP4 via FFmpeg.

---

### 🖼️ Modul 2: Welcome Photo Sambutan Member Baru
Peningkatan dari fitur sambutan teks yang sudah ada (`.welcome` & `.setwelcome`):

- **Perilaku & Alur Kerja**:
  - Ketika member baru masuk grup (event `group-participants.update` action `add`), bot tetap menggunakan kalimat sambutan kustom dari `.setwelcome` masing-masing grup (`{user}`, `{group}`).
  - Namun, pesan tidak lagi dikirim sebagai teks polosan:
    1. Bot mencoba mengambil foto profil WhatsApp member baru via `socket.profilePictureUrl(userJid, "image")`.
    2. **Jika ada foto profil**: Kirim foto profil member tersebut dengan `caption: textSambutan` dan `mentions`.
    3. **Jika tidak ada foto profil** (privasi tertutup atau kosong): Otomatis fallback mengirimkan foto profil Minji (`assets/minji.png`, foto yang sama seperti yang digunakan pada `.profile @user`) dengan `caption: textSambutan` dan `mentions`.
- **Keunggulan Teknis**:
  - Tanpa dependensi canvas berat.
  - Ringan, cepat, dan foto profil terlihat tajam langsung di WhatsApp.

---

### 🎵 Modul 3: Audio Effects Studio via FFmpeg
Memanfaatkan binary FFmpeg yang sudah aktif di server untuk manipulasi audio tanpa biaya API pihak ketiga:

- **Command & Preset Filter**:
  - **`.bass` [reply audio/vn]**: `equalizer=f=60:width_type=h:width=50:g=15` (meningkatkan frekuensi bass).
  - **`.chipmunk` [reply audio/vn]**: `asetrate=44100*1.4,aresample=44100` (suara tupai cempreng imut).
  - **`.slowed` [reply audio/vn]**: `atempo=0.82,aecho=0.8:0.9:1000:0.3` (slowed down + reverb sendu).
  - **`.nightcore` [reply audio/vn]**: `asetrate=44100*1.25,aresample=44100` (tempo dan nada dinaikkan).
  - **`.tovn` [reply audio]**: Transcode audio ke format Voice Note resmi WhatsApp (`ptt: true`, gelombang suara hijau).
- **Resource & Safety Guard**:
  - Maksimal durasi audio yang diproses: 5 menit (300 detik) untuk mencegah lonjakan CPU VPS.
  - Direktori pemrosesan menggunakan `createTempDir()` dan selalu dibersihkan di blok `finally`.

---

### 🛡️ Modul 4: The Admin Powerhouse (Daya Tarik Sewa Grup)

#### 1. Hidetag (Pengumuman Bersih)
- **Kebutuhan**: Mengirim pengumuman penting yang me-mention seluruh member tanpa mengotori ruang chat dengan deretan ratusan nomor HP.
- **Arsitektur Teknis**:
  - Command: `.hidetag <pesan pengumuman>`.
  - Mengambil daftar anggota grup dari `groupMetadata.participants`.
  - Mengirim pesan dengan parameter Baileys:
    ```typescript
    await socket.sendMessage(chatJid, {
      text: announcementMessage,
      mentions: participants.map((p) => p.id),
    });
    ```
  - Role Guard: Terkunci khusus untuk `SUPER_OWNER`, `TENANT_OWNER`, dan `TENANT_ADMIN`.

#### 2. Anti-Delete (Deteksi Pesan Ditarik)
- **Kebutuhan**: Mengungkap pesan teks atau media yang dihapus pengirim (*"This message was deleted"*).
- **Arsitektur Teknis**:
  - Event `messages.upsert`: Simpan metadata pesan dalam cache in-memory sementara berbasis LRU (maksimal 300 pesan per grup dengan TTL 1–2 jam agar RAM VPS tetap hemat).
  - Event `messages.update`: Deteksi `protocolMessage.type === 0` (REVOKE).
  - Jika ditemukan di cache, bot mengirim respon log:
    ```text
    ⚠️ [PESAN DITARIK TERDETEKSI]
    Pengirim: @628xxx
    Waktu: HH:mm WIB
    Isi Pesan: <pesan yang ditarik>
    ```
  - Konfigurasi tenant: `.antidelete [on|off]` (hanya Tenant Owner & Tenant Admin).

#### 3. Anti-ViewOnce (Penyelamat Media Sekali Lihat)
- **Kebutuhan**: Mengakses kembali foto atau video 1x lihat (*View Once*) yang dikirim ke grup.
- **Arsitektur Teknis**:
  - Deteksi pesan ber-flag `viewOnceMessageV2` atau `viewOnceMessage`.
  - Unduh buffer media via `downloadMediaMessage`.
  - Kirimkan kembali sebagai media foto/video biasa tanpa flag view once.
  - Mode konfigurasi:
    - `.antiviewonce on` ➔ Diteruskan ke grup.
    - `.antiviewonce admin` ➔ Diteruskan ke private chat Tenant Owner/Admin (menjaga privasi grup bisnis/toko).

---

## 3. Roadmap Eksekusi Bertahap

```
   ┌────────────────────────────────────────────────────────┐
   │ FASE 1: Quick Wins & Entertainment Studio [SELESAI]    │
   │ • Injeksi EXIF Watermark Stiker ("MinjiBot")           │
   │ • Fitur Stiker Brat (.brat <teks>)                     │
   │ • Peresmian Command .tovideo                           │
   │ • Modul Audio FX (.bass, .chipmunk, .slowed, .tovn)   │
   │ • Welcome Photo Sambutan (PP User / Minji Fallback)    │
   └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │ FASE 2: The Admin Powerhouse Core [SELESAI]            │
   │ • Command .hidetag <pesan> (Invisible Mentions)        │
   │ • Fitur Anti-Delete (LRU Cache in-memory + Revoke)     │
   │ • Fitur Anti-ViewOnce (Auto Recovery Media 1x Lihat)   │
   └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │ FASE 3: Testing, Verification, & VPS Deploy [AKTIF]    │
   │ • Unit Tests: 271/271 Tests Passed (100% Pass Rate)    │
   │ • Sinkronisasi Dokumentasi AGENTS.md & README.md       │
   │ • Deploy ke VPS Linux Tencent Lighthouse & PM2         │
   └────────────────────────────────────────────────────────┘
```

---

## 4. Standar Mutu & Aturan Penulisan Kode (Wajib Dipatuhi)

1. **Layering Architecture**: Command Handler (`src/commands/`) ➔ Service Layer (`src/services/`) ➔ Repository (`src/repositories/`).
2. **Kemandirian Dependency**: Prioritaskan **Sharp** dan **FFmpeg** lokal yang sudah ada. Hindari menambahkan library native berat seperti `node-canvas` yang berisiko error di VPS Linux.
3. **Pembersihan Resource**: Semua temporary file wajib menggunakan utility `createTempDir()` dan dibersihkan pada blok `finally`.
4. **Verifikasi Wajib Sebelum Commit**:
   - `npm run build` ➔ 0 error TypeScript.
   - `npm run test` ➔ 271 test suites lulus 100%.
   - Deployment otomatis melalui GitHub Actions ke VPS Tencent Lighthouse.
