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

const DEFAULT_WELCOME_MESSAGE = "Selamat datang {user} di {group}.";

export interface WelcomeConfigResult {
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

  async handleParticipantsUpdate(socket: WASocket, update: GroupParticipantsUpdate): Promise<void> {
    if (update.action !== "add" || update.participants.length === 0) {
      return;
    }

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
      const text = this.renderWelcomeMessage(
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

  assertCanManageWelcome(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command welcome hanya dapat digunakan oleh pengelola tenant.");
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

  private renderWelcomeMessage(
    template: string,
    tenantGroup: TenantGroup,
    mentions: string[],
  ): string {
    const mentionText = mentions.map((jid) => `@${jid.split("@")[0] ?? jid}`).join(" ");
    const groupName = tenantGroup.name ?? "grup ini";

    return template.replaceAll("{user}", mentionText).replaceAll("{group}", groupName).trim();
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
