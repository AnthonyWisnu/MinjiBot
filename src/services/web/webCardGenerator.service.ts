import sharp from "sharp";

export interface StreamDeckCardData {
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnail?: string;
  url: string;
}

export class WebCardGeneratorService {
  /**
   * Menghasilkan gambar card Spotify Stream Deck (Screenshot 2 / 084438 style)
   * dengan seekbar, controls, dan terminal telemetry.
   */
  async generateStreamDeckCard(data: StreamDeckCardData): Promise<Buffer> {
    const cardW = 600;
    const cardH = 820;

    const safeTitle = escapeXml(
      data.title.length > 34 ? `${data.title.slice(0, 32)}...` : data.title,
    );
    const safeChannel = escapeXml(
      data.channelTitle.length > 28 ? `${data.channelTitle.slice(0, 26)}...` : data.channelTitle,
    );
    const durM = Math.floor(data.durationSeconds / 60);
    const durS = String(data.durationSeconds % 60).padStart(2, "0");
    const durFormatted = `${durM}:${durS}`;

    // Download / prepare thumbnail
    const thumbBuffer = await this.fetchThumbnail(data.thumbnail);

    const svgCard = `
      <svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cardBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#121622" />
            <stop offset="100%" stop-color="#0a0d14" />
          </linearGradient>
          <linearGradient id="btnGreen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1ed760" />
            <stop offset="100%" stop-color="#1db954" />
          </linearGradient>
        </defs>

        <!-- Outer Card with rounded corners and neon dark border -->
        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="20" fill="url(#cardBg)" stroke="#222838" stroke-width="2"/>

        <!-- Top Header Info -->
        <text x="24" y="38" fill="#94a3b8" font-family="monospace" font-size="11" font-weight="700" letter-spacing="1">NOW PLAYING VIDEO</text>
        <text x="24" y="56" fill="#64748b" font-family="sans-serif" font-size="11">${safeTitle}</text>
        <!-- Speaker Icon on Right -->
        <circle cx="560" cy="42" r="12" fill="#182030" />
        <path d="M555 42 L559 38 L562 38 L562 46 L559 46 Z" fill="#94a3b8" />
        <path d="M565 39 Q567 42 565 45" stroke="#94a3b8" stroke-width="1.5" fill="none" />

        <!-- Placeholder rect for Thumbnail (composite target: top 72, left 24, w 552, h 280) -->
        <rect x="24" y="72" width="552" height="280" rx="14" fill="#080b10" stroke="#1c2332" stroke-width="1.5" />

        <!-- Title & Channel Info -->
        <text x="24" y="385" fill="#ffffff" font-family="sans-serif" font-size="18" font-weight="800">${safeTitle}</text>
        <text x="24" y="407" fill="#1db954" font-family="monospace" font-size="12" font-weight="600">${safeChannel} <tspan fill="#64748b">// YouTube</tspan></text>

        <!-- Seekbar Container -->
        <rect x="24" y="432" width="552" height="5" rx="2.5" fill="#263147" />
        <rect x="24" y="432" width="85" height="5" rx="2.5" fill="#1db954" />
        <circle cx="109" cy="434.5" r="6" fill="#ffffff" />
        <text x="24" y="455" fill="#64748b" font-family="monospace" font-size="11">0:10</text>
        <text x="548" y="455" fill="#64748b" font-family="monospace" font-size="11" text-anchor="end">${durFormatted}</text>

        <!-- Controls Row -->
        <!-- Shuffle -->
        <text x="50" y="495" fill="#64748b" font-family="sans-serif" font-size="16">&#8646;</text>
        <!-- Prev -->
        <text x="220" y="496" fill="#cbd5e1" font-family="sans-serif" font-size="18">&#9198;</text>
        <!-- Play/Pause Button Circle -->
        <circle cx="300" cy="492" r="24" fill="url(#btnGreen)" filter="drop-shadow(0 4px 10px rgba(29,185,84,0.4))" />
        <rect x="293" y="482" width="4" height="20" rx="2" fill="#0b0e14" />
        <rect x="303" y="482" width="4" height="20" rx="2" fill="#0b0e14" />
        <!-- Next -->
        <text x="366" y="496" fill="#cbd5e1" font-family="sans-serif" font-size="18">&#9197;</text>
        <!-- Repeat -->
        <text x="535" y="495" fill="#64748b" font-family="sans-serif" font-size="16">&#8635;</text>

        <!-- Telemetry Diagnostics Card Box -->
        <rect x="24" y="540" width="552" height="255" rx="14" fill="#0b0e15" stroke="#1d2434" stroke-width="1.5" />

        <!-- Telemetry Header -->
        <text x="40" y="568" fill="#00f0ff" font-family="monospace" font-size="12" font-weight="800" letter-spacing="0.5">STREAM DECK / TELEMETRY</text>
        <rect x="475" y="555" width="85" height="18" rx="4" fill="#0e2818" stroke="#1db954" stroke-width="1" />
        <text x="517" y="568" fill="#1db954" font-family="monospace" font-size="9" font-weight="700" text-anchor="middle">COMPLETE</text>

        <!-- Stats Grid (6 items) -->
        <rect x="40" y="586" width="160" height="42" rx="8" fill="#121722" stroke="#1a2232" stroke-width="1" />
        <text x="50" y="600" fill="#64748b" font-family="monospace" font-size="9">MIME</text>
        <text x="50" y="618" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="700">video/mp4</text>

        <rect x="220" y="586" width="160" height="42" rx="8" fill="#121722" stroke="#1a2232" stroke-width="1" />
        <text x="230" y="600" fill="#64748b" font-family="monospace" font-size="9">DOWNLOADED</text>
        <text x="230" y="618" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="700">Stream Relay</text>

        <rect x="400" y="586" width="160" height="42" rx="8" fill="#121722" stroke="#1a2232" stroke-width="1" />
        <text x="410" y="600" fill="#64748b" font-family="monospace" font-size="9">TOTAL</text>
        <text x="410" y="618" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="700">STREAMING</text>

        <rect x="40" y="636" width="160" height="42" rx="8" fill="#121722" stroke="#1a2232" stroke-width="1" />
        <text x="50" y="650" fill="#64748b" font-family="monospace" font-size="9">PROGRESS</text>
        <text x="50" y="668" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="700">100.0%</text>

        <rect x="220" y="636" width="160" height="42" rx="8" fill="#121722" stroke="#1a2232" stroke-width="1" />
        <text x="230" y="650" fill="#64748b" font-family="monospace" font-size="9">CHUNKS</text>
        <text x="230" y="668" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="700">81</text>

        <rect x="400" y="636" width="160" height="42" rx="8" fill="#121722" stroke="#1a2232" stroke-width="1" />
        <text x="410" y="650" fill="#64748b" font-family="monospace" font-size="9">LOOP</text>
        <text x="410" y="668" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="700">OFF</text>

        <!-- Terminal Status Box -->
        <rect x="40" y="688" width="520" height="92" rx="6" fill="#06090e" stroke="#151b26" stroke-width="1" />
        <text x="52" y="708" fill="#4ade80" font-family="monospace" font-size="10">Binary chunk: 64.00 KB</text>
        <text x="52" y="724" fill="#4ade80" font-family="monospace" font-size="10">Download complete</text>
        <text x="52" y="740" fill="#4ade80" font-family="monospace" font-size="10">Stream buffer synchronized</text>
        <text x="52" y="756" fill="#4ade80" font-family="monospace" font-size="10">Player ready // Webview active</text>
      </svg>
    `;

    const svgBuffer = Buffer.from(svgCard);

    if (thumbBuffer) {
      return await sharp(svgBuffer)
        .composite([
          {
            input: thumbBuffer,
            top: 72,
            left: 24,
          },
        ])
        .png()
        .toBuffer();
    }

    return await sharp(svgBuffer).png().toBuffer();
  }

