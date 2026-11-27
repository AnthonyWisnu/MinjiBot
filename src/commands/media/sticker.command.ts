import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { soundStickerSenderService } from "../../services/media/soundStickerSender.service";
import { stickerService } from "../../services/media/sticker.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { isMediaCommandAllowed } from "../../utils/dmAccess";
import { resolveMediaTarget, type MediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const BYTES_PER_MB = 1024 * 1024;
const MAX_STICKER_INPUT_MB = 15;

export const stickerCommands: CommandDefinition[] = [
  {
    name: "s",
    aliases: ["sticker"],
    execute: handleSticker,
  },
  {
    name: "sa",
    aliases: ["stickeraudio", "stickersound"],
    execute: handleSoundSticker,
  },
  {
    name: "gambar",
    aliases: ["toimg"],
    execute: handleStickerToImage,
  },
  {
    name: "tovideo",
    aliases: ["tovid", "togif"],
    execute: handleStickerToVideo,
  },
  {
    name: "smeme",
    execute: handleStickerMeme,
  },
  {
    name: "brat",
    execute: handleBratSticker,
  },
];

export async function handleSticker(context: CommandContext): Promise<void> {
  try {
    const target = await acquireAllowedStickerTarget(
      context,
      "Kirim/reply gambar, GIF/video pendek, atau stiker dengan command .s. Untuk stiker bersuara, gunakan .sa.",
    );
    if (!target) {
      return;
    }

    const inputBuffer = await fetchValidatedMediaBuffer(context, target, "sticker-download");
    const stickerBuffer = await stickerService.createSticker(
      inputBuffer,
      toStickerSourceType(target),
    );

    await context.socket.sendMessage(
      context.chatJid,
      {
        sticker: stickerBuffer,
        isAnimated: target.type === "video" || Boolean(target.isAnimated),
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    logger.error(
      { err: error, commandName: "s", chatJid: context.chatJid, senderJid: context.senderJid },
      "Gagal memproses command sticker (.s)",
    );
    await context.reply(formatStickerError(error));
  }
}

export async function handleSoundSticker(context: CommandContext): Promise<void> {
  try {
    const target = await acquireAllowedStickerTarget(
      context,
      "Kirim/reply video pendek bersuara dengan command .sa.",
    );
    if (!target) {
      return;
    }

    if (target.type !== "video") {
      await context.reply(
        "Command .sa khusus untuk video bersuara. Untuk gambar atau GIF tanpa suara, gunakan .s.",
      );
      return;
    }

    const inputBuffer = await fetchValidatedMediaBuffer(
      context,
      target,
      "sound-sticker-download",
    );
    const videoSticker = await stickerService.createVideoStickerWithSound(inputBuffer);
    if (!videoSticker.hasAudio) {
      await context.reply(
        "Video/GIF ini tidak memiliki trek audio. Gunakan .s untuk stiker bergerak tanpa suara.",
      );
      return;
    }

    await soundStickerSenderService.sendSoundSticker({
      socket: context.socket,
      chatJid: context.chatJid,
      webpBuffer: videoSticker.webpBuffer,
      audioBuffer: videoSticker.audioBuffer,
      fallbackDurationSeconds: videoSticker.durationSeconds,
      quoted: context.message,
    });
  } catch (error: unknown) {
    logger.error(
      { err: error, commandName: "sa", chatJid: context.chatJid, senderJid: context.senderJid },
      "Gagal memproses command sound sticker (.sa)",
    );
    await context.reply(formatStickerError(error));
  }
}

async function acquireAllowedStickerTarget(
  context: CommandContext,
  emptyTargetMessage: string,
): Promise<MediaTarget | null> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply(
      "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
    );
    return null;
  }

  const target = resolveMediaTarget(context, ["image", "video", "sticker"]);
  if (!target) {
    await context.reply(emptyTargetMessage);
    return null;
  }

  return target;
}

async function fetchValidatedMediaBuffer(
  context: CommandContext,
  target: MediaTarget,
  moduleName: string,
): Promise<Buffer> {
  assertMediaAllowed(target);
  const inputBuffer = await downloadTargetMedia(context, target, moduleName);
  assertBufferSizeAllowed(inputBuffer.byteLength, MAX_STICKER_INPUT_MB);
  return inputBuffer;
}

async function handleStickerToImage(context: CommandContext): Promise<void> {
  try {
    if (!(await isMediaCommandAllowed(context))) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
      );
      return;
    }

    const target = resolveMediaTarget(context, ["sticker"]);
    if (!target) {
      await context.reply("Reply sticker dengan command .gambar atau .toimg.");
      return;
    }

    assertBufferSizeAllowed(target.fileLength, MAX_STICKER_INPUT_MB);
    const inputBuffer = await downloadTargetMedia(context, target, "sticker-toimg-download");
    assertBufferSizeAllowed(inputBuffer.byteLength, MAX_STICKER_INPUT_MB);
    const output = await stickerService.stickerToMedia(inputBuffer, Boolean(target.isAnimated));

    if (output.type === "video") {
      await context.socket.sendMessage(
        context.chatJid,
        {
          video: output.buffer,
          mimetype: output.mimetype,
          fileName: output.fileName,
        },
        { quoted: context.message },
      );
      return;
    }

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: output.buffer,
        mimetype: output.mimetype,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatStickerError(error));
  }
}

