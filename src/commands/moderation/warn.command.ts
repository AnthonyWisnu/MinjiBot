import { warnService } from "../../services/moderation/warn.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const warnCommands: CommandDefinition[] = [
  {
    name: "warn",
    execute: handleWarn,
  },
  {
    name: "unwarn",
    execute: handleUnwarn,
  },
  {
    name: "warns",
    aliases: ["cekwarn", "listwarn"],
    execute: handleWarns,
  },
  {
    name: "resetwarn",
    aliases: ["clearwarn"],
    execute: handleResetWarn,
  },
  {
    name: "setwarn",
    execute: handleSetWarn,
  },
];

async function handleWarn(context: CommandContext): Promise<void> {
  try {
    const result = await warnService.warn(context);
    await context.reply(result.message, { mentions: result.mentions });
  } catch (error: unknown) {
    await context.reply(formatWarnError(error));
  }
}

async function handleUnwarn(context: CommandContext): Promise<void> {
  try {
    const result = await warnService.unwarn(context);
    await context.reply(result.message, { mentions: result.mentions });
  } catch (error: unknown) {
    await context.reply(formatWarnError(error));
  }
}

async function handleWarns(context: CommandContext): Promise<void> {
  try {
    const result = await warnService.getWarns(context);
    await context.reply(result.message, { mentions: result.mentions });
  } catch (error: unknown) {
    await context.reply(formatWarnError(error));
  }
}

async function handleResetWarn(context: CommandContext): Promise<void> {
  try {
    const result = await warnService.resetWarn(context);
    await context.reply(result.message, { mentions: result.mentions });
  } catch (error: unknown) {
    await context.reply(formatWarnError(error));
  }
}

async function handleSetWarn(context: CommandContext): Promise<void> {
  try {
    const result = await warnService.setWarnThreshold(context);
    await context.reply(result);
  } catch (error: unknown) {
    await context.reply(formatWarnError(error));
  }
}

function formatWarnError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("[")) {
    return error.message;
  }

  return "[ERROR] Terjadi kesalahan saat memproses command peringatan.";
}
