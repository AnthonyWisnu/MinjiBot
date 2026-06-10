import { tagAllService } from "../../services/tagall/tagAll.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const tagAllCommands: CommandDefinition[] = [
  {
    name: "tagall",
    execute: handleTagAll,
  },
];

async function handleTagAll(context: CommandContext): Promise<void> {
  try {
    await tagAllService.sendTagAll(context, context.argsText);
  } catch (error: unknown) {
    if (error instanceof Error) {
      await context.reply(error.message);
      return;
    }

    throw error;
  }
}
