import {
  QUICK_QUIZ_LABELS,
  type QuickQuizKind,
} from "../../services/game/quickQuizBank";
import { quickQuizService } from "../../services/game/quickQuiz.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

function createQuickQuizCommand(kind: QuickQuizKind): CommandDefinition {
  return {
    name: kind,
    execute: async (context: CommandContext) => {
      if (!context.isGroup || !context.tenantGroup) {
        await context.reply(`Game .${kind} hanya bisa dimainkan di grup aktif.`);
        return;
      }

      try {
        const arg = context.argsText.trim();
        const lower = arg.toLowerCase();

        if (lower === "skip" || lower === "nyerah" || lower === "stop") {
          const gave = quickQuizService.giveUp(context.chatJid);
          await context.reply(
            gave ? gave.text : "Tidak ada soal tebak-tebakan cepat aktif di grup ini.",
          );
          return;
        }

        const active = quickQuizService.getActiveSession(context.chatJid);
        if (active?.kind === kind && arg.length > 0) {
          const sender = await identityResolverService.resolveCanonicalUserJid(
            context.socket,
            context.chatJid,
            context.senderUserJid,
            context.senderAltJids,
          );
          const res = await quickQuizService.submitAnswer(context.chatJid, sender, arg);
          if (res.text) {
            await context.reply(res.text, { mentions: res.mentions });
          }
          return;
        }

        const started = quickQuizService.startQuiz(context.chatJid, kind);
        const sent = await context.socket.sendMessage(
          context.chatJid,
          { text: started.text },
          { quoted: context.message },
        );
        if (sent?.key.id) {
          quickQuizService.setMessageId(context.chatJid, sent.key.id);
        }
      } catch (error: unknown) {
        await context.reply(formatUserSafeError(error, `Gagal memproses game ${QUICK_QUIZ_LABELS[kind]}.`));
      }
    },
  };
}

const ALL_KINDS: readonly QuickQuizKind[] = [
  "susunkata",
  "tebakbendera",
  "siapakahaku",
  "tebakkalimat",
  "tebaklirik",
  "tekateki",
  "asahotak",
  "tebakkimia",
  "tebakibukota",
  "tebakprovinsi",
  "tebaklagu",
  "benarsalah",
];

export const quickQuizCommands: CommandDefinition[] = ALL_KINDS.map((kind) =>
  createQuickQuizCommand(kind),
);
