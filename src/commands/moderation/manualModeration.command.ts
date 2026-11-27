import { manualModerationService } from "../../services/moderation/manualModeration.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const manualModerationCommands: CommandDefinition[] = [
  {
    name: "add",
    execute: handleAdd,
  },
  {
    name: "kick",
    execute: handleKick,
  },
  {
    name: "promote",
    execute: handlePromote,
  },
  {
    name: "demote",
    execute: handleDemote,
  },
  {
    name: "del",
    aliases: ["delete"],
    execute: handleDelete,
  },
];

async function handleAdd(context: CommandContext): Promise<void> {
  try {
    const result = await manualModerationService.add(context);
    await context.reply(result);
  } catch (error: unknown) {
    await context.reply(formatManualModerationError(error));
  }
}

async function handleKick(context: CommandContext): Promise<void> {
  try {
    const result = await manualModerationService.kick(context);
    await context.reply(result);
  } catch (error: unknown) {
    await context.reply(formatManualModerationError(error));
  }
}

async function handlePromote(context: CommandContext): Promise<void> {
  try {
    const result = await manualModerationService.promote(context);
    await context.reply(result);
  } catch (error: unknown) {
    await context.reply(formatManualModerationError(error));
  }
}

async function handleDemote(context: CommandContext): Promise<void> {
  try {
    const result = await manualModerationService.demote(context);
    await context.reply(result);
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
    return error.message;
  }

  return "[ERROR] Command moderasi gagal diproses.";
}

function isSafeManualModerationError(message: string): boolean {
  return message.startsWith("[ERROR]") || message.startsWith("[INFO]");
}
