<div align="center">

# ⚡ MinjiBot V2

**Enterprise-Grade Multi-Tenant WhatsApp Bot Platform featuring Group-Rental Architecture, Persistent Member Economy, High-Throughput Media Engine, and Real-Time Host Telemetry.**

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%205.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Baileys](https://img.shields.io/badge/WhatsApp%20Engine-Baileys-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Prisma](https://img.shields.io/badge/ORM-Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![Test Suite](<https://img.shields.io/badge/Test%20Suite-398%20Passing%20(100%25)-brightgreen?style=for-the-badge&logo=node.js&logoColor=white>)]()
[![PM2](https://img.shields.io/badge/Process%20Manager-PM2-2B037A?style=for-the-badge&logo=pm2&logoColor=white)](https://pm2.keymetrics.io)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/features/actions)

<p align="center">
  <a href="#-key-features">Key Features</a> •
  <a href="#-system-architecture">Architecture</a> •
  <a href="#-command-showcase">Commands</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-production-deployment--cicd">Production & CI/CD</a> •
  <a href="#-audit-remediation--code-quality">Audit & Compliance</a>
</p>

</div>

---

## 🌟 Key Features

### 🏢 1. Multi-Tenant Group Rental Engine

- **Tenant Isolation**: Each WhatsApp group is isolated as an independent tenant group. Zero global premium clutter—privileges and economics are scoped strictly to the active rental contract of that group.
- **Automated Rental Lifecycle**: Formal state transitions (`PENDING` ➔ `ACTIVE` ➔ `EXPIRED` ➔ `BLOCKED` ➔ `REMOVED`) managed atomically with automatic contract expiration notifications.
- **Role Hierarchy**: Super Owner (`SUPER_OWNER_JIDS` full bypass), Tenant Owner (`ownerJid`), Tenant Admin (`tenantAdminJids`), and regular group Members.
- **SaaS Tenant Panel (`.panel` / `.tenantstatus`)**: Executive administrative dashboard presenting group identity, tenant code, active remaining rental days (WIB), bot admin permissions, management team roster, and modular switchboard.

### 📊 2. Rich Visual Menu & Live Server Telemetry (`.menu`)

- **Dynamic User Profile Presentation**: Fetches the caller's WhatsApp profile picture with high-resolution circular framing, automatically falling back to official MinjiBot brand avatar (`assets/minji.png`) if private or unset.
- **Live Server Telemetry Header**:
  - Live Indonesian WIB Time, Day, and Date formatted in `Asia/Jakarta`.
  - Host server metrics: `Country: Indonesia`, `Platform (linux)`, `CPU Cores & Clock Speed`, `RAM Free / Total`, and `Architecture (x64)`.
- **Adaptive Menu Sections**: Automatically tailors available command lists according to caller permissions (Super Owner, Tenant Owner, Group Member, or Private Chat mode).

### 💎 3. Persistent Group Member Economy

- **Group-Scoped Balances**: Composite identity `(groupJid, userJid)`. Balances in Group A never bleed into Group B.
- **Three-Asset Balance System**:
  - **Points**: Virtual currency earned from activities, daily claims, and mini games. Used for slot bets, gifts, and purchasing limits.
  - **Limits**: Fuel for heavy media features with strict atomic `Reserve ➔ Execute ➔ Consume/Refund` ledger operations.
  - **XP & Tiers**: Permanent progression tiers (_Warrior, Elite, Master, Grandmaster, Epic, Legend, Mythic_) with automatic real-time level-up celebration broadcasts in chat.
- **Daily Claims (`.daily` / `.claim`)**: 10–30 Points, 50 XP, 10% bonus limit chance, and daily streak tracking resetting at 00:00 WIB.
- **P2P Economy**: Intra-group peer gifting (`.giftpoint`, `.giftlimit`) and limit exchange (`.belilimit` — 100 Points per 1 Limit).

### 🚀 4. High-Throughput Media Downloader Pipeline (v2.1)

- **Global Headroom**: Supports files up to **400 MB** (`MAX_DOWNLOAD_FILE_MB = 400`) with zero VPS disk retention (ephemeral temp files are purged instantly upon delivery).
- **Smart WhatsApp Delivery Engine**: Videos $\le$ 100 MB are sent as native inline video players; videos > 100 MB up to 400 MB are automatically routed as HD Document Videos (`video/mp4`) to seamlessly bypass WhatsApp's 100 MB inline streaming ceiling.
- **YouTube Video (`.yt`)**: Smart Adaptive Resolution Engine prioritizing **720p 60FPS** and **720p 30FPS** for crystal-clear fidelity, with intelligent dynamic fallback to **480p** for long-form content up to **1 Hour (3,600s)**. Codec: mobile-safe **AVC1 (H.264) + AAC**.
- **YouTube Music / Play (`.play`)**: High-fidelity MP3 audio stream for tracks and podcasts up to **1 Hour (3,600s)**.
- **TikTok (`.tt`)**: Watermark-free HD video download up to **70 Minutes (4,200s)** or photo slides carousel up to **25 photos** + extracted background audio (BGM).
- **Instagram (`.ig`)**: Unified downloader supporting Reels, Posts, multi-slide Carousels (up to **15 slides**), and Stories (video up to **30 minutes**).
- **X / Twitter (`.x` / `.twt`)**: Full multi-media and mixed-media engine supporting up to **10 media items** (photos, videos, or mixed combinations) with video duration up to **30 minutes** in mobile-safe AVC1/H.264 + AAC via dual-engine `gallery-dl` + `yt-dlp`.
- **Pinterest (`.pin`)**: Original uncompressed HD photo and video downloader with automated `pin.it` shortlink redirect resolution.
- **HD Image Enhancer (`.hd`)**: Upscales and sharpens low-res photos using local Sharp Super-Clarity algorithms (mks2021 + CLAHE + LAB Sharpening) without external API costs.

### 🛡️ 5. The Admin Powerhouse & Tenant Defense

- **Tiered Warning System (`.warn`, `.unwarn`, `.warns`, `.resetwarn`, `.setwarn`)**: Progressive discipline enforcement with automatic group kick upon reaching threshold (default: 3 warnings), reason logging, and protected account immunity.
- **Anti-Raid & Bot Surge Defense (`.antiraid`, `.grup <buka|tutup>`)**: Zero-lag in-memory sliding window detecting abnormal join surges ($\ge 4$ members in $\le 10$s) to auto-lock the group to announcement mode, revoke invitation links, and alert administrators.
- **HideTag (`.hidetag <pesan>`)**: Broadcast announcements with invisible background mentions to notify all members cleanly without message clutter.
- **Anti-Delete (`.antidelete`)**: Intercepts revoked messages via high-speed in-memory LRU cache (500 capacity, 2MB media cap, 2-hour TTL) and resends deleted text/media with sender identity and timestamp.
- **Anti-Link & Anti-Spam**: Automatic deletion of WhatsApp group invitation links and multi-tier rate limiting (Normal/Soft/Strict modes).

### 🎨 6. Social Status & Viral Studio

- **Profile 2.0 Glassmorphism Card (`.profile`)**: High-resolution 800×450 visual card rendered locally with Sharp (no browser overhead), featuring circular avatar mask, tier badge, dynamic accent colors, XP progress bar, and 4 statistical counters.
- **Group Analytics & Sider Hunter (`.stats`, `.topaktif`, `.silent [hari]`)**: Non-blocking message counter, top 10 most active chatters leaderboard, and silent member detector to cull lurkers.
- **Viral Studio (`.quote`, `.tweet`)**:
  - `.quote` [reply]: Editorial dark glassmorphism quote card generator with optional WhatsApp sticker flag (`-s`).
  - `.tweet <teks>` / `.tweet @user <teks>`: Twitter / X Dark Mode tweet mockup generator with verified blue check and deterministic metrics.
- **Creative Media Tools**: Text sticker generator (`.brat`), meme maker (`.smeme`), sticker converter (`.toimg`, `.tovideo`), and audio effects studio (`.bass`, `.chipmunk`, `.slowed`, `.nightcore`, `.tovn`).

### 🎰 7. Mini Games & Interactive Quizzes

- **Educational Anti-Greed Slot Machine (`.slot`)**: Fruit emojis + lucky 7️⃣ with dynamic weighted RNG (Spins 1–3: ~65% win rate; Spins 4–10: ~35%; Spins 11+: ~20%; **ALL-IN**: ~6% win rate with anti-gambling advisory).
- **Family 100 Survey Board (`.family100`)**: Interactive survey board with out-of-order guessing and answerer attribution. Supports swipe-to-reply without prefix.
- **TicTacToe PvP (`.tictactoe @user`)**: Turn-based grid battle with **Swipe-to-Reply** challenge acceptance and move placement (`1`–`9`).
- **Brain Teasers**: Math calculations (`.mtk`), Word Scramble (`.tebakkata`), Emoji Riddles (`.tebakemoji`), and Number Guessing (`.tebakangka`).

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    WA[WhatsApp Network] <--> |Baileys WebSockets| BL[Lifecycle & Subscribers]
    BL --> |Event Subscribers| ES[Group Participants & Message Revoke]
    BL --> |Messages Upsert| MIP[Modular Interceptor Pipeline]

    subgraph Modular Interceptor Pipeline Chain
        MIP --> IP1["Priority 10: PendingTenant Interceptor"]
        IP1 --> IP2["Priority 20: AntiDelete Interceptor"]
        IP2 --> IP3["Priority 35: Activity Tracker Interceptor"]
        IP3 --> IP4["Priority 40: AFK & AntiLink Interceptors"]
        IP4 --> IP5["Priority 60: AntiSpam Interceptor"]
        IP5 --> IP6["Priority 70: Interactive Reply Interceptor"]
    end

    subgraph Security & Access Guards
        IP6 --> |Uncaught by Pipeline| RG[Role Guard]
        RG --> TG[Tenant Guard]
        TG --> FG[Feature Guard]
    end

    subgraph Application Service Layer
        FG --> CR[Command Router]
        CR --> DS["Media Downloader Suite (.tt, .ig, .yt, .x, .pin)"]
        CR --> VS["Viral Studio (.profile, .quote, .tweet)"]
        CR --> MS["Tenant Moderation (.warn, .antiraid, .antidelete)"]
        CR --> ESV["Member Economy (.daily, .belilimit, .slot)"]
        CR --> GS["Game Engine (.family100, .tictactoe, .kuis)"]
        CR --> TS["Tenant SaaS Panel (.panel, .activatetenant)"]
    end

    subgraph Storage & Infrastructure
        ESV & MS & TS --> RL[Ledger & Warning Repositories]
        GS & VS --> GP[Group Member Profile Repository]
        RL & GP --> PR[Prisma ORM]
        PR <--> PG[(PostgreSQL Database)]
        DS --> SMW[Smart WhatsApp Delivery Engine]
        SMW -->|Video <= 100MB| WA
        SMW -->|Video > 100MB <= 400MB| Doc[Document Video Stream]
        Doc --> WA
    end
```

---

## 📋 Command Showcase

| Category              | Command                    | Aliases         | Description                                                            | Limit / Cost | Access              |
| --------------------- | -------------------------- | --------------- | ---------------------------------------------------------------------- | ------------ | ------------------- |
| **Member Economy**    | `.daily`                   | `.claim`        | Claim daily points (10–30), XP (50), streak bonus                      | Free         | Member              |
|                       | `.profile`                 |                 | Visual Glassmorphism 2.0 card (avatar, rank, XP bar)                   | Free         | Member              |
|                       | `.belilimit <n>`           |                 | Buy limit with points (100 Points / 1 Limit)                           | Points       | Member              |
|                       | `.giftpoint @user <n>`     |                 | Send points to a fellow group member                                   | Points       | Member              |
|                       | `.giftlimit @user <n>`     |                 | Send limits to a fellow group member                                   | Limit        | Member              |
|                       | `.toppoint`                | `.toprank`      | View top 10 richest and highest XP members                             | Free         | Member              |
| **Media Downloader**  | `.tt <url>`                |                 | Download TikTok video (max 70m) or photos (max 25) + BGM               | 1 Limit      | Member / Free Owner |
|                       | `.ig <url>`                |                 | Download Instagram Reel, Post, Carousel (15), Story (30m)              | 1 Limit      | Member / Free Owner |
|                       | `.yt <url>`                |                 | Download YouTube video (Adaptive 720p/480p, max 1 hour)                | 1 Limit      | Member / Free Owner |
|                       | `.x <url>`                 | `.twt`          | Download X / Twitter post (Multi-item up to 10 media: photos & videos) | 1 Limit      | Member / Free Owner |
|                       | `.pin <url>`               | `.pinterest`    | Download Pinterest original HD photo/video (supports pin.it)           | 1 Limit      | Member / Free Owner |
|                       | `.play <judul>`            |                 | Stream high-bitrate YouTube MP3 audio (max 1 hour)                     | 1 Limit      | Member / Free Owner |
|                       | `.lirik <judul>`           |                 | Search song lyrics with optional document flag                         | 1 Limit      | Member / Free Owner |
|                       | `.hd`                      |                 | Enhance photo quality using Sharp Super-Clarity                        | 1 Limit      | Member / Free Owner |
| **Creative Studio**   | `.s`                       | `.sticker`      | Convert photo/video to sticker with official Minji watermark           | Free         | Member              |
|                       | `.smeme <teks>`            |                 | Create top/bottom meme sticker with official watermark                 | Free         | Member              |
|                       | `.brat <teks>`             |                 | Create dynamic Brat aesthetic text sticker (Charli XCX style)          | Free         | Member              |
|                       | `.quote` [reply]           | `.q`            | Render dark glassmorphism quote card (add `-s` for sticker)            | Free         | Member              |
|                       | `.tweet` [@u] `<txt>`      | `.twit`         | Render Dark Mode X tweet mockup with verified blue badge               | Free         | Member              |
|                       | `.toimg`                   | `.tovideo`      | Convert sticker back into PNG image or MP4 video                       | Free         | Member              |
|                       | `.bass` / `.chipmunk`      |                 | Audio effects: bass boost or chipmunk voice                            | Free         | Member              |
|                       | `.slowed` / `.nightcore`   |                 | Audio effects: slowed+reverb or nightcore tempo                        | Free         | Member              |
|                       | `.tovn`                    | `.vn`           | Convert any audio track into official WhatsApp Voice Note (PTT)        | Free         | Member              |
| **Interactive Games** | `.slot` [amount\|allin]    |                 | Play educational slot machine with dynamic weighted RNG                | Variable     | Member              |
|                       | `.family100`               |                 | Start interactive Family 100 survey game (reply to answer)             | Free         | Member              |
|                       | `.tictactoe @user`         | `.ttt`          | Challenge a member to a TicTacToe PvP battle (reply 1–9)               | Free         | Member              |
|                       | `.mtk`                     | `.math`         | Fast math calculation challenge (reply to answer)                      | Free         | Member              |
|                       | `.tebakkata`               |                 | Word scramble riddle game (reply to answer)                            | Free         | Member              |
|                       | `.tebakemoji`              |                 | Guess the emoji riddle game (reply to answer)                          | Free         | Member              |
|                       | `.nyerah`                  |                 | Surrender active quiz or TicTacToe match                               | Free         | Member              |
| **Tenant Moderation** | `.warn @user <alasan>`     |                 | Issue warning to member (Auto-kick on threshold)                       | Free         | Tenant Admin        |
|                       | `.unwarn @user`            |                 | Remove latest warning from member                                      | Free         | Tenant Admin        |
|                       | `.warns [@user]`           |                 | View warning history and violation list                                | Free         | Tenant Admin        |
|                       | `.resetwarn @user`         |                 | Reset all warnings for a member                                        | Free         | Tenant Admin        |
|                       | `.setwarn <1-10>`          |                 | Configure warning threshold before auto-kick                           | Free         | Tenant Owner        |
|                       | `.antiraid` [on\|off]      |                 | Toggle anti-raid surge defense                                         | Free         | Tenant Admin        |
|                       | `.grup <buka\|tutup>`      |                 | Manually lock/unlock group chat to announcement mode                   | Free         | Tenant Admin        |
|                       | `.panel`                   | `.tenantstatus` | Open SaaS administrative dashboard and switchboard                     | Free         | Tenant Admin        |
|                       | `.hidetag <pesan>`         |                 | Broadcast announcement with hidden background mentions                 | Free         | Tenant Admin        |
|                       | `.antidelete` [on\|off]    |                 | Toggle anti-revoke deleted message recovery                            | Free         | Tenant Admin        |
|                       | `.antilink` [on\|off]      |                 | Toggle group anti-invite link moderation                               | Free         | Tenant Admin        |
|                       | `.antispam` [mode]         |                 | Configure spam protection (normal / soft / strict)                     | Free         | Tenant Admin        |
|                       | `.welcome` [on\|off]       |                 | Toggle welcome greeting with avatar photo                              | Free         | Tenant Admin        |
|                       | `.setwelcome <pesan>`      |                 | Customize group greeting message template                              | Free         | Tenant Owner        |
|                       | `.goodbye` [on\|off]       |                 | Toggle goodbye notice when member departs                              | Free         | Tenant Admin        |
|                       | `.setgoodbye <pesan>`      |                 | Customize group goodbye notice template                                | Free         | Tenant Owner        |
|                       | `.reminder <time> <msg>`   |                 | Schedule automatic group reminder (WIB)                                | Free         | Tenant Admin        |
| **Tenant Owner**      | `.setowner @user`          |                 | Reassign official Tenant Owner in group                                | Free         | Tenant Owner        |
|                       | `.addadmin @user`          |                 | Designate a member as Tenant Admin                                     | Free         | Tenant Owner        |
|                       | `.deladmin @user`          |                 | Revoke Tenant Admin privileges                                         | Free         | Tenant Owner        |
|                       | `.transferowner <kd> <u>`  |                 | Transfer tenant ownership via confirmation code                        | Free         | Tenant Owner        |
| **Super Owner**       | `.pendinggroup`            |                 | List all detected pending tenant groups                                | Free         | Super Owner         |
|                       | `.activatetenant <kd> <u>` |                 | Activate rental contract for tenant group                              | Free         | Super Owner         |
|                       | `.listtenant`              |                 | List all registered tenant groups and active rentals                   | Free         | Super Owner         |
|                       | `.tenantinfo <kode>`       |                 | Inspect detailed tenant profile and contract dates                     | Free         | Super Owner         |
|                       | `.extendtenant <kd> <d>`   |                 | Extend rental contract duration by _d_ days                            | Free         | Super Owner         |
|                       | `.blocktenant <kode>`      |                 | Block tenant group from executing commands                             | Free         | Super Owner         |
|                       | `.unblocktenant <kode>`    |                 | Unblock previously banned tenant group                                 | Free         | Super Owner         |
|                       | `.removetenant <kode>`     |                 | Remove tenant group from active tracking                               | Free         | Super Owner         |
|                       | `.addpointall <kode> <n>`  |                 | Grant bonus points to all members in tenant                            | Free         | Super Owner         |
|                       | `.addlimitall <kode> <n>`  |                 | Grant bonus limits to all members in tenant                            | Free         | Super Owner         |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v20.x` or later (LTS recommended)
- **PostgreSQL**: `v14.x` or later
- **FFmpeg**: Installed and accessible in system `PATH`
- **yt-dlp**: Installed and accessible in system `PATH` (for YouTube, Instagram, TikTok, and X video extraction)
- **gallery-dl**: Installed and accessible in system `PATH` (for Instagram carousel, Pinterest HD, and X multi-photo/video)

### Linux VPS System Packages (Ubuntu / Debian)

```bash
sudo apt update && sudo apt install -y ffmpeg python3 python3-pip fonts-liberation fonts-noto-color-emoji
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
sudo pip3 install --break-system-packages gallery-dl
```

### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/AnthonyWisnu/MinjiBot.git
   cd MinjiBot
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure Environment Variables**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your credentials:

   ```ini
   DATABASE_URL="postgresql://user:password@localhost:5432/minjibot?schema=public"
   SUPER_OWNER_JIDS="628123456789@s.whatsapp.net"
   COMMAND_PREFIX="."
   MAX_DOWNLOAD_FILE_MB=400
   DOWNLOADER_BIN="yt-dlp"
   GALLERY_DL_BIN="gallery-dl"
   DOWNLOADER_TIMEOUT_MS=300000
   HD_MAX_INPUT_MB=10
   HD_AI_MAX_CONCURRENT_JOBS=1
   TENANT_SESSION_TTL_DAYS=7
   REMINDER_POLL_MS=30000
   ```

4. **Initialize Database Schema**:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

5. **Build and Run**:

   ```bash
   # Development
   npm run dev

   # Production Build
   npm run build
   node dist/index.js
   ```

6. **Link WhatsApp Session**:
   Scan the printed terminal QR code using WhatsApp on your smartphone (_Linked Devices_).

---

## 🌐 Production Deployment & CI/CD

MinjiBot is engineered for zero-downtime, continuous deployment to Linux VPS servers via a native **GitHub Actions Self-Hosted Runner**:

```text
[git push origin main] ➔ [GitHub Actions Self-Hosted Runner (vps-minji)]
                                      │
[flock atomic concurrency lock] ➔ [git reset --hard origin/main]
                                      │
[npm ci & prisma migrate deploy] ➔ [nice -n 10 npm run build]
                                      │
[pm2 restart minjibot --update-env] ◄─┘
```

Manual deployment with PM2:

```bash
npm run build
pm2 start dist/index.js --name minjibot
pm2 save
```

---

## 🧪 Audit Remediation & Code Quality

MinjiBot has undergone a rigorous 5-phase architectural and security audit with **37 findings remediated**:

- **Phase 1: Security & Stability**: SSRF prevention with DNS rebinding protection (`assertSafeExternalUrl`), command injection hardening (`runExternalProcess`), and Baileys reconnection exponential backoff.
- **Phase 2: Logic & Architecture**: Decoupled Modular Interceptor Pipeline, strict 3-tier layering (Commands ➔ Services ➔ Repositories), and composite member profiling.
- **Phase 3: Performance & Reliability**: In-memory LRU message caches with memory caps, streaming media chunking, and ephemeral temp directory auto-cleanup.
- **Phase 4: Code Quality**: 100% TypeScript Strict mode, ESLint strict configuration (`0 errors, 0 warnings`), and standardized Prettier formatting.
- **Phase 5: Automated Testing**: Comprehensive test suite enforcing **398/398 unit and integration tests passing 100%**:

```bash
npm test
```

---

## ⚠️ Important Disclaimer (Unofficial WhatsApp API)

> [!WARNING]
> MinjiBot is an unofficial software engineered on top of the reverse-engineered WhatsApp Multi-Device protocol via [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys). It is **NOT** affiliated with, authorized, maintained, or endorsed by WhatsApp Inc., Meta Platforms Inc., or any of its subsidiaries.
>
> Automated usage of WhatsApp accounts carries intrinsic risks under Meta's Terms of Service. Abusive behaviors—including excessive mass mentions (`.tagall`), unsolicited direct messaging, and high-frequency command spam—may result in temporary or permanent phone number bans. We strongly advise operating MinjiBot exclusively using a dedicated secondary SIM card/number.

---

## 🔒 Privacy & Data Transparency

MinjiBot is committed to zero persistent storage of ordinary chat conversations. Group chat messages are never recorded in the permanent database, except for transient administrative security features (such as bounded Anti-Delete cache and activity counters). Review our full data collection and retention guidelines in [PRIVACY.md](PRIVACY.md).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

<div align="center">
  <sub>Engineered with passion by <b>Anthony Wisnu</b>. Built for high-reliability communities.</sub>
</div>
