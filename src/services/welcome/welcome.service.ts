import {
  TenantAuditAction,
  TenantStatus,
  type TenantFeatureSetting,
  type TenantGroup,
  type TenantGroupSetting,
} from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import fs from "node:fs";
import path from "node:path";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import { normalizeJid } from "../../utils/jid";
import { tenantFeatureService } from "../tenant/tenantFeature.service";

export const DEFAULT_WELCOME_MESSAGE = `Selamat datang {user} di *{group}*.

Sebelum berinteraksi, mohon perhatikan hal berikut:
• Membaca dan menaati aturan di deskripsi grup
• Menjaga etika, kesopanan, dan ketertiban bersama
• Ketik *.menu* untuk mengakses perintah bot

Selamat bergabung dan selamat berdiskusi.`;

export const DEFAULT_GOODBYE_MESSAGE = `*[ PEMBERITAHUAN ]*
{user} telah keluar dari *{group}*.

Terima kasih atas kerja sama dan kebersamaannya selama ini. Sampai jumpa di lain kesempatan.`;

export interface WelcomeConfigResult {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
  groupSetting: TenantGroupSetting;
}

export interface GoodbyeConfigResult {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
  groupSetting: TenantGroupSetting;
}

export interface GroupParticipantsUpdate {
  id: string;
  participants: string[];
  action: string;
}

