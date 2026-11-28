import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

import { mediaQueueService } from "../../utils/boundedQueue";
import { formatCompactRupiah } from "../../utils/currency";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { clampText, escapeXml, stripInvalidXmlChars } from "../../utils/xml";

export type EventBannerScene =
  | "kpk_ott"
  | "penjara_ronda"
  | "masuk_ugd"
  | "jackpot_sultan"
  | "debt_collector"
  | "dana_kaget"
  | "world_boss"
  | "istana_presiden";

interface SceneTheme {
  fileName: string;
  ribbonText: string;
  ribbonBg: string;
  ribbonFg: string;
  ringColor: string;
  accentColor: string;
  fallbackStart: string;
  fallbackEnd: string;
  tickerText: string;
}

const SCENE_THEMES: Record<EventBannerScene, SceneTheme> = {
  kpk_ott: {
    fileName: "kpk_ott.jpg",
    ribbonText: "BREAKING NEWS  |  OPERASI TANGKAP TANGAN KPK",
    ribbonBg: "#DC2626",
    ribbonFg: "#FFFFFF",
    ringColor: "#F97316",
    accentColor: "#FDBA74",
    fallbackStart: "#2A0A0A",
    fallbackEnd: "#0F172A",
    tickerText: "LIVE REPORT MINJIBOT TV  •  TIDAK ADA AMPUN BAGI KORUPTOR GRUP",
  },
  penjara_ronda: {
    fileName: "penjara_ronda.jpg",
    ribbonText: "LAPORAN RONDA MALAM  |  MALING TERTANGKAP BASAH",
    ribbonBg: "#1D4ED8",
    ribbonFg: "#FFFFFF",
    ringColor: "#60A5FA",
    accentColor: "#93C5FD",
    fallbackStart: "#0B162C",
    fallbackEnd: "#1E293B",
    tickerText: "POS RONDA GRUP  •  SIMPAN UANGMU DI .ATM AGAR AMAN DARI MALING",
  },
  masuk_ugd: {
    fileName: "masuk_ugd.jpg",
    ribbonText: "DARURAT MEDIS  |  PASIEN MASUK RUANG UGD",
    ribbonBg: "#BE123C",
    ribbonFg: "#FFFFFF",
    ringColor: "#FB7185",
    accentColor: "#FDA4AF",
    fallbackStart: "#2B0914",
    fallbackEnd: "#0F172A",
    tickerText: "RSUD MINJIBOT  •  GUNAKAN .BEBASUGD ATAU ASURANSI BPJS SULTAN",
  },
  jackpot_sultan: {
    fileName: "jackpot_sultan.jpg",
    ribbonText: "JACKPOT SULTAN  |  KEMENANGAN BESAR GRUP",
    ribbonBg: "#CA8A04",
    ribbonFg: "#0F172A",
    ringColor: "#FDE047",
    accentColor: "#FEF08A",
    fallbackStart: "#2D1C04",
    fallbackEnd: "#0F172A",
    tickerText: "HALL OF SULTAN  •  SALDO MELEDAK! SIAP-SIAP DIPAJAKI WARGA",
  },
  debt_collector: {
    fileName: "debt_collector.jpg",
    ribbonText: "PERINGATAN PINJOL  |  RAZIA DEBT COLLECTOR",
    ribbonBg: "#991B1B",
    ribbonFg: "#FFFFFF",
    ringColor: "#EF4444",
    accentColor: "#FCA5A5",
    fallbackStart: "#240808",
    fallbackEnd: "#18181B",
    tickerText: "KOPERASI MINJI  •  LUNASI TAGIHAN LEWAT .BAYARUTANG SEGERA",
  },
  dana_kaget: {
    fileName: "dana_kaget.jpg",
    ribbonText: "REBUTAN GRUP  |  DANA KAGET SULTAN TERBUKA",
    ribbonBg: "#B45309",
    ribbonFg: "#FFFFFF",
    ringColor: "#FBBF24",
    accentColor: "#FDE68A",
    fallbackStart: "#321606",
    fallbackEnd: "#171717",
    tickerText: "SIAPA CEPAT DIA DAPAT  •  KETIK .AMBILKAGET SEKARANG JUGA",
  },
  world_boss: {
    fileName: "world_boss.jpg",
    ribbonText: "WORLD BOSS RAID  |  ANCAMAN RAKSASA MUNCUL",
    ribbonBg: "#7E22CE",
    ribbonFg: "#FFFFFF",
    ringColor: "#C084FC",
    accentColor: "#E9D5FF",
    fallbackStart: "#1F0A33",
    fallbackEnd: "#0F172A",
    tickerText: "ARENA RAID GRUP  •  KEROYOK BOSS BARENG DENGAN .SERANGBOSS",
  },
  istana_presiden: {
    fileName: "istana_presiden.jpg",
    ribbonText: "BERITA ISTANA  |  POLITIK & PEMERINTAHAN GRUP",
    ribbonBg: "#A16207",
    ribbonFg: "#FFFFFF",
    ringColor: "#FACC15",
    accentColor: "#FEF08A",
    fallbackStart: "#261905",
    fallbackEnd: "#111827",
    tickerText: "ISTANA NEGARA GRUP  •  SUARA WARGA MENENTUKAN TAKDIR KAS GRUP",
  },
};

