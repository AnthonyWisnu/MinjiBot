import { HeavyFeatureType } from "@prisma/client";

import { downloaderService } from "../../services/media/downloader.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { extractFirstHttpUrl, parseAllowedDownloaderUrl } from "../../utils/urlValidator";
import {
  formatFacebookError,
  formatGitCloneError,
  formatInstagramError,
  formatPinterestError,
  formatThreadsError,
  formatTikTokError,
  formatTwitterError,
  formatYoutubeError,
  handleDownloaderFailure,
  notifyProcessingOrQueued,
  sendAudioMessage,
  sendMediaItem,
  sleep,
} from "./downloaderDelivery";
import {
  consumeFeatureLimit,
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
  {
    name: "facebook",
    aliases: ["fb"],
    execute: handleFacebookDownloader,
  },
  {
    name: "threads",
    execute: handleThreadsDownloader,
  },
  {
    name: "gitclone",
    execute: handleGitCloneDownloader,
  },
];

async function handleTikTokDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
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

    await notifyProcessingOrQueued(context, "media TikTok");
    const result = await downloaderService.downloadTikTok(url);

    if (result.type === "video") {
      await sendMediaItem(context, {
        buffer: result.video.buffer,
        fileName: result.video.fileName,
        mimetype: result.video.mimetype,
        mediaType: "video",
      });
    } else if (result.items.length === 1) {
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

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }

    if (result.audio) {
      await sleep(500);
      await sendAudioMessage(context, result.audio);
    }
  } catch (error: unknown) {
    await handleDownloaderFailure({
      context,
      commandName: "tt",
      label: "TikTok",
      url,
      error,
      reserved,
      reservation,
      formatError: formatTikTokError,
    });
  }
}

async function handleInstagramDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
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

    await notifyProcessingOrQueued(context, "media Instagram");
    const result = await downloaderService.downloadInstagram(url);

    if (result.type === "single") {
      await sendMediaItem(context, result.item);
    } else {
      const totalMsg =
        result.totalCount > result.items.length
          ? `Terdeteksi ${String(result.totalCount)} item Instagram (mengirim maks. ${String(result.items.length)}). Mengirim satu per satu...`
          : `Terdeteksi ${String(result.items.length)} item Instagram. Mengirim satu per satu...`;
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
    await handleDownloaderFailure({
      context,
      commandName: "ig",
      label: "Instagram",
      url,
      error,
      reserved,
      reservation,
      formatError: formatInstagramError,
    });
  }
}

async function handleYoutubeVideoDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
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

    const isYtMusic = parsedUrl.hostname.toLowerCase() === "music.youtube.com";
    await notifyProcessingOrQueued(
      context,
      isYtMusic ? "YouTube Music (maks. 90 menit)" : "video YouTube (maks. 1 jam, hingga 720p)",
    );
    const result = await downloaderService.downloadYoutube(url);

    await sendMediaItem(context, result);

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    await handleDownloaderFailure({
      context,
      commandName: "yt",
      label: "YouTube",
      url,
      error,
      reserved,
      reservation,
      formatError: formatYoutubeError,
    });
  }
}

async function handleTwitterDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
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

    await notifyProcessingOrQueued(context, "media X (Twitter)");
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
    await handleDownloaderFailure({
      context,
      commandName: "x",
      label: "X (Twitter)",
      url,
      error,
      reserved,
      reservation,
      formatError: formatTwitterError,
    });
  }
}

