import { gameService } from "../../services/game/game.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

export const gameCommands: CommandDefinition[] = [
  {
    name: "kuis",
    execute: (context) => replyGame(context, () => gameService.startOrAnswerQuiz(context, "kuis")),
  },
  {
    name: "family100",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuiz(context, "family100")),
  },
  {
    name: "tebakkata",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuiz(context, "tebakkata")),
  },
  {
    name: "tebakemoji",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuiz(context, "tebakemoji")),
  },
  {
    name: "tebakangka",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuiz(context, "tebakangka")),
  },
  {
    name: "tictactoe",
    execute: (context) => replyGame(context, () => Promise.resolve(gameService.playTicTacToe(context))),
  },
  {
    name: "nyerah",
    execute: (context) => replyGame(context, () => gameService.surrender(context)),
  },
];

async function replyGame(context: CommandContext, action: () => Promise<string>): Promise<void> {
  try {
    await context.reply(await action());
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Game gagal diproses. Silakan coba lagi."));
  }
}
