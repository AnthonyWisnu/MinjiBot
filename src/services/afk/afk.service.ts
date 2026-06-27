import type { AfkStatus } from "@prisma/client";
import type { proto, WAMessage, WAMessageContent, WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { AfkStatusRepository } from "../../repositories/afkStatus.repository";
import {
  getIdentityCandidateJids,
  getMessageSenderJid,
  getUniqueNormalizedJids,
  isGroupJid,
  normalizeUserJid,
} from "../../utils/jid";
import { extractTextFromMessageContent } from "../../utils/messageText";

const DEFAULT_AFK_REASON = "Tidak ada alasan.";
const AFK_REPLY_COOLDOWN_MS = 60_000;
const MAX_AFK_RESPONSES_PER_MESSAGE = 3;

export interface AfkStatusStore {
  setAfkStatus(input: { groupJid: string; userJid: string; reason: string }): Promise<AfkStatus>;
  getAfkStatus(groupJid: string, userJid: string): Promise<AfkStatus | null>;
  getAfkStatusesByUsers(groupJid: string, userJids: string[]): Promise<AfkStatus[]>;
  clearAfkStatus(groupJid: string, userJid: string): Promise<AfkStatus | null>;
}

export class AfkService {
  private readonly notificationCooldowns = new Map<string, number>();

  constructor(
    private readonly repository: AfkStatusStore = new AfkStatusRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async setAfkStatus(groupJid: string, userJid: string, reason: string): Promise<AfkStatus> {
    return this.repository.setAfkStatus({
      groupJid,
      userJid: normalizeUserJid(userJid),
      reason: normalizeReason(reason),
    });
  }

  async handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<void> {
    const groupJid = message.key.remoteJid;
    if (!groupJid || !isGroupJid(groupJid) || message.key.fromMe) {
      return;
    }

    await this.notifyMentionedAfkUsers(socket, message, groupJid);
    await this.clearSenderAfkIfReturned(socket, message, groupJid);
  }

  private async notifyMentionedAfkUsers(
    socket: WASocket,
    message: WAMessage,
    groupJid: string,
  ): Promise<void> {
    const targetJids = this.extractTargetUserJids(message);
    if (targetJids.length === 0) {
      return;
    }

    const statuses = await this.repository.getAfkStatusesByUsers(groupJid, targetJids);
    const notifiedStatuses = statuses
      .filter((status) => this.canNotify(groupJid, status.userJid))
      .slice(0, MAX_AFK_RESPONSES_PER_MESSAGE);

    for (const status of notifiedStatuses) {
      this.markNotified(groupJid, status.userJid);
      await socket.sendMessage(
        groupJid,
        {
          text: [
            `[AFK] ${formatUserLabel(status.userJid)} sedang AFK.`,
            `Alasan: ${status.reason}`,
            `Sejak: ${formatDuration(this.now().getTime() - status.startedAt.getTime())} lalu.`,
          ].join("\n"),
          mentions: [status.userJid],
        },
        { quoted: message },
      );
    }
  }

  private async clearSenderAfkIfReturned(
    socket: WASocket,
    message: WAMessage,
    groupJid: string,
  ): Promise<void> {
    const text = extractTextFromMessageContent(message.message).trim();
    if (isAfkCommand(text)) {
      return;
    }

    const senderJid = getMessageSenderJid(groupJid, message.key.participant);
    const senderJids = getIdentityCandidateJids(senderJid, [
      message.key.senderPn,
      message.key.participantPn,
      message.key.senderLid,
      message.key.participantLid,
    ]);

    for (const candidateJid of senderJids) {
      const status = await this.repository.clearAfkStatus(groupJid, candidateJid);
      if (!status) {
        continue;
      }

      await socket.sendMessage(
        groupJid,
        {
          text: [
            "[AFK] Selamat datang kembali.",
            `AFK dinonaktifkan setelah ${formatDuration(
              this.now().getTime() - status.startedAt.getTime(),
            )}.`,
          ].join("\n"),
        },
        { quoted: message },
      );
      return;
    }
  }

  private extractTargetUserJids(message: WAMessage): string[] {
    const content = unwrapMessageContent(message.message);
    const contextInfo = content ? getContextInfo(content) : undefined;

    return getUniqueNormalizedJids([
      ...(contextInfo?.mentionedJid ?? []),
      contextInfo?.participant,
    ]);
  }

  private canNotify(groupJid: string, userJid: string): boolean {
    const key = this.getCooldownKey(groupJid, userJid);
    const lastNotifiedAt = this.notificationCooldowns.get(key);

    return !lastNotifiedAt || this.now().getTime() - lastNotifiedAt >= AFK_REPLY_COOLDOWN_MS;
  }

  private markNotified(groupJid: string, userJid: string): void {
    this.notificationCooldowns.set(this.getCooldownKey(groupJid, userJid), this.now().getTime());
  }

  private getCooldownKey(groupJid: string, userJid: string): string {
    return `${groupJid}:${userJid}`;
  }
}

function normalizeReason(reason: string): string {
  const trimmedReason = reason.trim();

  return trimmedReason.length > 0 ? trimmedReason : DEFAULT_AFK_REASON;
}

function isAfkCommand(text: string): boolean {
  const afkCommand = `${env.COMMAND_PREFIX}afk`;
  const normalizedText = text.toLowerCase();

  return normalizedText === afkCommand || normalizedText.startsWith(`${afkCommand} `);
}

function formatUserLabel(userJid: string): string {
  return userJid.split("@")[0] ?? userJid;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${String(days)} hari ${String(hours)} jam`;
  }

  if (hours > 0) {
    return `${String(hours)} jam ${String(minutes)} menit`;
  }

  if (minutes > 0) {
    return `${String(minutes)} menit`;
  }

  return `${String(seconds)} detik`;
}

function unwrapMessageContent(
  content: WAMessageContent | null | undefined,
): WAMessageContent | null {
  if (!content) {
    return null;
  }

  return (
    content.ephemeralMessage?.message ??
    content.viewOnceMessage?.message ??
    content.viewOnceMessageV2?.message ??
    content.documentWithCaptionMessage?.message ??
    content
  );
}

function getContextInfo(content: WAMessageContent): proto.IContextInfo | null | undefined {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.stickerMessage?.contextInfo
  );
}

export const afkService = new AfkService();
