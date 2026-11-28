import sharp from "sharp";

import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { clampText, escapeXml, stripInvalidXmlChars } from "../../utils/xml";
import { addStickerMetadata, DEFAULT_STICKER_AUTHOR } from "./sticker/stickerExif";

export type MemeTemplateKind = "wanted" | "jail" | "rip" | "triggered" | "trash" | "clown";
export type ImageFilterKind =
  | "blur"
  | "grayscale"
  | "invert"
  | "sepia"
  | "pixelate"
  | "mirror";

const MEME_SIZE = 600;

async function makeCircularPng(inputBuffer: Buffer, diameter: number): Promise<Buffer> {
  const maskSvg = Buffer.from(
    `<svg width="${String(diameter)}" height="${String(diameter)}" xmlns="http://www.w3.org/2000/svg"><circle cx="${String(diameter / 2)}" cy="${String(diameter / 2)}" r="${String(diameter / 2)}" fill="#ffffff"/></svg>`,
  );

  return sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
    .rotate()
    .resize(diameter, diameter, { fit: "cover" })
    .ensureAlpha()
    .composite([{ input: maskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export class PhotoMemeService {
  async renderMemeOverlay(
    inputBuffer: Buffer,
    template: MemeTemplateKind,
    labelText?: string,
  ): Promise<Buffer> {
    const safeLabel = escapeXml(clampText(stripInvalidXmlChars(labelText ?? "MEMBER GRUP"), 22, ""));

    return mediaQueueService.imageComputeQueue.run(async () => {
      if (template === "wanted") {
        const photo = await sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .rotate()
          .resize(440, 380, { fit: "cover" })
          .modulate({ saturation: 0.55, brightness: 0.96 })
          .tint({ r: 220, g: 196, b: 158 })
          .png()
          .toBuffer();

        const bountyMillion = 50 + (inputBuffer.byteLength % 900);
        const bgSvg = Buffer.from([
          `<svg width="600" height="720" xmlns="http://www.w3.org/2000/svg">`,
          `  <rect width="600" height="720" fill="#E6D2A8"/>`,
          `  <rect x="20" y="20" width="560" height="680" fill="none" stroke="#4A3219" stroke-width="8"/>`,
          `  <rect x="34" y="34" width="532" height="652" fill="none" stroke="#4A3219" stroke-width="2"/>`,
          `  <text x="300" y="108" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-size="78" font-weight="bold" fill="#3B2312" letter-spacing="8">WANTED</text>`,
          `  <text x="300" y="142" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="#5A391E" letter-spacing="5">DEAD OR ALIVE</text>`,
          `  <rect x="76" y="160" width="448" height="388" fill="#3B2312"/>`,
          `  <text x="300" y="600" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-size="36" font-weight="bold" fill="#3B2312">${safeLabel}</text>`,
          `  <text x="300" y="656" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="38" font-weight="900" fill="#7F1D1D">Rp ${String(bountyMillion)}.000.000</text>`,
          `</svg>`,
        ].join("\n"));

        return sharp(bgSvg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .composite([{ input: photo, top: 164, left: 80 }])
          .png()
          .toBuffer();
      }

      if (template === "jail") {
        const base = await sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .rotate()
          .resize(MEME_SIZE, MEME_SIZE, { fit: "cover" })
          .grayscale()
          .modulate({ brightness: 0.85 })
          .png()
          .toBuffer();

        const bars = [70, 162, 254, 346, 438, 530]
          .map(
            (x) =>
              `<rect x="${String(x - 10)}" y="0" width="20" height="600" fill="#262B33"/><rect x="${String(x - 4)}" y="0" width="4" height="600" fill="#64748B" opacity="0.7"/>`,
          )
          .join("");

        const overlaySvg = Buffer.from([
          `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">`,
          `  ${bars}`,
          `  <rect x="0" y="485" width="600" height="80" fill="#0F172A" opacity="0.88"/>`,
          `  <text x="300" y="538" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="40" font-weight="900" fill="#EF4444" letter-spacing="4">TERTANGKAP!</text>`,
          `</svg>`,
        ].join("\n"));

        return sharp(base, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .composite([{ input: overlaySvg }])
          .png()
          .toBuffer();
      }

      if (template === "rip") {
        const avatar = await makeCircularPng(
          await sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
            .grayscale()
            .png()
            .toBuffer(),
          200,
        );

        const stoneSvg = Buffer.from([
          `<svg width="600" height="700" xmlns="http://www.w3.org/2000/svg">`,
          `  <defs><linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#1E293B"/><stop offset="100%" stop-color="#0F172A"/></linearGradient></defs>`,
          `  <rect width="600" height="700" fill="url(#sky)"/>`,
          `  <path d="M100,660 L100,220 A200,190 0 0,1 500,220 L500,660 Z" fill="#94A3B8" stroke="#475569" stroke-width="10"/>`,
          `  <text x="300" y="165" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-size="78" font-weight="bold" fill="#1E293B" letter-spacing="10">R.I.P</text>`,
          `  <text x="300" y="465" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#1E293B">${safeLabel}</text>`,
          `  <text x="300" y="518" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="22" fill="#334155">Gugur di Medan Grup</text>`,
          `  <rect x="0" y="640" width="600" height="60" fill="#14532D"/>`,
          `</svg>`,
        ].join("\n"));

        return sharp(stoneSvg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .composite([{ input: avatar, top: 205, left: 200 }])
          .png()
          .toBuffer();
      }

      if (template === "triggered") {
        const base = await sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .rotate()
          .resize(620, 620, { fit: "cover" })
          .extract({ left: 10, top: 10, width: MEME_SIZE, height: MEME_SIZE })
          .tint({ r: 255, g: 120, b: 120 })
          .png()
          .toBuffer();

        const overlaySvg = Buffer.from([
          `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">`,
          `  <rect x="0" y="475" width="600" height="100" fill="#DC2626"/>`,
          `  <text x="300" y="544" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="60" font-weight="900" fill="#FFFFFF" letter-spacing="6">TRIGGERED</text>`,
          `</svg>`,
        ].join("\n"));

        return sharp(base, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .composite([{ input: overlaySvg }])
          .png()
          .toBuffer();
      }

      if (template === "trash") {
        const avatar = await makeCircularPng(inputBuffer, 220);
        const svg = Buffer.from([
          `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">`,
          `  <rect width="600" height="600" fill="#1E293B"/>`,
          `  <rect x="130" y="130" width="340" height="390" rx="22" fill="#334155" stroke="#94A3B8" stroke-width="8"/>`,
          `  <rect x="100" y="95" width="400" height="42" rx="12" fill="#64748B"/>`,
          `  <rect x="240" y="65" width="120" height="30" rx="10" fill="#475569"/>`,
          `  <text x="300" y="485" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="38" font-weight="900" fill="#F8FAFC">TRASH TIER</text>`,
          `  <text x="300" y="565" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="24" fill="#CBD5E1">${safeLabel}</text>`,
          `</svg>`,
        ].join("\n"));

        return sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
          .composite([{ input: avatar, top: 185, left: 190 }])
          .png()
          .toBuffer();
      }

      // clown
      const base = await sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .rotate()
        .resize(MEME_SIZE, MEME_SIZE, { fit: "cover" })
        .png()
        .toBuffer();

      const clownSvg = Buffer.from([
        `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">`,
        `  <rect x="12" y="12" width="576" height="576" rx="28" fill="none" stroke="#F59E0B" stroke-width="20"/>`,
        `  <circle cx="300" cy="300" r="42" fill="#EF4444" opacity="0.92"/>`,
        `  <circle cx="286" cy="286" r="10" fill="#FCA5A5" opacity="0.8"/>`,
        `  <rect x="0" y="480" width="600" height="90" fill="#7C3AED" opacity="0.92"/>`,
        `  <text x="300" y="538" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="44" font-weight="900" fill="#FEF08A" letter-spacing="4">BADUT GRUP</text>`,
        `</svg>`,
      ].join("\n"));

      return sharp(base, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .composite([{ input: clownSvg }])
        .png()
        .toBuffer();
    });
  }

  async applyFilter(inputBuffer: Buffer, filter: ImageFilterKind): Promise<Buffer> {
    return mediaQueueService.imageComputeQueue.run(async () => {
      const pipeline = sharp(inputBuffer, {
        animated: false,
        limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
      })
        .rotate()
        .resize(800, 800, { fit: "inside", withoutEnlargement: true });

      if (filter === "blur") {
        return pipeline.blur(8).png().toBuffer();
      }
      if (filter === "grayscale") {
        return pipeline.grayscale().png().toBuffer();
      }
      if (filter === "invert") {
        return pipeline.negate({ alpha: false }).png().toBuffer();
      }
      if (filter === "sepia") {
        return pipeline
          .modulate({ saturation: 0.45 })
          .tint({ r: 226, g: 186, b: 132 })
          .png()
          .toBuffer();
      }
      if (filter === "mirror") {
        return pipeline.flop().png().toBuffer();
      }

      // pixelate
      const { data: basePng, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
      const smallW = Math.max(16, Math.round(info.width / 16));
      const smallH = Math.max(16, Math.round(info.height / 16));
      const tiny = await sharp(basePng, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .resize(smallW, smallH, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      return sharp(tiny, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .resize(info.width, info.height, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
    });
  }

  async rotateImage(inputBuffer: Buffer, angle: number): Promise<Buffer> {
    if (![90, 180, 270].includes(angle)) {
      throw new AppUserError("Sudut putar harus 90, 180, atau 270 derajat. Contoh: *.rotate 90*");
    }
    return mediaQueueService.imageComputeQueue.run(async () =>
      sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .rotate(angle)
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer(),
    );
  }

  async createCircleSticker(inputBuffer: Buffer): Promise<Buffer> {
    const webpBuf = await mediaQueueService.imageComputeQueue.run(async () => {
      const circlePng = await makeCircularPng(inputBuffer, 512);
      return sharp(circlePng, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .webp({ quality: 90, effort: 4 })
        .toBuffer();
    });
    return addStickerMetadata(webpBuf, "MinjiBot Circle Pack", DEFAULT_STICKER_AUTHOR);
  }

  async renderPolaroid(inputBuffer: Buffer, rawCaption: string): Promise<Buffer> {
    const caption = escapeXml(
      clampText(stripInvalidXmlChars(rawCaption.trim() || "Kenangan Grup"), 30, "..."),
    );
    return mediaQueueService.imageComputeQueue.run(async () => {
      const photo = await sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .rotate()
        .resize(520, 520, { fit: "cover" })
        .png()
        .toBuffer();

      const frameSvg = Buffer.from([
        `<svg width="600" height="720" xmlns="http://www.w3.org/2000/svg">`,
        `  <rect width="600" height="720" fill="#1E293B"/>`,
        `  <rect x="20" y="20" width="560" height="680" rx="8" fill="#F8FAFC"/>`,
        `  <text x="300" y="635" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-style="italic" font-size="32" fill="#1E293B">${caption}</text>`,
        `  <text x="300" y="676" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="16" fill="#94A3B8">MINJIBOT POLAROID</text>`,
        `</svg>`,
      ].join("\n"));

      return sharp(frameSvg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .composite([{ input: photo, top: 44, left: 40 }])
        .png()
        .toBuffer();
    });
  }

  async renderShipCard(input: {
    avatarA: Buffer;
    avatarB: Buffer;
    nameA: string;
    nameB: string;
    percentage: number;
    verdict: string;
  }): Promise<Buffer> {
    const safeA = escapeXml(clampText(stripInvalidXmlChars(input.nameA), 18, ""));
    const safeB = escapeXml(clampText(stripInvalidXmlChars(input.nameB), 18, ""));
    const safeVerdict = escapeXml(clampText(stripInvalidXmlChars(input.verdict), 52, "..."));
    const barW = Math.round((Math.max(0, Math.min(100, input.percentage)) / 100) * 520);

    return mediaQueueService.imageComputeQueue.run(async () => {
      const [circA, circB] = await Promise.all([
        makeCircularPng(input.avatarA, 170),
        makeCircularPng(input.avatarB, 170),
      ]);

      const svg = Buffer.from([
        `<svg width="800" height="420" xmlns="http://www.w3.org/2000/svg">`,
        `  <defs><linearGradient id="shipBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3B0764"/><stop offset="50%" stop-color="#831843"/><stop offset="100%" stop-color="#1E1B4B"/></linearGradient></defs>`,
        `  <rect width="800" height="420" rx="26" fill="url(#shipBg)"/>`,
        `  <text x="400" y="54" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="28" fill="#FBCFE8" letter-spacing="4">SHIP COMPATIBILITY</text>`,
        `  <circle cx="195" cy="175" r="92" fill="none" stroke="#F472B6" stroke-width="6"/>`,
        `  <circle cx="605" cy="175" r="92" fill="none" stroke="#F472B6" stroke-width="6"/>`,
        `  <text x="400" y="192" text-anchor="middle" font-family="Arial Black, DejaVu Sans, sans-serif" font-size="56" fill="#FDF2F8">${String(input.percentage)}%</text>`,
        `  <text x="195" y="295" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">${safeA}</text>`,
        `  <text x="605" y="295" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">${safeB}</text>`,
        `  <rect x="140" y="320" width="520" height="22" rx="11" fill="#4C1D95"/>`,
        `  <rect x="140" y="320" width="${String(barW)}" height="22" rx="11" fill="#F472B6"/>`,
        `  <text x="400" y="380" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="19" fill="#FCE7F3">${safeVerdict}</text>`,
        `</svg>`,
      ].join("\n"));

      return sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .composite([
          { input: circA, top: 90, left: 110 },
          { input: circB, top: 90, left: 520 },
        ])
        .png()
        .toBuffer();
    });
  }

  async renderMarriageCard(input: {
    avatarA: Buffer;
    avatarB: Buffer;
    nameA: string;
    nameB: string;
    dowryLabel: string;
    dateLabel: string;
  }): Promise<Buffer> {
    const safeA = escapeXml(clampText(stripInvalidXmlChars(input.nameA), 20, ""));
    const safeB = escapeXml(clampText(stripInvalidXmlChars(input.nameB), 20, ""));
    const safeDowry = escapeXml(clampText(input.dowryLabel, 32, ""));
    const safeDate = escapeXml(clampText(input.dateLabel, 32, ""));

    return mediaQueueService.imageComputeQueue.run(async () => {
      const [circA, circB] = await Promise.all([
        makeCircularPng(input.avatarA, 150),
        makeCircularPng(input.avatarB, 150),
      ]);

      const svg = Buffer.from([
        `<svg width="800" height="480" xmlns="http://www.w3.org/2000/svg">`,
        `  <rect width="800" height="480" rx="22" fill="#064E3B"/>`,
        `  <rect x="20" y="20" width="760" height="440" rx="16" fill="none" stroke="#F59E0B" stroke-width="5"/>`,
        `  <rect x="32" y="32" width="736" height="416" rx="12" fill="none" stroke="#FDE68A" stroke-width="2" opacity="0.6"/>`,
        `  <text x="400" y="80" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-size="34" font-weight="bold" fill="#FDE68A" letter-spacing="4">BUKU NIKAH GRUP</text>`,
        `  <text x="400" y="108" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="16" fill="#A7F3D0">KANTOR URUSAN ASMARA MINJIBOT</text>`,
        `  <circle cx="220" cy="210" r="80" fill="none" stroke="#F59E0B" stroke-width="5"/>`,
        `  <circle cx="580" cy="210" r="80" fill="none" stroke="#F59E0B" stroke-width="5"/>`,
        `  <text x="400" y="224" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-size="48" fill="#FDE68A">&amp;</text>`,
        `  <text x="220" y="322" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">${safeA}</text>`,
        `  <text x="580" y="322" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">${safeB}</text>`,
        `  <text x="400" y="376" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="20" fill="#FDE68A">Mahar: ${safeDowry}</text>`,
        `  <text x="400" y="414" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="17" fill="#D1FAE5">Sah Tanggal: ${safeDate}</text>`,
        `</svg>`,
      ].join("\n"));

      return sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .composite([
          { input: circA, top: 135, left: 145 },
          { input: circB, top: 135, left: 505 },
        ])
        .png()
        .toBuffer();
    });
  }
}

export const photoMemeService = new PhotoMemeService();
