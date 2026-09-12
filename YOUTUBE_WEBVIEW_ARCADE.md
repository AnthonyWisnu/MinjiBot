# TUGAS UTAMA

Kamu bekerja langsung pada repository:

https://github.com/AnthonyWisnu/MinjiBot.git

Nama project: MinjiBot

Tujuan utama pekerjaan ini adalah mengembangkan MinjiBot agar memiliki pengalaman WebView interaktif di dalam aplikasi WhatsApp, khususnya:

1. Web Player YouTube yang dapat dibuka dari WhatsApp.
2. Streaming audio/video melalui web player.
3. Arcade berbasis HTML5/JavaScript yang dapat dibuka melalui WebView WhatsApp.
4. Game seperti Dino Runner, Block Blast, dan Chess.
5. Semua fitur harus terintegrasi dengan arsitektur MinjiBot yang sudah ada.

## ATURAN PALING PENTING

Jangan langsung coding.

Audit repository terlebih dahulu.

Jangan mengasumsikan bahwa tombol URL biasa adalah WebView.

Jangan mengklaim fitur "in-app WebView" berhasil hanya karena URL dapat diklik.

Target UX yang dimaksud adalah:

WhatsApp
    ↓
Pesan interaktif dari bot
    ↓
UI WebView / embedded web experience
    ↓
HTML + CSS + JavaScript berjalan di dalam pengalaman WhatsApp

BUKAN:

WhatsApp
    ↓
Klik URL
    ↓
Chrome / browser eksternal

Jika mekanisme WebView tidak didukung oleh versi Baileys yang sedang digunakan, cari tahu penyebabnya dan tentukan solusi yang benar sebelum melakukan implementasi.

---

# 1. AUDIT REPOSITORY TERLEBIH DAHULU

Periksa seluruh struktur project sebelum mengubah kode.

Minimal periksa:

- package.json
- tsconfig.json
- AGENTS.md
- README.md
- src/
- tests/
- konfigurasi environment
- konfigurasi Prisma
- command handler
- service layer
- media downloader
- YouTube service
- WhatsApp/Baileys connection layer
- server HTTP yang sudah ada jika tersedia
- seluruh command yang berhubungan dengan YouTube/media

Jangan membuat implementasi duplikat jika functionality yang dibutuhkan sebenarnya sudah tersedia.

Gunakan service yang sudah ada dan lakukan refactor jika diperlukan.

---

# 2. AUDIT BAILEYS

Kondisi awal repository saat ini menggunakan:

@whiskeysockets/baileys ^6.7.0

Namun bot referensi yang ingin dijadikan referensi menggunakan:

baileys ^7.0.0-rc14

Jangan langsung upgrade Baileys.

Investigasi terlebih dahulu:

1. Versi Baileys yang sedang digunakan MinjiBot.
2. Apakah versi tersebut mendukung:
   - interactiveMessage
   - nativeFlowMessage
   - nativeFlow
   - cta_url
   - WebView-related payload
   - useWebview
   - Flow
   - HTML/WebView primitive
3. Periksa type definition dan source code package yang sebenarnya ter-install.
4. Cari implementasi resmi/fork yang relevan jika fitur WebView tidak tersedia.
5. Bandingkan API Baileys 6.x dengan Baileys 7.x RC yang digunakan bot referensi.
6. Tentukan apakah upgrade Baileys diperlukan.
7. Jika upgrade diperlukan, identifikasi breaking changes yang berdampak pada MinjiBot.
8. Jangan mengganti library hanya karena versi lebih baru. Harus ada alasan teknis.

Gunakan status:

- VERIFIED
- CODE-LEVEL VERIFIED
- NOT VERIFIED
- NOT SUPPORTED

Jangan menggunakan istilah "supported" jika hanya berdasarkan asumsi.

---

# 3. BEDAKAN URL BUTTON DENGAN WEBVIEW

Ini sangat penting.

Jangan melakukan implementasi seperti:

cta_url -> https://domain/player

lalu menganggap pekerjaan selesai.

URL biasa dapat membuka browser eksternal.

Yang dicari adalah mekanisme yang menyebabkan halaman HTML dirender melalui pengalaman WebView/embedded web experience di WhatsApp.

Cari secara spesifik apakah library yang digunakan mendukung konsep seperti:

- useWebview
- WebView CTA
- rich webview
- native flow
- HTML primitive
- interactive web experience
- atau mekanisme lain yang setara.

