import {
  TenantAuditAction,
  TenantStatus,
  type TenantFeatureSetting,
  type TenantGroup,
} from "@prisma/client";
import {
  downloadMediaMessage,
  type proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import type { CommandContext } from "../../types/command";
import { normalizeJid, getMessageSenderJid } from "../../utils/jid";
import { extractTextFromMessageContent } from "../../utils/messageText";
import { tenantFeatureService } from "../tenant/tenantFeature.service";

const MAX_CACHE_ENTRIES = 500;
const MAX_MEDIA_CACHE_BYTES = 2 * 1024 * 1024; // 2 MB
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface CachedMessage {
  id: string;
  groupJid: string;
  senderJid: string;
  timestamp: number;
  text?: string;
  mediaType?: "image" | "sticker";
  mediaBuffer?: Buffer;
  caption?: string;
}

export interface AntiDeleteConfigResult {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
}

export class AntiDeleteService {
  private readonly messageCache = new Map<string, CachedMessage>();

  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepository = new TenantFeatureRepository(),
  ) {}

  async setAntiDeleteEnabled(
    context: CommandContext,
    enabled: boolean,
  ): Promise<AntiDeleteConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    return prisma.$transaction(async (tx) => {
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      await tenantFeatureRepository.ensureForGroup(tenantGroup.groupJid);
      const featureSetting = await tenantFeatureRepository.update(tenantGroup.groupJid, {
        antiDeleteEnabled: enabled,
      });

      await tenantAuditRepository.create({
        groupJid: tenantGroup.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.MODERATION_UPDATED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          antiDeleteEnabled: enabled,
        },
      });

      return {
        tenantGroup,
        featureSetting,
      };
    });
  }

  async cacheMessage(msg: WAMessage): Promise<void> {
    await Promise.resolve();
    const remoteJid = msg.key.remoteJid;
    const id = msg.key.id;
    if (!remoteJid || !remoteJid.endsWith("@g.us") || !id || !msg.message) {
      return;
    }

    // Don't cache protocol messages
    if (msg.message.protocolMessage) {
      return;
    }

    const groupJid = normalizeJid(remoteJid);
    const senderJid = getMessageSenderJid(remoteJid, msg.key.participant);
    const text = extractTextFromMessageContent(msg.message);

    let mediaType: "image" | "sticker" | undefined;
    let caption: string | undefined;

    const unwrapped = msg.message;
    if (unwrapped.imageMessage) {
      mediaType = "image";
      caption = unwrapped.imageMessage.caption ?? undefined;
    } else if (unwrapped.stickerMessage) {
      mediaType = "sticker";
    }

    const key = `${groupJid}:${id}`;
    this.cleanExpiredCache();

    if (this.messageCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.messageCache.keys().next().value;
      if (oldestKey) {
        this.messageCache.delete(oldestKey);
      }
    }

    const cachedItem: CachedMessage = {
      id,
      groupJid,
      senderJid,
      timestamp: Date.now(),
      text: text.trim() ? text.trim() : undefined,
      mediaType,
      caption,
    };
    this.messageCache.set(key, cachedItem);

    // Unduh buffer media secara non-blocking di latar belakang agar tidak menghambat pipeline pesan
    if (mediaType) {
      const fileLength = Number(
        unwrapped.imageMessage?.fileLength ?? unwrapped.stickerMessage?.fileLength ?? 0,
      );
      if (fileLength > 0 && fileLength <= MAX_MEDIA_CACHE_BYTES) {
        downloadMediaMessage(msg, "buffer", {})
          .then((buf) => {
            const currentEntry = this.messageCache.get(key);
            if (currentEntry) {
              currentEntry.mediaBuffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
            }
          })
          .catch(() => {
            // Abaikan kegagalan download cache di latar belakang
          });
      }
    }
  }

  async handleMessageRevoke(
    socket: WASocket,
    key: proto.IMessageKey,
  ): Promise<void> {
    const remoteJid = key.remoteJid;
    const id = key.id;
    if (!remoteJid || !remoteJid.endsWith("@g.us") || !id) {
      return;
    }

    const groupJid = normalizeJid(remoteJid);
    const cacheKey = `${groupJid}:${id}`;
    const cached = this.messageCache.get(cacheKey);
    if (!cached) {
      return;
    }

    // Always remove from cache so we don't trigger twice
    this.messageCache.delete(cacheKey);

    // Check if tenant is active and anti-delete is enabled
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.antiDeleteEnabled) {
      return;
    }

    const senderPhone = cached.senderJid.split("@")[0] ?? cached.senderJid;
    const timeStr = new Date(cached.timestamp).toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
    });

    const header = `⚠️ *[ DETEKSI PESAN DITARIK ]*\n• Pengirim: @${senderPhone}\n• Waktu: ${timeStr} WIB`;

    if (cached.mediaBuffer && cached.mediaType === "image") {
      await socket.sendMessage(groupJid, {
        image: cached.mediaBuffer,
        caption: `${header}\n\nPesan: ${cached.caption ?? "(Foto)"}`,
        mentions: [cached.senderJid],
      });
      return;
    }

    if (cached.mediaBuffer && cached.mediaType === "sticker") {
      await socket.sendMessage(groupJid, {
        text: `${header}\n\nPesan: (Stiker di bawah)`,
        mentions: [cached.senderJid],
      });
      await socket.sendMessage(groupJid, {
        sticker: cached.mediaBuffer,
      });
      return;
    }

    const messageContent = cached.text ?? cached.caption ?? "(Pesan tanpa teks)";
    await socket.sendMessage(groupJid, {
      text: `${header}\n\nIsi Pesan:\n${messageContent}`,
      mentions: [cached.senderJid],
    });
  }

  parseAntiDeleteToggle(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (normalized === "on") return true;
    if (normalized === "off") return false;
    throw new Error("Status antidelete harus on atau off.");
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

  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, item] of this.messageCache.entries()) {
      if (now - item.timestamp > CACHE_TTL_MS) {
        this.messageCache.delete(key);
      }
    }
  }
}

export const antiDeleteService = new AntiDeleteService();
