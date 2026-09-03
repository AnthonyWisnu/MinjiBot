import { HeavyFeatureType } from "@prisma/client";

import { downloaderService, type DownloaderKind } from "../../services/media/downloader.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  resolveFeatureAccess,
  reserveFeatureLimit,
  consumeFeatureLimit,
  refundFeatureLimit,
} from "./heavyFeatureHelper";

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

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    if (reserved && reservation !== null) {
      await refundFeatureLimit(reservation);
      await context.reply(
        `${formatDownloaderError(error, kind)}\nLimit yang sudah direservasi telah dikembalikan.`,
      );
    } else {
      await context.reply(formatDownloaderError(error, kind));
    }
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