Jika ternyata implementasi bot referensi menggunakan payload khusus atau fork Baileys tertentu, dokumentasikan payload tersebut dan alasan teknisnya.

---

# 4. GUNAKAN BOT REFERENSI SEBAGAI REFERENSI ARSITEKTUR

Bot referensi yang menjadi inspirasi memiliki dependency seperti:

- baileys ^7.0.0-rc14
- express
- ws
- axios
- puppeteer / puppeteer-core
- chess.js
- music-metadata
- sharp
- @jimp/jimp

Informasi dari pembuatnya menyebutkan:

- Express digunakan sebagai web server untuk Web Player dan beberapa halaman web.
- ws digunakan sebagai WebSocket server untuk streaming chunk audio secara real-time.
- chess.js digunakan untuk engine/aturan catur.
- music-metadata digunakan untuk metadata audio.
- sharp/Jimp digunakan untuk image processing.
- Baileys digunakan untuk komunikasi WhatsApp dan interactive message.

Jangan menyalin dependency tersebut secara membabi buta.

Tentukan dependency mana yang benar-benar diperlukan oleh MinjiBot.

---

# 5. TARGET FEATURE: YOUTUBE WEB PLAYER

Tambahkan command baru dengan konsep:

.ythtml <query>

Contoh:

.ythtml alan walker faded

atau:

.ythtml https://youtube.com/watch?v=...

Alur:

User
    ↓
.ythtml query
    ↓
YouTube search / URL parsing
    ↓
Ambil metadata video
    ↓
Bot mengirim interactive WebView message
    ↓
WhatsApp membuka WebView
    ↓
Web Player MinjiBot
    ↓
User dapat memainkan media

Jangan membuat YouTube downloader kedua.

Gunakan ulang service YouTube dan downloader yang sudah ada.

---

# 6. WEB PLAYER

Buat web player yang benar-benar usable.

Minimal memiliki:

- thumbnail
- judul video
- channel
- durasi
- play
- pause
- seek
- progress
- volume
- mute
- fullscreen jika didukung
- loading state
- buffering state
- error state
- reconnect
- informasi koneksi
- responsive mobile layout

UI harus dirancang khusus untuk mobile karena target utamanya adalah WebView WhatsApp.

Jangan membuat dashboard desktop yang dipaksa menjadi mobile.

---

# 7. STREAMING ARCHITECTURE

Investigasi dua pendekatan:

A. HTTP streaming dengan Range Request

B. WebSocket streaming menggunakan `ws`

Jangan otomatis memilih WebSocket hanya karena bot referensi menggunakannya.

Bandingkan:

- latency
- buffering
- seek
- reconnect
- resource usage
- mobile compatibility
- implementasi di browser/WebView
- concurrent users
- memory usage
- complexity

Jika HTTP Range lebih tepat untuk playback audio/video browser, gunakan HTTP Range.

Jika WebSocket memang diperlukan untuk mencapai behavior seperti referensi, implementasikan dengan benar.

Jika menggunakan WebSocket:

- buat session ID
- jangan expose filesystem path
- jangan expose command execution
- batasi ukuran chunk
- batasi koneksi
- timeout koneksi
- cleanup ketika client disconnect
- handle reconnect
- handle backpressure
- jangan menyimpan seluruh file besar di RAM

---

# 8. SECURITY STREAMING

Jangan membuat endpoint streaming yang menerima arbitrary command.

Dilarang membuat sesuatu seperti:

GET /stream?cmd=<arbitrary shell command>

Gunakan server-side validated media session.

Contoh konsep:

POST /api/player/session

Response:

{
  "sessionId": "opaque-random-id"
}

Kemudian:

GET /api/player/stream/:sessionId

Server memetakan sessionId ke metadata/media source yang sudah divalidasi.

Perhatikan:

- SSRF
- command injection
- path traversal
- arbitrary URL fetching
- arbitrary file access
- resource exhaustion
- excessive concurrent streams
- session hijacking
- expired sessions

Gunakan session yang:

- opaque
- random
- short-lived
- tidak mengandung secret
- dapat dicabut/expired

---

# 9. YT-DLP

MinjiBot sudah memiliki functionality YouTube/download.

Jangan membuat downloader baru jika service existing dapat digunakan.

Audit:

- yt-search
- yt-dlp
- downloader service
- cookies
- timeout
- max file size
- existing download limit
- existing YouTube command

Kemudian refactor agar player menggunakan service abstraction yang sama.

Tujuan:

YouTube search
    ↓
Media information service
    ↓