  /**
   * Menghasilkan gambar card Dans Catur (Screenshot 3 / 084542 style)
   */
  async generateChessCard(): Promise<Buffer> {
    const cardW = 600;
    const cardH = 700;

    const boardSize = 440;
    const tileSize = boardSize / 8; // 55px
    const startX = 80;
    const startY = 130;

    // Build 8x8 Board SVG
    let boardSvg = "";
    const pieces = [
      ["♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜"],
      ["♟", "♟", "♟", "♟", "♟", "♟", "♟", "♟"],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "♙", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["♙", "♙", "♙", "♙", "", "♙", "♙", "♙"],
      ["♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"],
    ];

    for (let r = 0; r < 8; r++) {
      const row = pieces[r];
      if (!row) continue;
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const color = isLight ? "#ebecd0" : "#779556";
        const x = startX + c * tileSize;
        const y = startY + r * tileSize;
        boardSvg += `<rect x="${x}" y="${y}" width="${tileSize}" height="${tileSize}" fill="${color}" />`;

        const piece = row[c];
        if (piece) {
          const pieceColor = r < 2 ? "#1e293b" : "#ffffff";
          boardSvg += `<text x="${x + tileSize / 2}" y="${y + tileSize / 2 + 13}" font-size="34" text-anchor="middle" fill="${pieceColor}" stroke="#0f172a" stroke-width="0.5">${piece}</text>`;
        }
      }
    }

