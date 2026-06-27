import type { WAMessageKey } from "@whiskeysockets/baileys";

import {
  moderationGuard,
  type ModerationContextState,
  type ModerationGuard,
} from "../../guards/moderationGuard";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import { getIdentityCandidateJids, normalizeJid, normalizeUserJid } from "../../utils/jid";
import { extractTargetJidFromMessage, normalizePhoneToJid } from "../../utils/moderationTarget";

export class ManualModerationService {
  constructor(private readonly guard: ModerationGuard = moderationGuard) {}

  async kick(context: CommandContext): Promise<string> {
    this.assertGroup(context);

    const targetJid = await this.resolveExistingTargetJid(context, "kick");
    const moderationContext = await this.resolveModerationContext(context, targetJid);
    const guardResult = this.guard.canKickUser(moderationContext);
    this.assertGuardAllowed(guardResult.message);

    await context.socket.groupParticipantsUpdate(context.chatJid, [targetJid], "remove");

    return "[ADMIN] User berhasil dikeluarkan dari grup.";
  }

  async add(context: CommandContext): Promise<string> {
    this.assertGroup(context);

    const phoneText = context.args[0];
    if (!phoneText) {
      throw new Error("[ERROR] Nomor wajib diisi.");
    }

    const targetJid = normalizePhoneToJid(phoneText);
    const moderationContext = await this.resolveModerationContext(context, context.senderUserJid);
    const guardResult = this.guard.canAddUser(moderationContext);
    this.assertGuardAllowed(guardResult.message);

    await context.socket.groupParticipantsUpdate(context.chatJid, [targetJid], "add");

    return "[ADMIN] Nomor berhasil ditambahkan ke grup.";
  }

  async promote(context: CommandContext): Promise<string> {
    this.assertGroup(context);

    const targetJid = await this.resolveExistingTargetJid(context, "promote");
    const moderationContext = await this.resolveModerationContext(context, targetJid);
    const guardResult = this.guard.canPromoteUser(moderationContext);
    this.assertGuardAllowed(guardResult.message);

    if (moderationContext.target.isGroupAdmin) {
      return "[INFO] User tersebut sudah menjadi admin.";
    }

    await context.socket.groupParticipantsUpdate(context.chatJid, [targetJid], "promote");

    return "[ADMIN] User berhasil dipromosikan menjadi admin.";
  }

  async demote(context: CommandContext): Promise<string> {
    this.assertGroup(context);

    const targetJid = await this.resolveExistingTargetJid(context, "demote");
    const moderationContext = await this.resolveModerationContext(context, targetJid);
    const guardResult = this.guard.canDemoteUser(moderationContext);
    this.assertGuardAllowed(guardResult.message);

    if (!moderationContext.target.isGroupAdmin) {
      return "[INFO] User tersebut bukan admin.";
    }

    await context.socket.groupParticipantsUpdate(context.chatJid, [targetJid], "demote");

    return "[ADMIN] User berhasil diturunkan dari admin.";
  }

  async deleteQuotedMessage(context: CommandContext): Promise<string> {
    this.assertGroup(context);
    this.assertCanModerate(context.role);

    if (!context.quoted?.id) {
      throw new Error("[ERROR] Reply pesan yang ingin dihapus dengan command .del.");
    }

    const moderationContext = await this.resolveModerationContext(context, context.senderUserJid);
    const guardResult = this.guard.canAddUser(moderationContext);
    this.assertGuardAllowed(guardResult.message);

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

  private async resolveExistingTargetJid(
    context: CommandContext,
    commandName: "kick" | "promote" | "demote",
  ): Promise<string> {
    const targetJid = extractTargetJidFromMessage(context);
    if (!targetJid) {
      throw new Error(`[ERROR] Reply atau mention user target.\nContoh: .${commandName} @user`);
    }

    return this.resolveGroupParticipantJid(context, targetJid);
  }

  private async resolveModerationContext(
    context: CommandContext,
    targetJid: string,
  ): Promise<ModerationContextState> {
    return this.guard.resolveContext({
      socket: context.socket,
      groupJid: context.chatJid,
      senderJids: getIdentityCandidateJids(context.senderUserJid, [
        context.senderJid,
        ...context.senderAltJids,
      ]),
      targetJids: [targetJid],
      tenantGroup: context.tenantGroup,
    });
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
      throw new Error("[ERROR] User target tidak ditemukan di grup.");
    }

    return normalizeUserJid(participant.id);
  }

  private assertGroup(context: CommandContext): void {
    if (!context.isGroup) {
      throw new Error("[ERROR] Command ini hanya dapat digunakan di grup.");
    }
  }

  private assertCanModerate(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("[ERROR] Kamu tidak punya izin untuk menjalankan aksi ini.");
  }

  private assertGuardAllowed(message: string | undefined): void {
    if (message) {
      throw new Error(message);
    }
  }
}

export const manualModerationService = new ManualModerationService();
