import { logger } from "../../config/logger";
import { playAudioService } from "../../services/media/playAudio.service";
import {
  youtubeSearchService,
  type YoutubeSearchResult,
} from "../../services/media/youtubeSearch.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

const MAX_DURATION_SECONDS = 10 * 60;
const MAX_SEARCH_RESULTS = 3;
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
        ptt: false,
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
        audio: await playAudioService.prepareMp3Audio(video.url),
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
