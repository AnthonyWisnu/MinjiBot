import { logger } from "../../config/logger";
import { playAudioService } from "../../services/media/playAudio.service";
import {
  youtubeSearchService,
  type YoutubeSearchResult,
} from "../../services/media/youtubeSearch.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

const MAX_DURATION_SECONDS = 10 * 60;
const MAX_SEARCH_RESULTS = 5;

export const playCommands: CommandDefinition[] = [
  {
    name: "play",
    execute: handlePlay,
  },
];

async function handlePlay(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Format command salah.\nGunakan: .play <nama lagu>");
    return;
  }

  let tempDir: string | undefined;

  try {
    await context.reply(`Mencari ${query}...`);
    const videos = await youtubeSearchService.searchVideos(query, MAX_SEARCH_RESULTS);
    const playableVideos = videos.filter(
      (video) => video.durationSeconds > 0 && video.durationSeconds <= MAX_DURATION_SECONDS,
    );

    if (playableVideos.length === 0) {
      await context.reply("Durasi lagu maksimal 10 menit.");
      return;
    }

    const result = await prepareFirstAvailableAudio(playableVideos);
    tempDir = result.audio.tempDir;

    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: result.audio.buffer,
        mimetype: result.audio.mimetype,
        fileName: result.audio.fileName,
      },
      { quoted: context.message },
    );

    await context.reply(formatYoutubeResult(result.video));
  } catch (error: unknown) {
    await context.reply(formatPlayError(error));
  } finally {
    if (tempDir) {
      await playAudioService.cleanup(tempDir);
    }
  }
}

async function prepareFirstAvailableAudio(videos: YoutubeSearchResult[]): Promise<{
  audio: Awaited<ReturnType<typeof playAudioService.prepareMp3Audio>>;
  video: YoutubeSearchResult;
}> {
  let lastError: unknown;

  for (const video of videos) {
    try {
      return {
        audio: await playAudioService.prepareMp3Audio(video.url, video.title),
        video,
      };
    } catch (error: unknown) {
      lastError = error;
      logger.warn(
        {
          error,
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
  const rawMessage = getErrorMessage(error);
  const message = rawMessage.toLowerCase();

  if (message.includes("tidak ditemukan")) {
    return "Lagu tidak ditemukan di YouTube. Coba kata kunci lain atau tambahkan nama penyanyi.";
  }

  if (
    message.includes("video unavailable") ||
    message.includes("not available") ||
    message.includes("private video") ||
    message.includes("sign in")
  ) {
    return "Tidak ada hasil YouTube yang bisa diunduh. Coba judul yang lebih spesifik atau tambahkan nama penyanyi.";
  }

  if (message.includes("enoent") || message.includes("not found")) {
    return "yt-dlp tidak tersedia atau gagal dijalankan. Pastikan yt-dlp tersedia di PATH server.";
  }

  if (message.includes("ffmpeg")) {
    return "ffmpeg tidak tersedia atau gagal menjalankan convert audio.";
  }

  return [
    "Audio YouTube gagal diproses. Coba lagi nanti.",
    "",
    "Kalau masih gagal, cek koneksi VPS, yt-dlp, dan ffmpeg.",
  ].join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function formatYoutubeResult(video: { durationText: string; title: string }): string {
  return [
    "[PLAY]",
    `Judul: ${video.title}`,
    `Durasi: ${video.durationText}`,
  ].join("\n");
}
