import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { imageEnhanceService } from "../../services/media/imageEnhance.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { resolveImageMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const BYTES_PER_MB = 1024 * 1024;
const HD_OUTPUT_MIMETYPE = "image/jpeg";
const HD_OUTPUT_FILENAME = "minjibot-hd.jpg";

export const hdCommands: CommandDefinition[] = [
  {
    name: "hd",
    execute: handleHd,
  },
];

async function handleHd(context: CommandContext): Promise<void> {
  try {
    if (!context.isGroup && context.role !== "TENANT_OWNER" && context.role !== "SUPER_OWNER") {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat Tenant Owner.",
      );
      return;
    }

    const target = resolveImageMediaTarget(context);
    if (!target) {
      await context.reply("Kirim foto dengan caption .hd atau reply foto dengan .hd.");
      return;
    }

    assertImageSizeAllowed(target.fileLength);
    const inputBuffer = await downloadMediaMessage(
      target.message,
      "buffer",
      {},
      {
        logger: logger.child({ module: "hd-download" }),
        reuploadRequest: context.socket.updateMediaMessage,
      },
    );

    assertImageSizeAllowed(inputBuffer.byteLength);
    const enhancedImage = await imageEnhanceService.enhanceFast(inputBuffer);
    const isDocumentMode = context.args[0]?.toLowerCase() === "doc";

    if (isDocumentMode) {
      await context.socket.sendMessage(
        context.chatJid,
        {
          document: enhancedImage.buffer,
          mimetype: HD_OUTPUT_MIMETYPE,
          fileName: HD_OUTPUT_FILENAME,
        },
        { quoted: context.message },
      );
      return;
    }

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: enhancedImage.buffer,
        mimetype: HD_OUTPUT_MIMETYPE,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Foto gagal diproses. Silakan coba lagi."));
  }
}

function assertImageSizeAllowed(fileLength: number | undefined): void {
  if (!fileLength) {
    return;
  }

  const maxBytes = env.HD_MAX_INPUT_MB * BYTES_PER_MB;
  if (fileLength > maxBytes) {
    throw new Error(`Ukuran gambar maksimal ${String(env.HD_MAX_INPUT_MB)} MB.`);
  }
}
