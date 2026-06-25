import { playAudioService } from "../../services/media/playAudio.service";
import { youtubeSearchService } from "../../services/media/youtubeSearch.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

const MAX_DURATION_SECONDS = 10 * 60;

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
    const video = await youtubeSearchService.searchVideo(query);

    if (video.durationSeconds > MAX_DURATION_SECONDS) {
      await context.reply("Durasi lagu maksimal 10 menit.");
      return;
    }

    const audio = await playAudioService.prepareOpusAudio(video.url);
    tempDir = audio.tempDir;

    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: audio.buffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      },
      { quoted: context.message },
    );

    await context.reply(formatYoutubeResult(video));
  } catch (error: unknown) {
    await context.reply(formatPlayError(error));
  } finally {
    if (tempDir) {
      await playAudioService.cleanup(tempDir);
    }
  }
}

function formatPlayError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "";
  const message = rawMessage.toLowerCase();

  if (message.includes("tidak ditemukan")) {
    return "Lagu tidak ditemukan di YouTube. Coba kata kunci lain atau tambahkan nama penyanyi.";
  }

  if (message.includes("yt-dlp")) {
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

function formatYoutubeResult(video: { durationText: string; title: string }): string {
  return [
    "[PLAY]",
    `Judul: ${video.title}`,
    `Durasi: ${video.durationText}`,
  ].join("\n");
}
