import { HeavyFeatureType } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { downloaderService, type DownloaderKind } from "../../services/media/downloader.service";
import { heavyFeatureAccessService } from "../../services/quota/heavyFeatureAccess.service";
import { tenantQuotaService } from "../../services/quota/tenantQuota.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const downloaderCommands: CommandDefinition[] = [
  {
    name: "tt",
    execute: (context) => handleDownloader(context, "tiktok", HeavyFeatureType.TIKTOK_DOWNLOAD),
  },
  {
    name: "ig",
    execute: (context) =>
      handleDownloader(context, "instagram", HeavyFeatureType.INSTAGRAM_REELS_DOWNLOAD),
  },
  {
    name: "igstory",
    execute: (context) =>
      handleDownloader(context, "instagram-story", HeavyFeatureType.INSTAGRAM_STORY_DOWNLOAD),
  },
];

async function handleDownloader(
  context: CommandContext,
  kind: DownloaderKind,
  feature: HeavyFeatureType,
): Promise<void> {
  const url = context.args[0];
  if (!url) {
    await context.reply(`Format command salah.\nGunakan: .${context.commandName} <link>`);
    return;
  }

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

    await context.reply("Video sedang diproses. Mohon tunggu.");
    const downloadedVideo = await downloaderService.downloadVideo(url, kind);

    await context.socket.sendMessage(
      context.chatJid,
      {
        video: downloadedVideo.buffer,
        mimetype: downloadedVideo.mimetype,
        fileName: downloadedVideo.fileName,
      },
      { quoted: context.message },
    );

    if (reserved) {
      await tenantQuotaService.consumeHeavyFeatureQuota(reservation);
    }
  } catch (error: unknown) {
    if (reserved) {
      await tenantQuotaService.refundHeavyFeatureQuota(reservation);
    }

    await context.reply(formatDownloaderError(error, kind));
  }
}

function formatDownloaderError(error: unknown, kind: DownloaderKind): string {
  const message = error instanceof Error ? error.message : "";
  const lowerMessage = message.toLowerCase();

  if (kind === "instagram-story") {
    if (
      lowerMessage.includes("login") ||
      lowerMessage.includes("cookies") ||
      lowerMessage.includes("private") ||
      lowerMessage.includes("not available")
    ) {
      return "Media gagal diambil. Pastikan link masih aktif dan dapat diakses.";
    }

    return "Media gagal diambil. Pastikan link masih aktif dan dapat diakses.";
  }

  if (lowerMessage.includes("max-filesize")) {
    return "Video terlalu besar untuk dikirim.";
  }

  return "Video gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}
