import { manualModerationService } from "../../services/moderation/manualModeration.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const manualModerationCommands: CommandDefinition[] = [
  {
    name: "kick",
    execute: handleKick,
  },
  {
    name: "del",
    aliases: ["delete"],
    execute: handleDelete,
  },
];

async function handleKick(context: CommandContext): Promise<void> {
  try {
    const result = await manualModerationService.kick(context);
    await context.socket.sendMessage(
      context.chatJid,
      {
        text: result,
        mentions: [context.quoted?.participantJid ?? context.mentionedJids[0] ?? ""].filter(
          (jid) => jid.length > 0,
        ),
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatManualModerationError(error));
  }
}

async function handleDelete(context: CommandContext): Promise<void> {
  try {
    const result = await manualModerationService.deleteQuotedMessage(context);
    await context.reply(result);
  } catch (error: unknown) {
    await context.reply(formatManualModerationError(error));
  }
}

function formatManualModerationError(error: unknown): string {
  if (error instanceof Error && isSafeManualModerationError(error.message)) {
    return `${error.message}\n\nPastikan bot menjadi admin grup.`;
  }

  return "Command moderasi gagal diproses.\n\nPastikan bot menjadi admin grup.";
}

function isSafeManualModerationError(message: string): boolean {
  return (
    message.includes("kick diri sendiri") ||
    message.includes("Reply pesan") ||
    message.includes("Reply atau mention") ||
    message.includes("User target") ||
    message.includes("hanya dapat digunakan")
  );
}
