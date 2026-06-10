import sharp from "sharp";

export interface EnhanceImageResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export class ImageEnhanceService {
  async enhanceFast(inputBuffer: Buffer): Promise<EnhanceImageResult> {
    const image = sharp(inputBuffer, {
      failOn: "error",
    }).rotate();
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Dimensi gambar tidak dapat dibaca.");
    }

    const width = metadata.width * 2;
    const height = metadata.height * 2;
    const buffer = await image
      .resize({
        width,
        height,
        fit: "fill",
        kernel: "lanczos3",
      })
      .jpeg({
        quality: 92,
        mozjpeg: true,
      })
      .toBuffer();

    return {
      buffer,
      width,
      height,
    };
  }
}

export const imageEnhanceService = new ImageEnhanceService();