    const svg = `
      <svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cardBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#121622" />
            <stop offset="100%" stop-color="#0a0d14" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="20" fill="url(#cardBg)" stroke="#222838" stroke-width="2"/>

        <!-- Header -->
        <text x="36" y="44" fill="#94a3b8" font-family="monospace" font-size="12" font-weight="700" letter-spacing="1">DANS CATUR</text>
        <text x="36" y="78" fill="#ffffff" font-family="sans-serif" font-size="28" font-weight="800">Catur</text>
        <rect x="445" y="48" width="115" height="26" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1"/>
        <text x="502" y="65" fill="#38bdf8" font-family="sans-serif" font-size="12" font-weight="700" text-anchor="middle">Bot berjalan</text>

        <!-- Board Wrapper -->
        <rect x="${startX - 6}" y="${startY - 6}" width="${boardSize + 12}" height="${boardSize + 12}" rx="12" fill="#202634" />
        ${boardSvg}

        <!-- Footer Info -->
        <rect x="36" y="605" width="528" height="60" rx="10" fill="#0f141f" stroke="#1c2436" stroke-width="1.5" />
        <text x="56" y="632" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">Mode: MinjiBot AI Engine &amp; Duel 2 Pemain</text>
        <text x="56" y="650" fill="#1db954" font-family="monospace" font-size="11">Aturan Resmi FIDE Penuh // Hadiah +120 Pts &amp; +250 XP</text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Menghasilkan gambar card Retro Arcade Hub (Screenshot 4 style)
   */
  async generateArcadeCard(): Promise<Buffer> {
    const cardW = 600;
    const cardH = 680;

    const svg = `
      <svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cardBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#121622" />
            <stop offset="100%" stop-color="#0a0d14" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="20" fill="url(#cardBg)" stroke="#222838" stroke-width="2"/>

        <!-- Header -->
        <text x="36" y="44" fill="#94a3b8" font-family="monospace" font-size="12" font-weight="700" letter-spacing="1">MINJIBOT RETRO ARCADE</text>
        <text x="36" y="78" fill="#00f0ff" font-family="sans-serif" font-size="26" font-weight="800">Arcade Zone</text>
        <rect x="440" y="48" width="120" height="26" rx="6" fill="#1e293b" stroke="#1db954" stroke-width="1"/>
        <text x="500" y="65" fill="#1db954" font-family="monospace" font-size="11" font-weight="700" text-anchor="middle">5 MINI-GAMES</text>

        <!-- 5 Games Grid -->
        <!-- Game 1: Dino -->
        <rect x="36" y="110" width="528" height="80" rx="12" fill="#0f141f" stroke="#1c2436" stroke-width="1.5" />
        <rect x="52" y="125" width="50" height="50" rx="10" fill="#0d2b18" stroke="#1db954" stroke-width="1"/>
        <text x="77" y="157" fill="#1db954" font-size="22" text-anchor="middle">🦖</text>
        <text x="118" y="145" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="700">1. Dino Runner</text>
        <text x="118" y="165" fill="#94a3b8" font-family="sans-serif" font-size="12">Lompat &amp; merunduk lewati kaktus serta drone</text>

        <!-- Game 2: Snake -->
        <rect x="36" y="205" width="528" height="80" rx="12" fill="#0f141f" stroke="#1c2436" stroke-width="1.5" />
        <rect x="52" y="220" width="50" height="50" rx="10" fill="#0c2534" stroke="#00f0ff" stroke-width="1"/>
        <text x="77" y="252" fill="#00f0ff" font-size="22" text-anchor="middle">🐍</text>
        <text x="118" y="240" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="700">2. Snake Retro Neon</text>
        <text x="118" y="260" fill="#94a3b8" font-family="sans-serif" font-size="12">Ular klasik arcade dengan kontrol D-Pad taktis</text>

        <!-- Game 3: Block Blast -->
        <rect x="36" y="300" width="528" height="80" rx="12" fill="#0f141f" stroke="#1c2436" stroke-width="1.5" />
        <rect x="52" y="315" width="50" height="50" rx="10" fill="#241434" stroke="#c084fc" stroke-width="1"/>
        <text x="77" y="347" fill="#c084fc" font-size="22" text-anchor="middle">🧩</text>
        <text x="118" y="335" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="700">3. Block Blast 8x8</text>
        <text x="118" y="355" fill="#94a3b8" font-family="sans-serif" font-size="12">Puzzle balok susun warna-warni bersihkan baris dan kolom</text>

