import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import {
  photoMemeService,
  type ImageFilterKind,
  type MemeTemplateKind,
} from "../../services/media/photoMeme.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { isMediaCommandAllowed } from "../../utils/dmAccess";
import { resolveMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const MAX_INPUT_BYTES = 15 * 1024 * 1024;

async function ensureAllowed(context: CommandContext): Promise<boolean> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply(
      "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
    );
    return false;
  }
  return true;
}

async function resolvePhotoOrAvatar(
  context: CommandContext,
): Promise<{ buffer: Buffer; label: string; mentions: string[] }> {
  const mediaTarget = resolveMediaTarget(context, ["image", "sticker"]);
  if (mediaTarget) {
    if (mediaTarget.fileLength && mediaTarget.fileLength > MAX_INPUT_BYTES) {
      throw new Error("Ukuran gambar terlalu besar (maksimal 15 MB).");
    }
    const buffer = await downloadMediaMessage(
      mediaTarget.message,
      "buffer",
      {},
      {
        logger: logger.child({ module: "photo-meme-download" }),
        reuploadRequest: context.socket.updateMediaMessage,
      },
    );
    if (buffer.byteLength > MAX_INPUT_BYTES) {
      throw new Error("Ukuran gambar terlalu besar (maksimal 15 MB).");
    }
    return { buffer, label: context.argsText.trim() || "MEMBER GRUP", mentions: [] };
  }

  const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
  const targetJid = rawTarget
    ? await identityResolverService.resolveCanonicalUserJid(context.socket, context.chatJid, rawTarget)
    : await identityResolverService.resolveCanonicalUserJid(
        context.socket,
        context.chatJid,
        context.senderUserJid,
        context.senderAltJids,
      );

  const avatar = await avatarService.getAvatarWithFallback(context.socket, targetJid);
  const phone = targetJid.split("@")[0] ?? targetJid;
  return { buffer: avatar, label: `@${phone}`, mentions: [targetJid] };
}

function makeMemeHandler(template: MemeTemplateKind) {
  return async (context: CommandContext): Promise<void> => {
    if (!(await ensureAllowed(context))) return;
    try {
      const { buffer, label, mentions } = await resolvePhotoOrAvatar(context);
      const out = await photoMemeService.renderMemeOverlay(buffer, template, label);
      await context.socket.sendMessage(
        context.chatJid,
        {
          image: out,
          mimetype: "image/png",
          mentions: mentions.length > 0 ? mentions : undefined,
        },
        { quoted: context.message },
      );
    } catch (error: unknown) {
      await context.reply(formatUserSafeError(error, `Gagal membuat efek .${template}.`));
    }
  };
}

function makeFilterHandler(filter: ImageFilterKind) {
  return async (context: CommandContext): Promise<void> => {
    if (!(await ensureAllowed(context))) return;
    try {
      const { buffer } = await resolvePhotoOrAvatar(context);
      const out = await photoMemeService.applyFilter(buffer, filter);
      await context.socket.sendMessage(
        context.chatJid,
        { image: out, mimetype: "image/png" },
        { quoted: context.message },
      );
    } catch (error: unknown) {
      await context.reply(formatUserSafeError(error, `Gagal memproses filter .${filter}.`));
    }
  };
}

async function handleRotate(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const angle = context.args[0] ? Number.parseInt(context.args[0], 10) : 90;
    const { buffer } = await resolvePhotoOrAvatar(context);
    const out = await photoMemeService.rotateImage(buffer, angle);
    await context.socket.sendMessage(
      context.chatJid,
      { image: out, mimetype: "image/png" },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memutar gambar."));
  }
}

async function handleCircleSticker(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const { buffer } = await resolvePhotoOrAvatar(context);
    const stickerBuf = await photoMemeService.createCircleSticker(buffer);
    await context.socket.sendMessage(
      context.chatJid,
      { sticker: stickerBuf, isAnimated: false },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat stiker lingkaran."));
  }
}

async function handlePolaroid(context: CommandContext): Promise<void> {
  if (!(await ensureAllowed(context))) return;
  try {
    const { buffer } = await resolvePhotoOrAvatar(context);
    const caption = context.argsText.replace(/@\d+/g, "").trim();
    const out = await photoMemeService.renderPolaroid(buffer, caption);
    await context.socket.sendMessage(
      context.chatJid,
      { image: out, mimetype: "image/png" },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat frame polaroid."));
  }
}

export const photoMemeCommands: CommandDefinition[] = [
  { name: "wanted", execute: makeMemeHandler("wanted") },
  { name: "jail", execute: makeMemeHandler("jail") },
  { name: "rip", execute: makeMemeHandler("rip") },
  { name: "triggered", execute: makeMemeHandler("triggered") },
  { name: "trash", execute: makeMemeHandler("trash") },
  { name: "clown", execute: makeMemeHandler("clown") },
  { name: "blur", execute: makeFilterHandler("blur") },
  { name: "grayscale", aliases: ["bw"], execute: makeFilterHandler("grayscale") },
  { name: "invert", execute: makeFilterHandler("invert") },
  { name: "sepia", execute: makeFilterHandler("sepia") },
  { name: "pixelate", execute: makeFilterHandler("pixelate") },
  { name: "mirror", aliases: ["flip"], execute: makeFilterHandler("mirror") },
  { name: "rotate", execute: handleRotate },
  { name: "circle", execute: handleCircleSticker },
  { name: "polaroid", execute: handlePolaroid },
];
