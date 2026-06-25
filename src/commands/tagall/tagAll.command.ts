import { tagAllService } from "../../services/tagall/tagAll.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

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
    await context.reply(formatUserSafeError(error, "Tag all gagal diproses. Silakan coba lagi."));
  }
}
