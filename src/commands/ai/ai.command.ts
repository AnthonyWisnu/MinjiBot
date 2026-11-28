import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { HeavyFeatureType } from "@prisma/client";

import { logger } from "../../config/logger";
import { chatMemoryService } from "../../services/ai/chatMemory.service";
import {
  AI_MAX_CONTEXT_CHARS,
  AI_MAX_PROMPT_CHARS,
  openRouterService,
  prepareVisionImageDataUrl,
  type AiPersona,
} from "../../services/ai/openRouter.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import { parseRpgState } from "../../services/rpg/rpgState";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatCompactRupiah } from "../../utils/currency";
import { resolveMediaTarget } from "../../utils/mediaTarget";
import { extractTextFromMessageContent } from "../../utils/messageText";
import { formatUserSafeError } from "../../utils/userSafeError";
import { executeWithHeavyFeatureLimit } from "../media/heavyFeatureHelper";

const MAX_VISION_IMAGE_BYTES = 10 * 1024 * 1024;

function resolveAiPrompt(context: CommandContext, maxChars = AI_MAX_PROMPT_CHARS): string {
  const userText = context.argsText.trim();
  const quotedText = (
    context.quoted?.text ?? extractTextFromMessageContent(context.quoted?.message)
  ).trim();

  if (userText && quotedText) {
    const combined = `${userText}\n\nKonteks pesan yang dibalas:\n${quotedText}`;
    return combined.length > maxChars ? `${combined.slice(0, maxChars - 3)}...` : combined;
  }

  const chosen = userText || quotedText;
  return chosen.length > maxChars ? `${chosen.slice(0, maxChars - 3)}...` : chosen;
}

async function runOpenRouterWithLimit(
  context: CommandContext,
  options: {
    persona: AiPersona;
    prompt: string;
    headerTitle?: string;
    imageDataUrl?: string;
    maxPromptChars?: number;
    mentions?: string[];
  },
): Promise<void> {
  const quotaScopeJid = context.isGroup ? context.chatJid : `private:${context.senderUserJid}`;
  const bypassCooldown = context.role === "SUPER_OWNER";

  try {
    openRouterService.validateBeforeLimitReserve({
      groupJid: quotaScopeJid,
      userJid: context.senderUserJid,
      prompt: options.prompt,
      maxPromptChars: options.maxPromptChars,
      bypassCooldown,
    });

    const result = await executeWithHeavyFeatureLimit(
      context,
      HeavyFeatureType.AI_CHAT,
      async () =>
        openRouterService.ask({
          groupJid: quotaScopeJid,
          userJid: context.senderUserJid,
          prompt: options.prompt,
          persona: options.persona,
          imageDataUrl: options.imageDataUrl,
          maxPromptChars: options.maxPromptChars,
          bypassCooldown,
        }),
    );

    if (!result) return;

    if (options.persona === "simi") {
      await context.reply(result.answer, { mentions: options.mentions });
      return;
    }

    const header = options.headerTitle ?? "*── [ MINJI AI ] ──*";
    await context.reply(
      [
        header,
        "",
        result.answer,
        "",
        `_Kuota AI hari ini: ${String(result.remainingGroupQuota)}/${String(result.dailyQuotaLimit)}_`,
      ].join("\n"),
      { mentions: options.mentions },
    );
  } catch (error: unknown) {
    await context.reply(
      formatUserSafeError(error, "AI sedang tidak bisa merespons saat ini. Coba lagi sebentar ya."),
    );
  }
}

async function extractOptionalVisionImage(context: CommandContext): Promise<string | undefined> {
  const target = resolveMediaTarget(context, ["image"]);
  if (!target) return undefined;

  if (target.fileLength && target.fileLength > MAX_VISION_IMAGE_BYTES) {
    throw new Error("Ukuran foto terlalu besar untuk dibaca AI (maksimal 10 MB).");
  }

  const rawBuffer = await downloadMediaMessage(
    target.message,
    "buffer",
    {},
    {
      logger: logger.child({ module: "ai-vision-download" }),
      reuploadRequest: context.socket.updateMediaMessage,
    },
  );
  if (rawBuffer.byteLength > MAX_VISION_IMAGE_BYTES) {
    throw new Error("Ukuran foto terlalu besar untuk dibaca AI (maksimal 10 MB).");
  }

  return prepareVisionImageDataUrl(rawBuffer);
}

