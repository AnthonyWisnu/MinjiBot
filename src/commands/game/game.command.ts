import { type GameMessageResponse, gameService } from "../../services/game/game.service";
import { quickQuizService } from "../../services/game/quickQuiz.service";
import { sambungKataService } from "../../services/game/sambungKata.service";
import { slotGameService } from "../../services/game/slotGame.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

export const gameCommands: CommandDefinition[] = [
  {
    name: "kuis",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "kuis")),
  },
  {
    name: "family100",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "family100")),
  },
  {
    name: "tebakkata",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "tebakkata")),
  },
  {
    name: "tebakemoji",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "tebakemoji")),
  },
  {
    name: "tebakangka",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "tebakangka")),
  },
  {
    name: "mtk",
    aliases: ["math"],
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "mtk")),
  },
  {
    name: "katla",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "katla")),
  },
  {
    name: "caklontong",
    aliases: ["cakl"],
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "caklontong")),
  },
  {
    name: "bom",
    execute: (context) =>
      replyGame(context, () => gameService.startOrAnswerQuizRich(context, "bom")),
  },
  {
    name: "clue",
    aliases: ["hint"],
    execute: (context) => replyGame(context, () => Promise.resolve(gameService.getClue(context))),
  },
  {
    name: "slot",
    execute: (context) => replyGame(context, async () => ({ text: await slotGameService.play(context) })),
  },
  {
    name: "tictactoe",
    execute: (context) => replyGame(context, () => gameService.playTicTacToeRich(context)),
  },
  {
    name: "nyerah",
    execute: (context) =>
      replyGame(context, async () => {
        if (context.isGroup) {
          const quickGave = quickQuizService.giveUp(context.chatJid);
          if (quickGave) {
            return quickGave;
          }
          if (sambungKataService.getSession(context.chatJid)) {
            sambungKataService.stopGame(context.chatJid);
            return { text: "Sesi Sambung Kata dihentikan." };
          }
        }
        return gameService.surrenderRich(context);
      }),
  },
];

async function replyGame(
  context: CommandContext,
  action: () => Promise<GameMessageResponse>,
): Promise<void> {
  try {
    const response = await action();
    const sent = await context.socket.sendMessage(
      context.chatJid,
      {
        text: response.text,
        ...(response.mentions && response.mentions.length > 0 ? { mentions: response.mentions } : {}),
      },
      { quoted: context.message },
    );
    if (sent?.key.id) {
      gameService.setQuizMessageId(context.chatJid, sent.key.id);
      gameService.setTicTacToeMessageId(context.chatJid, sent.key.id);
    }
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Game gagal diproses. Silakan coba lagi."));
  }
}
