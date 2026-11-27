import sharp from "sharp";

import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";

export interface EnhanceImageOptions {
  documentMode?: boolean;
}

export interface EnhanceImageResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export class ImageEnhanceService {
  public static readonly MAX_STANDARD_EDGE = 2560;
  public static readonly MAX_DOCUMENT_EDGE = 3840;

  async enhanceImage(
    inputBuffer: Buffer,
    options?: EnhanceImageOptions,
  ): Promise<EnhanceImageResult> {
    return mediaQueueService.imageComputeQueue.run(async () => {
      const probe = sharp(inputBuffer, {
        failOn: "error",
        limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
      });
      const metadata = await probe.metadata();

      if (!metadata.width || !metadata.height) {
        throw new AppUserError("Dimensi gambar tidak dapat dibaca.");
      }

      // EXIF orientation 5, 6, 7, 8 swap width and height
      const isRotated = !!(
        metadata.orientation &&
        metadata.orientation >= 5 &&
        metadata.orientation <= 8
      );
      const srcWidth = isRotated ? metadata.height : metadata.width;
      const srcHeight = isRotated ? metadata.width : metadata.height;

      const targetMaxEdge = options?.documentMode
        ? ImageEnhanceService.MAX_DOCUMENT_EDGE
        : ImageEnhanceService.MAX_STANDARD_EDGE;

      const maxSrcEdge = Math.max(srcWidth, srcHeight);
      const scale = maxSrcEdge < targetMaxEdge ? Math.min(targetMaxEdge / maxSrcEdge, 3.0) : 1.0;

      const targetWidth = scale > 1.0 ? Math.round(srcWidth * scale) : srcWidth;
      const targetHeight = scale > 1.0 ? Math.round(srcHeight * scale) : srcHeight;

      const claheWidth = Math.max(4, Math.min(64, Math.floor(targetWidth / 2)));
      const claheHeight = Math.max(4, Math.min(64, Math.floor(targetHeight / 2)));

      const pipeline = sharp(inputBuffer, {
        failOn: "error",
        limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
      })
        .rotate()
        .resize({
          width: targetWidth,
          height: targetHeight,
          fit: "inside",
          kernel: "mks2021",
          withoutEnlargement: false,
          fastShrinkOnLoad: false,
        })
        .clahe({
          width: claheWidth,
          height: claheHeight,
          maxSlope: 2,
        })
        .linear(1.04, -5)
        .modulate({
          brightness: 1.01,
          saturation: 1.08,
        })
        .sharpen({
          sigma: 0.9,
          m1: 0.35,
          m2: 2.8,
          x1: 3.5,
          y2: 12,
          y3: 20,
        })
        .jpeg({
          quality: 95,
          mozjpeg: true,
          chromaSubsampling: "4:4:4",
          trellisQuantisation: true,
          overshootDeringing: true,
        });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

      return {
        buffer: data,
        width: info.width,
        height: info.height,
      };
    });
  }

  /**
   * Alias backward-compatible untuk `enhanceImage`.
   */
  async enhanceFast(inputBuffer: Buffer): Promise<EnhanceImageResult> {
    return this.enhanceImage(inputBuffer);
  }
}

export const imageEnhanceService = new ImageEnhanceService();
