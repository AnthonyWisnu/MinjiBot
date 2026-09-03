import { HeavyFeatureType } from "@prisma/client";

import {
  downloaderService,
  type DownloadedMediaItem,
  type DownloaderKind,
} from "../../services/media/downloader.service";
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
    execute: handleInstagramDownloader,
  },
  {
    name: "yt",
    execute: handleYoutubeVideoDownloader,
  },
];

// ─── TikTok (.tt) ──────────────────────────────────────────────────────────

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

    await context.reply("Video TikTok sedang diproses. Mohon tunggu...");
    const downloadedVideo = await downloaderService.downloadVideo(url, kind);

    // Kirim video terlebih dahulu
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

    // Susul dengan audio (best-effort, tidak ganggu user jika gagal)
    await sendTikTokAudio(context, downloadedVideo.buffer);
  } catch (error: unknown) {
    if (reserved && reservation !== null) {
      await refundFeatureLimit(reservation);
      await context.reply(
        `${formatTikTokError(error)}\nLimit yang sudah direservasi telah dikembalikan.`,
      );
    } else {
      await context.reply(formatTikTokError(error));
    }
  }
}

async function sendTikTokAudio(context: CommandContext, videoBuffer: Buffer): Promise<void> {
  try {
    const audio = await downloaderService.extractAudioFromVideo(videoBuffer);
    await sleep(500);
    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: audio.buffer,
        mimetype: audio.mimetype,
        ptt: false,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    // Gagal extract audio tidak perlu notify user — video sudah terkirim
    // Hanya log di server
    void error;
  }
}

// ─── Instagram Unified (.ig) ───────────────────────────────────────────────
// Handles: reels, foto tunggal, story, carousel (max 10 item)

async function handleInstagramDownloader(context: CommandContext): Promise<void> {
  const url = context.args[0];
  if (!url || !url.toLowerCase().includes("instagram.com")) {
    await context.reply("Format command salah.\nGunakan: .ig <link Instagram>");
    return;
  }

  const access = await resolveFeatureAccess(context, HeavyFeatureType.INSTAGRAM_REELS_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await context.reply("Media Instagram sedang diproses. Mohon tunggu...");
    const result = await downloaderService.downloadInstagram(url);

    if (result.type === "single") {
      await sendMediaItem(context, result.item);
    } else {
      await context.reply(
        `Terdeteksi ${String(result.totalCount)} item. Mengirim satu per satu...`,
      );
      for (const item of result.items) {
        await sendMediaItem(context, item);
        await sleep(300);
      }
    }

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    if (reserved && reservation !== null) {
      await refundFeatureLimit(reservation);
      await context.reply(
        `${formatInstagramError(error)}\nLimit yang sudah direservasi telah dikembalikan.`,
      );
    } else {
      await context.reply(formatInstagramError(error));
    }
  }
}

// ─── YouTube Video (.yt) ──────────────────────────────────────────────────
// Max 480p, max 12 menit, pakai sistem limit yang sama

async function handleYoutubeVideoDownloader(context: CommandContext): Promise<void> {
  const url = context.args[0];
  if (
    !url ||
    (!url.toLowerCase().includes("youtube.com") && !url.toLowerCase().includes("youtu.be"))
  ) {
    await context.reply("Format command salah.\nGunakan: .yt <link YouTube>");
    return;
  }

  const access = await resolveFeatureAccess(context, HeavyFeatureType.YOUTUBE_VIDEO_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await context.reply(
      "Video YouTube sedang diproses (maks. 12 menit, hingga 720p 60fps). Mohon tunggu...",
    );
    const result = await downloaderService.downloadYoutube(url);

    await context.socket.sendMessage(
      context.chatJid,
      {
        video: result.buffer,
        mimetype: "video/mp4",
        fileName: result.fileName,
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
        `${formatYoutubeError(error)}\nLimit yang sudah direservasi telah dikembalikan.`,
      );
    } else {
      await context.reply(formatYoutubeError(error));
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function sendMediaItem(
  context: CommandContext,
  item: DownloadedMediaItem,
): Promise<void> {
  if (item.mediaType === "video") {
    await context.socket.sendMessage(
      context.chatJid,
      {
        video: item.buffer,
        mimetype: "video/mp4",
        fileName: item.fileName,
      },
      { quoted: context.message },
    );
  } else {
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: item.buffer,
        mimetype: item.mimetype,
      },
      { quoted: context.message },
    );
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function formatTikTokError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Video terlalu besar untuk dikirim.";
  }
  return "Video gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}

function formatInstagramError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("login") ||
    message.includes("cookies") ||
    message.includes("private") ||
    message.includes("not available")
  ) {
    return "Media gagal diambil. Pastikan link masih aktif dan dapat diakses.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media terlalu besar untuk dikirim.";
  }
  if (message.includes("tidak ada media")) {
    return "Tidak ada media yang berhasil diunduh. Pastikan link valid.";
  }
  return "Media gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}

function formatYoutubeError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("duration") ||
    message.includes("match-filter") ||
    message.includes("720")
  ) {
    return "Video melebihi batas durasi 12 menit.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Video terlalu besar untuk dikirim.";
  }
  return "Video YouTube gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}
