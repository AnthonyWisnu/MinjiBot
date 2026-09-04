import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

import { stickerService } from "./sticker.service";

export interface QuoteCardInput {
  text: string;
  authorName: string;
  authorSub?: string;
  avatarBuffer?: Buffer | null;
}

export interface TweetCardInput {
  text: string;
  authorName: string;
  authorHandle: string;
  avatarBuffer?: Buffer | null;
  dateStr?: string;
}

const QUOTE_WIDTH = 800;
const QUOTE_HEIGHT = 440;

const TWEET_WIDTH = 800;
const TWEET_HEIGHT = 440;

export class QuoteCardService {
  /**
   * Me-render aesthetic editorial quote card (Dark Glassmorphism).
   */
  async generateQuoteCard(input: QuoteCardInput): Promise<Buffer> {
    const { text, authorName, authorSub, avatarBuffer } = input;

    const safeAuthor = escapeXml(authorName.length > 25 ? `${authorName.slice(0, 23)}...` : authorName);
    const safeSub = escapeXml(authorSub ?? "MinjiBot Official Quote");

    // Wrap text into clean lines
    const maxChars = text.length > 150 ? 44 : 36;
    const lines = wrapText(text, maxChars, 6);
    const fontSize = lines.length > 4 ? 22 : 26;
    const lineHeight = fontSize + 10;

    // Center text vertically
    const totalTextHeight = lines.length * lineHeight;
    const startY = Math.max(110, Math.round(180 - totalTextHeight / 2));

    const textSpans = lines
      .map((line, idx) => {
        const y = startY + idx * lineHeight;
        return `<tspan x="260" y="${String(y)}">${escapeXml(line)}</tspan>`;
      })
      .join("");

    // Prepare circular avatar for author (120x120)
    const circularAvatar = await this.prepareCircularAvatar(avatarBuffer, 120);

    const svgBackground = Buffer.from(
      `<svg width="${String(QUOTE_WIDTH)}" height="${String(QUOTE_HEIGHT)}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0B0F19" />
            <stop offset="50%" stop-color="#111827" />
            <stop offset="100%" stop-color="#1E1B4B" />
          </linearGradient>
          <linearGradient id="accentGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#6366F1" />
            <stop offset="100%" stop-color="#EC4899" />
          </linearGradient>
          <linearGradient id="quoteGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#38BDF8" />
            <stop offset="100%" stop-color="#818CF8" />
          </linearGradient>
        </defs>

        <!-- Base Card -->
        <rect x="0" y="0" width="${String(QUOTE_WIDTH)}" height="${String(QUOTE_HEIGHT)}" rx="24" fill="url(#bg)" />

        <!-- Outer Glow Border -->
        <rect x="2" y="2" width="${String(QUOTE_WIDTH - 4)}" height="${String(QUOTE_HEIGHT - 4)}" rx="22" fill="none" stroke="#1F2937" stroke-width="2" />

        <!-- Giant Watermark Quote Sign -->
        <text x="50" y="170" font-family="Georgia, serif" font-size="200" font-weight="bold" fill="#FFFFFF" fill-opacity="0.04">“</text>

        <!-- Accent Top Bar -->
        <rect x="24" y="20" width="80" height="4" rx="2" fill="url(#accentGlow)" />

        <!-- Quote Text -->
        <text font-family="'Segoe UI', Roboto, Helvetica, sans-serif" font-size="${String(fontSize)}" font-weight="500" fill="#F8FAFC">
          ${textSpans}
        </text>

        <!-- Divider Line -->
        <line x1="260" y1="${String(startY + totalTextHeight + 25)}" x2="740" y2="${String(startY + totalTextHeight + 25)}" stroke="#334155" stroke-width="1.5" />

        <!-- Author Name & Tag -->
        <text x="260" y="${String(startY + totalTextHeight + 58)}" font-family="'Segoe UI', Roboto, Helvetica, sans-serif" font-size="20" font-weight="700" fill="url(#quoteGlow)">
          — ${safeAuthor}
        </text>
        <text x="260" y="${String(startY + totalTextHeight + 82)}" font-family="'Segoe UI', Roboto, Helvetica, sans-serif" font-size="13" font-weight="500" fill="#94A3B8">
          ${safeSub}
        </text>

        <!-- Bottom Right Branding -->
        <text x="750" y="405" text-anchor="end" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" fill="#475569" letter-spacing="1.5">MINJIBOT QUOTES</text>
      </svg>`,
    );

    // Composite circular avatar at (left: 70, top: 140)
    return sharp(svgBackground)
      .composite([
        {
          input: circularAvatar,
          top: 140,
          left: 70,
        },
      ])
      .png()
      .toBuffer();
  }

