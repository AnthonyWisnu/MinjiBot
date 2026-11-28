import sharp from "sharp";

import { mediaQueueService } from "../../utils/boundedQueue";
import { formatCompactRupiah } from "../../utils/currency";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { clampText, escapeXml, stripInvalidXmlChars } from "../../utils/xml";
import type { GachaCardSpec, GachaRarity } from "../rpg/rpgExpansionCatalog";

const CARD_WIDTH = 600;
const CARD_HEIGHT = 840;

interface RarityTheme {
  bgStart: string;
  bgEnd: string;
  borderOuter: string;
  borderInner: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  stars: string;
  tierLabel: string;
}

const RARITY_THEMES: Record<GachaRarity, RarityTheme> = {
  R: {
    bgStart: "#0B192C",
    bgEnd: "#17375E",
    borderOuter: "#38BDF8",
    borderInner: "#0EA5E9",
    accent: "#7DD3FC",
    badgeBg: "#0284C7",
    badgeText: "#F8FAFC",
    stars: "★ ★",
    tierLabel: "RARE",
  },
  SR: {
    bgStart: "#1E1038",
    bgEnd: "#3B186B",
    borderOuter: "#C084FC",
    borderInner: "#9333EA",
    accent: "#E9D5FF",
    badgeBg: "#7E22CE",
    badgeText: "#FAF5FF",
    stars: "★ ★ ★",
    tierLabel: "SUPER RARE",
  },
  SSR: {
    bgStart: "#2B1906",
    bgEnd: "#5C3508",
    borderOuter: "#FDE047",
    borderInner: "#EAB308",
    accent: "#FEF08A",
    badgeBg: "#CA8A04",
    badgeText: "#1C1917",
    stars: "★ ★ ★ ★",
    tierLabel: "SUPER SPECIAL RARE",
  },
  UR: {
    bgStart: "#2A081C",
    bgEnd: "#6B0F3A",
    borderOuter: "#FB7185",
    borderInner: "#F43F5E",
    accent: "#FDA4AF",
    badgeBg: "#E11D48",
    badgeText: "#FFF1F2",
    stars: "★ ★ ★ ★ ★",
    tierLabel: "ULTRA RARE",
  },
};

function wrapQuoteLines(text: string, maxChars = 34): [string, string] {
  const clean = stripInvalidXmlChars(text).trim();
  if (clean.length <= maxChars) {
    return [clean, ""];
  }
  const splitIdx = clean.lastIndexOf(" ", maxChars);
  if (splitIdx > 10) {
    return [clean.slice(0, splitIdx).trim(), clampText(clean.slice(splitIdx + 1).trim(), maxChars)];
  }
  return [clean.slice(0, maxChars), clampText(clean.slice(maxChars), maxChars)];
}

export interface GachaCardRenderInput {
  card: GachaCardSpec;
  ownerLabel: string;
  isNew: boolean;
  ownedCopies: number;
  cashbackMoney?: bigint;
}

