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

    await context.reply(["[AFK] Status AFK aktif.", `Alasan: ${status.reason}`].join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Status AFK gagal diproses."));
  }
}