  /**
   * Konversi quote PNG menjadi WhatsApp WebP sticker resmi dengan metadata.
   */
  async generateQuoteSticker(quoteCardBuffer: Buffer): Promise<Buffer> {
    const webpRaw = await sharp(quoteCardBuffer)
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90 })
      .toBuffer();

    return stickerService.createSticker(webpRaw, "image");
  }

  /**
   * Me-render mockup postingan X (Twitter) Dark Mode viral.
   */
  async generateTweetCard(input: TweetCardInput): Promise<Buffer> {
    const { text, authorName, authorHandle, avatarBuffer, dateStr } = input;

    const safeName = escapeXml(authorName.length > 22 ? `${authorName.slice(0, 20)}...` : authorName);
    const cleanHandle = authorHandle.replace(/^@/, "");
    const safeHandle = escapeXml(cleanHandle.length > 20 ? `${cleanHandle.slice(0, 18)}...` : cleanHandle);

    // Realistic tweet date
    const dateFormatted = dateStr ?? formatTweetDate(new Date());

    // Deterministic random engagement numbers from text hash
    const metrics = computeTweetMetrics(text);

    // Wrap tweet text
    const lines = wrapText(text, 48, 5);
    const textSpans = lines
      .map((line, idx) => {
        const y = 145 + idx * 30;
        return `<tspan x="45" y="${String(y)}">${escapeXml(line)}</tspan>`;
      })
      .join("");

    // Prepare circular avatar (70x70)
    const circularAvatar = await this.prepareCircularAvatar(avatarBuffer, 70);

    const svgTemplate = Buffer.from(
      `<svg width="${String(TWEET_WIDTH)}" height="${String(TWEET_HEIGHT)}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${String(TWEET_WIDTH)}" height="${String(TWEET_HEIGHT)}" rx="20" fill="#000000" />
        <rect x="1" y="1" width="${String(TWEET_WIDTH - 2)}" height="${String(TWEET_HEIGHT - 2)}" rx="19" fill="none" stroke="#2F3336" stroke-width="1.5" />

        <!-- User Info -->
        <text x="130" y="65" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="#E7E9EA">
          ${safeName}
        </text>

        <!-- Verified Badge SVG -->
        <g transform="translate(${String(140 + Math.min(safeName.length * 11, 240))}, 48)">
          <circle cx="10" cy="10" r="10" fill="#1D9BF0" />
          <path d="M6 10 L8.5 12.5 L14 7" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </g>

        <!-- Handle -->
        <text x="130" y="92" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="400" fill="#71767B">
          @${safeHandle}
        </text>

        <!-- X Logo Top Right -->
        <path d="M 735 35 L 750 55 L 733 75 L 738 75 L 752 58 L 762 75 L 775 75 L 759 52 L 774 35 L 769 35 L 757 49 L 748 35 Z" fill="#E7E9EA" />

        <!-- Tweet Body Text -->
        <text font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="400" fill="#E7E9EA">
          ${textSpans}
        </text>

        <!-- Date & Source -->
        <text x="45" y="315" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="400" fill="#71767B">
          ${escapeXml(dateFormatted)} · <tspan fill="#1D9BF0">MinjiBot for Android</tspan>
        </text>

        <!-- Separator Line -->
        <line x1="45" y1="335" x2="755" y2="335" stroke="#2F3336" stroke-width="1" />

        <!-- Metrics Row -->
        <!-- Retweets -->
        <text x="45" y="375" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#E7E9EA">${metrics.retweets} <tspan font-weight="400" fill="#71767B">Reposts</tspan></text>
        <!-- Quotes -->
        <text x="180" y="375" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#E7E9EA">${metrics.quotes} <tspan font-weight="400" fill="#71767B">Quotes</tspan></text>
        <!-- Likes -->
        <text x="310" y="375" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#E7E9EA">${metrics.likes} <tspan font-weight="400" fill="#71767B">Likes</tspan></text>
        <!-- Bookmarks -->
        <text x="440" y="375" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#E7E9EA">${metrics.bookmarks} <tspan font-weight="400" fill="#71767B">Bookmarks</tspan></text>

        <!-- Bottom Accent -->
        <text x="755" y="415" text-anchor="end" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="600" fill="#334155">𝕏 OFFICIAL MOCKUP</text>
      </svg>`,
    );

    return sharp(svgTemplate)
      .composite([
        {
          input: circularAvatar,
          top: 35,
          left: 45,
        },
      ])
      .png()
      .toBuffer();
  }

  private async prepareCircularAvatar(avatarBuffer?: Buffer | null, size = 120): Promise<Buffer> {
    let sourceBuffer = avatarBuffer;
    sourceBuffer ??= this.getFallbackAvatar();

    const circleMaskSvg = Buffer.from(
      `<svg width="${String(size)}" height="${String(size)}"><circle cx="${String(size / 2)}" cy="${String(
        size / 2,
      )}" r="${String(size / 2)}" fill="white" /></svg>`,
    );

    try {
      if (sourceBuffer) {
        return await sharp(sourceBuffer)
          .resize(size, size, { fit: "cover" })
          .composite([{ input: circleMaskSvg, blend: "dest-in" }])
          .png()
          .toBuffer();
      }
    } catch {
      // ignore and fallback
    }

    const fallbackSvg = Buffer.from(
      `<svg width="${String(size)}" height="${String(size)}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${String(size / 2)}" cy="${String(size / 2)}" r="${String(size / 2)}" fill="#1E293B" />
        <circle cx="${String(size / 2)}" cy="${String(size * 0.38)}" r="${String(size * 0.2)}" fill="#64748B" />
        <path d="M ${String(size * 0.2)} ${String(size * 0.85)} A ${String(size * 0.3)} ${String(size * 0.3)} 0 0 1 ${String(size * 0.8)} ${String(size * 0.85)} Z" fill="#64748B" />
      </svg>`,
    );

    return sharp(fallbackSvg).png().toBuffer();
  }

  private getFallbackAvatar(): Buffer | null {
    const possiblePaths = [
      path.resolve(process.cwd(), "assets/minji.png"),
      path.resolve(process.cwd(), "src/Minji.png"),
      path.resolve(__dirname, "../../assets/minji.png"),
      path.resolve(__dirname, "../../../assets/minji.png"),
      path.resolve(__dirname, "../../Minji.png"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          return fs.readFileSync(p);
        } catch {
          // ignore
        }
      }
    }

    return null;
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

