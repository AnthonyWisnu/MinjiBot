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

    const MAX_DIMENSION = 4096;
    const targetScale = 4;
    const maxScale = Math.min(
      MAX_DIMENSION / metadata.width,
      MAX_DIMENSION / metadata.height,
    );
    const scale = Math.max(1, Math.min(targetScale, maxScale));

    const width = Math.round(metadata.width * scale);
    const height = Math.round(metadata.height * scale);
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
