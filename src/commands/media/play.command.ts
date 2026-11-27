import { HeavyFeatureType } from "@prisma/client";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";
import { lastPlayedService } from "../../services/media/lastPlayed.service";
import { playAudioService } from "../../services/media/playAudio.service";
import {
  youtubeSearchService,
  type YoutubeSearchResult,
} from "../../services/media/youtubeSearch.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatDurationLimitLabel } from "../../utils/time";
import { parseAllowedDownloaderUrl } from "../../utils/urlValidator";
import { executeWithHeavyFeatureLimit } from "./heavyFeatureHelper";

const MAX_SEARCH_RESULTS = 3;
const MAX_INLINE_AUDIO_BYTES = 100 * 1024 * 1024;
const GENERIC_PLAY_ERROR = "Audio gagal diproses. Silakan coba lagi nanti.";

export const playCommands: CommandDefinition[] = [
  {
    name: "play",
    execute: handlePlay,
  },
];

async function handlePlay(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Format command salah.\nGunakan: .play <nama lagu / link YouTube Music>");
    return;
  }

  try {
    await executeWithHeavyFeatureLimit(context, HeavyFeatureType.PLAY_SONG, async () => {
      const candidates = await resolvePlayableCandidates(context, query);

      let tempDir: string | undefined;
      try {
        const result = await prepareFirstAvailableAudio(candidates);
        tempDir = result.audio.tempDir;

        await sendPlayAudio(context, result.audio.buffer, result.audio.mimetype, result.video);

        lastPlayedService.setLastPlayed({
          chatJid: context.chatJid,
          title: result.video.title,
          artist: result.video.channelTitle,
        });

        await context.reply(formatYoutubeResult(result.video));
      } finally {
        if (tempDir) {
          await playAudioService.cleanup(tempDir);
        }
      }
    });
  } catch (error: unknown) {
    logger.error(
      {
        err: error,
        commandName: "play",
        query,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
      },
      "Gagal memproses command play",
    );
    await context.reply(formatPlayError(error));
  }
}

async function resolvePlayableCandidates(
  context: CommandContext,
  query: string,
): Promise<YoutubeSearchResult[]> {
  const maxDurationSec = env.MAX_YOUTUBE_MUSIC_DURATION_SEC;
  const durationMessage = `Durasi lagu maksimal ${formatDurationLimitLabel(maxDurationSec)}.`;
  const urlMatch = /https?:\/\/[^\s<>"'`]+/i.exec(query);

  if (urlMatch !== null) {
    const candidateUrl = urlMatch[0].replace(/[),.;!?]+$/, "");
    const parsedUrl = parseAllowedDownloaderUrl(candidateUrl, "youtube");
    if (!parsedUrl) {
      throw new AppUserError(
        "Command .play hanya menerima judul lagu atau link resmi YouTube / YouTube Music.",
      );
    }

    await context.reply("Mengambil audio YouTube Music, mohon tunggu...");
    const video = await youtubeSearchService.getVideoByUrl(parsedUrl);
    if (video.durationSeconds <= 0) {
      throw new AppUserError("Siaran langsung tidak didukung untuk .play.");
    }
    if (video.durationSeconds > maxDurationSec) {
      throw new AppUserError(durationMessage);
    }
    return [video];
  }

  await context.reply(`Mencari ${query}...`);
  const videos = await youtubeSearchService.searchVideos(query, MAX_SEARCH_RESULTS);
  const playableVideos = videos.filter(
    (video) => video.durationSeconds > 0 && video.durationSeconds <= maxDurationSec,
  );

  if (playableVideos.length === 0) {
    throw new AppUserError(durationMessage);
  }

  return playableVideos;
}

async function sendPlayAudio(
  context: CommandContext,
  buffer: Buffer,
  mimetype: "audio/mpeg",
  video: YoutubeSearchResult,
): Promise<void> {
  if (buffer.byteLength <= MAX_INLINE_AUDIO_BYTES) {
    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: buffer,
        mimetype,
        ptt: false,
      },
      { quoted: context.message },
    );
    return;
  }

  const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
  await context.socket.sendMessage(
    context.chatJid,
    {
      document: buffer,
      mimetype,
      fileName: createAudioFileName(video.title),
      caption: `_Ukuran audio (${sizeMb} MB) di atas 100 MB, dikirim sebagai dokumen MP3._`,
    },
    { quoted: context.message },
  );
}

function createAudioFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return `minjibot-${slug || "audio"}.mp3`;
}

async function prepareFirstAvailableAudio(videos: YoutubeSearchResult[]): Promise<{
  audio: Awaited<ReturnType<typeof playAudioService.prepareMp3Audio>>;
  video: YoutubeSearchResult;
}> {
  let lastError: unknown;

  for (const video of videos) {
    try {
      return {
        audio: await playAudioService.prepareMp3Audio(video.url),
        video,
      };
    } catch (error: unknown) {
      lastError = error;
      logger.warn(
        {
          errorMessage: getErrorMessage(error),
          videoId: video.videoId,
          title: video.title,
        },
        "Kandidat audio YouTube gagal diproses",
      );
    }
  }

  throw new Error(`Tidak ada hasil YouTube yang bisa diunduh. ${getErrorMessage(lastError)}`);
}

function formatPlayError(error: unknown): string {
  if (error instanceof AppUserError) {
    return error.message;
  }

  const rawMessage = getErrorMessage(error);
  const message = rawMessage.toLowerCase();

  if (message.includes("tidak ditemukan")) {
    return "Lagu tidak ditemukan. Coba kata kunci lain atau tambahkan nama penyanyi.";
  }

  if (message.includes("download audio") || message.includes("stream")) {
    return GENERIC_PLAY_ERROR;
  }

  if (message.includes("ffmpeg")) {
    return GENERIC_PLAY_ERROR;
  }

  return GENERIC_PLAY_ERROR;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function formatYoutubeResult(video: { durationText: string; title: string }): string {
  return ["[PLAY]", `Judul: ${video.title}`, `Durasi: ${video.durationText}`].join("\n");
}
