import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import {
  audioEffectService,
  type AudioEffectType,
} from "../../services/media/audioEffect.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { resolveMediaTarget, type MediaTarget } from "../../utils/mediaTarget";

const BYTES_PER_MB = 1024 * 1024;
const MAX_AUDIO_INPUT_MB = 30;

export const audioEffectCommands: CommandDefinition[] = [
  {
    name: "bass",
    execute: (context) => handleAudioEffect(context, "bass"),
  },
  {
    name: "chipmunk",
    execute: (context) => handleAudioEffect(context, "chipmunk"),
  },
  {
    name: "slowed",
    execute: (context) => handleAudioEffect(context, "slowed"),
  },
  {
    name: "nightcore",
    execute: (context) => handleAudioEffect(context, "nightcore"),
  },
  {
    name: "tovn",
    aliases: ["vn"],
    execute: (context) => handleAudioEffect(context, "tovn"),
  },
];

async function handleAudioEffect(
  context: CommandContext,
  effect: AudioEffectType,
): Promise<void> {
  try {
    if (!isMediaCommandAllowed(context)) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat Tenant Owner.",
      );
      return;
    }

    const target = resolveMediaTarget(context, ["audio", "video"]);
    if (!target) {
      await context.reply(
        `Reply audio, voice note, atau video pendek dengan command .${context.commandName}.`,
      );
      return;
    }

    if (target.fileLength && target.fileLength > MAX_AUDIO_INPUT_MB * BYTES_PER_MB) {
      await context.reply(`Ukuran media maksimal ${String(MAX_AUDIO_INPUT_MB)} MB.`);
      return;
    }

    await context.reply("Sedang memproses audio, mohon tunggu...");
    const inputBuffer = await downloadTargetMedia(context, target);

    if (inputBuffer.byteLength > MAX_AUDIO_INPUT_MB * BYTES_PER_MB) {
      await context.reply(`Ukuran media maksimal ${String(MAX_AUDIO_INPUT_MB)} MB.`);
      return;
    }

    const result = await audioEffectService.applyEffect(inputBuffer, effect);

    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: result.buffer,
        mimetype: result.mimetype,
        fileName: result.fileName,
        ptt: Boolean(result.ptt),
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    logger.error({ error, effect, chatJid: context.chatJid }, "Gagal memproses audio effect");
    const message =
      error instanceof Error ? error.message : "Gagal memproses audio. Pastikan file valid.";
    await context.reply(message);
  }
}

async function downloadTargetMedia(
  context: CommandContext,
  target: MediaTarget,
): Promise<Buffer> {
  const buffer = await downloadMediaMessage(
    target.message,
    "buffer",
    {},
    {
      logger: logger.child({ module: "audio-fx-download" }),
      reuploadRequest: context.socket.updateMediaMessage,
    },
  );

  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

function isMediaCommandAllowed(context: CommandContext): boolean {
  return context.isGroup || context.role === "TENANT_OWNER" || context.role === "SUPER_OWNER";
}
