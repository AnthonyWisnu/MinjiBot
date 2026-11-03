import { HeavyFeatureType } from "@prisma/client";

import {
  downloaderService,
  type DownloadedMediaItem,
  type ExtractedAudio,
} from "../../services/media/downloader.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { parseAllowedDownloaderUrl } from "../../utils/urlValidator";
import {
  consumeFeatureLimit,
  refundFeatureLimit,
  reserveFeatureLimit,
  resolveFeatureAccess,
} from "./heavyFeatureHelper";

export const downloaderCommands: CommandDefinition[] = [
  {
    name: "tt",
    execute: handleTikTokDownloader,
  },
  {
    name: "ig",
    execute: handleInstagramDownloader,
  },
  {
    name: "yt",
    execute: handleYoutubeVideoDownloader,
  },
  {
    name: "x",
    aliases: ["twt"],
    execute: handleTwitterDownloader,
  },
  {
    name: "pin",
    aliases: ["pinterest"],
    execute: handlePinterestDownloader,
  },
];

// ─── TikTok (.tt) ──────────────────────────────────────────────────────────
// Handles: video tanpa watermark, single photo, & photo carousel (max 12 item) + BGM audio

async function handleTikTokDownloader(context: CommandContext): Promise<void> {
  const rawUrl = context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "tiktok");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .tt <link TikTok>");
    return;
  }
  const url = parsedUrl.toString();

  const access = await resolveFeatureAccess(context, HeavyFeatureType.TIKTOK_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await context.reply("Media TikTok sedang diproses. Mohon tunggu...");
    const result = await downloaderService.downloadTikTok(url);

    if (result.type === "video") {
      await sendMediaItem(context, {
        buffer: result.video.buffer,
        fileName: result.video.fileName,
        mimetype: result.video.mimetype,
        mediaType: "video",
      });
    } else {
      if (result.items.length === 1) {
        const firstItem = result.items[0];
        if (firstItem) {
          await sendMediaItem(context, firstItem);
        }
      } else {
        const totalMsg =
          result.totalCount > result.items.length
            ? `Terdeteksi ${String(result.totalCount)} foto slide TikTok (mengirim maks. ${String(result.items.length)}). Mengirim satu per satu...`
            : `Terdeteksi ${String(result.items.length)} foto slide TikTok. Mengirim satu per satu...`;
        await context.reply(totalMsg);

        for (const item of result.items) {
          await sendMediaItem(context, item);
          await sleep(300);
        }
      }
    }

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }

    // Kirim audio / lagu pengiring (BGM) jika tersedia
    if (result.audio) {
      await sleep(500);
      await sendAudioMessage(context, result.audio);
    }
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

async function sendAudioMessage(context: CommandContext, audio: ExtractedAudio): Promise<void> {
  try {
    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: audio.buffer,
        mimetype: audio.mimetype,
        ptt: false,
      },
      { quoted: context.message },
    );
  } catch {
    // Audio dikirim secara best-effort, tidak menggagalkan perintah jika gagal kirim
  }
}

// ─── Instagram Unified (.ig) ───────────────────────────────────────────────
// Handles: reels, foto tunggal, story, carousel (max 10 item)

async function handleInstagramDownloader(context: CommandContext): Promise<void> {
  const rawUrl = context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "instagram");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .ig <link Instagram>");
    return;
  }
  const url = parsedUrl.toString();

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
// Max 720p, max 12 menit, pakai sistem limit yang sama

async function handleYoutubeVideoDownloader(context: CommandContext): Promise<void> {
  const rawUrl = context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "youtube");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .yt <link YouTube>");
    return;
  }
  const url = parsedUrl.toString();

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
      "Video YouTube sedang diproses (maks. 1 jam, hingga 720p). Mohon tunggu...",
    );
    const result = await downloaderService.downloadYoutube(url);

    await sendMediaItem(context, result);

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

// ─── Twitter / X (.x, .twt) ────────────────────────────────────────────────
// Max duration 30 menit, format mobile-safe H.264/AAC, smart send <= 100MB video / > 100MB document