async function handleAssistantOrVision(context: CommandContext): Promise<void> {
  try {
    const imageDataUrl = await extractOptionalVisionImage(context);
    const prompt =
      resolveAiPrompt(context) ||
      (imageDataUrl ? "Jelaskan isi gambar ini dengan ringkas dan jelas." : "");

    if (!prompt) {
      await context.reply(
        "Tulis pertanyaan untuk AI (atau kirim/reply foto dengan *.ai <pertanyaan>*).\nContoh: *.ai jelaskan kenapa langit berwarna biru*",
      );
      return;
    }

    await runOpenRouterWithLimit(context, {
      persona: imageDataUrl ? "vision" : "assistant",
      prompt,
      imageDataUrl,
      headerTitle: imageDataUrl ? "*── [ MINJI AI VISION ] ──*" : "*── [ MINJI AI ] ──*",
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses foto untuk AI Vision."));
  }
}

async function handleSimi(context: CommandContext): Promise<void> {
  const prompt = resolveAiPrompt(context);
  if (!prompt) {
    await context.reply("Ketik pesan untuk ngobrol sama Simi.\nContoh: *.simi halo minji lagi apa?*");
    return;
  }
  await runOpenRouterWithLimit(context, { persona: "simi", prompt });
}

async function handleVisionOnly(
  context: CommandContext,
  persona: "ocr" | "vision",
  defaultPrompt: string,
  headerTitle: string,
  usageMsg: string,
): Promise<void> {
  try {
    const imageDataUrl = await extractOptionalVisionImage(context);
    if (!imageDataUrl) {
      await context.reply(usageMsg);
      return;
    }
    const prompt = context.argsText.trim() || defaultPrompt;
    await runOpenRouterWithLimit(context, {
      persona,
      prompt,
      imageDataUrl,
      headerTitle,
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membaca gambar dengan AI."));
  }
}

async function handleRingkasChat(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .ringkas hanya bisa digunakan di dalam grup aktif.");
    return;
  }

  const reqCount = context.args[0] ? Number.parseInt(context.args[0], 10) : 30;
  const count = Number.isInteger(reqCount) ? Math.max(5, Math.min(40, reqCount)) : 30;
  const { transcript, messageCount } = chatMemoryService.formatTranscript(context.chatJid, count);

  if (messageCount < 3) {
    await context.reply(
      "Belum cukup obrolan teks terbaru yang terekam di grup ini (minimal 3 chat sejak bot aktif).",
    );
    return;
  }

  await runOpenRouterWithLimit(context, {
    persona: "ringkas",
    prompt: `Ringkas ${String(messageCount)} pesan terakhir grup berikut:\n\n${transcript}`,
    maxPromptChars: AI_MAX_CONTEXT_CHARS,
    headerTitle: `*── [ RINGKASAN ${String(messageCount)} CHAT ] ──*`,
  });
}

async function handleTanyaChat(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .tanyachat hanya bisa digunakan di dalam grup aktif.");
    return;
  }

  const question = context.argsText.trim();
  if (!question) {
    await context.reply(
      "Format salah.\nGunakan: *.tanyachat <pertanyaan tentang obrolan tadi>*\nContoh: *.tanyachat tadi bahas makan di mana?*",
    );
    return;
  }

  const { transcript, messageCount } = chatMemoryService.formatTranscript(context.chatJid, 40);
  if (messageCount === 0) {
    await context.reply("Belum ada obrolan teks terbaru yang terekam di grup ini.");
    return;
  }

  await runOpenRouterWithLimit(context, {
    persona: "tanyachat",
    prompt: `Pertanyaan: ${question}\n\nTranskrip obrolan terakhir:\n${transcript}`,
    maxPromptChars: AI_MAX_CONTEXT_CHARS,
    headerTitle: "*── [ TANYA OBROLAN GRUP ] ──*",
  });
}

async function handleRoastOrPuji(
  context: CommandContext,
  mode: "roast" | "puji",
): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply(`Perintah .${mode} hanya bisa digunakan di grup aktif.`);
    return;
  }

  try {
    const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
    const targetJid = rawTarget
      ? await identityResolverService.resolveCanonicalUserJid(
          context.socket,
          context.chatJid,
          rawTarget,
        )
      : await identityResolverService.resolveCanonicalUserJid(
          context.socket,
          context.chatJid,
          context.senderUserJid,
          context.senderAltJids,
        );

    const view =
      (await memberProfileViewService.getTargetProfile(context.chatJid, targetJid)) ??
      (await memberProfileViewService.getOwnProfile(context.chatJid, targetJid));

    const p = view.profile;
    const rpg = parseRpgState(p.rpgState);
    const totalAssets = p.moneyBalance + p.bankBalance;
    const statusAsmara = rpg.spouseJid
      ? "Sudah Menikah"
      : p.partnerJid
        ? "Punya Pacar"
        : "Jomblo";

    const profileSummary = [
      `Target: @${targetJid.split("@")[0] ?? targetJid}`,
      `Rank/Level: ${view.rank} (Lv.${String(p.level)})`,
      `Total Kekayaan: ${formatCompactRupiah(totalAssets)}`,
      `Poin: ${String(p.pointsBalance)}, Limit: ${String(p.limitBalance)}`,
      `Daily Streak: ${String(p.currentStreak)} hari`,
      `Menang/Main Game: ${String(p.totalGamesWon)}/${String(p.totalGamesPlayed)}`,
      `Status Asmara: ${statusAsmara}`,
      `Gelar: ${rpg.customTitle ?? "Belum punya gelar"}`,
      `Total Chat Grup: ${String(p.messageCount)} pesan`,
    ].join(" | ");

    await runOpenRouterWithLimit(context, {
      persona: mode,
      prompt:
        mode === "roast"
          ? `Buatkan roasting kocak yang ramah & aman buat teman grup dengan profil ini: ${profileSummary}`
          : `Buatkan pujian lebay yang lucu & bikin senyum buat teman grup dengan profil ini: ${profileSummary}`,
      headerTitle: mode === "roast" ? "*── [ MINJI ROASTING ] ──*" : "*── [ MINJI PUJIAN ] ──*",
      mentions: [targetJid],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, `Gagal memproses .${mode}.`));
  }
}