function wrapText(text: string, maxCharsPerLine: number, maxLines = 6): string[] {
  const paragraphs = text.trim().split(/\r?\n/);
  const resultLines: string[] = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;

    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + " " + word).trim();
      } else {
        if (currentLine.length > 0) {
          resultLines.push(currentLine);
        }
        currentLine = word;
        if (resultLines.length >= maxLines - 1) {
          break;
        }
      }
    }

    if (currentLine.length > 0 && resultLines.length < maxLines) {
      resultLines.push(currentLine);
    }

    if (resultLines.length >= maxLines) {
      break;
    }
  }

  if (resultLines.length === 0) {
    resultLines.push(text.slice(0, maxCharsPerLine));
  }

  return resultLines;
}

function formatTweetDate(date: Date): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  const dayMonthYear = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

  return `${time} · ${dayMonthYear}`;
}

function computeTweetMetrics(text: string): {
  retweets: string;
  quotes: string;
  likes: string;
  bookmarks: string;
} {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  const retweets = (100 + (hash % 4500)).toLocaleString("en-US");
  const quotes = (20 + (hash % 980)).toLocaleString("en-US");
  const likes = (500 + (hash % 38000)).toLocaleString("en-US");
  const bookmarks = (40 + (hash % 1200)).toLocaleString("en-US");

  return { retweets, quotes, likes, bookmarks };
}

export const quoteCardService = new QuoteCardService();