Media resolver
    ↓
Streaming service

Bukan:

Command A -> downloader A

Command B -> downloader B

---

# 10. ARCADE

Tambahkan command:

.arcade

Command ini membuka halaman Arcade melalui mekanisme WebView yang sama.

Minimal sediakan:

/arcade

/arcade/dino

/arcade/block-blast

/arcade/chess

Jangan membuat game sebagai command terminal.

Game harus berupa HTML/CSS/JavaScript yang dijalankan dalam WebView.

---

# 11. DINO RUNNER

Buat game Dino Runner sederhana tetapi benar-benar playable.

Fitur minimum:

- player
- ground
- obstacle
- jump
- collision detection
- score
- increasing difficulty
- game over
- restart
- touch input
- keyboard input
- responsive mobile layout

Jangan menggunakan asset copyrighted secara sembarangan.

Boleh menggunakan CSS shapes atau SVG sederhana.

---

# 12. BLOCK BLAST

Buat game Block Blast sederhana.

Fitur minimum:

- grid
- random pieces
- drag/touch placement
- valid placement detection
- row clearing
- column clearing
- score
- game over
- restart
- responsive mobile interaction

Pastikan tidak hanya berupa mockup.

Game harus playable.

---

# 13. CHESS

Gunakan chess.js yang sudah ada jika memang kompatibel.

Jangan implementasikan seluruh aturan catur secara manual.

Minimal:

- board
- legal moves
- turn management
- check
- checkmate
- stalemate
- castling
- en passant
- promotion
- restart
- touch interaction

Jika memungkinkan, pisahkan:

Chess engine

dari:

Chess UI

Jangan mencampurkan seluruh logic game dalam satu file besar.

AI chess boleh menjadi tahap berikutnya jika terlalu kompleks.

Prioritas pertama adalah permainan legal player-vs-player.

---

# 14. WEB SERVER

Gunakan Express yang sudah tersedia jika cocok dengan arsitektur project.

Pisahkan:

web/

player/

arcade/

streaming/

session/

routing/

Jangan membuat satu `server.ts` berisi seluruh logic.

Contoh struktur yang diharapkan:

src/
  web/
    server.ts
    routes/
      player.route.ts
      arcade.route.ts
      stream.route.ts
    services/
      webview.service.ts
      player-session.service.ts
      streaming.service.ts

  commands/
    media/
      ythtml.command.ts
    arcade/
      arcade.command.ts

  services/
    media/
    youtube/
    streaming/

  games/
    dino/
    block-blast/
    chess/

Sesuaikan dengan struktur repository sebenarnya.

Jangan memaksakan struktur ini jika bertentangan dengan architecture existing.

---

# 15. WHATSAPP WEBVIEW SERVICE

Buat abstraction khusus, misalnya:

WhatsAppWebViewService

Tanggung jawabnya:

- membuat URL/session
- membuat interactive message
- membuat payload WebView
- mengirim message
- menangani fallback
- mengetahui capability yang benar-benar didukung Baileys

Command tidak boleh mengetahui detail payload Baileys yang rumit.

Contoh:

ythtml command

    ↓

WhatsAppWebViewService.openPlayer(...)

Bukan:

ythtml command

    ↓

raw proto manipulation
    ↓
nativeFlowMessage
    ↓
payload panjang

---

# 16. FALLBACK

Fallback boleh disediakan.

Tetapi fallback BUKAN target utama.

Prioritas:

1. In-app WebView
2. Jika tidak tersedia pada client tertentu, berikan fallback yang jelas.

Jangan mengubah acceptance criteria menjadi "URL bisa dibuka".

Acceptance criteria tetap:

"HTML application berjalan di dalam pengalaman WebView WhatsApp."

Jika client membuka browser eksternal, tandai sebagai:

FAILED WEBVIEW ACCEPTANCE TEST

bukan:

PASSED

---

# 17. HTTPS

Karena WebView dan media streaming akan membutuhkan web server yang dapat diakses client WhatsApp, siapkan konfigurasi untuk:

development:

localhost

production:

HTTPS domain

Jangan menganggap localhost dapat diakses langsung oleh HP pengguna.

Dokumentasikan:

- PORT
- HOST
- PUBLIC_BASE_URL
- HTTPS requirement
- reverse proxy
- WebSocket path
- production deployment

Jangan memasukkan secret ke repository.

Update `.env.example`.

---

# 18. ENVIRONMENT

Jika membutuhkan konfigurasi baru, gunakan environment variable.

Contoh konsep:

