import type { WAMessageKey } from "@whiskeysockets/baileys";

import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import { normalizeJid, normalizePhoneNumberToUserJid, normalizeUserJid } from "../../utils/jid";

export class ManualModerationService {
  async kick(context: CommandContext): Promise<string> {
    this.assertGroup(context);
    this.assertCanModerate(context.role);

    const targetJid = await this.resolveKickTargetJid(context);
    if (normalizeUserJid(targetJid) === normalizeUserJid(context.senderUserJid)) {
      throw new Error("Kamu tidak dapat kick diri sendiri.");
    }

    await context.socket.groupParticipantsUpdate(context.chatJid, [targetJid], "remove");

    return `User berhasil dikeluarkan: @${targetJid.split("@")[0] ?? targetJid}`;
  }

  async deleteQuotedMessage(context: CommandContext): Promise<string> {
    this.assertGroup(context);
    this.assertCanModerate(context.role);

    if (!context.quoted?.id) {
      throw new Error("Reply pesan yang ingin dihapus dengan command .del.");
    }

    const deleteKey: WAMessageKey = {
      remoteJid: context.chatJid,
      id: context.quoted.id,
      participant: context.quoted.participantJid,
      fromMe: false,
    };

    await context.socket.sendMessage(context.chatJid, {
      delete: deleteKey,
    });

    return "Pesan berhasil dihapus.";
  }

  private async resolveKickTargetJid(context: CommandContext): Promise<string> {
    const rawTarget =
      context.quoted?.participantJid ?? context.mentionedJids[0] ?? context.args[0] ?? null;

    if (!rawTarget) {
      throw new Error("Reply atau mention user yang ingin dikick.\nContoh: .kick @user");
    }

    const targetJid = rawTarget.includes("@")
      ? normalizeUserJid(rawTarget)
      : normalizePhoneNumberToUserJid(rawTarget);

    return this.resolveGroupParticipantJid(context, targetJid);
  }

  private async resolveGroupParticipantJid(
    context: CommandContext,
    targetJid: string,
  ): Promise<string> {
    const metadata = await context.socket.groupMetadata(context.chatJid);
    const normalizedTarget = normalizeJid(targetJid);
    const participant = metadata.participants.find((item) => {
      const candidates = [item.id, item.jid, item.lid]
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeJid(value));

      return candidates.includes(normalizedTarget);
    });

    if (!participant) {
      throw new Error("User target tidak ditemukan di grup.");
    }

    return participant.id;
  }

  private assertGroup(context: CommandContext): void {
    if (!context.isGroup) {
      throw new Error("Command ini hanya dapat digunakan di grup.");
    }
  }

  private assertCanModerate(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Command ini hanya dapat digunakan oleh pengelola tenant.");
  }
}

export const manualModerationService = new ManualModerationService();