async function handlePinterestDownloader(context: CommandContext): Promise<void> {
  const rawInput = context.argsText.trim();
  if (!rawInput) {
    await context.reply(
      "Format command salah.\nGunakan: .pin <kata kunci> atau .pin <link Pinterest / pin.it>",
    );
    return;
  }

  const urlMatch = /https?:\/\/[^\s<>"'`]+/i.exec(rawInput);
  let targetUrl: string | null = null;

  if (urlMatch !== null) {
    const candidateUrl = urlMatch[0].replace(/[),.;!?]+$/, "");
    const parsedUrl = parseAllowedDownloaderUrl(candidateUrl, "pinterest");
    if (!parsedUrl) {
      await context.reply(
        "Format command salah.\nGunakan: .pin <kata kunci> atau .pin <link Pinterest / pin.it>",
      );
      return;
    }
    targetUrl = parsedUrl.toString();
  } else if (rawInput.length > 100) {
    await context.reply("Kata kunci pencarian Pinterest terlalu panjang (maks. 100 karakter).");
    return;
  }

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

    if (targetUrl !== null) {
      await notifyProcessingOrQueued(context, "media Pinterest");
      const result = await downloaderService.downloadPinterest(targetUrl);
      await sendMediaItem(context, result);
    } else {
      await notifyProcessingOrQueued(context, `3 foto Pinterest "${rawInput}"`);
      const items = await downloaderService.searchPinterest(rawInput, 3);
      for (const item of items) {
        await sendMediaItem(context, item);
        await sleep(300);
      }
    }

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    await handleDownloaderFailure({
      context,
      commandName: "pin",
      label: "Pinterest",
      url: targetUrl ?? rawInput,
      error,
      reserved,
      reservation,
      formatError: formatPinterestError,
    });
  }
}

async function handleFacebookDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "facebook");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .facebook <link Facebook / fb.watch>");
    return;
  }
  const url = parsedUrl.toString();

  const access = await resolveFeatureAccess(context, HeavyFeatureType.FACEBOOK_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await notifyProcessingOrQueued(context, "video Facebook");
    const result = await downloaderService.downloadFacebook(url);
    await sendMediaItem(context, result);

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    await handleDownloaderFailure({
      context,
      commandName: "facebook",
      label: "Facebook",
      url,
      error,
      reserved,
      reservation,
      formatError: formatFacebookError,
    });
  }
}

async function handleThreadsDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "threads");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .threads <link Threads>");
    return;
  }
  const url = parsedUrl.toString();

  const access = await resolveFeatureAccess(context, HeavyFeatureType.THREADS_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await notifyProcessingOrQueued(context, "media Threads");
    const result = await downloaderService.downloadThreads(url);
    if (result.type === "single") {
      await sendMediaItem(context, result.item);
    } else {
      await context.reply(
        `Terdeteksi ${String(result.items.length)} media Threads. Mengirim satu per satu...`,
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
    await handleDownloaderFailure({
      context,
      commandName: "threads",
      label: "Threads",
      url,
      error,
      reserved,
      reservation,
      formatError: formatThreadsError,
    });
  }
}

async function handleGitCloneDownloader(context: CommandContext): Promise<void> {
  const rawUrl = extractFirstHttpUrl(context.argsText) ?? context.args[0];
  const parsedUrl = parseAllowedDownloaderUrl(rawUrl, "github");
  if (!parsedUrl) {
    await context.reply("Format command salah.\nGunakan: .gitclone <link repository GitHub>");
    return;
  }
  const url = parsedUrl.toString();

  const access = await resolveFeatureAccess(context, HeavyFeatureType.GITCLONE_DOWNLOAD);
  if (access === null) return;

  const reservation = access.skip ? null : access.reservation;
  let reserved = false;

  try {
    if (reservation !== null) {
      const ok = await reserveFeatureLimit(context, reservation);
      if (!ok) return;
      reserved = true;
    }

    await notifyProcessingOrQueued(context, "arsip ZIP repository GitHub");
    const result = await downloaderService.downloadGitClone(url);
    const sizeMb = (result.buffer.byteLength / (1024 * 1024)).toFixed(2);

    await context.socket.sendMessage(
      context.chatJid,
      {
        document: result.buffer,
        mimetype: result.mimetype,
        fileName: result.fileName,
        caption: `Repository: *${result.repoFullName}* (${result.branch})\nUkuran: ${sizeMb} MB`,
      },
      { quoted: context.message },
    );

    if (reserved && reservation !== null) {
      await consumeFeatureLimit(reservation);
    }
  } catch (error: unknown) {
    await handleDownloaderFailure({
      context,
      commandName: "gitclone",
      label: "GitClone",
      url,
      error,
      reserved,
      reservation,
      formatError: formatGitCloneError,
    });
  }
}