WEB_PORT=
PUBLIC_BASE_URL=
WEBVIEW_SESSION_TTL=
STREAM_SESSION_TTL=
STREAM_MAX_CONCURRENT=
STREAM_TIMEOUT_MS=

Nama final sesuaikan dengan konvensi project.

Semua environment variable harus divalidasi melalui config/env layer yang sudah ada.

Jangan membaca `process.env.X` secara acak di seluruh source code.

---

# 19. ERROR HANDLING

Handle:

- YouTube tidak ditemukan
- URL invalid
- video unavailable
- downloader gagal
- cookies invalid
- stream gagal
- WebSocket disconnect
- session expired
- unsupported client
- WebView unavailable
- server offline
- game route tidak ditemukan

User harus mendapatkan pesan error yang masuk akal.

Jangan mengirim stack trace kepada user.

---

# 20. LOGGING

Gunakan logger yang sudah ada.

Log minimal:

- player session created
- player session expired
- stream started
- stream stopped
- stream failed
- websocket connected
- websocket disconnected
- WebView message sent
- WebView generation failed

Jangan log:

- WhatsApp auth credentials
- cookies
- secret token
- full private session data
- sensitive user data

---

# 21. TESTING

Tambahkan test untuk:

### WebView

- session generation
- session expiration
- invalid session
- payload generation
- unsupported capability

### Streaming

- valid session
- expired session
- invalid session
- range request
- cleanup
- concurrency limit

### YouTube

- search query
- direct URL
- unavailable video
- invalid URL

### Arcade

- Dino collision
- score
- restart

- Block Blast placement
- line clearing
- game over

- Chess legal moves
- illegal moves
- check
- checkmate
- promotion
- castling
- en passant

Tidak semua logic harus dites melalui WhatsApp langsung. Pisahkan unit test dan integration test.

---

# 22. ACCEPTANCE TEST PALING PENTING

Sebelum mengatakan feature selesai, lakukan pengujian nyata.

## Test A: YouTube

Kirim:

.ythtml <video>

Expected:

WhatsApp menampilkan interactive WebView experience.

Ketika dibuka:

Web Player tampil.

User dapat:

- play
- pause
- seek
- volume
- melihat buffering
- mendapatkan audio/video

Jika hasilnya membuka Chrome:

FAIL.

Jangan mengatakan selesai.

---

## Test B: Arcade

Kirim:

.arcade

Expected:

WhatsApp membuka Arcade dalam WebView.

User dapat memilih:

Dino

Block Blast

Chess

Game benar-benar dapat dimainkan.

Jika hanya membuka browser eksternal:

FAIL.

---

# 23. JANGAN HALUSINASI

Ini adalah aturan wajib.

Jika kamu tidak mengetahui apakah sebuah API tersedia:

jangan menebak.

Cari source code/type definition package.

Jika tidak dapat diverifikasi:

tulis:

NOT VERIFIED

Jika API tidak tersedia:

tulis:

NOT SUPPORTED

Jika hanya ditemukan pada fork tertentu:

tulis:

SUPPORTED BY FORK X

Jika berhasil dibuktikan melalui source/type:

tulis:

CODE-LEVEL VERIFIED

Jika sudah diuji pada perangkat WhatsApp nyata:

tulis:

RUNTIME VERIFIED

Jangan menggunakan istilah "sudah support WebView" hanya karena menemukan `cta_url`.

---

# 24. JANGAN LANGSUNG UPGRADE BAILEYS

Sebelum upgrade dari:

@whiskeysockets/baileys ^6.7.0

ke versi/fork lain, buat laporan:

CURRENT:

- package
- version
- API yang tersedia

TARGET:

- package
- version
- API WebView yang diperlukan

IMPACT:

- connection layer
- authentication
- message sending
- event handlers
- types
- existing commands
- media
- tests

RISKS:

- breaking changes
- auth compatibility
- protocol changes
- maintenance risk

Kemudian pilih solusi paling aman.

---

# 25. JANGAN MERUSAK FEATURE EXISTING

Setelah perubahan:

Pastikan minimal tetap berfungsi:

- WhatsApp connection
- pairing/authentication
- command handler
- existing YouTube search
- existing downloader
- existing media commands
- existing Prisma/database
- existing limits
- existing tenant/group logic
- existing logging

Jika ada feature existing yang harus diubah, jelaskan alasannya.

---

# 26. DOKUMENTASI

Update dokumentasi yang relevan.

Minimal:

README.md

.env.example

