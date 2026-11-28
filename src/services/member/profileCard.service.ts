import sharp from "sharp";

import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { clampText, escapeXml } from "../../utils/xml";
import { avatarService } from "../media/avatar.service";
import type { ProfileView } from "./memberProfileView.service";
import { getProfileThemeSpec, type ProfileThemeId } from "./profileThemes";
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
  themeId?: ProfileThemeId | null;
  featuredPet?: { label: string; level: number } | null;
  customTitle?: string | null;
}

export class ProfileCardService {
  async generateCard(input: ProfileCardInput): Promise<Buffer> {
    const { view, label, phone, role, isSuperOwner } = input;
    const { profile, rank } = view;

    const theme = getProfileThemeSpec(input.themeId);
    const isCustomTheme = theme.id !== "midnight";
    const rankColor = RANK_COLORS[rank] ?? theme.accentPrimary;
    const accentColor = isCustomTheme ? theme.accentPrimary : rankColor;
    const safeMaskedPhone = escapeXml(clampText(maskPhoneNumber(phone), 32, "..."));
    const safeName = escapeXml(clampText(label, 20, "..."));
    const safeRole = escapeXml(clampText(role.toUpperCase(), 22, "..."));
    const safeRank = escapeXml(clampText(rank.toUpperCase(), 24, "..."));
    const safeThemeName = escapeXml(clampText(theme.name.toUpperCase(), 20, "..."));
    const safeCreatedAtWib = escapeXml(clampText(view.createdAtWib, 40, "..."));
    const petBadgeText = input.featuredPet
      ? `PET: ${input.featuredPet.label.toUpperCase()} LV.${String(input.featuredPet.level)}`
      : "BELUM ADA PET";
    const safePetBadge = escapeXml(clampText(petBadgeText, 24, "..."));
    const safeCustomTitle = input.customTitle
      ? escapeXml(clampText(input.customTitle.toUpperCase(), 24, "..."))
      : null;

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
        progressPct =
          span > 0 ? Math.min(100, Math.max(5, Math.round((progress.current / span) * 100))) : 100;
        xpText = `${profile.experience.toLocaleString("id-ID")} / ${progress.next.toLocaleString("id-ID")} XP`;
      } else {
        progressPct = 100;
        xpText = `${profile.experience.toLocaleString("id-ID")} XP [MAX]`;
      }
    }

    const safeXpText = escapeXml(xpText);
    const progressBarWidth = Math.round((progressPct / 100) * 480);

    // Stats
    const pointsStr = escapeXml(
      (isSuperOwner ? 999999 : profile.pointsBalance).toLocaleString("id-ID"),
    );
    const limitStr = escapeXml(isSuperOwner ? "UNLIMITED" : String(profile.limitBalance));
    const streakStr = escapeXml(`${String(isSuperOwner ? 999 : profile.currentStreak)} Hari`);
    const winRate =
      profile.totalGamesPlayed > 0
        ? `${String(Math.round((profile.totalGamesWon / profile.totalGamesPlayed) * 100))}%`
        : "0%";
    const winRateStr = escapeXml(
      isSuperOwner
        ? "100% (999/999)"
        : `${winRate} (${String(profile.totalGamesWon)}/${String(profile.totalGamesPlayed)})`,
    );

    // 1. Prepare circular avatar
    const circularAvatar = await this.prepareCircularAvatar(input.avatarBuffer);

    // 2. Build SVG background and content
    const svg = `
<svg width="${String(CARD_WIDTH)}" height="${String(CARD_HEIGHT)}" viewBox="0 0 ${String(CARD_WIDTH)} ${String(CARD_HEIGHT)}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.bgStart}" />
      <stop offset="60%" stop-color="${theme.bgMid}" />
      <stop offset="100%" stop-color="${theme.bgEnd}" />
    </linearGradient>

    <linearGradient id="rankGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.8" />
      <stop offset="100%" stop-color="${theme.accentSecondary}" stop-opacity="0.2" />
    </linearGradient>

    <linearGradient id="xpBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${accentColor}" />
      <stop offset="100%" stop-color="${theme.accentSecondary}" />
    </linearGradient>

    <linearGradient id="boxBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${theme.boxStart}" stop-opacity="0.92" />
      <stop offset="100%" stop-color="${theme.boxEnd}" stop-opacity="0.92" />
    </linearGradient>
  </defs>

  <!-- Background base -->
  <rect width="100%" height="100%" rx="24" fill="url(#cardBg)" />
  <rect width="100%" height="100%" rx="24" fill="none" stroke="${theme.borderColor}" stroke-opacity="0.45" stroke-width="2.5" />

  <!-- Decorative ambient blur circles -->
  <circle cx="120" cy="120" r="95" fill="${theme.glowColor}" fill-opacity="0.14" filter="blur(40px)" />
  <circle cx="700" cy="350" r="115" fill="${theme.accentSecondary}" fill-opacity="0.1" filter="blur(50px)" />

  <!-- Avatar Ring & Rank Halo -->
  <circle cx="130" cy="155" r="76" fill="none" stroke="${accentColor}" stroke-width="4" stroke-opacity="0.85" />
  <circle cx="130" cy="155" r="82" fill="none" stroke="${theme.accentSecondary}" stroke-width="1" stroke-dasharray="6,6" stroke-opacity="0.55" />

  <!-- Rank Badge Pill below avatar -->
  <rect x="48" y="248" width="164" height="32" rx="16" fill="${rankColor}" />
  <text x="130" y="269" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#0f172a" text-anchor="middle">
    ${safeRank}
  </text>

  <!-- Featured Pet Companion Pill -->
  <rect x="42" y="292" width="176" height="30" rx="15" fill="url(#boxBg)" stroke="${input.featuredPet ? accentColor : theme.boxStroke}" stroke-width="1.2" />
  <text x="130" y="311" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="${input.featuredPet ? theme.accentSecondary : "#94A3B8"}" text-anchor="middle">
    ${safePetBadge}
  </text>

  <!-- Left Header & Name Info -->
  <text x="250" y="76" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="#F8FAFC">
    ${safeName}
  </text>
  <text x="250" y="104" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#94A3B8">
    ${safeMaskedPhone}${safeCustomTitle ? `  •  ${safeCustomTitle}` : ""}
  </text>

  <!-- Role & Theme Badges -->
  <rect x="250" y="120" width="148" height="24" rx="12" fill="${theme.boxStart}" stroke="${theme.boxStroke}" stroke-width="1" />
  <text x="324" y="136" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#E2E8F0" text-anchor="middle">
    ${safeRole}
  </text>
  <rect x="408" y="120" width="168" height="24" rx="12" fill="${theme.boxEnd}" stroke="${accentColor}" stroke-opacity="0.65" stroke-width="1" />
  <text x="492" y="136" font-family="Arial, Helvetica, sans-serif" font-size="10.5" font-weight="bold" fill="${accentColor}" text-anchor="middle">
    TEMA: ${safeThemeName}
  </text>

  <!-- XP Section -->
  <text x="250" y="178" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#E2E8F0">
    PROGRES TIER
  </text>
  <text x="730" y="178" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="${accentColor}" text-anchor="end">
    ${safeXpText}
  </text>

  <!-- Progress Bar Track & Fill -->
  <rect x="250" y="190" width="480" height="14" rx="7" fill="${theme.boxEnd}" stroke="${theme.boxStroke}" stroke-width="1" />
  <rect x="250" y="190" width="${String(progressBarWidth)}" height="14" rx="7" fill="url(#xpBar)" />

  <!-- 4 Stat Boxes (2x2 Grid) -->
  <!-- Box 1: Poin -->
  <rect x="250" y="226" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="${theme.boxStroke}" stroke-width="1" />
  <text x="270" y="252" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    POIN SALDO
  </text>
  <text x="270" y="284" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#FBBF24">
    ${pointsStr} Poin
  </text>

  <!-- Box 2: Limit -->
  <rect x="500" y="226" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="${theme.boxStroke}" stroke-width="1" />
  <text x="520" y="252" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    KUOTA LIMIT
  </text>
  <text x="520" y="284" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="${accentColor}">
    ${limitStr}
  </text>

  <!-- Box 3: Streak -->
  <rect x="250" y="316" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="${theme.boxStroke}" stroke-width="1" />
  <text x="270" y="342" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    DAILY STREAK
  </text>
  <text x="270" y="374" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#FB923C">
    ${streakStr}
  </text>

  <!-- Box 4: Win Rate -->
  <rect x="500" y="316" width="230" height="74" rx="14" fill="url(#boxBg)" stroke="${theme.boxStroke}" stroke-width="1" />
  <text x="520" y="342" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#94A3B8">
    GAME WIN RATE
  </text>
  <text x="520" y="374" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="bold" fill="${theme.accentSecondary}">
    ${winRateStr}
  </text>

  <!-- Footer Watermark -->
  <text x="55" y="420" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#94A3B8">
    MINJIBOT ECOSYSTEM • VERIFIED MEMBER CARD
  </text>
  <text x="730" y="420" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#94A3B8" text-anchor="end">
    Bergabung: ${safeCreatedAtWib}
  </text>
</svg>
`;

    // 3. Render base card
    const cardBaseBuffer = await sharp(Buffer.from(svg), {
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .png()
      .toBuffer();

    // 4. Composite avatar onto base card at (x=55, y=80)
    return sharp(cardBaseBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
      .composite([
        {
          input: circularAvatar,
          top: 80,
          left: 55,
        },
      ])
      .png()
      .toBuffer();
  }

  private async prepareCircularAvatar(avatarBuffer?: Buffer | null): Promise<Buffer> {
    let sourceBuffer = avatarBuffer;
    sourceBuffer ??= avatarService.getFallbackAvatar();

    const AVATAR_SIZE = 150;
    const circleMaskSvg = Buffer.from(
      `<svg width="${String(AVATAR_SIZE)}" height="${String(AVATAR_SIZE)}"><circle cx="${String(
        AVATAR_SIZE / 2,
      )}" cy="${String(AVATAR_SIZE / 2)}" r="${String(AVATAR_SIZE / 2)}" fill="white" /></svg>`,
    );

    try {
      return await sharp(sourceBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
        .composite([{ input: circleMaskSvg, blend: "dest-in" }])
        .png()
        .toBuffer();
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

    return sharp(fallbackSvg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).png().toBuffer();
  }
}

function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  const prefix = digits.slice(0, 4);
  const suffix = digits.slice(-3);
  return `+${prefix}-****-${suffix}`;
}

export const profileCardService = new ProfileCardService();
