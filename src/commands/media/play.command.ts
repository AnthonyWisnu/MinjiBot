import play, { type YouTubeVideo } from "play-dl";

import { logger } from "../../config/logger";
import { playAudioService } from "../../services/media/playAudio.service";
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

  try {
    await context.reply(`Mencari ${query}...`);
    const videos = await searchYouTubeVideos(query);
    const playableVideos = videos.filter(
      (video) => video.durationInSec > 0 && video.durationInSec <= MAX_DURATION_SECONDS,
    );

    if (playableVideos.length === 0) {
      await context.reply("Durasi lagu maksimal 10 menit.");
      return;
    }

    const result = await prepareFirstAvailableAudio(playableVideos);

    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: result.audio.buffer,
        mimetype: result.audio.mimetype,
        ptt: true,
      },
      { quoted: context.message },
    );

    await context.reply(formatYoutubeResult(result.video));
  } catch (error: unknown) {
    await context.reply(formatPlayError(error));
  }
}

async function searchYouTubeVideos(query: string): Promise<YouTubeVideo[]> {
  await play.setToken({
    useragent: ["Mozilla/5.0"],
  });

  const videos = await play.search(query, {
    limit: MAX_SEARCH_RESULTS,
    source: {
      youtube: "video",
    },
  });

  if (videos.length === 0) {
    throw new Error("Video YouTube tidak ditemukan.");
  }

  return videos;
}

async function prepareFirstAvailableAudio(videos: YouTubeVideo[]): Promise<{
  audio: Awaited<ReturnType<typeof playAudioService.prepareOpusAudio>>;
  video: YouTubeVideo;
}> {
  let lastError: unknown;

  for (const video of videos) {
    try {
      return {
        audio: await playAudioService.prepareOpusAudio(video.url),
        video,
      };
    } catch (error: unknown) {
      lastError = error;
      logger.warn(
        {
          error,
          videoId: video.id,
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
    message.includes("sign in") ||
    message.includes("play-dl") ||
    message.includes("403") ||
    message.includes("stream audio youtube")
  ) {
    return "Stream audio YouTube gagal dibuka. Coba judul lain atau coba lagi nanti.";
  }

  if (message.includes("ffmpeg")) {
    return "ffmpeg tidak tersedia atau gagal menjalankan convert audio.";
  }

  return [
    "Audio YouTube gagal diproses. Coba lagi nanti.",
    "",
    "Kalau masih gagal, cek koneksi VPS dan ffmpeg.",
  ].join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function formatYoutubeResult(video: { durationRaw: string; title?: string }): string {
  return [
    "[PLAY]",
    `Judul: ${video.title ?? "-"}`,
    `Durasi: ${video.durationRaw}`,
  ].join("\n");
}
