import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import {
  generateStyledFonts,
  lightMakerService,
  parseEmojiMixPair,
} from "../../services/media/lightMaker.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { isMediaCommandAllowed } from "../../utils/dmAccess";
import { resolveMediaTarget, type MediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const BYTES_PER_MB = 1024 * 1024;
const MAX_MAKER_INPUT_MB = 25;

async function ensureAllowed(context: CommandContext): Promise<boolean> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply(
      "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
    );
    return false;
  }
  return true;
}

async function downloadMediaBuffer(
  context: CommandContext,
  target: MediaTarget,
  moduleName: string,
): Promise<Buffer> {
  if (target.fileLength && target.fileLength > MAX_MAKER_INPUT_MB * BYTES_PER_MB) {
    throw new Error(`Ukuran media terlalu besar (maksimal ${String(MAX_MAKER_INPUT_MB)} MB).`);
  }
  const buffer = await downloadMediaMessage(
    target.message,
    "buffer",
    {},
    {
      logger: logger.child({ module: moduleName }),
      reuploadRequest: context.socket.updateMediaMessage,
    },
  );
  if (buffer.byteLength > MAX_MAKER_INPUT_MB * BYTES_PER_MB) {
    throw new Error(`Ukuran media terlalu besar (maksimal ${String(MAX_MAKER_INPUT_MB)} MB).`);
  }
  return buffer;
}

async function handleEmojiMix(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const pair = parseEmojiMixPair(context.argsText);
    if (!pair) {
      await context.reply("Format salah.\nGunakan: *.emojimix 😂+🔥* atau *.emojimix 😍 👻*");
      return;
    }

    const webpBuffer = await lightMakerService.createEmojiMixSticker(pair[0], pair[1]);
    await context.socket.sendMessage(
      context.chatJid,
      { sticker: webpBuffer, isAnimated: false },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menggabungkan emoji."));
  }
}

async function handleTahta(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const text = context.argsText.trim();
    if (!text) {
      await context.reply("Format salah.\nGunakan: *.tahta <teks>*\nContoh: *.tahta MINJI*");
      return;
    }

    const pngBuffer = await lightMakerService.renderTahtaImage(text);
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: pngBuffer,
        mimetype: "image/png",
        caption: `Harta Tahta *${text.toUpperCase().slice(0, 20)}*`,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat gambar Harta Tahta."));
  }
}

async function handleCarbon(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const argCode = context.argsText.trim();
    const rawCode = argCode.length > 0 ? argCode : (context.quoted?.text?.trim() ?? "");
    if (!rawCode) {
      await context.reply(
        "Format salah.\nGunakan: *.carbon <kode>* atau reply pesan berisi kode dengan *.carbon*.",
      );
      return;
    }

    const pngBuffer = await lightMakerService.renderCarbonImage(rawCode);
    await context.socket.sendMessage(
      context.chatJid,
      { image: pngBuffer, mimetype: "image/png" },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal merender gambar Carbon."));
  }
}

async function handleWatermark(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const target = resolveMediaTarget(context, ["sticker"]);
    if (!target) {
      await context.reply(
        "Reply stiker yang ingin diubah watermark-nya.\nContoh: *.wm Pack Keren | Minji*",
      );
      return;
    }

    const raw = context.argsText.trim();
    const sep = raw.indexOf("|");
    const pack = sep >= 0 ? raw.slice(0, sep).trim() : raw;
    const author = sep >= 0 ? raw.slice(sep + 1).trim() : "";

    const inputBuffer = await downloadMediaBuffer(context, target, "wm-download");
    const outWebp = await lightMakerService.rewatermarkSticker(inputBuffer, pack, author);
    await context.socket.sendMessage(
      context.chatJid,
      { sticker: outWebp, isAnimated: Boolean(target.isAnimated) },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengganti watermark stiker."));
  }
}

