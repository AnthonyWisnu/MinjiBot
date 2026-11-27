import { downloadMediaMessage, type AnyMessageContent } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { groupStatusService } from "../../services/media/groupStatus.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { extractContactCandidateJids } from "../../utils/jid";
import { resolveMediaTarget } from "../../utils/mediaTarget";
import { formatUserSafeError } from "../../utils/userSafeError";

const MAX_STATUS_MEDIA_BYTES = 15 * 1024 * 1024;

async function buildStatusPayload(context: CommandContext): Promise<AnyMessageContent | null> {
  const captionText = context.argsText.trim();
  const target = resolveMediaTarget(context, ["image", "video", "audio"]);

  if (target) {
    if (target.fileLength && target.fileLength > MAX_STATUS_MEDIA_BYTES) {
      throw new Error("Ukuran media status maksimal 15 MB.");
    }

    const mediaBuffer = await downloadMediaMessage(
      target.message,
      "buffer",
      {},
      {
        logger: logger.child({ module: "group-status-download" }),
        reuploadRequest: context.socket.updateMediaMessage,
      },
    );
    const buffer = Buffer.isBuffer(mediaBuffer) ? mediaBuffer : Buffer.from(mediaBuffer);
    if (buffer.byteLength > MAX_STATUS_MEDIA_BYTES) {
      throw new Error("Ukuran media status maksimal 15 MB.");
    }

    if (target.type === "image") {
      return {
        image: buffer,
        caption: captionText || undefined,
      };
    }

    if (target.type === "video") {
      return {
        video: buffer,
        caption: captionText || undefined,
      };
    }

    return {
      audio: buffer,
      mimetype: target.mimetype ?? "audio/ogg; codecs=opus",
      ptt: true,
    };
  }

  if (captionText.length > 0) {
    return {
      text: captionText,
    };
  }

  return null;
}

async function canPostGroupStatus(context: CommandContext): Promise<boolean> {
  if (
    context.role === "SUPER_OWNER" ||
    context.role === "TENANT_OWNER" ||
    context.role === "TENANT_ADMIN"
  ) {
    return true;
  }

  return identityResolverService.isGroupAdmin(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

async function handleGroupStatus(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .sw hanya dapat digunakan di dalam grup aktif.");
    return;
  }

  try {
    const allowed = await canPostGroupStatus(context);
    if (!allowed) {
      await context.reply(
        "Perintah .sw (Status Grup) hanya dapat digunakan oleh Admin Grup, Tenant Admin, atau Owner.",
      );
      return;
    }

    const payload = await buildStatusPayload(context);
    if (!payload) {
      await context.reply(
        "Kirim/reply foto, video, audio, atau ketik teks setelah .sw.\nContoh: .sw Halo warga grup!",
      );
      return;
    }

    await groupStatusService.postGroupStatus({
      socket: context.socket,
      groupJid: context.chatJid,
      senderUserJid: context.senderUserJid,
      content: payload,
      bypassCooldown: context.role === "SUPER_OWNER",
    });

    await context.reply("Status Grup WhatsApp berhasil diposting!");
  } catch (error: unknown) {
    logger.error(
      { err: error, commandName: context.commandName, chatJid: context.chatJid },
      "Gagal mengirim Status Grup (.sw)",
    );
    await context.reply(formatUserSafeError(error, "Gagal memposting Status Grup WhatsApp."));
  }
}

async function handleBotStatus(context: CommandContext): Promise<void> {
  if (context.role !== "SUPER_OWNER") {
    await context.reply("Perintah .upsw hanya dapat digunakan oleh Super Owner.");
    return;
  }

  try {
    const payload = await buildStatusPayload(context);
    if (!payload) {
      await context.reply(
        "Kirim/reply foto, video, audio, atau ketik teks setelah .upsw.\nContoh: .upsw MinjiBot online!",
      );
      return;
    }

    let statusJidList: string[] = [];
    if (context.isGroup) {
      const metadata = await identityResolverService.getGroupMetadata(
        context.socket,
        context.chatJid,
      );
      if (metadata?.participants) {
        statusJidList = [
          ...new Set(
            metadata.participants.flatMap((p) => extractContactCandidateJids(p)),
          ),
        ];
      }
    }
    if (statusJidList.length === 0) {
      statusJidList = [context.senderUserJid];
    }

    await groupStatusService.postBotStatus({
      socket: context.socket,
      statusJidList,
      content: payload,
    });

    await context.reply(
      `Status akun bot berhasil diposting ke ${String(statusJidList.length)} penerima!`,
    );
  } catch (error: unknown) {
    logger.error({ err: error, commandName: "upsw" }, "Gagal mengirim Status Bot (.upsw)");
    await context.reply(formatUserSafeError(error, "Gagal memposting Status Bot."));
  }
}

export const groupStatusCommands: CommandDefinition[] = [
  {
    name: "sw",
    aliases: ["swgc", "tagsw"],
    execute: handleGroupStatus,
  },
  {
    name: "upsw",
    execute: handleBotStatus,
  },
];