async function handleTwitterDownloader(context: CommandContext): Promise<void> {
  const rawUrl = context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "twitter");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .x <link tweet / x.com> atau .twt <link>");
    return;
  }
  const url = parsedUrl.toString();

  const access = await resolveFeatureAccess(context, HeavyFeatureType.TWITTER_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await context.reply("Media X (Twitter) sedang diproses (maks. 30 menit). Mohon tunggu...");
    const result = await downloaderService.downloadTwitter(url);

    if (result.type === "single") {
      await sendMediaItem(context, result.item);
    } else {
      const videoCount = result.items.filter((it) => it.mediaType === "video").length;
      const imageCount = result.items.filter((it) => it.mediaType === "image").length;

      let detail = "";
      if (videoCount > 0 && imageCount > 0) {
        detail = ` (${String(videoCount)} video, ${String(imageCount)} foto)`;
      } else if (videoCount > 0) {
        detail = ` (${String(videoCount)} video)`;
      } else if (imageCount > 0) {
        detail = ` (${String(imageCount)} foto)`;
      }

      const totalMsg =
        result.totalCount > result.items.length
          ? `Terdeteksi ${String(result.totalCount)} media X (Twitter)${detail} (mengirim maks. ${String(result.items.length)}). Mengirim satu per satu...`
          : `Terdeteksi ${String(result.items.length)} media X (Twitter)${detail}. Mengirim satu per satu...`;

      await context.reply(totalMsg);

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
        `${formatTwitterError(error)}\nLimit yang sudah direservasi telah dikembalikan.`,
      );
    } else {
      await context.reply(formatTwitterError(error));
    }
  }
}

// ─── Pinterest (.pin) ──────────────────────────────────────────────────────
// Foto resolusi asli HD / Video Pinterest, supports pin.it shortlink

async function handlePinterestDownloader(context: CommandContext): Promise<void> {
  const rawUrl = context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "pinterest");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .pin <link Pinterest / pin.it>");
    return;
  }
  const url = parsedUrl.toString();

  const access = await resolveFeatureAccess(context, HeavyFeatureType.PINTEREST_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await context.reply("Media Pinterest sedang diproses. Mohon tunggu...");
    const result = await downloaderService.downloadPinterest(url);

    await sendMediaItem(context, result);

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    if (reserved && reservation !== null) {
      await refundFeatureLimit(reservation);
      await context.reply(
        `${formatPinterestError(error)}\nLimit yang sudah direservasi telah dikembalikan.`,
      );
    } else {
      await context.reply(formatPinterestError(error));
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const MB_100 = 100 * 1024 * 1024;

async function sendMediaItem(
  context: CommandContext,
  item: DownloadedMediaItem,
  caption?: string,
): Promise<void> {
  if (item.mediaType === "video") {
    if (item.buffer.byteLength <= MB_100) {
      await context.socket.sendMessage(
        context.chatJid,
        {
          video: item.buffer,
          mimetype: "video/mp4",
          fileName: item.fileName,
          caption,
        },
        { quoted: context.message },
      );
    } else {
      const sizeMb = (item.buffer.byteLength / (1024 * 1024)).toFixed(1);
      const docCaption = caption
        ? `${caption}\n\nℹ️ _Ukuran video (${sizeMb} MB) di atas 100 MB, dikirim sebagai dokumen video HD._`
        : `ℹ️ _Ukuran video (${sizeMb} MB) di atas 100 MB, dikirim sebagai dokumen video HD._`;

      await context.socket.sendMessage(
        context.chatJid,
        {
          document: item.buffer,
          mimetype: "video/mp4",
          fileName: item.fileName.endsWith(".mp4") ? item.fileName : `${item.fileName}.mp4`,
          caption: docCaption,
        },
        { quoted: context.message },
      );
    }
  } else {
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: item.buffer,
        mimetype: item.mimetype,
        caption,
      },
      { quoted: context.message },
    );
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function formatTikTokError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media TikTok terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (
    message.includes("duration") ||
    message.includes("match-filter") ||
    message.includes("4200")
  ) {
    return "Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).";
  }
  if (message.includes("gagal mengambil foto") || message.includes("tidak ada media")) {
    return "Konten foto slide TikTok gagal diambil. Pastikan link valid dan publik.";
  }
  return "Konten TikTok gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
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
    return "Media terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (
    message.includes("duration") ||
    message.includes("match-filter") ||
    message.includes("1800")
  ) {
    return "Video Instagram melebihi batas durasi 30 menit.";
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
    message.includes("3600") ||
    message.includes("720")
  ) {
    return "Video melebihi batas durasi 1 jam.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Video terlalu besar untuk dikirim (maks. 400 MB).";
  }
  return "Video YouTube gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}

function formatTwitterError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("duration") ||
    message.includes("match-filter") ||
    message.includes("1800")
  ) {
    return "Video X (Twitter) melebihi batas durasi 30 menit.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media X (Twitter) terlalu besar untuk dikirim (maks. 400 MB).";
  }
  return "Media X (Twitter) gagal diambil. Pastikan tweet bersifat publik dan berisi video/media.";
}

function formatPinterestError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media Pinterest terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (message.includes("tidak ditemukan") || message.includes("tidak ada media")) {
    return "Media Pinterest tidak ditemukan. Pastikan link publik dan valid.";
  }
  return "Media Pinterest gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}
