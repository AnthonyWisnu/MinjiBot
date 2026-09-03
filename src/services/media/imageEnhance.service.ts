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
      .sharpen({ sigma: 1.2, m1: 1.0, m2: 3.0 })
      .modulate({ brightness: 1.02, saturation: 1.08 })
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
