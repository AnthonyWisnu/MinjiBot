import { HeavyFeatureType } from "@prisma/client";

import {
  AI_MAX_PROMPT_CHARS,
  openRouterService,
  type AiPersona,
} from "../../services/ai/openRouter.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { extractTextFromMessageContent } from "../../utils/messageText";
import { formatUserSafeError } from "../../utils/userSafeError";
import { executeWithHeavyFeatureLimit } from "../media/heavyFeatureHelper";

function resolveAiPrompt(context: CommandContext): string {
  const userText = context.argsText.trim();
  const quotedText = (
    context.quoted?.text ?? extractTextFromMessageContent(context.quoted?.message)
  ).trim();

  if (userText && quotedText) {
    const combined = `${userText}\n\nKonteks pesan yang dibalas:\n${quotedText}`;
    return combined.length > AI_MAX_PROMPT_CHARS
      ? `${combined.slice(0, AI_MAX_PROMPT_CHARS - 3)}...`
      : combined;
  }

  return userText || quotedText;
}

async function handleAiCommand(context: CommandContext, persona: AiPersona): Promise<void> {
  const prompt = resolveAiPrompt(context);
  if (!prompt) {
    const usage =
      persona === "simi"
        ? "Ketik pesan untuk ngobrol sama Simi.\nContoh: .simi halo minji lagi apa?"
        : "Tulis pertanyaan untuk AI (atau reply pesan lalu ketik .ai).\nContoh: .ai jelaskan kenapa langit berwarna biru";
    await context.reply(usage);
    return;
  }

  const quotaScopeJid = context.isGroup ? context.chatJid : `private:${context.senderUserJid}`;
  const bypassCooldown = context.role === "SUPER_OWNER";

  try {
    // Validasi API key, panjang prompt, cooldown & kuota harian SEBELUM reserve limit
    openRouterService.validateBeforeLimitReserve({
      groupJid: quotaScopeJid,
      userJid: context.senderUserJid,
      prompt,
      bypassCooldown,
    });

    const result = await executeWithHeavyFeatureLimit(
      context,
      HeavyFeatureType.AI_CHAT,
      async () =>
        openRouterService.ask({
          groupJid: quotaScopeJid,
          userJid: context.senderUserJid,
          prompt,
          persona,
          bypassCooldown,
        }),
    );

    if (!result) {
      return;
    }

    if (persona === "simi") {
      await context.reply(result.answer);
      return;
    }

    await context.reply(
      [
        "*── [ MINJI AI ] ──*",
        "",
        result.answer,
        "",
        `_Kuota AI hari ini: ${String(result.remainingGroupQuota)}/${String(result.dailyQuotaLimit)}_`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(
      formatUserSafeError(error, "AI sedang tidak bisa merespons saat ini. Coba lagi sebentar ya."),
    );
  }
}

export const aiCommands: CommandDefinition[] = [
  {
    name: "ai",
    aliases: ["tanya", "gpt", "minji"],
    execute: (context) => handleAiCommand(context, "assistant"),
  },
  {
    name: "simi",
    aliases: ["simsimi"],
    execute: (context) => handleAiCommand(context, "simi"),
  },
];
