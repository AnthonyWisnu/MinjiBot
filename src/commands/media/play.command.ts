import { audioPlayService } from "../../services/media/audioPlay.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

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
    await context.reply("Lagu sedang dicari. Mohon tunggu.");
    const audio = await audioPlayService.searchAndDownloadMp3(query);

    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: audio.buffer,
        mimetype: audio.mimetype,
        fileName: audio.fileName,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatPlayError(error));
  }
}

function formatPlayError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("duration")) {
    return "Durasi lagu maksimal 10 menit.";
  }

  if (message.includes("audio tidak ditemukan") || message.includes("no video")) {
    return "Lagu tidak ditemukan. Coba kata kunci lain.";
  }

  if (message.includes("ukuran audio")) {
    return "Audio terlalu besar untuk dikirim.";
  }

  return "Lagu gagal diambil. Coba kata kunci lain.";
}
