import {
  TenantAuditAction,
  TenantStatus,
  type TenantFeatureSetting,
  type TenantGroup,
} from "@prisma/client";
import {
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import type { CommandContext } from "../../types/command";
import { normalizeJid, getMessageSenderJid } from "../../utils/jid";
import { tenantFeatureService } from "../tenant/tenantFeature.service";

export interface AntiViewOnceConfigResult {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
}

export class AntiViewOnceService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepository = new TenantFeatureRepository(),
  ) {}

  async setAntiViewOnceEnabled(
    context: CommandContext,
    enabled: boolean,
  ): Promise<AntiViewOnceConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        antiViewOnceEnabled: enabled,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.MODERATION_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          antiViewOnceEnabled: enabled,
        },
      });

      return {
        tenantGroup,
        featureSetting,
      };
    });
  }

  async handleViewOnce(socket: WASocket, msg: WAMessage): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith("@g.us") || !msg.message) {
      return;
    }

    const rawContent =
      msg.message.ephemeralMessage?.message ??
      msg.message.documentWithCaptionMessage?.message ??
      msg.message;

    const innerMessage =
      rawContent?.viewOnceMessage?.message ??
      rawContent?.viewOnceMessageV2?.message ??
      rawContent?.viewOnceMessageV2Extension?.message ??
      msg.message.viewOnceMessage?.message ??
      msg.message.viewOnceMessageV2?.message ??
      msg.message.viewOnceMessageV2Extension?.message;

    if (!innerMessage) {
      return;
    }

    const isImage = Boolean(innerMessage.imageMessage);
    const isVideo = Boolean(innerMessage.videoMessage);
    if (!isImage && !isVideo) {
      return;
    }

    const groupJid = normalizeJid(remoteJid);
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.antiViewOnceEnabled) {
      return;
    }

    const participantJid = msg.key.participant ?? (msg.key.fromMe ? socket.user?.id : undefined);
    const senderJid = getMessageSenderJid(remoteJid, participantJid);
    const senderPhone = senderJid.split("@")[0] ?? senderJid;

    try {
      const mediaBuffer = await downloadMediaMessage(msg, "buffer", {});
      const buffer = Buffer.isBuffer(mediaBuffer) ? mediaBuffer : Buffer.from(mediaBuffer);

      const originalCaption =
        innerMessage.imageMessage?.caption ?? innerMessage.videoMessage?.caption ?? "";
      const captionText = originalCaption.trim() ? `\n\nPesan: ${originalCaption.trim()}` : "";
      const text = `📸 *[ ANTI VIEW-ONCE ]*\nMedia 1x lihat dari @${senderPhone} berhasil diamankan.${captionText}`;

      if (isImage) {
        await socket.sendMessage(groupJid, {
          image: buffer,
          caption: text,
          mentions: [senderJid],
        });
      } else if (isVideo) {
        await socket.sendMessage(groupJid, {
          video: buffer,
          caption: text,
          mimetype: innerMessage.videoMessage?.mimetype ?? "video/mp4",
          mentions: [senderJid],
        });
      }
    } catch (error: unknown) {
      logger.warn({ error, groupJid, senderJid }, "Gagal mendownload media anti view-once");
    }
  }

  parseAntiViewOnceToggle(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (normalized === "on") return true;
    if (normalized === "off") return false;
    throw new Error("Status antiviewonce harus on atau off.");
  }

  private async resolveManagedTenant(context: CommandContext): Promise<TenantGroup> {
    if (
      context.role !== "SUPER_OWNER" &&
      context.role !== "TENANT_OWNER" &&
      context.role !== "TENANT_ADMIN"
    ) {
      throw new Error("Command ini hanya dapat digunakan oleh pengelola tenant.");
    }

    return tenantFeatureService.resolveManagedTenant({
      actorJid: context.senderUserJid,
      actorRole: context.role,
      tenantGroup: context.tenantGroup,
      isGroup: context.isGroup,
    });
  }

  private isTenantActive(tenantGroup: TenantGroup | null): tenantGroup is TenantGroup {
    return Boolean(
      tenantGroup?.expiresAt &&
      tenantGroup.status === TenantStatus.ACTIVE &&
      !tenantGroup.isBlocked &&
      tenantGroup.expiresAt.getTime() > Date.now(),
    );
  }
}

export const antiViewOnceService = new AntiViewOnceService();