Jika architecture berubah, tambahkan/update dokumentasi architecture.

Dokumentasikan:

- cara menjalankan local
- cara menjalankan web server
- cara konfigurasi public URL
- cara menggunakan `.ythtml`
- cara menggunakan `.arcade`
- kebutuhan HTTPS
- kebutuhan reverse proxy
- WebSocket jika digunakan
- keterbatasan WhatsApp client
- fallback behavior

---

# 27. OUTPUT SEBELUM CODING

Sebelum mengubah kode, berikan audit singkat dengan format:

## CURRENT ARCHITECTURE

...

## BAILEYS CAPABILITY

...

## WEBVIEW CAPABILITY

...

## YOUTUBE ARCHITECTURE

...

## PROPOSED ARCHITECTURE

...

## REQUIRED DEPENDENCIES

...

## FILES TO CHANGE

...

## FILES TO CREATE

...

## RISKS

...

## ACCEPTANCE TEST

...

Kemudian baru implementasikan.

Jika ada blocker teknis yang membuat target WebView tidak mungkin dicapai dengan library saat ini, jangan pura-pura mengimplementasikan.

Jelaskan blocker tersebut dan pilih solusi teknis yang dapat diverifikasi.

---

# 28. IMPLEMENTASI HARUS MODULAR

Jangan membuat file monster.

Pisahkan berdasarkan responsibility.

Hindari:

- satu file 1000+ baris
- raw Baileys payload tersebar
- downloader logic bercampur dengan command
- game logic bercampur dengan HTTP route
- streaming bercampur dengan WhatsApp message handling

Gunakan service, route, controller/handler, utility, dan domain module sesuai kebutuhan.

---

# 29. PRIORITAS IMPLEMENTASI

Urutan pekerjaan:

PHASE 1
Audit repository dan Baileys.

PHASE 2
Pastikan mekanisme WebView.

PHASE 3
Implement WebView abstraction.

PHASE 4
Implement Express web server.

PHASE 5
Implement player session.

PHASE 6
Implement YouTube Web Player.

PHASE 7
Implement streaming.

PHASE 8
Implement Arcade shell.

PHASE 9
Implement Dino.

PHASE 10
Implement Block Blast.

PHASE 11
Implement Chess.

PHASE 12
Testing.

PHASE 13
Security review.

PHASE 14
Documentation.

Jangan lompat langsung ke PHASE 6 sebelum PHASE 2 selesai diverifikasi.

---

# 30. DEFINITION OF DONE

Project dianggap selesai hanya jika:

[ ] Repository existing sudah diaudit.

[ ] Baileys capability sudah diverifikasi.

[ ] Mekanisme WebView sudah diverifikasi.

[ ] `.ythtml` tersedia.

[ ] Web Player tersedia.

[ ] Streaming tersedia.

[ ] Player session aman.

[ ] `.arcade` tersedia.

[ ] Dino playable.

[ ] Block Blast playable.

[ ] Chess playable.

[ ] Existing features tidak rusak.

[ ] TypeScript build berhasil.

[ ] ESLint berhasil.

[ ] Tests berhasil.

[ ] Security review selesai.

[ ] `.env.example` diperbarui.

[ ] README diperbarui.

[ ] Acceptance test dijelaskan.

[ ] Jika runtime WhatsApp belum bisa diuji, statusnya harus dinyatakan secara eksplisit sebagai NOT RUNTIME VERIFIED.

Jangan menyatakan DONE jika acceptance test WebView belum terbukti.

---

# INSTRUKSI TERAKHIR

Jadilah engineer yang melakukan reverse engineering secara hati-hati, bukan sekadar menghasilkan kode yang terlihat benar.

Fokus utama:

WEBVIEW WHATSAPP YANG BENAR-BENAR EMBEDDED.

Bukan sekadar URL.

Bukan sekadar browser.

Bukan sekadar HTML server.

Bukan sekadar interactive button.

Target akhirnya adalah pengalaman seperti:

WhatsApp
    ↓
Interactive message
    ↓
Embedded WebView
    ↓
MinjiBot Web Application
    ↓
YouTube Player / Arcade Game

Gunakan repository MinjiBot yang sudah ada sebagai foundation.

Reuse existing architecture sebanyak mungkin.

Jangan rewrite project dari nol.

Jangan menambahkan dependency tanpa alasan.

Jangan melakukan upgrade Baileys tanpa audit compatibility.

Jangan mengklaim sesuatu bekerja jika belum diverifikasi.