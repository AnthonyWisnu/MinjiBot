import {
  AntiSpamMode,
  TenantAuditAction,
  TenantStatus,
  type TenantFeatureSetting,
  type TenantGroup,
  type TenantGroupSetting,
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

const MESSAGE_FLOOD_WINDOW_MS = 10_000;
const MESSAGE_FLOOD_LIMIT = 6;
const COMMAND_FLOOD_WINDOW_MS = 8_000;
const COMMAND_FLOOD_LIMIT = 4;
const REPEATED_TEXT_WINDOW_MS = 30_000;
const REPEATED_TEXT_LIMIT = 3;
const MEDIA_SPAM_WINDOW_MS = 15_000;
const MEDIA_SPAM_LIMIT = 4;
const ACTION_COOLDOWN_MS = 20_000;

interface SpamBucket {
  messageTimes: number[];
  commandTimes: number[];
  mediaTimes: number[];
  repeatedText?: {
    text: string;
    count: number;
    firstAt: number;
  };
  lastActionAt?: number;
}

export interface AntiSpamConfigResult {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
  groupSetting: TenantGroupSetting;
}

export class AntiSpamService {
  private readonly buckets = new Map<string, SpamBucket>();

  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepository = new TenantFeatureRepository(),
    private readonly tenantGroupSettingRepository = new TenantGroupSettingRepository(),
    private readonly guard: ModerationGuard = moderationGuard,
  ) {}

  async setAntiSpamEnabled(
    context: CommandContext,
    enabled: boolean,
  ): Promise<AntiSpamConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        antiSpamEnabled: enabled,
      });
      const groupSetting = await tenantGroupSettingRepository.ensureForGroup(tenantGroup.groupJid);

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.MODERATION_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          antiSpamEnabled: enabled,
        },
      });

      return {
        tenantGroup,
        featureSetting,
        groupSetting,
      };
    });
  }

  async setAntiSpamMode(
    context: CommandContext,
    mode: AntiSpamMode,
  ): Promise<AntiSpamConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      const featureSetting = await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      await tenantGroupSettingRepository.ensureForGroup(tenantGroup.groupJid);
      const groupSetting = await tenantGroupSettingRepository.update(tenantGroup.groupJid, {
        antiSpamMode: mode,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.MODERATION_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          antiSpamMode: mode,
        },
      });

      return {
        tenantGroup,
        featureSetting,
        groupSetting,
      };
    });
  }

  async getAntiSpamConfig(context: CommandContext): Promise<AntiSpamConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);
    const featureSetting = await this.tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
    const groupSetting = await this.tenantGroupSettingRepository.ensureForGroup(
      tenantGroup.groupJid,
    );

    return {
      tenantGroup,
      featureSetting,
      groupSetting,
    };
  }

  async handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<void> {
    const groupJid = message.key.remoteJid;
    if (!groupJid || message.key.fromMe || !groupJid.endsWith("@g.us")) {
      return;
    }

    const senderJid = getMessageSenderJid(groupJid, message.key.participant);
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.antiSpamEnabled) {
      return;
    }

    const reason = this.detectSpam(groupJid, senderJid, message);
    if (!reason) {
      return;
    }

    const bucket = this.getBucket(groupJid, senderJid);
    const now = Date.now();
    if (bucket.lastActionAt && now - bucket.lastActionAt < ACTION_COOLDOWN_MS) {
      return;
    }
    bucket.lastActionAt = now;

    const senderJids = this.getMessageSenderCandidateJids(message, senderJid);
    const groupSetting = await this.tenantGroupSettingRepository.ensureForGroup(groupJid);

    if (groupSetting.antiSpamMode === AntiSpamMode.NORMAL) {
      await this.sendWarning(socket, groupJid, message, `Peringatan spam terdeteksi: ${reason}.`, [
        senderJid,
      ]);
      return;
    }

    const moderationContext = await this.resolveAntiSpamModerationContext(
      socket,
      groupJid,
      senderJids,
      tenantGroup,
    );
    if (!moderationContext) {
      await this.sendWarning(
        socket,
        groupJid,
        message,
        "[WARNING] Pesan terdeteksi spam. Tindakan otomatis tidak dapat dijalankan.",
        [senderJid],
      );
      return;
    }

    if (groupSetting.antiSpamMode === AntiSpamMode.SOFT) {
      if (moderationContext.botIsAdmin) {
        await this.deleteMessageIfPossible(socket, message);
        await this.sendWarning(
          socket,
          groupJid,
          message,
          "[WARNING] Pesan terdeteksi spam dan sudah dihapus.",
          [senderJid],
        );
        return;
      }

      await this.sendWarning(
        socket,
        groupJid,
        message,
        "[WARNING] Pesan terdeteksi spam. Tindakan otomatis tidak dapat dijalankan.",
        [senderJid],
      );
      return;
    }

    const autoKickResult = this.guard.canAutoKickUser(moderationContext);
    if (!autoKickResult.allowed) {
      if (moderationContext.botIsAdmin) {
        await this.deleteMessageIfPossible(socket, message);
      }

      await this.sendWarning(
        socket,
        groupJid,
        message,
        moderationContext.botIsAdmin
          ? "[WARNING] Pesan terdeteksi spam, tetapi user dilindungi dari kick."
          : "[WARNING] Pesan terdeteksi spam. Tindakan otomatis tidak dapat dijalankan.",
        [senderJid],
      );
      return;
    }

    await this.deleteMessageIfPossible(socket, message);
    await this.sendWarning(
      socket,
      groupJid,
      message,
      "[WARNING] Pesan terdeteksi spam. User akan dikeluarkan dari grup.",
      [senderJid],
    );
    await this.kickIfPossible(socket, groupJid, senderJid);
  }

  parseAntiSpamToggle(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    if (normalized === "on") {
      return true;
    }

    if (normalized === "off") {
      return false;
    }

    throw new Error("Status antispam harus on atau off.");
  }

  parseAntiSpamMode(value: string): AntiSpamMode {
    const normalized = value.trim().toLowerCase();

    if (normalized === "normal") {
      return AntiSpamMode.NORMAL;
    }

    if (normalized === "soft") {
      return AntiSpamMode.SOFT;
    }

    if (normalized === "strict") {
      return AntiSpamMode.STRICT;
    }

    throw new Error("Mode antispam harus normal, soft, atau strict.");
  }

  assertCanManageAntiSpam(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command antispam hanya dapat digunakan oleh pengelola tenant.");
  }

  private detectSpam(groupJid: string, senderJid: string, message: WAMessage): string | null {
    const now = Date.now();
    const bucket = this.getBucket(groupJid, senderJid);
    const text = extractTextFromMessageContent(message.message).trim().toLowerCase();
    const isCommand = text.startsWith(".");
    const isMedia = Boolean(
      message.message?.imageMessage ??
      message.message?.videoMessage ??
      message.message?.audioMessage ??
      message.message?.documentMessage ??
      message.message?.stickerMessage,
    );

    bucket.messageTimes = pushWindow(bucket.messageTimes, now, MESSAGE_FLOOD_WINDOW_MS);
    if (bucket.messageTimes.length >= MESSAGE_FLOOD_LIMIT) {
      return "message flood";
    }

    if (isCommand) {
      bucket.commandTimes = pushWindow(bucket.commandTimes, now, COMMAND_FLOOD_WINDOW_MS);
      if (bucket.commandTimes.length >= COMMAND_FLOOD_LIMIT) {
        return "command flood";
      }
    }

    if (text.length > 0) {
      if (
        bucket.repeatedText?.text === text &&
        now - bucket.repeatedText.firstAt <= REPEATED_TEXT_WINDOW_MS
      ) {
        bucket.repeatedText.count += 1;
      } else {
        bucket.repeatedText = {
          text,
          count: 1,
          firstAt: now,
        };
      }

      if (bucket.repeatedText.count >= REPEATED_TEXT_LIMIT) {
        return "repeated text";
      }
    }

    if (isMedia) {
      bucket.mediaTimes = pushWindow(bucket.mediaTimes, now, MEDIA_SPAM_WINDOW_MS);
      if (bucket.mediaTimes.length >= MEDIA_SPAM_LIMIT) {
        return "media spam";
      }
    }

    return null;
  }

  private async resolveManagedTenant(context: CommandContext): Promise<TenantGroup> {
    this.assertCanManageAntiSpam(context.role);

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

  private async resolveAntiSpamModerationContext(
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
      logger.warn({ error, groupJid }, "Gagal membaca metadata grup untuk antispam");
      return null;
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
      logger.warn({ error, groupJid: remoteJid }, "Gagal menghapus pesan antispam");
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
      logger.warn({ error, groupJid }, "Gagal kick pelanggar antispam");
    }
  }

  private static readonly MAX_BUCKET_ENTRIES = 1000;
  private static readonly BUCKET_TTL_MS = 10 * 60 * 1000; // 10 menit
  private lastBucketCleanupAt = 0;

  private getBucket(groupJid: string, senderJid: string): SpamBucket {
    this.pruneBucketsIfNeeded();

    const key = `${groupJid}:${senderJid}`;
    const bucket = this.buckets.get(key);
    if (bucket) {
      return bucket;
    }

    if (this.buckets.size >= AntiSpamService.MAX_BUCKET_ENTRIES) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey) {
        this.buckets.delete(oldestKey);
      }
    }

    const nextBucket: SpamBucket = {
      messageTimes: [],
      commandTimes: [],
      mediaTimes: [],
    };
    this.buckets.set(key, nextBucket);

    return nextBucket;
  }

  private pruneBucketsIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastBucketCleanupAt < 60_000) {
      return;
    }
    this.lastBucketCleanupAt = now;

    const expiryThreshold = now - AntiSpamService.BUCKET_TTL_MS;
    for (const [key, bucket] of this.buckets.entries()) {
      const latestMessage = bucket.messageTimes[bucket.messageTimes.length - 1] ?? 0;
      const latestCommand = bucket.commandTimes[bucket.commandTimes.length - 1] ?? 0;
      const latestMedia = bucket.mediaTimes[bucket.mediaTimes.length - 1] ?? 0;
      const lastActivity = Math.max(latestMessage, latestCommand, latestMedia, bucket.lastActionAt ?? 0);

      if (lastActivity < expiryThreshold) {
        this.buckets.delete(key);
      }
    }
  }
}

function pushWindow(values: number[], nextValue: number, windowMs: number): number[] {
  return [...values.filter((value) => nextValue - value <= windowMs), nextValue];
}

export const antiSpamService = new AntiSpamService();