export class WelcomeService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepository = new TenantFeatureRepository(),
    private readonly tenantGroupSettingRepository = new TenantGroupSettingRepository(),
  ) {}

  async setWelcomeEnabled(context: CommandContext, enabled: boolean): Promise<WelcomeConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        welcomeEnabled: enabled,
      });
      const groupSetting = await tenantGroupSettingRepository.ensureForGroup(tenantGroup.groupJid);

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.WELCOME_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          welcomeEnabled: enabled,
        },
      });

      return {
        tenantGroup,
        featureSetting,
        groupSetting,
      };
    });
  }

  async setWelcomeMessage(
    context: CommandContext,
    welcomeMessage: string,
  ): Promise<WelcomeConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      const featureSetting = await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      await tenantGroupSettingRepository.ensureForGroup(tenantGroup.groupJid);
      const groupSetting = await tenantGroupSettingRepository.update(tenantGroup.groupJid, {
        welcomeMessage,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.WELCOME_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          welcomeMessageUpdated: true,
        },
      });

      return {
        tenantGroup,
        featureSetting,
        groupSetting,
      };
    });
  }

  async setGoodbyeEnabled(context: CommandContext, enabled: boolean): Promise<GoodbyeConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        goodbyeEnabled: enabled,
      });
      const groupSetting = await tenantGroupSettingRepository.ensureForGroup(tenantGroup.groupJid);

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.WELCOME_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          goodbyeEnabled: enabled,
        },
      });

      return {
        tenantGroup,
        featureSetting,
        groupSetting,
      };
    });
  }

  async setGoodbyeMessage(
    context: CommandContext,
    goodbyeMessage: string,
  ): Promise<GoodbyeConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      const featureSetting = await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      await tenantGroupSettingRepository.ensureForGroup(tenantGroup.groupJid);
      const groupSetting = await tenantGroupSettingRepository.update(tenantGroup.groupJid, {
        goodbyeMessage,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.WELCOME_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          goodbyeMessageUpdated: true,
        },
      });

      return {
        tenantGroup,
        featureSetting,
        groupSetting,
      };
    });
  }

  async handleParticipantsUpdate(socket: WASocket, update: GroupParticipantsUpdate): Promise<void> {
    if (update.participants.length === 0) {
      return;
    }

    if (update.action === "add") {
      await this.handleWelcomeEvent(socket, update);
    } else if (update.action === "remove") {
      await this.handleGoodbyeEvent(socket, update);
    }
  }

  private async handleWelcomeEvent(socket: WASocket, update: GroupParticipantsUpdate): Promise<void> {
    const groupJid = normalizeJid(update.id);
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.welcomeEnabled) {
      return;
    }

    const groupSetting = await this.tenantGroupSettingRepository.ensureForGroup(groupJid);
    const fallbackAvatar = getFallbackMinjiAvatar();

    for (const participant of update.participants) {
      const participantJid = normalizeJid(participant);
      const text = this.renderMessage(
        groupSetting.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE,
        tenantGroup,
        [participantJid],
      );

      let profilePicUrl: string | null = null;
      try {
        const pic = await socket.profilePictureUrl(participantJid, "image");
        profilePicUrl = pic ?? null;
      } catch {
        // user profile picture may be private or not set
      }

      if (profilePicUrl) {
        try {
          await socket.sendMessage(groupJid, {
            image: { url: profilePicUrl },
            caption: text,
            mentions: [participantJid],
          });
          continue;
        } catch {
          // fallback to local avatar
        }
      }

      if (fallbackAvatar) {
        try {
          await socket.sendMessage(groupJid, {
            image: fallbackAvatar,
            caption: text,
            mentions: [participantJid],
          });
          continue;
        } catch {
          // fallback to text message
        }
      }

      // Final fallback to text message
      await socket.sendMessage(groupJid, {
        text,
        mentions: [participantJid],
      });
    }
  }

  private async handleGoodbyeEvent(socket: WASocket, update: GroupParticipantsUpdate): Promise<void> {
    const groupJid = normalizeJid(update.id);
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.goodbyeEnabled) {
      return;
    }

    const groupSetting = await this.tenantGroupSettingRepository.ensureForGroup(groupJid);
    const botJid = socket.user?.id ? normalizeJid(socket.user.id) : null;

    for (const participant of update.participants) {
      const participantJid = normalizeJid(participant);
      if (botJid && participantJid === botJid) {
        // Skip if the bot itself was removed from the group
        continue;
      }

      const text = this.renderMessage(
        groupSetting.goodbyeMessage ?? DEFAULT_GOODBYE_MESSAGE,
        tenantGroup,
        [participantJid],
      );

      try {
        await socket.sendMessage(groupJid, {
          text,
          mentions: [participantJid],
        });
      } catch {
        // ignore send error on leave
      }
    }
  }

  parseWelcomeToggle(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    if (normalized === "on") {
      return true;
    }

    if (normalized === "off") {
      return false;
    }

    throw new Error("Status welcome harus on atau off.");
  }

  parseGoodbyeToggle(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    if (normalized === "on") {
      return true;
    }

    if (normalized === "off") {
      return false;
    }

    throw new Error("Status goodbye harus on atau off.");
  }

  assertCanManageWelcome(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command welcome hanya dapat digunakan oleh pengelola tenant.");
  }

  assertCanManageGoodbye(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command goodbye hanya dapat digunakan oleh pengelola tenant.");
  }

  renderMessage(
    template: string,
    tenantGroup: TenantGroup,
    mentions: string[],
  ): string {
    const mentionText = mentions.map((jid) => `@${jid.split("@")[0] ?? jid}`).join(" ");
    const groupName = tenantGroup.name ?? "grup ini";

    return template.replaceAll("{user}", mentionText).replaceAll("{group}", groupName).trim();
  }

  renderWelcomeMessage(
    template: string,
    tenantGroup: TenantGroup,
    mentions: string[],
  ): string {
    return this.renderMessage(template, tenantGroup, mentions);
  }

  private async resolveManagedTenant(context: CommandContext): Promise<TenantGroup> {
    this.assertCanManageWelcome(context.role);

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

function getFallbackMinjiAvatar(): Buffer | null {
  const possiblePaths = [
    path.resolve(process.cwd(), "assets/minji.png"),
    path.resolve(process.cwd(), "src/Minji.png"),
    path.resolve(__dirname, "../../assets/minji.png"),
    path.resolve(__dirname, "../../../assets/minji.png"),
    path.resolve(__dirname, "../../Minji.png"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {
        // ignore read error
      }
    }
  }
  return null;
}

export const welcomeService = new WelcomeService();
