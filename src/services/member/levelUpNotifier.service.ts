import type { WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { isGroupJid } from "../../utils/jid";
import type { MemberRank } from "./rank.service";

export interface LevelUpNotification {
  groupJid: string;
  userJid: string;
  oldRank: MemberRank;
  newRank: MemberRank;
  newXp: number;
}

export class LevelUpNotifierService {
  private socket: WASocket | null = null;

  setSocket(socket: WASocket | null): void {
    this.socket = socket;
  }

  async notifyLevelUp(event: LevelUpNotification): Promise<void> {
    if (!this.socket || !isGroupJid(event.groupJid)) {
      logger.debug(event, "Level up diabaikan: socket belum terhubung atau bukan grup");
      return;
    }

    const username = event.userJid.split("@")[0] ?? "";
    const mention = `@${username}`;

    const text = [
      "🎉 *[ LEVEL UP! ]* 🏆",
      "",
      `Selamat kepada ${mention} yang berhasil naik ke tier *${event.newRank.toUpperCase()}* (${event.newXp.toLocaleString("id-ID")} XP)!`,
      "Gelar baru dan statusmu di grup telah disematkan. Terus tingkatkan keaktifanmu!",
    ].join("\n");

    try {
      await this.socket.sendMessage(event.groupJid, {
        text,
        mentions: [event.userJid],
      });

      logger.info(
        {
          groupJid: event.groupJid,
          userJid: event.userJid,
          oldRank: event.oldRank,
          newRank: event.newRank,
          newXp: event.newXp,
        },
        "Notifikasi level-up berhasil dikirim ke grup",
      );
    } catch (error: unknown) {
      logger.warn(
        { error, groupJid: event.groupJid, userJid: event.userJid },
        "Gagal mengirim pesan selebrasi level up ke grup",
      );
    }
  }
}

export const levelUpNotifierService = new LevelUpNotifierService();