const BANNER_W = 720;
const BANNER_H = 450;
const AVATAR_SIZE = 164;
const EVENTS_DIR = path.resolve(process.cwd(), "assets", "events");

export interface EventBannerInput {
  scene: EventBannerScene;
  headline: string;
  subjectName: string;
  details: string[];
  avatarBuffer?: Buffer | null;
}

export interface SultanBlackCardInput {
  memberName: string;
  customTitle: string | null;
  rank: string;
  level: number;
  prestige: number;
  netWorth: bigint;
  cashBalance: bigint;
  bankBalance: bigint;
  investAndAssetValue: bigint;
  wealthPosition: number;
  avatarBuffer?: Buffer | null;
}

async function createCircularAvatar(buffer: Buffer, size: number): Promise<Buffer> {
  const maskSvg = Buffer.from(
    `<svg width="${String(size)}" height="${String(size)}" xmlns="http://www.w3.org/2000/svg"><circle cx="${String(size / 2)}" cy="${String(size / 2)}" r="${String(size / 2)}" fill="#ffffff"/></svg>`,
  );

  return sharp(buffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
    .rotate()
    .resize(size, size, { fit: "cover" })
    .ensureAlpha()
    .composite([{ input: maskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export class EventBannerService {
  private readonly bgCache = new Map<EventBannerScene, Buffer>();

  private async loadSceneBackground(scene: EventBannerScene): Promise<Buffer> {
    const cached = this.bgCache.get(scene);
    if (cached) return cached;

    const theme = SCENE_THEMES[scene];
    const fullPath = path.join(EVENTS_DIR, theme.fileName);

    try {
      const fileBuf = await readFile(fullPath);
      const resized = await sharp(fileBuf, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .resize(BANNER_W, BANNER_H, { fit: "cover" })
        .jpeg({ quality: 84 })
        .toBuffer();
      this.bgCache.set(scene, resized);
      return resized;
    } catch {
      const fallbackSvg = Buffer.from(
        [
          `<svg width="${String(BANNER_W)}" height="${String(BANNER_H)}" xmlns="http://www.w3.org/2000/svg">`,
          `  <defs>`,
          `    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">`,
          `      <stop offset="0%" stop-color="${theme.fallbackStart}"/>`,
          `      <stop offset="100%" stop-color="${theme.fallbackEnd}"/>`,
          `    </linearGradient>`,
          `  </defs>`,
          `  <rect width="720" height="450" fill="url(#bg)"/>`,
          `  <circle cx="620" cy="95" r="170" fill="${theme.ringColor}" opacity="0.14"/>`,
          `  <circle cx="120" cy="360" r="140" fill="${theme.ribbonBg}" opacity="0.14"/>`,
          `</svg>`,
        ].join("\n"),
      );
      const rendered = await sharp(fallbackSvg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .jpeg({ quality: 84 })
        .toBuffer();
      this.bgCache.set(scene, rendered);
      return rendered;
    }
  }

  async renderEventBanner(input: EventBannerInput): Promise<Buffer> {
    const theme = SCENE_THEMES[input.scene];
    const safeHeadline = escapeXml(clampText(stripInvalidXmlChars(input.headline), 30, ""));
    const safeSubject = escapeXml(clampText(stripInvalidXmlChars(input.subjectName), 28, ""));
    const safeDetails = input.details
      .slice(0, 3)
      .map((line) => escapeXml(clampText(stripInvalidXmlChars(line), 44, "")));

    return mediaQueueService.imageComputeQueue.run(async () => {
      const bg = await this.loadSceneBackground(input.scene);
      let circularAvatar: Buffer | null = null;
      if (input.avatarBuffer && input.avatarBuffer.byteLength > 0) {
        try {
          circularAvatar = await createCircularAvatar(input.avatarBuffer, AVATAR_SIZE);
        } catch {
          circularAvatar = null;
        }
      }

      const detailY = [248, 286, 324];
      const detailNodes = safeDetails
        .map(
          (line, idx) =>
            `  <text x="242" y="${String(detailY[idx] ?? 324)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#F1F5F9">${line}</text>`,
        )
        .join("\n");

      const avatarCenterX = 122;
      const avatarCenterY = 225;

      const overlaySvg = Buffer.from(
        [
          `<svg width="${String(BANNER_W)}" height="${String(BANNER_H)}" xmlns="http://www.w3.org/2000/svg">`,
          `  <defs>`,
          `    <linearGradient id="scrim" x1="0%" y1="0%" x2="100%" y2="0%">`,
          `      <stop offset="0%" stop-color="#050811" stop-opacity="0.82"/>`,
          `      <stop offset="65%" stop-color="#050811" stop-opacity="0.72"/>`,
          `      <stop offset="100%" stop-color="#050811" stop-opacity="0.48"/>`,
          `    </linearGradient>`,
          `  </defs>`,
          `  <rect width="720" height="450" fill="url(#scrim)"/>`,
          `  <rect x="0" y="0" width="720" height="48" fill="${theme.ribbonBg}"/>`,
          `  <circle cx="24" cy="24" r="7" fill="${theme.ribbonFg}"/>`,
          `  <text x="44" y="31" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="bold" fill="${theme.ribbonFg}" letter-spacing="1.2">${escapeXml(theme.ribbonText)}</text>`,
          `  <rect x="24" y="68" width="672" height="316" rx="20" fill="#090D18" fill-opacity="0.62" stroke="${theme.ringColor}" stroke-width="2" stroke-opacity="0.75"/>`,
          `  <circle cx="${String(avatarCenterX)}" cy="${String(avatarCenterY)}" r="${String(AVATAR_SIZE / 2 + 8)}" fill="none" stroke="${theme.ringColor}" stroke-width="5"/>`,
          `  <circle cx="${String(avatarCenterX)}" cy="${String(avatarCenterY)}" r="${String(AVATAR_SIZE / 2)}" fill="#1E293B"/>`,
          !circularAvatar
            ? `  <text x="${String(avatarCenterX)}" y="${String(avatarCenterY + 14)}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="42" font-weight="bold" fill="${theme.accentColor}">MB</text>`
            : "",
          `  <text x="242" y="138" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="bold" fill="#FFFFFF">${safeHeadline}</text>`,
          `  <rect x="242" y="152" width="420" height="3" fill="${theme.ringColor}" opacity="0.85"/>`,
          `  <text x="242" y="196" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" font-weight="bold" fill="${theme.accentColor}">${safeSubject}</text>`,
          detailNodes,
          `  <rect x="0" y="406" width="720" height="44" fill="#020617" fill-opacity="0.92"/>`,
          `  <rect x="0" y="406" width="720" height="2" fill="${theme.ringColor}"/>`,
          `  <text x="360" y="434" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="bold" fill="#E2E8F0" letter-spacing="0.8">${escapeXml(theme.tickerText)}</text>`,
          `</svg>`,
        ]
          .filter((line) => line.length > 0)
          .join("\n"),
      );

      const layers: OverlayOptions[] = [{ input: overlaySvg, top: 0, left: 0 }];
      if (circularAvatar) {
        layers.push({
          input: circularAvatar,
          top: avatarCenterY - AVATAR_SIZE / 2,
          left: avatarCenterX - AVATAR_SIZE / 2,
        });
      }

      return sharp(bg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .composite(layers)
        .jpeg({ quality: 82 })
        .toBuffer();
    });
  }

  async renderSultanBlackCard(input: SultanBlackCardInput): Promise<Buffer> {
    const W = 700;
    const H = 420;
    const avatarDiameter = 104;
    const safeName = escapeXml(clampText(stripInvalidXmlChars(input.memberName), 24, ""));
    const safeTitle = escapeXml(
      clampText(stripInvalidXmlChars(input.customTitle ?? "SULTAN MEMBER"), 28, ""),
    );
    const safeRank = escapeXml(`${input.rank} • Lv.${String(input.level)}`);
    const stars =
      input.prestige > 0
        ? `PRESTIGE ${"★".repeat(Math.min(5, input.prestige))}${input.prestige > 5 ? `+${String(input.prestige - 5)}` : ""}`
        : "STANDARD TIER";
    const wealthRankText =
      input.wealthPosition > 0 ? `TOP #${String(input.wealthPosition)} TERKAYA` : "SULTAN GRUP";

    return mediaQueueService.imageComputeQueue.run(async () => {
      let circularAvatar: Buffer | null = null;
      if (input.avatarBuffer && input.avatarBuffer.byteLength > 0) {
        try {
          circularAvatar = await createCircularAvatar(input.avatarBuffer, avatarDiameter);
        } catch {
          circularAvatar = null;
        }
      }

      const svg = Buffer.from(
        [
          `<svg width="${String(W)}" height="${String(H)}" xmlns="http://www.w3.org/2000/svg">`,
          `  <defs>`,
          `    <linearGradient id="obsidian" x1="0%" y1="0%" x2="100%" y2="100%">`,
          `      <stop offset="0%" stop-color="#09090B"/>`,
          `      <stop offset="50%" stop-color="#18181B"/>`,
          `      <stop offset="100%" stop-color="#09090B"/>`,
          `    </linearGradient>`,
          `    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">`,
          `      <stop offset="0%" stop-color="#B45309"/>`,
          `      <stop offset="45%" stop-color="#FDE047"/>`,
          `      <stop offset="100%" stop-color="#CA8A04"/>`,
          `    </linearGradient>`,
          `  </defs>`,
          `  <rect width="700" height="420" rx="28" fill="url(#obsidian)"/>`,
          `  <rect x="10" y="10" width="680" height="400" rx="22" fill="none" stroke="url(#gold)" stroke-width="4"/>`,
          `  <rect x="22" y="22" width="656" height="376" rx="16" fill="none" stroke="#CA8A04" stroke-width="1" opacity="0.45"/>`,
          `  <circle cx="620" cy="70" r="140" fill="#FDE047" opacity="0.06"/>`,
          `  <rect x="44" y="42" width="62" height="44" rx="8" fill="url(#gold)"/>`,
          `  <line x1="44" y1="64" x2="106" y2="64" stroke="#422006" stroke-width="1.5"/>`,
          `  <line x1="75" y1="42" x2="75" y2="86" stroke="#422006" stroke-width="1.5"/>`,
          `  <text x="124" y="61" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="bold" fill="#FDE047" letter-spacing="3">MINJIBOT BLACK CARD</text>`,
          `  <text x="124" y="83" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" fill="#A1A1AA">${escapeXml(stars)}  |  ${escapeXml(wealthRankText)}</text>`,
          `  <circle cx="604" cy="96" r="${String(avatarDiameter / 2 + 4)}" fill="none" stroke="url(#gold)" stroke-width="3.5"/>`,
          `  <circle cx="604" cy="96" r="${String(avatarDiameter / 2)}" fill="#27272A"/>`,
          `  <text x="44" y="148" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" font-weight="bold" fill="#A1A1AA" letter-spacing="2">TOTAL KEKAYAAN BERSIH (NET WORTH)</text>`,
          `  <text x="44" y="204" font-family="DejaVu Sans, Arial, sans-serif" font-size="44" font-weight="bold" fill="#FEF08A">${escapeXml(formatCompactRupiah(input.netWorth))}</text>`,
          `  <rect x="44" y="226" width="612" height="74" rx="14" fill="#27272A" fill-opacity="0.65" stroke="#52525B" stroke-width="1"/>`,
          `  <text x="64" y="252" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" fill="#A1A1AA">DOMPET</text>`,
          `  <text x="64" y="282" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#F8FAFC">${escapeXml(formatCompactRupiah(input.cashBalance))}</text>`,
          `  <text x="266" y="252" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" fill="#A1A1AA">BANK &amp; DEPOSITO</text>`,
          `  <text x="266" y="282" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#F8FAFC">${escapeXml(formatCompactRupiah(input.bankBalance))}</text>`,
          `  <text x="478" y="252" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" fill="#A1A1AA">INVESTASI &amp; BISNIS</text>`,
          `  <text x="478" y="282" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#FDE047">${escapeXml(formatCompactRupiah(input.investAndAssetValue))}</text>`,
          `  <text x="44" y="344" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF">${safeName}</text>`,
          `  <text x="44" y="372" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="bold" fill="#FACC15">${safeTitle}</text>`,
          `  <text x="656" y="346" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" font-weight="bold" fill="#E4E4E7">${safeRank}</text>`,
          `  <text x="656" y="372" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" fill="#A1A1AA">VERIFIED SULTAN ASSET</text>`,
          `</svg>`,
        ].join("\n"),
      );

      const layers: OverlayOptions[] = [];
      if (circularAvatar) {
        layers.push({
          input: circularAvatar,
          top: 96 - avatarDiameter / 2,
          left: 604 - avatarDiameter / 2,
        });
      }

      const pipeline = sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS });
      if (layers.length > 0) {
        return pipeline.composite(layers).png().toBuffer();
      }
      return pipeline.png().toBuffer();
    });
  }
}

export const eventBannerService = new EventBannerService();
