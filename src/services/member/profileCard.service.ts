import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

import type { ProfileView } from "./memberProfileView.service";
import { rankProgress } from "./rank.service";

const CARD_WIDTH = 800;
const CARD_HEIGHT = 450;

const RANK_COLORS: Record<string, string> = {
  Warrior: "#94A3B8",
  Elite: "#38BDF8",
  Master: "#34D399",
  Grandmaster: "#A855F7",
  Epic: "#F43F5E",
  Legend: "#F59E0B",
  Mythic: "#EF4444",
  "Immortal [MAX]": "#EC4899",
};

export interface ProfileCardInput {
  view: ProfileView;
  label: string;
  phone: string;
  role: string;
  isSuperOwner?: boolean;
  avatarBuffer?: Buffer | null;
}

export class ProfileCardService {
  async generateCard(input: ProfileCardInput): Promise<Buffer> {
    const { view, label, phone, role, isSuperOwner } = input;
    const { profile, rank } = view;

    const rankColor = RANK_COLORS[rank] ?? "#38BDF8";
    const maskedPhone = maskPhoneNumber(phone);
    const safeName = escapeXml(label.length > 20 ? `${label.slice(0, 18)}...` : label);
    const safeRole = escapeXml(role.toUpperCase());
    const safeRank = escapeXml(rank.toUpperCase());

    // XP calculation
    let xpText = "";
    let progressPct = 100;

    if (isSuperOwner) {
      xpText = "999.999 XP [MAX]";
      progressPct = 100;
    } else {
      const progress = rankProgress(profile.experience);
      if (progress.next !== null) {
        const span = progress.next - progress.threshold;
        progressPct = span > 0 ? Math.min(100, Math.max(5, Math.round((progress.current / span) * 100))) : 100;
        xpText = `${profile.experience.toLocaleString("id-ID")} / ${progress.next.toLocaleString("id-ID")} XP`;
      } else {
        progressPct = 100;
        xpText = `${profile.experience.toLocaleString("id-ID")} XP [MAX]`;
      }
    }

    const progressBarWidth = Math.round((progressPct / 100) * 480);

    // Stats
    const pointsStr = (isSuperOwner ? 999999 : profile.pointsBalance).toLocaleString("id-ID");
    const limitStr = isSuperOwner ? "UNLIMITED" : String(profile.limitBalance);
    const streakStr = `${String(isSuperOwner ? 999 : profile.currentStreak)} Hari`;
    const winRate =
      profile.totalGamesPlayed > 0
        ? `${String(Math.round((profile.totalGamesWon / profile.totalGamesPlayed) * 100))}%`
        : "0%";
    const winRateStr = isSuperOwner ? "100% (999/999)" : `${winRate} (${String(profile.totalGamesWon)}/${String(profile.totalGamesPlayed)})`;

    // 1. Prepare circular avatar
    const circularAvatar = await this.prepareCircularAvatar(input.avatarBuffer);

    // 2. Build SVG background and content
    const svg = `
<svg width="${String(CARD_WIDTH)}" height="${String(CARD_HEIGHT)}" viewBox="0 0 ${String(CARD_WIDTH)} ${String(CARD_HEIGHT)}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19" />
      <stop offset="60%" stop-color="#111827" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>

    <linearGradient id="rankGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${rankColor}" stop-opacity="0.8" />
      <stop offset="100%" stop-color="${rankColor}" stop-opacity="0.2" />
    </linearGradient>

    <linearGradient id="xpBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${rankColor}" />
      <stop offset="100%" stop-color="#38BDF8" />
    </linearGradient>

    <linearGradient id="boxBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.9" />
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.9" />
    </linearGradient>
  </defs>

  <!-- Background base -->
  <rect width="100%" height="100%" rx="24" fill="url(#cardBg)" />
  <rect width="100%" height="100%" rx="24" fill="none" stroke="${rankColor}" stroke-opacity="0.3" stroke-width="2" />

  <!-- Decorative ambient blur circles -->
  <circle cx="120" cy="120" r="90" fill="${rankColor}" fill-opacity="0.1" filter="blur(40px)" />
  <circle cx="700" cy="350" r="110" fill="#38BDF8" fill-opacity="0.08" filter="blur(50px)" />

  <!-- Avatar Ring & Rank Halo -->
  <circle cx="130" cy="160" r="76" fill="none" stroke="${rankColor}" stroke-width="4" stroke-opacity="0.8" />
  <circle cx="130" cy="160" r="82" fill="none" stroke="${rankColor}" stroke-width="1" stroke-dasharray="6,6" stroke-opacity="0.5" />

  <!-- Rank Badge Pill below avatar -->
  <rect x="55" y="255" width="150" height="34" rx="17" fill="${rankColor}" />
  <text x="130" y="278" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#0f172a" text-anchor="middle">
    ${safeRank}
  </text>

  <!-- Left Header & Name Info -->
  <text x="250" y="82" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="#F8FAFC">
    ${safeName}
  </text>
  <text x="250" y="110" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#94A3B8">
    ${maskedPhone}
  </text>

  <!-- Role Badge -->
  <rect x="250" y="125" width="140" height="24" rx="12" fill="#334155" />
  <text x="320" y="142" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#E2E8F0" text-anchor="middle">
    ${safeRole}
  </text>

  <!-- XP Section -->
  <text x="250" y="182" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#E2E8F0">
    PROGRES TIER
  </text>
  <text x="730" y="182" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="${rankColor}" text-anchor="end">
    ${xpText}
  </text>

  <!-- Progress Bar Track & Fill -->
  <rect x="250" y="194" width="480" height="14" rx="7" fill="#1e293b" stroke="#334155" stroke-width="1" />
  <rect x="250" y="194" width="${String(progressBarWidth)}" height="14" rx="7" fill="url(#xpBar)" />

  <!-- 4 Stat Boxes (2x2 Grid) -->
  <!-- Box 1: Poin -->
  <rect x="250" y="230" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="#334155" stroke-width="1" />
  <text x="270" y="256" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    POIN SALDO
  </text>
  <text x="270" y="288" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#FBBF24">
    🪙 ${pointsStr}
  </text>

  <!-- Box 2: Limit -->
  <rect x="500" y="230" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="#334155" stroke-width="1" />
  <text x="520" y="256" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    KUOTA LIMIT
  </text>
  <text x="520" y="288" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#38BDF8">
    ⚡ ${limitStr}
  </text>

  <!-- Box 3: Streak -->
  <rect x="250" y="320" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="#334155" stroke-width="1" />
  <text x="270" y="346" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    DAILY STREAK
  </text>
  <text x="270" y="378" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#FB923C">
    🔥 ${streakStr}
  </text>

  <!-- Box 4: Win Rate -->
  <rect x="500" y="320" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="#334155" stroke-width="1" />
  <text x="520" y="346" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    GAME WIN RATE
  </text>
  <text x="520" y="378" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="bold" fill="#A855F7">
    🎮 ${winRateStr}
  </text>

  <!-- Footer Watermark -->
  <text x="55" y="420" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#64748B">
    MINJIBOT ECOSYSTEM • VERIFIED MEMBER CARD
  </text>
  <text x="730" y="420" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#64748B" text-anchor="end">
    Bergabung: ${view.createdAtWib}
  </text>
</svg>
`;

    // 3. Render base card
    const cardBaseBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // 4. Composite avatar onto base card at (x=55, y=85)
    return sharp(cardBaseBuffer)
      .composite([
        {
          input: circularAvatar,
          top: 85,
          left: 55,
        },
      ])
      .png()
      .toBuffer();
  }

