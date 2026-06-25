import { musicPreviewService } from "../../services/media/musicPreview.service";
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
    await context.reply("Preview lagu sedang dicari. Mohon tunggu.");
    const audio = await musicPreviewService.searchPreview(query);

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
  const rawMessage = error instanceof Error ? error.message : "";
  const message = rawMessage.toLowerCase();

  if (message.includes("tidak ditemukan")) {
    return "Preview lagu tidak ditemukan. Coba kata kunci lain atau tambahkan nama penyanyi.";
  }

  if (message.includes("terlalu besar")) {
    return "Preview lagu terlalu besar untuk dikirim.";
  }

  return [
    "Preview lagu gagal diambil. Coba lagi nanti.",
    "",
    "Catatan: .play memakai preview resmi online, bukan full lagu.",
  ].join("\n");
}
