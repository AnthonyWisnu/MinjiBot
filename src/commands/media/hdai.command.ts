import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { HeavyFeatureType } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { imageAiUpscaleService } from "../../services/media/imageAiUpscale.service";
import { heavyFeatureAccessService } from "../../services/quota/heavyFeatureAccess.service";
import { tenantQuotaService } from "../../services/quota/tenantQuota.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { resolveImageMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

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
    const quotaContext = await heavyFeatureAccessService.resolveQuotaContext(context);
    if (!quotaContext.allowed) {
      await context.reply(quotaContext.message);
      return;
    }

    const reservation = {
      ownerJid: quotaContext.ownerJid,
      actorJid: context.senderUserJid,
      groupJid: quotaContext.groupJid,
      source: quotaContext.source,
      feature,
      correlationId: randomUUID(),
    };
    let reserved = false;

    try {
      if (!quotaContext.skipQuota) {
        try {
          await tenantQuotaService.reserveHeavyFeatureQuota(reservation);
        } catch {
          await context.reply(heavyFeatureAccessService.getQuotaEmptyMessage(context));
          return;
        }
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

      if (reserved) {
        await tenantQuotaService.consumeHeavyFeatureQuota(reservation);
      }
    } catch (error: unknown) {
      if (reserved) {
        await tenantQuotaService.refundHeavyFeatureQuota(reservation);
      }

      throw error;
    }
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Foto HD AI gagal diproses. Silakan coba lagi."));
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
