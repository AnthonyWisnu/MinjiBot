import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { stickerService } from "../../services/media/sticker.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { resolveMediaTarget, type MediaTarget } from "../../utils/mediaTarget";

const BYTES_PER_MB = 1024 * 1024;
const MAX_STICKER_INPUT_MB = 15;

export const stickerCommands: CommandDefinition[] = [
  {
    name: "s",
    aliases: ["sticker"],
    execute: handleSticker,
  },
  {
    name: "gambar",
    aliases: ["toimg"],
    execute: handleStickerToImage,
  },
];

async function handleSticker(context: CommandContext): Promise<void> {
  try {
    if (!isMediaCommandAllowed(context)) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat Tenant Owner.",
      );
      return;
    }

    const target = resolveMediaTarget(context, ["image", "video"]);
    if (!target) {
      await context.reply("Kirim/reply gambar atau video pendek dengan command .s.");
      return;
    }

    assertMediaAllowed(target);
    const inputBuffer = await downloadTargetMedia(context, target, "sticker-download");
    assertBufferSizeAllowed(inputBuffer.byteLength, MAX_STICKER_INPUT_MB);

    const stickerBuffer = await stickerService.createSticker(
      inputBuffer,
      toStickerSourceType(target),
    );

    await context.socket.sendMessage(
      context.chatJid,
      {
        sticker: stickerBuffer,
        isAnimated: target.type === "video",
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatStickerError(error));
  }
}

async function handleStickerToImage(context: CommandContext): Promise<void> {
  try {
    if (!isMediaCommandAllowed(context)) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat Tenant Owner.",
      );
      return;
    }

    const target = resolveMediaTarget(context, ["sticker"]);
    if (!target) {
      await context.reply("Reply sticker dengan command .gambar atau .toimg.");
      return;
    }

    assertBufferSizeAllowed(target.fileLength, MAX_STICKER_INPUT_MB);
    const inputBuffer = await downloadTargetMedia(context, target, "sticker-toimg-download");
    assertBufferSizeAllowed(inputBuffer.byteLength, MAX_STICKER_INPUT_MB);
    const output = await stickerService.stickerToMedia(inputBuffer, Boolean(target.isAnimated));

    if (output.type === "video") {
      await context.socket.sendMessage(
        context.chatJid,
        {
          video: output.buffer,
          mimetype: output.mimetype,
          fileName: output.fileName,
        },
        { quoted: context.message },
      );
      return;
    }

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: output.buffer,
        mimetype: output.mimetype,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatStickerError(error));
  }
}

function isMediaCommandAllowed(context: CommandContext): boolean {
  return context.isGroup || context.role === "TENANT_OWNER" || context.role === "SUPER_OWNER";
}

function assertMediaAllowed(target: MediaTarget): void {
  assertBufferSizeAllowed(target.fileLength, MAX_STICKER_INPUT_MB);
}

function toStickerSourceType(target: MediaTarget): "image" | "video" {
  if (target.type === "image" || target.type === "video") {
    return target.type;
  }

  throw new Error("Media tidak dapat dijadikan sticker.");
}

function assertBufferSizeAllowed(fileLength: number | undefined, maxMb: number): void {
  if (!fileLength) {
    return;
  }

  const maxBytes = maxMb * BYTES_PER_MB;
  if (fileLength > maxBytes) {
    throw new Error(`Ukuran media maksimal ${String(maxMb)} MB.`);
  }
}

async function downloadTargetMedia(
  context: CommandContext,
  target: MediaTarget,
  moduleName: string,
): Promise<Buffer> {
  return downloadMediaMessage(
    target.message,
    "buffer",
    {},
    {
      logger: logger.child({ module: moduleName }),
      reuploadRequest: context.socket.updateMediaMessage,
    },
  );
}

function formatStickerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Konversi media gagal diproses.";
}
