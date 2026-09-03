import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { HeavyFeatureType } from "@prisma/client";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { imageAiUpscaleService } from "../../services/media/imageAiUpscale.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { resolveImageMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";
import {
  resolveFeatureAccess,
  reserveFeatureLimit,
  consumeFeatureLimit,
  refundFeatureLimit,
} from "./heavyFeatureHelper";

const BYTES_PER_MB = 1024 * 1024;
const HD_AI_OUTPUT_MIMETYPE = "image/jpeg";
const HD_AI_OUTPUT_FILENAME = "minjibot-hd-ai.jpg";

export const hdAiCommands: CommandDefinition[] = [
  {
    name: "hdai",
    execute: handleHdAi,
  },
];

async function handleHdAi(context: CommandContext): Promise<void> {
  try {
    const target = resolveImageMediaTarget(context);
    if (!target) {
      await context.reply("Kirim foto dengan caption .hdai atau reply foto dengan .hdai.");
      return;
    }

    assertImageSizeAllowed(target.fileLength);

    const isDocumentMode = context.args[0]?.toLowerCase() === "doc";
    const feature = isDocumentMode
      ? HeavyFeatureType.HD_AI_PHOTO_DOCUMENT
      : HeavyFeatureType.HD_AI_PHOTO;

    const access = await resolveFeatureAccess(context, feature);
    if (access === null) return;

    const reservation = access.skip ? null : access.reservation;
    let reserved = false;

    try {
      if (reservation !== null) {
        const ok = await reserveFeatureLimit(context, reservation);
        if (!ok) return;
        reserved = true;
      }

      await context.reply("Foto HD AI masuk antrean. Mohon tunggu.");
      const inputBuffer = await downloadMediaMessage(
        target.message,
        "buffer",
        {},
        {
          logger: logger.child({ module: "hdai-download" }),
          reuploadRequest: context.socket.updateMediaMessage,
        },
      );
      assertImageSizeAllowed(inputBuffer.byteLength);

      const outputBuffer = await imageAiUpscaleService.upscale(inputBuffer);

      if (isDocumentMode) {
        await context.socket.sendMessage(
          context.chatJid,
          {
            document: outputBuffer,
            mimetype: HD_AI_OUTPUT_MIMETYPE,
            fileName: HD_AI_OUTPUT_FILENAME,
          },
          { quoted: context.message },
        );
      } else {
        await context.socket.sendMessage(
          context.chatJid,
          {
            image: outputBuffer,
            mimetype: HD_AI_OUTPUT_MIMETYPE,
          },
          { quoted: context.message },
        );
      }

      if (reserved && reservation !== null) {
        await consumeFeatureLimit(reservation);
      }
    } catch (error: unknown) {
      if (reserved && reservation !== null) {
        await refundFeatureLimit(reservation);
      }

      throw error;
    }
  } catch (error: unknown) {
    await context.reply(
      formatUserSafeError(error, "Foto HD AI gagal diproses. Silakan coba lagi."),
    );
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
