import webp from "node-webpmux";

export const DEFAULT_STICKER_PACK = "MinjiBot Official Pack";
export const DEFAULT_STICKER_AUTHOR = "MinjiBot";

export async function addStickerMetadata(
  webpBuffer: Buffer,
  packName: string = DEFAULT_STICKER_PACK,
  author: string = DEFAULT_STICKER_AUTHOR,
): Promise<Buffer> {
  try {
    const json = {
      "sticker-pack-id": "com.minjibot.sticker",
      "sticker-pack-name": packName,
      "sticker-pack-publisher": author,
      emojis: [] as string[],
    };

    const exifHeader = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00,
    ]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), "utf-8");
    const jsonLen = jsonBuffer.length;
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(jsonLen, 0);
    const offsetBuffer = Buffer.alloc(4);
    offsetBuffer.writeUInt32LE(0x16, 0);

    const exifData = Buffer.concat([exifHeader, lenBuffer, offsetBuffer, jsonBuffer]);

    const img = new webp.Image();
    await img.load(webpBuffer);
    img.exif = exifData;
    return await img.save(null);
  } catch {
    return webpBuffer;
  }
}