async function handleStyle(context: CommandContext): Promise<void> {
  try {
    const argText = context.argsText.trim();
    const text = argText.length > 0 ? argText : (context.quoted?.text?.trim() ?? "");
    const variants = generateStyledFonts(text);
    const lines = [
      "*── [ GAYA FONT UNICODE ] ──*",
      ...variants.map((v, idx) => `${String(idx + 1)}. *${v.label}:*\n${v.text}`),
    ];
    await context.reply(lines.join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses gaya teks."));
  }
}

async function handleCekReso(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const target = resolveMediaTarget(context, ["image", "sticker", "video"]);
    if (!target) {
      await context.reply("Kirim atau reply foto, stiker, atau video dengan perintah *.cekreso*.");
      return;
    }
    if (target.type !== "image" && target.type !== "sticker" && target.type !== "video") {
      await context.reply("Tipe media tidak didukung untuk .cekreso.");
      return;
    }

    const buffer = await downloadMediaBuffer(context, target, "cekreso-download");
    const info = await lightMakerService.inspectMediaResolution(buffer, target.type);
    const sizeLabel =
      info.sizeBytes >= BYTES_PER_MB
        ? `${(info.sizeBytes / BYTES_PER_MB).toFixed(2)} MB`
        : `${(info.sizeBytes / 1024).toFixed(1)} KB`;
    const dimLabel =
      info.width && info.height ? `${String(info.width)} x ${String(info.height)} px` : "Tidak terbaca";

    const lines = [
      "*── [ INFO RESOLUSI MEDIA ] ──*",
      `Tipe     : ${info.mediaType.toUpperCase()}`,
      `Format   : ${info.format}`,
      `Dimensi  : ${dimLabel}`,
      `Ukuran   : ${sizeLabel}`,
    ];
    if (info.durationSec !== null) {
      lines.push(`Durasi   : ${info.durationSec.toFixed(1)} detik`);
    }
    if (info.mediaType === "sticker") {
      lines.push(`Animasi  : ${info.isAnimated ? "Ya" : "Tidak"}`);
    }

    await context.reply(lines.join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memeriksa resolusi media."));
  }
}

async function handleResize(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const target = resolveMediaTarget(context, ["image"]);
    if (!target) {
      await context.reply(
        "Kirim atau reply gambar dengan perintah *.resize <lebar> <tinggi>*.\nContoh: *.resize 512 512*",
      );
      return;
    }

    const width = Number.parseInt(context.args[0] ?? "", 10);
    const height = Number.parseInt(context.args[1] ?? "", 10);
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      await context.reply("Format salah. Contoh: *.resize 800 600* (rentang 16 - 2048 px).");
      return;
    }

    const buffer = await downloadMediaBuffer(context, target, "resize-download");
    const resized = await lightMakerService.resizeImageBuffer(buffer, width, height);
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: resized,
        mimetype: "image/png",
        caption: `Berhasil diubah ke *${String(width)} x ${String(height)} px*.`,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengubah ukuran gambar."));
  }
}

async function handleGetFoto(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const target = resolveMediaTarget(context, ["video"]);
    if (!target) {
      await context.reply(
        "Kirim atau reply video dengan perintah *.getfoto [detik]*.\nContoh: *.getfoto 3*",
      );
      return;
    }

    const rawSec = context.args[0]?.trim();
    const seekSeconds = rawSec ? Number.parseFloat(rawSec) : 0;
    if (Number.isNaN(seekSeconds)) {
      await context.reply("Masukkan angka detik yang valid. Contoh: *.getfoto 5*");
      return;
    }

    const videoBuffer = await downloadMediaBuffer(context, target, "getfoto-download");
    const frameJpg = await lightMakerService.extractVideoFrame(videoBuffer, seekSeconds);

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: frameJpg,
        mimetype: "image/jpeg",
        caption: `Cuplikan frame video pada detik ke-${String(seekSeconds)}.`,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil foto dari video."));
  }
}

export const lightMakerCommands: CommandDefinition[] = [
  { name: "emojimix", aliases: ["emix"], execute: handleEmojiMix },
  { name: "tahta", execute: handleTahta },
  { name: "carbon", execute: handleCarbon },
  { name: "wm", aliases: ["take", "steal", "swm"], execute: handleWatermark },
  { name: "style", aliases: ["font", "fancy"], execute: handleStyle },
  { name: "cekreso", aliases: ["reso"], execute: handleCekReso },
  { name: "resize", execute: handleResize },
  { name: "getfoto", aliases: ["toframe", "ssvid"], execute: handleGetFoto },
];
