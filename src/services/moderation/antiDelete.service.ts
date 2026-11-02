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
import type { CommandContext } from "../../types/command";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import {
  normalizeJid,
  getMessageSenderJid,
  normalizeUserJid,
  getPreferredUserJid,
  getUniqueNormalizedJids,
  getIdentityCandidateJids,
  isPhoneUserJid,
} from "../../utils/jid";
import { extractTextFromMessageContent } from "../../utils/messageText";
import { roleGuard } from "../../guards/roleGuard";
import { tenantFeatureService } from "../tenant/tenantFeature.service";

const MAX_CACHE_ENTRIES = 500;
const MAX_MEDIA_CACHE_BYTES = 2 * 1024 * 1024; // 2 MB per file
export const MAX_TOTAL_MEDIA_BYTES = 64 * 1024 * 1024; // 64 MB plafon total RAM (PERF-01)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SUPPRESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedMessage {
  id: string;
  groupJid: string;
  senderJid: string;
  senderAltJids?: string[];
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

interface ExtendedMessageKey {
  senderPn?: string | null;
  participantPn?: string | null;
  senderLid?: string | null;
  participantLid?: string | null;
}

export class AntiDeleteService {
  private readonly messageCache = new Map<string, CachedMessage>();
  private readonly suppressedMessageKeys = new Map<string, number>();
  private currentMediaBytes = 0;

  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepository = new TenantFeatureRepository(),
  ) {}

  getCurrentMediaBytes(): number {
    return this.currentMediaBytes;
  }

  private deleteFromCache(key: string): boolean {
    const item = this.messageCache.get(key);
    if (!item) return false;
    if (item.mediaBuffer) {
      this.currentMediaBytes -= item.mediaBuffer.byteLength;
      if (this.currentMediaBytes < 0) this.currentMediaBytes = 0;
    }
    return this.messageCache.delete(key);
  }

  private evictMediaUntilUnderCap(additionalBytes: number): void {
    while (this.currentMediaBytes + additionalBytes > MAX_TOTAL_MEDIA_BYTES) {
      let evicted = false;
      for (const item of this.messageCache.values()) {
        if (item.mediaBuffer) {
          this.currentMediaBytes -= item.mediaBuffer.byteLength;
          delete item.mediaBuffer;
          evicted = true;
          break;
        }
      }
      if (!evicted) break;
    }
    if (this.currentMediaBytes < 0) this.currentMediaBytes = 0;
  }

  suppressModerationDelete(chatJid: string, messageId: string): void {
    const groupJid = normalizeJid(chatJid);
    const key = `${groupJid}:${messageId}`;
    this.deleteFromCache(key);
    this.cleanExpiredSuppressedKeys();
    this.suppressedMessageKeys.set(key, Date.now());
  }

  private cleanExpiredSuppressedKeys(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.suppressedMessageKeys.entries()) {
      if (now - timestamp > SUPPRESSION_TTL_MS) {
        this.suppressedMessageKeys.delete(key);
      }
    }
  }

  async setAntiDeleteEnabled(
    context: CommandContext,
    enabled: boolean,
  ): Promise<AntiDeleteConfigResult> {
    const tenantGroup = await this.resolveManagedTenant(context);

    const result = await prisma.$transaction(async (tx) => {
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

    tenantFeatureService.invalidateCache(tenantGroup.groupJid);
    return result;
  }

  async cacheMessage(msg: WAMessage): Promise<void> {
    await Promise.resolve();
    const remoteJid = msg.key.remoteJid;
    const id = msg.key.id;
    if (!remoteJid || !remoteJid.endsWith("@g.us") || !id || !msg.message) {
      return;
    }

    // Abaikan pesan milik bot sendiri (jangan pernah di-cache untuk anti-delete)
    if (msg.key.fromMe) {
      return;
    }

    // Don't cache protocol messages
    if (msg.message.protocolMessage) {
      return;
    }

    // Jangan pernah membongkar atau mencache pesan privasi View-Once
    if (
      msg.message.viewOnceMessage ||
      msg.message.viewOnceMessageV2 ||
      (msg.message as { viewOnceMessageV2Extension?: unknown }).viewOnceMessageV2Extension
    ) {
      return;
    }

    const groupJid = normalizeJid(remoteJid);
    const key = `${groupJid}:${id}`;

    // Jika pesan ini sudah ditandai untuk dihapus oleh moderasi, jangan simpan di cache
    if (this.suppressedMessageKeys.has(key)) {
      return;
    }

    const rawSenderJid = getMessageSenderJid(remoteJid, msg.key.participant);
    const extKey = msg.key as unknown as ExtendedMessageKey;
    const senderAltJids = getUniqueNormalizedJids([
      remoteJid,
      msg.key.participant,
      extKey.senderPn,
      extKey.participantPn,
      extKey.senderLid,
      extKey.participantLid,
    ]);
    const senderJid = getPreferredUserJid(
      senderAltJids.includes(rawSenderJid) ? senderAltJids : [rawSenderJid, ...senderAltJids],
    );
    const text = extractTextFromMessageContent(msg.message);

    let mediaType: "image" | "sticker" | undefined;
    let caption: string | undefined;

    const unwrapped =
      msg.message.ephemeralMessage?.message ??
      msg.message.documentWithCaptionMessage?.message ??
      msg.message;

    if (
      unwrapped.viewOnceMessage ||
      unwrapped.viewOnceMessageV2 ||
      (unwrapped as { viewOnceMessageV2Extension?: unknown }).viewOnceMessageV2Extension
    ) {
      return;
    }

    if (unwrapped.imageMessage) {
      mediaType = "image";
      caption = unwrapped.imageMessage.caption ?? undefined;
    } else if (unwrapped.stickerMessage) {
      mediaType = "sticker";
    }

    this.cleanExpiredCache();

    if (this.messageCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.messageCache.keys().next().value;
      if (oldestKey) {
        this.deleteFromCache(oldestKey);
      }
    }

    const cachedItem: CachedMessage = {
      id,
      groupJid,
      senderJid,
      senderAltJids,
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
            const mediaBuffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
            // Validasi ukuran buffer pasca-download (PERF-01)
            if (mediaBuffer.byteLength <= 0 || mediaBuffer.byteLength > MAX_MEDIA_CACHE_BYTES) {
              return;
            }

            const currentEntry = this.messageCache.get(key);
            if (currentEntry) {
              // Pastikan plafon 64 MB ditaati sebelum menambah buffer baru
              this.evictMediaUntilUnderCap(mediaBuffer.byteLength);
              currentEntry.mediaBuffer = mediaBuffer;
              this.currentMediaBytes += mediaBuffer.byteLength;
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
    revokerJid?: string | null,
  ): Promise<void> {
    const remoteJid = key.remoteJid;
    const id = key.id;
    if (!remoteJid || !remoteJid.endsWith("@g.us") || !id) {
      return;
    }

    // Abaikan penarikan pesan dari bot itu sendiri
    if (key.fromMe) {
      return;
    }

    const groupJid = normalizeJid(remoteJid);
    const cacheKey = `${groupJid}:${id}`;

    // Cek apakah pesan ini sudah ditekan oleh moderasi bot (AntiLink, AntiSpam, .del)
    if (this.suppressedMessageKeys.has(cacheKey)) {
      this.deleteFromCache(cacheKey);
      return;
    }

    const cached = this.messageCache.get(cacheKey);
    if (!cached) {
      return;
    }

    // Always remove from cache so we don't trigger twice
    this.deleteFromCache(cacheKey);

    // Jika revoker diketahui dan BUKAN pengirim asli (dihapus oleh Admin Grup untuk moderasi)
    if (revokerJid) {
      const normalizedRevoker = normalizeUserJid(revokerJid);
      const senderCandidates = getUniqueNormalizedJids([
        cached.senderJid,
        ...(cached.senderAltJids ?? []),
      ]);
      if (!senderCandidates.includes(normalizedRevoker)) {
        // Dihapus oleh admin grup, jangan di-repost!
        return;
      }
    }

    // Check if tenant is active and anti-delete is enabled
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      return;
    }

    const featureSetting = await this.tenantFeatureRepository.findByGroupJid(groupJid);
    if (!featureSetting?.antiDeleteEnabled) {
      return;
    }

    // Super Owner, Tenant Owner, dan Bot kebal dari Anti-Delete
    const botJid = socket.user?.id;
    const extRevokeKey = key as unknown as ExtendedMessageKey;
    const allSenderCandidates = getUniqueNormalizedJids([
      cached.senderJid,
      ...(cached.senderAltJids ?? []),
      key.participant,
      extRevokeKey.participantPn,
      extRevokeKey.senderPn,
    ]);

    // Jika kandidat masih ada LID, coba resolve via groupMetadata jika socket mendukung
    if (
      allSenderCandidates.some((j) => j.endsWith("@lid")) &&
      typeof socket.groupMetadata === "function"
    ) {
      try {
        const metadata = await socket.groupMetadata(groupJid);
        const matchedParticipant = metadata.participants.find((p) => {
          const extP = p as unknown as { jid?: string; lid?: string };
          const cand = getIdentityCandidateJids(p.id, [extP.jid, extP.lid]);
          return cand.some((c) => allSenderCandidates.includes(c));
        });
        if (matchedParticipant) {
          const extP = matchedParticipant as unknown as { jid?: string; lid?: string };
          const participantCand = getIdentityCandidateJids(matchedParticipant.id, [
            extP.jid,
            extP.lid,
          ]);
          allSenderCandidates.push(...participantCand);
        }
      } catch {
        // Abaikan jika metadata grup gagal diambil
      }
    }

    if (this.isProtectedSender(cached.senderJid, allSenderCandidates, tenantGroup, botJid)) {
      return;
    }

    const preferredPhoneJid =
      allSenderCandidates.find((j) => isPhoneUserJid(j)) ?? cached.senderJid;
    const senderPhone = preferredPhoneJid.split("@")[0] ?? preferredPhoneJid;
    const mentions = getUniqueNormalizedJids([
      cached.senderJid,
      ...(cached.senderAltJids ?? []),
      ...allSenderCandidates,
    ]);
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
        mentions,
      });
      return;
    }

    if (cached.mediaBuffer && cached.mediaType === "sticker") {
      await socket.sendMessage(groupJid, {
        text: `${header}\n\nPesan: (Stiker di bawah)`,
        mentions,
      });
      await socket.sendMessage(groupJid, {
        sticker: cached.mediaBuffer,
      });
      return;
    }

    const messageContent = cached.text ?? cached.caption ?? "(Pesan tanpa teks)";
    await socket.sendMessage(groupJid, {
      text: `${header}\n\nIsi Pesan:\n${messageContent}`,
      mentions,
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

  isProtectedSender(
    senderJid: string,
    senderAltJidsOrTenantGroup?: string[] | TenantGroup | null,
    tenantGroupOrBotJid?: TenantGroup | string | null,
    maybeBotJid?: string | null,
  ): boolean {
    let senderAltJids: string[] = [];
    let tenantGroup: TenantGroup | null = null;
    let botJid: string | null = null;

    if (Array.isArray(senderAltJidsOrTenantGroup)) {
      senderAltJids = senderAltJidsOrTenantGroup;
      tenantGroup = (tenantGroupOrBotJid as TenantGroup | null | undefined) ?? null;
      botJid = maybeBotJid ?? null;
    } else {
      tenantGroup = senderAltJidsOrTenantGroup ?? null;
      botJid = (tenantGroupOrBotJid as string | null | undefined) ?? null;
    }

    const candidateJids = getIdentityCandidateJids(senderJid, senderAltJids);

    for (const jid of candidateJids) {
      if (roleGuard.isSuperOwner(jid)) {
        return true;
      }

      if (tenantGroup?.ownerJid && normalizeUserJid(tenantGroup.ownerJid) === jid) {
        return true;
      }

      if (botJid && normalizeUserJid(botJid) === jid) {
        return true;
      }
    }

    return false;
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, item] of this.messageCache.entries()) {
      if (now - item.timestamp > CACHE_TTL_MS) {
        this.deleteFromCache(key);
      }
    }
  }
}

export const antiDeleteService = new AntiDeleteService();