function createTextPersonaCommand(
  name: string,
  persona: AiPersona,
  headerTitle: string,
  usage: string,
  aliases?: string[],
  maxPromptChars = AI_MAX_PROMPT_CHARS,
): CommandDefinition {
  return {
    name,
    aliases,
    execute: async (context) => {
      const prompt = resolveAiPrompt(context, maxPromptChars);
      if (!prompt) {
        await context.reply(usage);
        return;
      }
      await runOpenRouterWithLimit(context, {
        persona,
        prompt,
        headerTitle,
        maxPromptChars,
      });
    },
  };
}

export const aiCommands: CommandDefinition[] = [
  {
    name: "ai",
    aliases: ["tanya", "gpt", "minji"],
    execute: handleAssistantOrVision,
  },
  {
    name: "simi",
    aliases: ["simsimi"],
    execute: handleSimi,
  },
  {
    name: "ringkas",
    aliases: ["tldr"],
    execute: handleRingkasChat,
  },
  {
    name: "tanyachat",
    execute: handleTanyaChat,
  },
  {
    name: "ocr",
    aliases: ["baca"],
    execute: (context) =>
      handleVisionOnly(
        context,
        "ocr",
        "Baca dan salin seluruh teks yang ada pada gambar ini secara rapi.",
        "*── [ OCR BACA TEKS FOTO ] ──*",
        "Kirim atau reply foto/screenshot dengan perintah *.ocr* atau *.baca*.",
      ),
  },
  {
    name: "jelaskanfoto",
    execute: (context) =>
      handleVisionOnly(
        context,
        "vision",
        "Jelaskan secara jelas dan ringkas apa isi gambar ini.",
        "*── [ ANALISIS FOTO AI ] ──*",
        "Kirim atau reply foto dengan perintah *.jelaskanfoto [pertanyaan]*.",
      ),
  },
  {
    name: "roast",
    execute: (context) => handleRoastOrPuji(context, "roast"),
  },
  {
    name: "puji",
    execute: (context) => handleRoastOrPuji(context, "puji"),
  },
  createTextPersonaCommand(
    "pantunai",
    "pantunai",
    "*── [ PANTUN AI ] ──*",
    "Format: *.pantunai <topik>*\nContoh: *.pantunai gajian telat*",
  ),
  createTextPersonaCommand(
    "cerpen",
    "cerpen",
    "*── [ CERPEN AI ] ──*",
    "Format: *.cerpen <tema>*\nContoh: *.cerpen kucing jadi presiden*",
  ),
  createTextPersonaCommand(
    "curhat",
    "curhat",
    "*── [ RUANG CURHAT ] ──*",
    "Format: *.curhat <ceritamu>*\nContoh: *.curhat capek banget kerja hari ini*",
  ),
  createTextPersonaCommand(
    "debat",
    "debat",
    "*── [ LAWAN DEBAT AI ] ──*",
    "Format: *.debat <topik/pernyataan>*\nContoh: *.debat bubur diaduk lebih enak*",
  ),
  createTextPersonaCommand(
    "koding",
    "koding",
    "*── [ ASISTEN KODING ] ──*",
    "Format: *.koding <pertanyaan>*\nContoh: *.koding bedanya let dan const di JS*",
  ),
  createTextPersonaCommand(
    "perbaiki",
    "perbaiki",
    "*── [ PERBAIKAN TEKS ] ──*",
    "Format: *.perbaiki <teks>* (atau reply pesan yang ingin dirapikan).",
    undefined,
    1_400,
  ),
  createTextPersonaCommand(
    "summarize",
    "summarize",
    "*── [ RINGKASAN TEKS ] ──*",
    "Format: *.summarize <teks panjang>* (atau reply pesan panjang).",
    undefined,
    AI_MAX_CONTEXT_CHARS,
  ),
  createTextPersonaCommand(
    "ide",
    "ide",
    "*── [ BRAINSTORM IDE ] ──*",
    "Format: *.ide <topik>*\nContoh: *.ide bisnis modal kecil untuk mahasiswa*",
  ),
];
