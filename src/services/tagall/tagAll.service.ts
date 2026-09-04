import type { GroupMetadata } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";

const TAG_ALL_ALLOWED_ROLES: readonly Role[] = ["SUPER_OWNER", "TENANT_OWNER", "TENANT_ADMIN"];

export interface TagAllResult {
  mentionedCount: number;
}

export class TagAllService {
  private readonly cooldownUntilByGroup = new Map<string, number>();

  constructor(private readonly tenantGroupSettingRepository = new TenantGroupSettingRepository()) {}

  async sendTagAll(context: CommandContext, message: string): Promise<TagAllResult> {
    if (!context.isGroup) {
      throw new Error("Command ini hanya bisa digunakan di grup.");
    }

    if (!TAG_ALL_ALLOWED_ROLES.includes(context.role)) {
      throw new Error("Command ini hanya bisa digunakan oleh owner atau admin tenant.");
    }

    const cleanMessage = message.trim();
    if (cleanMessage.length === 0) {
      throw new Error("Format command salah.\nGunakan: .tagall <pesan>");
    }

    const setting = await this.tenantGroupSettingRepository.ensureForGroup(context.chatJid);
    this.assertCooldownAvailable(context.chatJid, setting.tagAllCooldownSec);

    const metadata = await this.getGroupMetadata(context);
    const mentions = metadata.participants
      .map((participant) => participant.id)
      .filter((participantJid) => participantJid.length > 0);

    if (mentions.length === 0) {
      throw new Error("Tidak ada member yang bisa ditag di grup ini.");
    }

    await context.socket.sendMessage(
      context.chatJid,
      {
        text: cleanMessage,
        mentions,
      },
      {
        quoted: context.message,
      },
    );

    this.setCooldown(context.chatJid, setting.tagAllCooldownSec);

    return {
      mentionedCount: mentions.length,
    };
  }

  async sendHideTag(context: CommandContext, message: string): Promise<TagAllResult> {
    if (!context.isGroup) {
      throw new Error("Command ini hanya bisa digunakan di grup.");
    }

    if (!TAG_ALL_ALLOWED_ROLES.includes(context.role)) {
      throw new Error("Command ini hanya bisa digunakan oleh owner atau admin tenant.");
    }

    const cleanMessage = message.trim();
    if (cleanMessage.length === 0) {
      throw new Error("Format command salah.\nGunakan: .hidetag <pesan pengumuman>");
    }

    const setting = await this.tenantGroupSettingRepository.ensureForGroup(context.chatJid);
    this.assertCooldownAvailable(context.chatJid, setting.tagAllCooldownSec);

    const metadata = await this.getGroupMetadata(context);
    const mentions = metadata.participants
      .map((participant) => participant.id)
      .filter((participantJid) => participantJid.length > 0);

    if (mentions.length === 0) {
      throw new Error("Tidak ada member yang bisa ditag di grup ini.");
    }

    await context.socket.sendMessage(
      context.chatJid,
      {
        text: `📢 *[ PENGUMUMAN ]*\n\n${cleanMessage}`,
        mentions,
      },
      {
        quoted: context.message,
      },
    );

    this.setCooldown(context.chatJid, setting.tagAllCooldownSec);

    return {
      mentionedCount: mentions.length,
    };
  }

  private assertCooldownAvailable(groupJid: string, cooldownSec: number): void {
    if (cooldownSec <= 0) {
      return;
    }

    const now = Date.now();
    const cooldownUntil = this.cooldownUntilByGroup.get(groupJid) ?? 0;

    if (cooldownUntil <= now) {
      return;
    }

    const remainingSec = Math.ceil((cooldownUntil - now) / 1000);
    throw new Error(`Tag all masih cooldown. Coba lagi dalam ${String(remainingSec)} detik.`);
  }

  private setCooldown(groupJid: string, cooldownSec: number): void {
    if (cooldownSec <= 0) {
      this.cooldownUntilByGroup.delete(groupJid);
      return;
    }

    this.cooldownUntilByGroup.set(groupJid, Date.now() + cooldownSec * 1000);
  }

  private async getGroupMetadata(context: CommandContext): Promise<GroupMetadata> {
    try {
      return await context.socket.groupMetadata(context.chatJid);
    } catch (error: unknown) {
      logger.error(
        {
          error,
          groupJid: context.chatJid,
        },
        "Gagal mengambil metadata grup untuk tag all",
      );

      throw new Error("Gagal mengambil daftar member grup.");
    }
  }
}

export const tagAllService = new TagAllService();
