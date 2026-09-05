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
  private readonly mentionsWhileAfk = new Map<string, Set<string>>();

  constructor(
    private readonly repository: AfkStatusStore = new AfkStatusRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async setAfkStatus(groupJid: string, userJid: string, reason: string): Promise<AfkStatus> {
    const normalizedUser = normalizeUserJid(userJid);
    this.mentionsWhileAfk.delete(this.getCooldownKey(groupJid, normalizedUser));

    return this.repository.setAfkStatus({
      groupJid,
      userJid: normalizedUser,
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
    if (statuses.length === 0) {
      return;
    }

    const senderJid = getMessageSenderJid(groupJid, message.key.participant);
    const normalizedSender = senderJid ? normalizeUserJid(senderJid) : null;

    // Catat pemanggil ke dalam daftar mentionsWhileAfk
    for (const status of statuses) {
      if (normalizedSender && normalizedSender !== status.userJid) {
        const afkKey = this.getCooldownKey(groupJid, status.userJid);
        let callers = this.mentionsWhileAfk.get(afkKey);
        if (!callers) {
          callers = new Set<string>();
          this.mentionsWhileAfk.set(afkKey, callers);
        }
        callers.add(normalizedSender);
      }
    }

    const notifiedStatuses = statuses
      .filter((status) => this.canNotify(groupJid, status.userJid))
      .slice(0, MAX_AFK_RESPONSES_PER_MESSAGE);

    for (const status of notifiedStatuses) {
      this.markNotified(groupJid, status.userJid);
      const userMention = `@${status.userJid.split("@")[0] ?? status.userJid}`;
      const durationText = formatDuration(this.now().getTime() - status.startedAt.getTime());

      await socket.sendMessage(
        groupJid,
        {
          text: [
            "💤 *[ PEMBERITAHUAN AFK ]*",
            "",
            `${userMention} yang kamu panggil sedang AFK.`,
            "",
            `• *Alasan* : ${status.reason}`,
            `• *Sejak*  : ${durationText} lalu`,
            "",
            `Pesanmu akan disampaikan saat ${userMention} kembali aktif. Mohon ditunggu ya! 🙏`,
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

      const afkKey = this.getCooldownKey(groupJid, candidateJid);
      const callersSet = this.mentionsWhileAfk.get(afkKey);
      this.mentionsWhileAfk.delete(afkKey);

      const callersList = callersSet ? Array.from(callersSet) : [];
      let callsSummary = "Tidak ada panggilan masuk";
      if (callersList.length > 0) {
        if (callersList.length <= 4) {
          const callerTags = callersList.map((j) => `@${j.split("@")[0] ?? ""}`).join(", ");
          callsSummary = `Dicari oleh ${callerTags} (${String(callersList.length)} orang)`;
        } else {
          const firstThree = callersList
            .slice(0, 3)
            .map((j) => `@${j.split("@")[0] ?? ""}`)
            .join(", ");
          const remaining = callersList.length - 3;
          callsSummary = `Dicari oleh ${firstThree}, dan ${String(remaining)} lainnya (${String(callersList.length)} orang)`;
        }
      }

      const userMention = `@${candidateJid.split("@")[0] ?? candidateJid}`;
      const durationText = formatDuration(this.now().getTime() - status.startedAt.getTime());

      const returnText = [
        `🔔 *[ STATUS UPDATE ]* — ${userMention} telah kembali aktif`,
        "",
        "Status AFK kamu telah dinonaktifkan secara otomatis.",
        "",
        "📋 *Ringkasan Sesi*:",
        `• Waktu Rehat : ${durationText}`,
        `• Alasan      : ${status.reason}`,
        `• Panggilan   : ${callsSummary}`,
        "",
        "Selamat melanjutkan aktivitas dan obrolan di grup! 🚀",
      ].join("\n");

      const mentions = [...new Set([candidateJid, ...callersList])];

      await socket.sendMessage(
        groupJid,
        {
          text: returnText,
          mentions,
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
    const nowTime = this.now().getTime();
    this.notificationCooldowns.set(this.getCooldownKey(groupJid, userJid), nowTime);

    if (this.notificationCooldowns.size > 200) {
      for (const [key, timestamp] of this.notificationCooldowns.entries()) {
        if (nowTime - timestamp >= AFK_REPLY_COOLDOWN_MS) {
          this.notificationCooldowns.delete(key);
        }
      }
    }

    if (this.mentionsWhileAfk.size > 200) {
      const oldestKey = this.mentionsWhileAfk.keys().next().value;
      if (oldestKey) {
        this.mentionsWhileAfk.delete(oldestKey);
      }
    }
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
