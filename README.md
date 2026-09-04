<div align="center">

# ⚡ MinjiBot V2

**Enterprise-Grade Multi-Tenant WhatsApp Bot Platform featuring Group-Rental Architecture, Persistent Member Economy, and High-Performance Media Pipeline.**

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%205.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Baileys](https://img.shields.io/badge/WhatsApp%20Engine-Baileys-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Prisma](https://img.shields.io/badge/ORM-Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![Tests](https://img.shields.io/badge/Tests-314%20Passed-brightgreen?style=for-the-badge&logo=jest&logoColor=white)]()
[![PM2](https://img.shields.io/badge/Process%20Manager-PM2-2B037A?style=for-the-badge&logo=pm2&logoColor=white)](https://pm2.keymetrics.io)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/features/actions)

<p align="center">
  <a href="#-key-features">Key Features</a> •
  <a href="#-system-architecture">Architecture</a> •
  <a href="#-command-showcase">Commands</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-production-deployment--cicd">Production & CI/CD</a>
</p>

</div>

---

## 🌟 Key Features

### 🏢 1. Multi-Tenant Group Rental Engine
- **Per-Group Tenant Isolation**: WhatsApp groups operate as independent tenants. Zero global premium clutter.
- **Automated Lifecycle**: State transitions (`PENDING` ➔ `ACTIVE` ➔ `EXPIRED` ➔ `BLOCKED` ➔ `REMOVED`).
- **Flexible Management**: Super Owner activates & extends rentals; Tenant Owner manages group settings; Tenant Admin assists with moderation.
- **SaaS Tenant Panel (`.panel` / `.tenantstatus`)**: Full-featured administrative dashboard presenting live group information, active remaining rental days, bot admin privileges, and modular switchboard.

### 💎 2. Persistent Group Member Economy
- **Group-Scoped Balances**: Composite identity `(groupJid, userJid)`. Balances in Group A do not bleed into Group B.
- **Economic Assets**:
  - **Points**: Virtual currency earned from activities and claims.
  - **Limits**: Fuel for heavy media features with strict atomic `Reserve ➔ Execute ➔ Consume/Refund` ledger operations.
  - **XP & Tiers**: Permanent rank progression (*Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster*).
- **Daily Rewards (`.daily` / `.claim`)**: 100–300 Points, 50 XP, chance of bonus Limit, with daily streak multipliers reset at 00:00 WIB.
- **P2P Economy**: Peer gifting (`.giftpoint`, `.giftlimit`) and limit exchange (`.belilimit`).
- **Automatic Level-Up Announcements**: Real-time celebration broadcast in chat when a member ascends to a higher rank tier.

### 🛡️ 3. The Admin Powerhouse (Rental Dealbreakers)
- **Tiered Warning System (`.warn`, `.unwarn`, `.warns`, `.resetwarn`, `.setwarn`)**: Progressive discipline enforcement with automatic kick upon reaching threshold (default 3 warnings), reason tracking, and protected account immunity.
- **Anti-Raid & Bot Surge Defense (`.antiraid`, `.grup <buka|tutup>`)**: High-speed in-memory sliding window detecting abnormal join surges ($\ge 4$ members in $\le 10$s) to auto-lock the group to announcement mode, revoke invitation links, and alert administrators.
- **HideTag (`.hidetag <pesan>`)**: Broadcast announcements with invisible background mentions to keep chat screens uncluttered.
- **Anti-Delete (`.antidelete`) & Anti-ViewOnce (`.antiviewonce`)**: Catch revoked messages via fast in-memory LRU cache and reveal ephemeral media automatically.

### 🎨 4. Social Status & Viral Studio
- **Profile 2.0 Glassmorphism Card (`.profile`)**: High-resolution 800×450 visual card rendered locally with Sharp (no browser overhead), featuring circular avatar mask, tier badge, dynamic colors, XP progress bar, and 4 statistical counters.
- **Group Analytics & Sider Hunter (`.stats`, `.topaktif`, `.silent [hari]`)**: Non-blocking message counter, top 10 most active chatters leaderboard, and silent member detector to cull lurkers.
- **Viral Studio (`.quote`, `.tweet`)**:
  - `.quote` [reply]: Editorial quote card generator with optional WhatsApp sticker flag (`-s`).
  - `.tweet <teks>` / `.tweet @user <teks>`: Twitter / X Dark Mode tweet mockup generator with verified blue check and deterministic metrics.

### 🎰 5. Educational Anti-Greed Slot Machine
- **Authentic Visuals**: Fruit emojis + lucky 7️⃣ (`🍒 🍇 🍉 🍊 🍋 7️⃣`).
- **Dynamic Weighted RNG (The Reality Trap)**:
  - Spins 1–3 (*Beginner's Luck*): ~65% win probability.
  - Spins 4–10 (*House Edge Awakening*): ~35% win probability.
  - Spins 11+ (*The Grind*): ~20% win probability.
  - **ALL-IN Bet Mode**: Win probability plummets to **~6%**, delivering a harsh lesson and educational advisory against real-money gambling addiction.

### 🎮 6. Interactive Group Gaming Suite
- **Family 100 Survey Board**: Hidden survey slots (`...............`) that reveal out-of-order upon correct guesses with answerer attribution. Supports direct message reply/quote.
- **TicTacToe PvP**: Turn-based grid battle with **Swipe-to-Reply** challenge acceptance and move placement (`1`–`9`).
- **Brain Teasers**: Math calculation (`.mtk`), Word Scramble (`.tebakkata`), Emoji Riddles (`.tebakemoji`), and Number Guessing (`.tebakangka`).

### 🚀 7. High-Throughput Media Downloader Pipeline
- **TikTok (`.tt`)**: Watermark-free HD video download with direct fast-API extraction and robust yt-dlp fallback.
- **Instagram (`.ig`)**: Unified downloader supporting Reels, Posts, multi-slide Carousels, and Stories.
- **YouTube (`.yt`)**: Smart Adaptive Resolution Engine prioritizing **720p 60FPS** and **720p 30FPS** for crystal-clear high-definition fidelity (`<= 100MB`), with intelligent dynamic fallback to **480p** for extended videos (up to 12 minutes). Remuxed with mobile-safe **AVC1 (H.264) + AAC** for instant, native playback on all iOS & Android devices.
- **AI Image Enhancer (`.hd`)**: Upscales and sharpens low-res photos with AI face restoration.

### 🛡️ 8. Enterprise Resilience & Auto-Reconnect
- **Modular Interceptor Pipeline**: Chain of Responsibility message processor decoupled from commands.
- **500 Status Interceptor**: Intercepts WhatsApp stream acknowledgment glitches and badSession glitches without destroying credentials, triggering an exponential backoff reconnect loop.
- **Dual JID Normalization**: Seamlessly resolves both WhatsApp Phone JIDs (`@s.whatsapp.net`) and Linked Device IDs (`@lid`).

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    WA[WhatsApp Network] <--> |Baileys WebSockets| BL[Lifecycle & Subscribers]
    BL --> |Event Subscribers| ES[Group Participants & Message Revoke]
    BL --> |Messages Upsert| MIP[Modular Interceptor Pipeline]
    
    subgraph Interceptor Pipeline Chain
        MIP --> IP1[PendingTenant Interceptor]
        IP1 --> IP2[AntiDelete & AntiViewOnce Interceptors]
        IP2 --> IP3[Activity Tracker Interceptor]
        IP3 --> IP4[AFK & AntiLink Interceptors]
        IP4 --> IP5[AntiSpam Interceptor]
        IP5 --> IP6[Interactive Reply Interceptor]
    end

    subgraph Security & Access Layer
        IP6 --> |Uncaught by Pipeline| RG[Role Guard]
        RG --> TG[Tenant Guard]
        TG --> FG[Feature Guard]
    end
    
    subgraph Application Service Layer
        FG --> CR[Command Router]
        CR --> DS[Media & Downloader Service]
        CR --> VS[Viral Studio & Profile Card Service]
        CR --> MS[Moderation & Warn Service]
        CR --> ESV[Member Economy Service]
        CR --> GS[Game Engine & PvP Service]
        CR --> TS[Tenant Management & Panel Service]
    end
    
    subgraph Data & Storage Layer
        ESV & MS & TS --> RL[Ledger & Warning Repositories]
        GS & VS --> GP[Group Member Profile Repository]
        RL & GP --> PR[Prisma ORM]
        PR <--> PG[(PostgreSQL Database)]
    end
```

---

## 📋 Command Showcase

| Category | Command | Description | Limit / Cost |
|---|---|---|---|
| **Member Economy & Status** | `.daily` / `.claim` | Claim daily points, XP, and streak bonus | Free |
| | `.profile` [@user] | Generate Glassmorphism 2.0 visual card with avatar, rank, and XP bar | Free |
| | `.belilimit <count>` | Exchange 1,000 Points per Limit | Points |
| | `.giftpoint @user <n>` | Send points to a fellow group member | Points |
| | `.giftlimit @user <n>` | Send limits to a fellow group member | Limit |
| | `.toppoint` / `.toprank` | View top 10 richest and highest XP members | Free |
| **Activity Analytics** | `.stats` | Group activity analytics (total chats, active hours, top chatters) | Free |
| | `.topaktif` / `.topchat` | Top 10 most active members by message count | Free |
| | `.silent [hari]` | Sider hunter: detect members with 0 messages over X days (default 7) | Free |
| **Viral Studio** | `.quote` [reply] [-s] | Render dark glassmorphism quote card (add `-s` for WhatsApp sticker) | Free |
| | `.tweet` [@user] `<text>`| Render Dark Mode X / Twitter tweet mockup with verified blue badge | Free |
| **Media Engine** | `.tt <url>` | Download TikTok video (no watermark) or Photo Slides (up to 12) + BGM audio | 1 Limit |
| | `.ig <url>` | Download Instagram Reel, Post, Carousel, or Story | 1 Limit |
| | `.yt <url>` | Download YouTube video (Adaptive 720p60/720p30/480p, max 12 mins) | 1 Limit |
| | `.hd` [reply photo] | Enhance photo quality using AI restoration | 2 Limits |
| | `.play <query>` | Stream & send MP3 audio track | 1 Limit |
| | `.lirik <query>` | Search song lyrics | 1 Limit |
| | `.s` / `.sticker` | Create sticker from photo/short video with official MinjiBot watermark | Free |
| | `.smeme <text>` | Create top/bottom meme sticker with official MinjiBot watermark | Free |
| | `.brat <text>` | Create Brat aesthetic text sticker (Charli XCX style) with MinjiBot watermark | Free |
| | `.toimg` / `.tovideo` | Convert static sticker to PNG image or animated sticker to MP4 video | Free |
| | `.bass` / `.chipmunk` | Apply bass boost or chipmunk vocal effect to audio/VN | Free |
| | `.slowed` / `.nightcore`| Apply slowed+reverb or nightcore tempo effect to audio/VN | Free |
| | `.tovn` | Convert any audio track into official WhatsApp Voice Note (PTT) | Free |
| **Mini Games** | `.slot` [amount \| allin] | Play dynamic educational fruit slot machine | Variable |
| | `.family100` | Start interactive Family 100 survey game | Free |
| | `.tictactoe @user` | Challenge a member to a TicTacToe PvP battle | Free |
| | `.mtk` / `.math` | Math challenge with direct reply answer | Free |
| | `.tebakkata` / `.tebakemoji` | Guessing riddles with direct reply answer | Free |
| | `.nyerah` | Surrender active quiz or TicTacToe game | Free |
| **Tenant Moderation (P0)**| `.warn @user <alasan>` | Give disciplinary warning (Auto-kick on threshold) | Free (Admin) |
| | `.unwarn @user` | Remove latest warning from member | Free (Admin) |
| | `.warns [@user]` | View warning history and violation list | Free (Admin) |
| | `.resetwarn @user` | Reset all warnings for a member | Free (Admin) |
| | `.setwarn <1-10>` | Set warning threshold before auto-kick | Free (Admin) |
| | `.antiraid` [on \| off] | Toggle anti-raid surge defense | Free (Admin) |
| | `.antiraid setting <n> <s>`| Configure surge threshold ($n$ members in $s$ seconds) | Free (Admin) |
| | `.grup <buka \| tutup>` | Manually lock or unlock group chat | Free (Admin) |
| | `.panel` / `.tenantstatus`| Open SaaS administrative dashboard and modular switchboard | Free (Admin) |
| | `.hidetag <msg>` | Broadcast announcement with hidden mentions | Free (Admin) |
| | `.antidelete` [on \| off] | Reveal deleted / revoked messages with sender info | Free (Admin) |
| | `.antiviewonce` [on \| off]| Secure and reveal 1x view-once photos and videos | Free (Admin) |
| | `.antilink` [on \| off] | Toggle group anti-invite link moderation | Free (Admin) |
| | `.antispam` [mode] | Configure spam protection (normal/soft/strict) | Free (Admin) |
| | `.welcome` [on \| off] | Toggle welcome message greeting | Free (Admin) |
| | `.setwelcome <msg>` | Customize group greeting message | Free (Admin) |
| | `.goodbye` [on \| off] | Toggle goodbye notification on member leave | Free (Admin) |
| | `.setgoodbye <msg>` | Customize group goodbye message | Free (Admin) |
| | `.reminder <time> <msg>` | Set automatic group reminder | Free (Admin) |
| **Super Owner** | `.tenant list` | List all tenant groups and rental statuses | Admin |
| | `.tenant activate <id> <d>`| Activate group rental for *d* days | Admin |
| | `.tenant extend <id> <d>` | Extend group rental period | Admin |
| | `.tenant block <id>` | Block abusive tenant group | Admin |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v20.x` or later
- **PostgreSQL**: `v14.x` or later
- **FFmpeg**: Installed and accessible in system PATH
- **yt-dlp**: Installed and accessible in system PATH (for media downloader)

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
   Fill in your configuration:
   ```ini
   DATABASE_URL="postgresql://user:password@localhost:5432/minjibot?schema=public"
   SUPER_OWNER_JIDS="628123456789@s.whatsapp.net"
   COMMAND_PREFIX="."
   MAX_DOWNLOAD_FILE_MB=120
   ```

4. **Initialize Database**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. **Run in Development**:
   ```bash
   npm run dev
   ```

6. **Link WhatsApp Session**:
   Scan the generated terminal QR code with WhatsApp (*Linked Devices*).

---

## 🌐 Production Deployment & CI/CD

MinjiBot is engineered for zero-downtime, continuous deployment to Linux VPS servers (e.g., Tencent Cloud Lighthouse, AWS, DigitalOcean) via **GitHub Actions**.

### Automated CI/CD Workflow (`.github/workflows/deploy.yml`)

Every push to branch `main` triggers automated remote deployment over SSH:

```
[git push origin main] ➔ [GitHub Actions] ➔ [SSH into VPS] ➔ [git reset --hard origin/main]
                                                                        │
[PM2 Zero-Downtime Reload] ◄── [npm run build] ◄── [prisma generate & push]
```

To run manually with PM2:
```bash
# Build TypeScript
npm run build

# Start or reload daemon
pm2 start dist/index.js --name minjibot
pm2 save
```

---

## 🧪 Test Suite

MinjiBot enforces strict unit and integration testing across all core modules:

```bash
npm run test
```

```text
# tests 314
# suites 0
# pass 314
# fail 0
# duration_ms 12755.0539
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

<div align="center">
  <sub>Engineered with passion by <b>Anthony Wisnu</b>. Built for high-reliability communities.</sub>
</div>
