import {
  TenantAuditAction,
  TenantStatus,
  type TenantFeatureSetting,
  type TenantGroup,
} from "@prisma/client";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import { getMessageSenderJid, normalizeJid } from "../../utils/jid";
import { extractTextFromMessageContent } from "../../utils/messageText";
import { tenantFeatureService } from "../tenant/tenantFeature.service";

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
  ) {}

  async setAntiLinkEnabled(
    context: CommandContext,
    enabled: boolean,
  ): Promise<AntiLinkConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        antiLinkEnabled: enabled,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderJid,
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
  }

  async handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<void> {
    const groupJid = message.key.remoteJid;
    if (!groupJid || message.key.fromMe || !groupJid.endsWith("@g.us")) {
      return;
    }

    const text = extractTextFromMessageContent(message.message);
    if (!WHATSAPP_INVITE_PATTERN.test(text)) {
      return;
    }

    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.antiLinkEnabled) {
      return;
    }

    const senderJid = getMessageSenderJid(groupJid, message.key.participant);
    const senderRole = await this.resolveProtectedSenderRole(groupJid, senderJid, tenantGroup);
    if (senderRole !== "MEMBER") {
      return;
    }

    await this.deleteMessageIfPossible(socket, message);

    const groupSetting = await this.tenantGroupSettingRepository.ensureForGroup(groupJid);
    if (groupSetting.antiLinkAutoKick) {
      await this.kickIfPossible(socket, groupJid, senderJid);
    }
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
      actorJid: context.senderJid,
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

  private async resolveProtectedSenderRole(
    groupJid: string,
    senderJid: string,
    tenantGroup: TenantGroup,
  ): Promise<Role> {
    const normalizedSenderJid = normalizeJid(senderJid);

    if (tenantGroup.ownerJid && normalizeJid(tenantGroup.ownerJid) === normalizedSenderJid) {
      return "TENANT_OWNER";
    }

    const admin = await prisma.tenantAdmin.findUnique({
      where: {
        groupJid_userJid: {
          groupJid,
          userJid: normalizedSenderJid,
        },
      },
    });

    return admin ? "TENANT_ADMIN" : "MEMBER";
  }

  private async deleteMessageIfPossible(socket: WASocket, message: WAMessage): Promise<void> {
    const remoteJid = message.key.remoteJid;
    const messageId = message.key.id;

    if (!remoteJid || !messageId) {
      return;
    }

    try {
      await socket.sendMessage(remoteJid, {
        delete: message.key,
      });
    } catch (error: unknown) {
      logger.warn({ error, groupJid: remoteJid }, "Gagal menghapus pesan antilink");
    }
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