async function handleStickerToVideo(context: CommandContext): Promise<void> {
  try {
    if (!(await isMediaCommandAllowed(context))) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
      );
      return;
    }

    const target = resolveMediaTarget(context, ["sticker"]);
    if (!target) {
      await context.reply("Reply sticker bergerak/animasi dengan command .tovideo.");
      return;
    }

    assertBufferSizeAllowed(target.fileLength, MAX_STICKER_INPUT_MB);
    const inputBuffer = await downloadTargetMedia(context, target, "sticker-tovideo-download");
    assertBufferSizeAllowed(inputBuffer.byteLength, MAX_STICKER_INPUT_MB);

    const output = await stickerService.stickerToMedia(inputBuffer, true);
    if (output.type === "video") {
      await context.socket.sendMessage(
        context.chatJid,
        {
          video: output.buffer,
          mimetype: output.mimetype,
          fileName: output.fileName,
        },
        { quoted: context.message },
      );
      return;
    }

    await context.reply(
      "Stiker ini bukan stiker bergerak/animasi. Gunakan .toimg untuk stiker biasa.",
    );
  } catch (error: unknown) {
    await context.reply(formatStickerError(error));
  }
}

async function handleBratSticker(context: CommandContext): Promise<void> {
  try {
    if (!(await isMediaCommandAllowed(context))) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
      );
      return;
    }

    const text = context.argsText.trim();
    if (!text) {
      await context.reply("Format command salah.\nGunakan: .brat <teks>\nContoh: .brat kamu nanya");
      return;
    }

    const stickerBuffer = await stickerService.createBratSticker(text);

    await context.socket.sendMessage(
      context.chatJid,
      {
        sticker: stickerBuffer,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    logger.error(
      { err: error, commandName: "brat", chatJid: context.chatJid, senderJid: context.senderJid },
      "Gagal memproses command brat",
    );
    await context.reply(formatStickerError(error));
  }
}

async function handleStickerMeme(context: CommandContext): Promise<void> {
  try {
    if (!(await isMediaCommandAllowed(context))) {
      await context.reply(
        "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
      );
      return;
    }

    const memeText = context.argsText.trim();
    if (!memeText) {
      await context.reply("Format command salah.\nGunakan: .smeme <teks> atau .smeme atas | bawah");
      return;
    }

    const target = resolveMediaTarget(context, ["image", "sticker"]);
    if (!target) {
      await context.reply("Reply gambar atau sticker dengan command .smeme <teks>.");
      return;
    }

    assertBufferSizeAllowed(target.fileLength, MAX_STICKER_INPUT_MB);
    const inputBuffer = await downloadTargetMedia(context, target, "smeme-download");
    assertBufferSizeAllowed(inputBuffer.byteLength, MAX_STICKER_INPUT_MB);
    const { topText, bottomText } = parseMemeText(memeText);
    const stickerBuffer = await stickerService.createMemeSticker(inputBuffer, topText, bottomText);

    await context.socket.sendMessage(
      context.chatJid,
      {
        sticker: stickerBuffer,
        isAnimated: false,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    logger.error(
      { err: error, commandName: "smeme", chatJid: context.chatJid, senderJid: context.senderJid },
      "Gagal memproses command smeme",
    );
    await context.reply(formatStickerError(error));
  }
}

function assertMediaAllowed(target: MediaTarget): void {
  assertBufferSizeAllowed(target.fileLength, MAX_STICKER_INPUT_MB);
}

function toStickerSourceType(target: MediaTarget): "image" | "video" | "sticker" {
  if (target.type === "image" || target.type === "video" || target.type === "sticker") {
    return target.type;
  }

  throw new Error("Media tidak dapat dijadikan sticker.");
}

function assertBufferSizeAllowed(fileLength: number | undefined, maxMb: number): void {
  if (!fileLength) {
    return;
  }

  const maxBytes = maxMb * BYTES_PER_MB;
  if (fileLength > maxBytes) {
    throw new Error(`Ukuran media maksimal ${String(maxMb)} MB.`);
  }
}

async function downloadTargetMedia(
  context: CommandContext,
  target: MediaTarget,
  moduleName: string,
): Promise<Buffer> {
  return downloadMediaMessage(
    target.message,
    "buffer",
    {},
    {
      logger: logger.child({ module: moduleName }),
      reuploadRequest: context.socket.updateMediaMessage,
    },
  );
}

function parseMemeText(text: string): { topText: string; bottomText: string } {
  const separatorIndex = text.indexOf("|");
  if (separatorIndex < 0) {
    return {
      topText: "",
      bottomText: text,
    };
  }

  return {
    topText: text.slice(0, separatorIndex),
    bottomText: text.slice(separatorIndex + 1),
  };
}

function formatStickerError(error: unknown): string {
  return formatUserSafeError(error, "Konversi media gagal diproses.");
}
