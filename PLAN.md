# BLUEPRINT IMPLEMENTASI: MINJIBOT WEB MINI-APP SUITE
# YouTube Stream Deck, Retro Arcade Zone, Strategy Arena, & Community Portal

Dokumen perencanaan teknis ini merinci arsitektur, bahasa desain, dan tahapan pengerjaan untuk memperluas MinjiBot menjadi platform bot WhatsApp interaktif berbasis Web App (In-App Browser).

Seluruh antarmuka web dirancang seragam mengikuti bahasa desain **"Spotify Dark Tactical System"** yang terinspirasi dari referensi visual yang disetujui (Dark Theme `#121212`, aksen hijau Spotify `#1DB954`, aksen Cyber Cyan `#00F0FF`, tipografi *JetBrains Mono* untuk status telemetri, dan kartu beveled melengkung).

---

## 1. Arsitektur Desain Visual Terpadu (Unified Design System)

Seluruh fitur (baik pemutar musik, game arcade, papan catur, soundboard, hingga papan peringkat) menggunakan modul styling terpusat agar memiliki estetika yang serasi dan profesional:

1. **Palet Warna Utama**:
   - Background Utama: Deep Onyx `#0e1015` dan Obsidian `#12151c`.
   - Card Plate: Chassis Dark `#181b24` dengan border bevel `#262b36`.
   - Aksen Primer: Spotify Green `#1DB954` (tombol utama, indikator live, active tab).
   - Aksen Sekunder: Cyber Cyan `#00F0FF` (diagnostik data, progress bar).
   - Aksen Status: Alert Amber `#FFB800` dan Danger Red `#FF385C`.
   - Tipografi: *Plus Jakarta Sans* untuk judul antarmuka dan *JetBrains Mono* untuk log terminal serta statistik skor.
2. **Komponen UI Berulang (Reusable UI Tokens)**:
   - **Tactile Header**: Ikon platform di kiri, judul instrumen, dan badge status live di kanan.
   - **Bottom Sheet Drawer**: Laci mengambang di bawah layar dengan pegangan tarik (*drag handle pill*) untuk navigasi tab yang mulus di ponsel.
   - **Diagnostic Terminal Window**: Jendela status bergaya terminal retro dengan log proses (*chunk streaming*, *engine state*, atau *game over telemetry*).

---

## 2. Cakupan Ekosistem Fitur Lengkap

### SUITE 1: Music & Media Stream Deck (Spotify Style)
1. **Spotify Search Catalog (Screenshot 1 Style)**:
   - Endpoint: `GET /player/search?q=...`
   - UI: Bar pencarian atas hijau, list 7-10 lagu dengan cover art, nama channel, durasi, match rating bintang hijau, dan kontrol paginasi.
   - Aksi: Mengetuk salah satu lagu langsung membuka pemutar video/audio.
2. **Now Playing Video Deck (Screenshot 2 Style)**:
   - Endpoint: `GET /player/:sessionId`
   - UI: Frame video 16:9, judul lagu marquee, scrubber waktu interaktif (0:00 / total), tombol kendali (Shuffle, Previous, Play/Pause lingkaran hijau besar, Next, Loop, Slider Volume).
   - Panel Diagnostik Bawah: Status WebSocket/HTTP chunk stream, metrik MIME, ukuran file (MB), total chunk, dan jendela log terminal realtime.