        <!-- Game 4: 2048 -->
        <rect x="36" y="395" width="528" height="80" rx="12" fill="#0f141f" stroke="#1c2436" stroke-width="1.5" />
        <rect x="52" y="410" width="50" height="50" rx="10" fill="#2d1e0f" stroke="#fbbf24" stroke-width="1"/>
        <text x="77" y="442" fill="#fbbf24" font-size="16" font-family="monospace" font-weight="800" text-anchor="middle">2048</text>
        <text x="118" y="430" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="700">4. 2048 Number Puzzle</text>
        <text x="118" y="450" fill="#94a3b8" font-family="sans-serif" font-size="12">Geser dan gabungkan angka mencapai ubin emas 2048</text>

        <!-- Game 5: Flappy Minji -->
        <rect x="36" y="490" width="528" height="80" rx="12" fill="#0f141f" stroke="#1c2436" stroke-width="1.5" />
        <rect x="52" y="505" width="50" height="50" rx="10" fill="#15263a" stroke="#38bdf8" stroke-width="1"/>
        <text x="77" y="537" fill="#38bdf8" font-size="22" text-anchor="middle">🕊️</text>
        <text x="118" y="525" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="700">5. Flappy Minji</text>
        <text x="118" y="545" fill="#94a3b8" font-family="sans-serif" font-size="12">Ketuk untuk mengepak sayap melewati lorong pipa neon</text>

        <!-- Footer -->
        <rect x="36" y="590" width="528" height="60" rx="10" fill="#080c14" stroke="#1a2232" stroke-width="1"/>
        <text x="56" y="618" fill="#1db954" font-family="monospace" font-size="11" font-weight="700">KLAIM REWARD POIN &amp; XP KE AKUN WHATSAPP</text>
        <text x="56" y="636" fill="#94a3b8" font-family="sans-serif" font-size="11">Skor tertinggi menghasilkan token .claimreward untuk saldo Anda</text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Menghasilkan gambar card Meme Soundboard (Screenshot 084337 style)
   */
  async generateSoundboardCard(): Promise<Buffer> {
    const cardW = 600;
    const cardH = 500;

    const svg = `
      <svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cardBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#121622" />
            <stop offset="100%" stop-color="#0a0d14" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="20" fill="url(#cardBg)" stroke="#222838" stroke-width="2"/>

        <text x="36" y="44" fill="#94a3b8" font-family="monospace" font-size="12" font-weight="700" letter-spacing="1">MEME SOUNDBOARD // MINJIBOT</text>
        <text x="36" y="78" fill="#f43f5e" font-family="sans-serif" font-size="26" font-weight="800">Voice Note Dispatcher</text>
        <rect x="420" y="48" width="140" height="26" rx="6" fill="#2d121c" stroke="#f43f5e" stroke-width="1"/>
        <text x="490" y="65" fill="#f43f5e" font-family="monospace" font-size="10" font-weight="700" text-anchor="middle">11 VIRAL SOUNDS</text>

        <!-- Sound Chips Grid -->
        <rect x="36" y="110" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="50" y="138" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">💥 Vine Boom</text>
        <text x="50" y="160" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="217" y="110" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="231" y="138" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">🎺 Airhorn</text>
        <text x="231" y="160" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="398" y="110" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="412" y="138" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">🥁 Ba-Dum-Tss</text>
        <text x="412" y="160" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="36" y="195" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="50" y="223" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">😐 Bruh Sound</text>
        <text x="50" y="245" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="217" y="195" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="231" y="223" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">🔔 Taco Bell</text>
        <text x="231" y="245" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="398" y="195" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="412" y="223" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">🎻 Sad Violin</text>
        <text x="412" y="245" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="36" y="280" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="50" y="308" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">✨ Anime Wow</text>
        <text x="50" y="330" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="217" y="280" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="231" y="308" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">💨 Discord Join</text>
        <text x="231" y="330" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <rect x="398" y="280" width="165" height="70" rx="10" fill="#131826" stroke="#252f44" stroke-width="1.5" />
        <text x="412" y="308" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="700">🌟 Level Up SFX</text>
        <text x="412" y="330" fill="#1db954" font-family="monospace" font-size="10">[KIRIM VN]</text>

        <!-- Footer -->
        <rect x="36" y="380" width="528" height="85" rx="10" fill="#080c14" stroke="#1a2232" stroke-width="1"/>
        <text x="56" y="412" fill="#ffffff" font-family="sans-serif" font-size="13" font-weight="700">Putar preview di browser &amp; kirimkan VN ke grup ini</text>
        <text x="56" y="435" fill="#94a3b8" font-family="sans-serif" font-size="11">Dikonversi otomatis ke format OGG Opus PTT WhatsApp resmi</text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  private async fetchThumbnail(url?: string): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;

      const rawBuffer = Buffer.from(await res.arrayBuffer());
      return await sharp(rawBuffer)
        .resize(552, 280, { fit: "cover" })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const webCardGeneratorService = new WebCardGeneratorService();
