import {
  localFunBankService,
  type LocalFunCategory,
} from "../../services/fun/localFunBank.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

function createLocalFunCommand(
  name: LocalFunCategory,
  aliases?: string[],
): CommandDefinition {
  return {
    name,
    aliases,
    execute: async (context: CommandContext) => {
      const picked = localFunBankService.pickRandom(name);
      await context.reply([`*── [ ${picked.title} ] ──*`, "", picked.text].join("\n"));
    },
  };
}

export const localFunBankCommands: CommandDefinition[] = [
  createLocalFunCommand("pantun"),
  createLocalFunCommand("gombal"),
  createLocalFunCommand("jokes", ["receh"]),
  createLocalFunCommand("faktaunik"),
  createLocalFunCommand("quotes"),
  createLocalFunCommand("motivasi"),
  createLocalFunCommand("bucin"),
  createLocalFunCommand("galau"),
  createLocalFunCommand("bijak"),
  createLocalFunCommand("sindir"),
  createLocalFunCommand("katakata"),
  createLocalFunCommand("bacot"),
  createLocalFunCommand("darkjokes"),
  createLocalFunCommand("tebakreceh"),
  createLocalFunCommand("pickup"),
];