  private async prepareCircularAvatar(avatarBuffer?: Buffer | null): Promise<Buffer> {
    let sourceBuffer = avatarBuffer;
    sourceBuffer ??= this.getFallbackAvatar();

    const AVATAR_SIZE = 150;
    const circleMaskSvg = Buffer.from(
      `<svg width="${String(AVATAR_SIZE)}" height="${String(AVATAR_SIZE)}"><circle cx="${String(
        AVATAR_SIZE / 2,
      )}" cy="${String(AVATAR_SIZE / 2)}" r="${String(AVATAR_SIZE / 2)}" fill="white" /></svg>`,
    );

    try {
      if (sourceBuffer) {
        return await sharp(sourceBuffer)
          .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
          .composite([{ input: circleMaskSvg, blend: "dest-in" }])
          .png()
          .toBuffer();
      }
    } catch {
      // ignore and fallback
    }

    // Default SVG placeholder avatar if reading image fails
    const fallbackSvg = Buffer.from(
      `<svg width="${String(AVATAR_SIZE)}" height="${String(AVATAR_SIZE)}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${String(AVATAR_SIZE / 2)}" cy="${String(AVATAR_SIZE / 2)}" r="${String(AVATAR_SIZE / 2)}" fill="#334155" />
        <circle cx="${String(AVATAR_SIZE / 2)}" cy="55" r="28" fill="#94A3B8" />
        <path d="M 35 125 A 40 40 0 0 1 115 125 Z" fill="#94A3B8" />
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

function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  const prefix = digits.slice(0, 4);
  const suffix = digits.slice(-3);
  return `+${prefix}-****-${suffix}`;
}

export const profileCardService = new ProfileCardService();
