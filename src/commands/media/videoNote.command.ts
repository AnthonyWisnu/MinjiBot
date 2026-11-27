import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { videoNoteService } from "../../services/media/videoNote.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { isMediaCommandAllowed } from "../../utils/dmAccess";
import { resolveMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const BYTES_PER_MB = 1024 * 1024;
const MAX_VIDEO_NOTE_INPUT_MB = 30;

export const videoNoteCommands: CommandDefinition[] = [
  {
    name: "ptv",
    aliases: ["videonote"],
    execute: handleVideoNote,
  },
];

async function handleVideoNote(context: CommandContext): Promise<void> {
  try {
    if (!(await isMediaCommandAllowed(context))) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
      );
      return;
    }

    const target = resolveMediaTarget(context, ["video"]);
    if (!target) {
      await context.reply("Kirim atau reply video dengan command .ptv (atau .videonote).");
      return;
    }

    if (target.fileLength && target.fileLength > MAX_VIDEO_NOTE_INPUT_MB * BYTES_PER_MB) {
      await context.reply(`Ukuran video maksimal ${String(MAX_VIDEO_NOTE_INPUT_MB)} MB.`);
      return;
    }

    await context.reply("Sedang memproses video note bersuara, mohon tunggu...");
    const downloaded = await downloadMediaMessage(
      target.message,
      "buffer",
      {},
      {
        logger: logger.child({ module: "ptv-download" }),
        reuploadRequest: context.socket.updateMediaMessage,
      },
    );
    const inputBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);

    if (inputBuffer.byteLength > MAX_VIDEO_NOTE_INPUT_MB * BYTES_PER_MB) {
      await context.reply(`Ukuran video maksimal ${String(MAX_VIDEO_NOTE_INPUT_MB)} MB.`);
      return;
    }

    const result = await videoNoteService.createVideoNote(inputBuffer);

    await context.socket.sendMessage(
      context.chatJid,
      {
        video: result.buffer,
        mimetype: result.mimetype,
        ptv: true,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    logger.error(
      { err: error, commandName: "ptv", chatJid: context.chatJid, senderJid: context.senderJid },
      "Gagal memproses command video note (.ptv)",
    );
    await context.reply(formatUserSafeError(error, "Konversi video note gagal diproses."));
  }
}