3. **Spotify Synced Lyrics Drawer**:
   - Integrasi langsung dengan service existing [`src/services/media/lyrics.service.ts`](file:///C:/laragon/www/bots/bot-minji/src/services/media/lyrics.service.ts) (LRCLIB).
   - Kartu lirik yang dapat digeser ke atas dari bawah pemutar, menampilkan teks lagu berlatar belakang blur transparan.
4. **Interactive Meme Soundboard (Kirim VN Langsung ke WhatsApp)**:
   - Endpoint: `GET /soundboard`
   - UI: Grid kartu tombol suara meme viral (sound effect tawa, anime, drum, vine boom, meme sound).
   - Fitur Unik Dua Arah: Setiap tombol suara memiliki tombol **"PLAY"** (dengar di browser) dan tombol **"SEND AS VN TO WA"** (memanggil API internal MinjiBot untuk langsung mengirim audio PTT ke obrolan grup WhatsApp aktif).

---

### SUITE 2: Retro Arcade Hub (Screenshot 4 Style)
Navigasi tab di bagian atas laci drawer: `[ Dino Runner ]`, `[ Snake Game ]`, `[ Block Blast ]`, `[ 2048 ]`, `[ Flappy Minji ]`.

1. **Dino Runner**:
   - Canvas 2D retro monokrom, gravitasi dinamis, rintangan kaktus & burung pterodactyl, pertambahan kecepatan bertahap, tombol sentuh bawah `[ v DUCK ]` dan `[ ^ JUMP ]`.
2. **Snake Game**:
   - Game ular klasik dengan animasi neon halus, sistem skor, dan kontrol gestur usapan jari / D-Pad sentuh.
3. **Block Blast**:
   - Papan grid 8x8, 3 pilihan polyomino shape per ronde, mekanik seret & letak (*drag & drop*), pembersihan baris & kolom dengan efek animasi kombo warna-warni.
4. **2048 Puzzle**:
   - Papan 4x4 geser angka dengan animasi transisi angka kelipatan halus, mendukung gestur swipe ponsel.
5. **Flappy Minji**:
   - Reskin spesial menggunakan aset resmi bot [`src/Minji.png`](file:///C:/laragon/www/bots/bot-minji/src/Minji.png) sebagai karakter terbang melewati celah pipa.

---

### SUITE 3: Strategy & Duel Arenas (Screenshot 3 Style)
1. **Dans Catur (Screenshot 3 Style)**:
   - Endpoint: `GET /catur/:roomId`
   - UI: Papan catur 8x8 hijau-putih standar FIDE, render bidak vektor tajam, sistem klik-pindah atau seret bidak.
   - Engine Aturan: `chess.js` (validasi gerakan legal, check, checkmate, stalemate, promosi pion, castling, en passant).
   - Mode: Player vs AI Bot (dengan pilihan tingkat kesulitan) atau Pass-and-Play duel 2 pemain.
2. **Connect Four (4 in a Row)**:
   - Endpoint: `GET /duel/connect4/:roomId`
   - UI: Grid lubang koin 7x6 warna biru gelap, animasi koin jatuh (Merah vs Kuning), deteksi kemenangan 4 koin sebaris.
3. **Tic-Tac-Toe Deluxe**:
   - Papan visual modern dengan efek garis neon menyala saat ada pemain yang berhasil membuat 3 baris tanda X atau O.

---

### SUITE 4: Community Portal & Gamifikasi Grup
Terhubung langsung ke database PostgreSQL Prisma MinjiBot:

1. **Visual Hall of Fame / Group Leaderboard Deck**:
   - Endpoint: `GET /leaderboard/:groupJid`
   - UI: Papan peringkat kaca gelap (*glassmorphism*) menampilkan kartu profil member teratas grup:
     - Top Sultan (Poin terbanyak dari tabel `GroupMemberProfile`)
     - Top Level / Experience
     - Top Gamer grup
   - Lencana visual emas, perak, dan perunggu yang elegan.
2. **Spin the Wheel (Roda Keberuntungan / Lucky Draw)**:
   - Endpoint: `GET /spin/:groupJid`
   - UI: Roda putar interaktif warna-warni berputar mulus dengan jarum penunjuk dan suara detak putaran.
   - Mode:
     - Pengundian Giveaway Acak (daftar nama otomatis diambil dari anggota aktif grup).
     - Daily Spin Reward untuk memenangkan tambahan kuota limit fitur berat.
3. **Klaim Hadiah Skor ke Akun WhatsApp**:
   - Pencapaian skor tinggi di game (misal skor 2048 tembus 2.000 atau menang catur) menghasilkan token klaim berbatas waktu untuk menambah koin/XP ke profil member via [`gameReward.service.ts`](file:///C:/laragon/www/bots/bot-minji/src/services/game/gameReward.service.ts).

---

## 3. Tahapan Pengerjaan Bertahap (Phase-by-Phase Execution Plan)

Pengerjaan dibagi ke dalam 8 sub-fase terstruktur:

### FASE 1: Fondasi Web Server & Session Manager
- Instalasi dependensi minimal: `express`, `@types/express`, `chess.js`, `@types/chess.js`.
- Konfigurasi variabel lingkungan di [`src/config/env.ts`](file:///C:/laragon/www/bots/bot-minji/src/config/env.ts):
  - `WEB_SERVER_PORT` (default: 3004)
  - `WEB_BASE_URL` (misal: `https://play.anthonywj.my.id` atau `http://localhost:3004`)
- Pembuatan service `src/services/web/webServer.service.ts` berbasis Express yang terikat erat pada lifecycle bot di [`src/bot/lifecycle.ts`](file:///C:/laragon/www/bots/bot-minji/src/bot/lifecycle.ts) (`webServer.start()` dan `webServer.stop()`).
- Pembuatan service `src/services/web/playerSession.service.ts` untuk mengelola short-lived UUID token (TTL 30 menit) dengan pembersihan otomatis.

### FASE 2: Spotify Search Catalog & Streaming Deck
- Pembuatan antarmuka pencarian `src/web/player/search.html` (Screenshot 1 style) terhubung ke [`src/services/media/youtubeSearch.service.ts`](file:///C:/laragon/www/bots/bot-minji/src/services/media/youtubeSearch.service.ts).
- Pembuatan antarmuka pemutar `src/web/player/index.html` (Screenshot 2 style) dengan seekbar, kontrol audio/video, dan jendela terminal log status chunk.
- Pembuatan service `src/services/media/youtubeStream.service.ts` untuk menyalurkan audio/video stream via HTTP Range Request dari `yt-dlp` dengan proteksi kill on disconnect.
- Integrasi drawer lirik terhubung ke [`src/services/media/lyrics.service.ts`](file:///C:/laragon/www/bots/bot-minji/src/services/media/lyrics.service.ts).

### FASE 3: Interactive Meme Soundboard (Kirim VN ke WA)
- Pembuatan antarmuka soundboard `src/web/soundboard/index.html` dengan tema gelap bertombol audio taktis.
- Endpoint internal `POST /api/soundboard/send-wa`:
  - Menerima `soundId`, `chatJid`, dan token sesi.
  - Mengirimkan file audio tersebut sebagai Voice Note PTT ke grup WhatsApp yang bersangkutan melalui Baileys `socket.sendMessage(chatJid, { audio: buffer, ptt: true })`.

### FASE 4: Arcade Hub & Solo Canvas Suite
- Pembuatan antarmuka laci mengambang `src/web/arcade/index.html` (Screenshot 4 style) dengan tab slider:
  - `src/web/arcade/dino/`: Engine Dino Runner dengan tombol sentuh Duck & Jump.
  - `src/web/arcade/snake/`: Engine Snake Retro dengan D-Pad sentuh.
  - `src/web/arcade/block-blast/`: Engine Block Blast 8x8 Grid.
  - `src/web/arcade/2048/`: Engine 2048 puzzle geser.
  - `src/web/arcade/flappy/`: Engine Flappy Minji dengan sprite avatar Minji.

### FASE 5: Strategy Arena (Dans Catur & Duel Games)
- Pembuatan antarmuka catur `src/web/catur/index.html` (Screenshot 3 style) menggunakan `chess.js` untuk aturan legal FIDE dan AI bot minimax ringan.
- Pembuatan antarmuka Connect Four `src/web/duel/connect4.html` untuk duel 2 pemain grup.
- Pembuatan antarmuka Tic-Tac-Toe Deluxe visual `src/web/duel/tictactoe.html`.

### FASE 6: Community Portal & Gamifikasi
- Pembuatan antarmuka `src/web/community/leaderboard.html`: Membaca data agregasi dari Prisma database dan merender kartu ranking mewah.
- Pembuatan antarmuka `src/web/community/spin.html`: Roda keberuntungan untuk giveaway grup dan undian harian.
- Endpoint klaim reward game `POST /api/arcade/claim-reward` yang terhubung ke [`gameReward.service.ts`](file:///C:/laragon/www/bots/bot-minji/src/services/game/gameReward.service.ts).

### FASE 7: WhatsApp Command Handlers & Interactive Buttons
- Pembuatan modul abstraksi tombol URL `src/services/whatsapp/interactiveMessage.service.ts` (`cta_url` nativeFlowMessage didampingi fallback URL link markdown rapi).
- Pendaftaran command WhatsApp baru di [`src/commands/index.ts`](file:///C:/laragon/www/bots/bot-minji/src/commands/index.ts):
  - `.ythtml <judul/link>` -> Membuka Spotify Search / Now Playing Deck.
  - `.arcade` -> Membuka Arcade Zone (Dino, Snake, Block Blast, 2048, Flappy).
  - `.catur` -> Membuka Papan Catur Dans Catur.
  - `.soundboard` -> Membuka Meme Soundboard.
  - `.spin` -> Membuka Roda Keberuntungan grup.
  - `.topweb` -> Membuka Visual Leaderboard Hall of Fame.

### FASE 8: Testing, Security Hardening, & Deployment VPS
- Pembuatan unit tests di folder `tests/`:
  - Validasi SSRF regex & penolakan URL ilegal.
  - Validasi lifecycle session store dan timeout purging.
  - Validasi validitas langkah catur legal via `chess.js`.
- Audit keamanan: Sanitasi argumen spawn CLI, proteksi proses zombie yt-dlp, rate-limiting request.
- Kompilasi build TypeScript (`npm run build`).
- Deployment ke VPS Tencent Cloud: Penambahan blok server Nginx reverse proxy SSL untuk port web MinjiBot dan reload PM2 `minjibot`.

---

## 4. Matriks Kriteria Penerimaan (Definition of Done)

- [ ] Web server Express terintegrasi dan mati-hidup selaras dengan lifecycle bot tanpa proses menggantung.
- [ ] Command `.ythtml` menyajikan tampilan pencarian dan pemutar video/audio bergaya Spotify persis Screenshot 1 & 2.
- [ ] Command `.catur` menyajikan papan catur interaktif persis Screenshot 3 dengan aturan legal penuh.
- [ ] Command `.arcade` menyajikan drawer tab Dino Runner, Snake, Block Blast, 2048, dan Flappy Minji persis Screenshot 4.
- [ ] Tombol pada Meme Soundboard berhasil memicu bot mengirim voice note langsung ke chat WhatsApp.
- [ ] Leaderboard web berhasil membaca data profil dan poin member asli dari PostgreSQL Prisma.
- [ ] Pesan WhatsApp memiliki tombol interaktif dan fallback link yang bekerja 100% di semua versi WhatsApp.
- [ ] Penggunaan RAM VPS tetap terkendali dan stabil di bawah 65% pemakaian memori.
