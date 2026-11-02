import {
  TenantAuditAction,
  TenantStatus,
  type TenantFeatureSetting,
  type TenantGroup,
} from "@prisma/client";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import {
  moderationGuard,
  type ModerationContextState,
  type ModerationGuard,
} from "../../guards/moderationGuard";
import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import { getIdentityCandidateJids, getMessageSenderJid } from "../../utils/jid";
import { extractTextFromMessageContent } from "../../utils/messageText";
import { tenantFeatureService } from "../tenant/tenantFeature.service";
import { antiDeleteService } from "./antiDelete.service";

const WHATSAPP_INVITE_PATTERN =
  /(?:https?:\/\/)?(?:chat\.whatsapp\.com|whatsapp\.com\/channel)\/[A-Za-z0-9_-]+/i;

export interface AntiLinkConfigResult {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
}

export class AntiLinkService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepository = new TenantFeatureRepository(),
    private readonly tenantGroupSettingRepository = new TenantGroupSettingRepository(),
    private readonly guard: ModerationGuard = moderationGuard,
  ) {}

  async setAntiLinkEnabled(
    context: CommandContext,
    enabled: boolean,
  ): Promise<AntiLinkConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    const result = await prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        antiLinkEnabled: enabled,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.MODERATION_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          antiLinkEnabled: enabled,
        },
      });

      return {
        tenantGroup,
        featureSetting,
      };
    });

    tenantFeatureService.invalidateCache(tenantGroup.groupJid);
    return result;
  }

  async handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<boolean> {
    const groupJid = message.key.remoteJid;
    if (!groupJid || message.key.fromMe || !groupJid.endsWith("@g.us")) {
      return false;
    }

    const text = extractTextFromMessageContent(message.message);
    if (!WHATSAPP_INVITE_PATTERN.test(text)) {
      return false;
    }

    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return false;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.antiLinkEnabled) {
      return false;
    }

    const senderJid = getMessageSenderJid(groupJid, message.key.participant);
    const senderJids = this.getMessageSenderCandidateJids(message, senderJid);

    const moderationContext = await this.resolveAntiLinkModerationContext(
      socket,
      groupJid,
      senderJids,
      tenantGroup,
    );
    if (!moderationContext) {
      return false;
    }

    // Check immunity BEFORE deleting message!
    const isImmune =
      moderationContext.sender.isBot ||
      moderationContext.sender.isSuperOwner ||
      moderationContext.sender.isTenantOwner ||
      moderationContext.sender.isTenantAdmin ||
      moderationContext.sender.isGroupAdmin;

    if (isImmune) {
      return false;
    }

    // Violation confirmed: Delete message
    await this.deleteMessageIfPossible(socket, message);

    const groupSetting = await this.tenantGroupSettingRepository.ensureForGroup(groupJid);
    if (groupSetting.antiLinkAutoKick) {
      const autoKickResult = this.guard.canAutoKickUser(moderationContext);
      if (autoKickResult.allowed) {
        await this.kickIfPossible(socket, groupJid, senderJid);
      } else {
        await this.sendWarning(
          socket,
          groupJid,
          message,
          "[WARNING] Link terdeteksi, tetapi user dilindungi dari kick.",
          [senderJid],
        );
      }
    }

    return true;
  }

  parseAntiLinkToggle(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    if (normalized === "on") {
      return true;
    }

    if (normalized === "off") {
      return false;
    }

    throw new Error("Status antilink harus on atau off.");
  }

  assertCanManageAntiLink(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command antilink hanya dapat digunakan oleh pengelola tenant.");
  }

  private async resolveManagedTenant(context: CommandContext): Promise<TenantGroup> {
    this.assertCanManageAntiLink(context.role);

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

  private getMessageSenderCandidateJids(message: WAMessage, senderJid: string): string[] {
    return getIdentityCandidateJids(senderJid, [
      message.key.senderPn,
      message.key.participantPn,
      message.key.senderLid,
      message.key.participantLid,
    ]);
  }

  private async resolveAntiLinkModerationContext(
    socket: WASocket,
    groupJid: string,
    senderJids: string[],
    tenantGroup: TenantGroup,
  ): Promise<ModerationContextState | null> {
    try {
      return await this.guard.resolveContext({
        socket,
        groupJid,
        senderJids,
        targetJids: senderJids,
        tenantGroup,
      });
    } catch (error: unknown) {
      logger.warn({ error, groupJid }, "Gagal membaca metadata grup untuk antilink");
      return null;
    }
  }

  private async deleteMessageIfPossible(socket: WASocket, message: WAMessage): Promise<void> {
    const remoteJid = message.key.remoteJid;
    const messageId = message.key.id;

    if (!remoteJid || !messageId) {
      return;
    }

    antiDeleteService.suppressModerationDelete(remoteJid, messageId);

    try {
      await socket.sendMessage(remoteJid, {
        delete: message.key,
      });
    } catch (error: unknown) {
      logger.warn({ error, groupJid: remoteJid }, "Gagal menghapus pesan antilink");
    }
  }

  private async sendWarning(
    socket: WASocket,
    groupJid: string,
    message: WAMessage,
    text: string,
    mentions: string[] = [],
  ): Promise<void> {
    await socket.sendMessage(
      groupJid,
      {
        text,
        mentions,
      },
      { quoted: message },
    );
  }

  private async kickIfPossible(
    socket: WASocket,
    groupJid: string,
    senderJid: string,
  ): Promise<void> {
    try {
      await socket.groupParticipantsUpdate(groupJid, [senderJid], "remove");
    } catch (error: unknown) {
      logger.warn({ error, groupJid }, "Gagal kick pelanggar antilink");
    }
  }
}

export const antiLinkService = new AntiLinkService();