export class GachaCardService {
  async renderCard(input: GachaCardRenderInput): Promise<Buffer> {
    const { card, ownerLabel, isNew, ownedCopies, cashbackMoney } = input;
    const theme = RARITY_THEMES[card.rarity];
    const safeName = escapeXml(clampText(stripInvalidXmlChars(card.name), 26, ""));
    const safeSub = escapeXml(clampText(stripInvalidXmlChars(card.subtitle), 32, ""));
    const safeOwner = escapeXml(clampText(stripInvalidXmlChars(ownerLabel), 24, ""));
    const [q1, q2] = wrapQuoteLines(`"${card.quote}"`, 36);
    const safeQ1 = escapeXml(q1);
    const safeQ2 = escapeXml(q2);
    const powerWidth = Math.max(40, Math.min(440, Math.round((card.power / 1000) * 440)));

    const statusBanner = isNew
      ? "KARTU BARU TERBUKA"
      : `DUPLIKAT (x${String(ownedCopies)}) +${formatCompactRupiah(cashbackMoney ?? card.duplicateCashback)}`;
    const safeStatus = escapeXml(statusBanner);

    const svg = Buffer.from(
      [
        `<svg width="${String(CARD_WIDTH)}" height="${String(CARD_HEIGHT)}" xmlns="http://www.w3.org/2000/svg">`,
        `  <defs>`,
        `    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">`,
        `      <stop offset="0%" stop-color="${theme.bgStart}"/>`,
        `      <stop offset="100%" stop-color="${theme.bgEnd}"/>`,
        `    </linearGradient>`,
        `    <linearGradient id="foil" x1="0%" y1="0%" x2="100%" y2="0%">`,
        `      <stop offset="0%" stop-color="${theme.borderOuter}"/>`,
        `      <stop offset="50%" stop-color="${theme.accent}"/>`,
        `      <stop offset="100%" stop-color="${theme.borderInner}"/>`,
        `    </linearGradient>`,
        `  </defs>`,
        `  <rect width="600" height="840" rx="34" fill="url(#cardBg)"/>`,
        `  <rect x="14" y="14" width="572" height="812" rx="26" fill="none" stroke="url(#foil)" stroke-width="6"/>`,
        `  <rect x="28" y="28" width="544" height="784" rx="18" fill="none" stroke="${theme.borderInner}" stroke-width="1.5" opacity="0.65"/>`,
        `  <rect x="46" y="46" width="120" height="44" rx="12" fill="${theme.badgeBg}"/>`,
        `  <text x="106" y="76" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="${theme.badgeText}">${card.rarity}</text>`,
        `  <text x="554" y="76" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="${theme.accent}">#${card.serial} / 020</text>`,
        `  <text x="300" y="128" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" fill="${theme.borderOuter}" letter-spacing="6">${theme.stars}</text>`,
        `  <rect x="52" y="148" width="496" height="296" rx="20" fill="#090D16" fill-opacity="0.52" stroke="${theme.borderInner}" stroke-width="2"/>`,
        `  <circle cx="300" cy="296" r="106" fill="${theme.badgeBg}" fill-opacity="0.22" stroke="${theme.borderOuter}" stroke-width="3"/>`,
        `  <polygon points="300,204 380,296 300,388 220,296" fill="${theme.borderInner}" fill-opacity="0.28" stroke="${theme.accent}" stroke-width="2.5"/>`,
        `  <text x="300" y="314" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="64" font-weight="bold" fill="${theme.accent}">${card.rarity}</text>`,
        `  <text x="300" y="424" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="bold" fill="${theme.accent}" letter-spacing="4">${theme.tierLabel}</text>`,
        `  <text x="300" y="498" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" font-weight="bold" fill="#FFFFFF">${safeName}</text>`,
        `  <text x="300" y="534" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="21" fill="${theme.accent}">${safeSub}</text>`,
        `  <rect x="64" y="562" width="472" height="68" rx="14" fill="#090D16" fill-opacity="0.45"/>`,
        `  <text x="80" y="588" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" font-weight="bold" fill="#CBD5E1">POWER RATING</text>`,
        `  <text x="520" y="588" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="${theme.borderOuter}">${String(card.power)} / 1000</text>`,
        `  <rect x="80" y="602" width="440" height="14" rx="7" fill="#1E293B"/>`,
        `  <rect x="80" y="602" width="${String(powerWidth)}" height="14" rx="7" fill="url(#foil)"/>`,
        `  <text x="300" y="676" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="19" font-style="italic" fill="#E2E8F0">${safeQ1}</text>`,
        safeQ2
          ? `  <text x="300" y="704" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="19" font-style="italic" fill="#E2E8F0">${safeQ2}</text>`
          : "",
        `  <rect x="70" y="726" width="460" height="42" rx="12" fill="${theme.badgeBg}"/>`,
        `  <text x="300" y="754" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="bold" fill="${theme.badgeText}">${safeStatus}</text>`,
        `  <text x="52" y="798" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" fill="#94A3B8">Kolektor: ${safeOwner}</text>`,
        `  <text x="548" y="798" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" fill="#94A3B8">MinjiBot Gacha</text>`,
        `</svg>`,
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );

    return mediaQueueService.imageComputeQueue.run(async () =>
      sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).png().toBuffer(),
    );
  }
}

export const gachaCardService = new GachaCardService();
