import { afkService } from "../../services/afk/afk.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

export const afkCommands: CommandDefinition[] = [
  {
    name: "afk",
    execute: handleAfk,
  },
];

async function handleAfk(context: CommandContext): Promise<void> {
  try {
    if (!context.isGroup) {
      await context.reply("Command AFK hanya dapat digunakan di grup.");
      return;
    }

    const status = await afkService.setAfkStatus(
      context.chatJid,
      context.senderUserJid,
      context.argsText,
    );

    await context.reply(
      [
        "💤 *[ AFK DIAKTIFKAN ]*",
        `• Status : Aktif`,
        `• Alasan : ${status.reason}`,
        "",
        "Sistem akan mencatat pesan jika ada yang mencarimu. Ketik pesan apapun di grup untuk mematikan mode AFK.",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Status AFK gagal diproses."));
  }
}
