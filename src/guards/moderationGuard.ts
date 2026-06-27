import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";
import type { TenantGroup } from "@prisma/client";

import { env } from "../config/env";
import { TenantAdminRepository } from "../repositories/tenantAdmin.repository";
import { getIdentityCandidateJids, normalizeUserJid } from "../utils/jid";

export type ModerationAction = "kick" | "promote" | "demote";

export interface ModerationUserState {
  userJid: string;
  isSuperOwner: boolean;
  isTenantOwner: boolean;
  isTenantAdmin: boolean;
  isGroupAdmin: boolean;
  isBot: boolean;
}

export interface ModerationContextState {
  botIsAdmin: boolean;
  sender: ModerationUserState;
  target: ModerationUserState;
}

export interface ModerationGuardResult {
  allowed: boolean;
  message?: string;
}

export class ModerationGuard {
  private readonly superOwnerJids = new Set(
    env.SUPER_OWNER_JIDS.map((jid) => normalizeUserJid(jid)),
  );

  constructor(private readonly tenantAdminRepository = new TenantAdminRepository()) {}

  async resolveContext(input: {
    socket: WASocket;
    groupJid: string;
    senderJids: string[];
    targetJids: string[];
    tenantGroup?: TenantGroup;
  }): Promise<ModerationContextState> {
    const metadata = await input.socket.groupMetadata(input.groupJid);
    const botJids = this.getBotCandidateJids(input.socket);

    return {
      botIsAdmin: this.isParticipantAdmin(metadata, botJids),
      sender: await this.resolveUserState({
        groupJid: input.groupJid,
        userJids: input.senderJids,
        botJids,
        metadata,
        tenantGroup: input.tenantGroup,
      }),
      target: await this.resolveUserState({
        groupJid: input.groupJid,
        userJids: input.targetJids,
        botJids,
        metadata,
        tenantGroup: input.tenantGroup,
      }),
    };
  }

  canKickUser(context: ModerationContextState): ModerationGuardResult {
    const baseResult = this.canRunModerationAction(context);
    if (!baseResult.allowed) {
      return baseResult;
    }

    return this.canPunishTarget(context);
  }

  canAddUser(context: ModerationContextState): ModerationGuardResult {
    return this.canRunModerationAction(context);
  }

  canPromoteUser(context: ModerationContextState): ModerationGuardResult {
    const baseResult = this.canRunModerationAction(context);
    if (!baseResult.allowed) {
      return baseResult;
    }

    if (context.target.isBot) {
      return protectedTargetResult();
    }

    if (context.target.isSuperOwner || context.target.isTenantOwner) {
      return protectedTargetResult();
    }

    return { allowed: true };
  }

  canDemoteUser(context: ModerationContextState): ModerationGuardResult {
    const baseResult = this.canRunModerationAction(context);
    if (!baseResult.allowed) {
      return baseResult;
    }

    return this.canPunishTarget(context);
  }

  canAutoKickUser(context: ModerationContextState): ModerationGuardResult {
    if (!context.botIsAdmin) {
      return {
        allowed: false,
        message: "[ERROR] Bot harus menjadi admin grup untuk menjalankan aksi ini.",
      };
    }

    if (
      context.target.isBot ||
      context.target.isSuperOwner ||
      context.target.isTenantOwner ||
      context.target.isTenantAdmin ||
      context.target.isGroupAdmin
    ) {
      return protectedTargetResult();
    }

    return { allowed: true };
  }

  isProtectedUser(user: ModerationUserState): boolean {
    return user.isSuperOwner || user.isTenantOwner || user.isBot;
  }

  private canPunishTarget(context: ModerationContextState): ModerationGuardResult {
    if (
      context.target.userJid === context.sender.userJid ||
      context.target.isBot ||
      context.target.isSuperOwner
    ) {
      return protectedTargetResult();
    }

    if (context.target.isTenantOwner && !context.sender.isSuperOwner) {
      return protectedTargetResult();
    }

    if (
      context.target.isGroupAdmin &&
      !context.sender.isSuperOwner &&
      !context.sender.isTenantOwner
    ) {
      return protectedTargetResult();
    }

    return { allowed: true };
  }

  private canRunModerationAction(context: ModerationContextState): ModerationGuardResult {
    if (!context.botIsAdmin) {
      return {
        allowed: false,
        message: "[ERROR] Bot harus menjadi admin grup untuk menjalankan aksi ini.",
      };
    }

    if (!this.canSenderModerate(context.sender)) {
      return {
        allowed: false,
        message: "[ERROR] Kamu tidak punya izin untuk menjalankan aksi ini.",
      };
    }

    return { allowed: true };
  }

  private canSenderModerate(sender: ModerationUserState): boolean {
    return (
      sender.isSuperOwner || sender.isTenantOwner || sender.isTenantAdmin || sender.isGroupAdmin
    );
  }

  private async resolveUserState(input: {
    groupJid: string;
    userJids: string[];
    botJids: string[];
    metadata: GroupMetadata;
    tenantGroup?: TenantGroup;
  }): Promise<ModerationUserState> {
    const normalizedJids = input.userJids.map((jid) => normalizeUserJid(jid));
    const participant = this.findParticipant(input.metadata, normalizedJids);
    const participantJids = this.getParticipantCandidateJids(participant);
    const userJid = normalizeUserJid(participantJids[0] ?? normalizedJids[0] ?? "");
    const candidateJids = [...new Set([...normalizedJids, ...participantJids, userJid])];
    const isTenantOwner = Boolean(
      input.tenantGroup?.ownerJid &&
      candidateJids.includes(normalizeUserJid(input.tenantGroup.ownerJid)),
    );

    return {
      userJid,
      isSuperOwner: candidateJids.some((jid) => this.superOwnerJids.has(jid)),
      isTenantOwner,
      isTenantAdmin: await this.isTenantAdmin(input.groupJid, candidateJids),
      isGroupAdmin: this.isParticipantAdmin(input.metadata, candidateJids),
      isBot: candidateJids.some((jid) => input.botJids.includes(jid)),
    };
  }

  private async isTenantAdmin(groupJid: string, userJids: string[]): Promise<boolean> {
    for (const userJid of userJids) {
      if (await this.tenantAdminRepository.exists(groupJid, userJid)) {
        return true;
      }
    }

    return false;
  }

  private getParticipantCandidateJids(
    participant:
      | {
          id?: string | null;
          jid?: string | null;
          lid?: string | null;
        }
      | null
      | undefined,
  ): string[] {
    if (!participant) {
      return [];
    }

    return getIdentityCandidateJids(participant.id ?? "", [participant.jid, participant.lid]);
  }

  private findParticipant(metadata: GroupMetadata, userJids: string[]) {
    return metadata.participants.find((participant) => {
      const candidates = this.getParticipantCandidateJids(participant);

      return candidates.some((jid) => userJids.includes(jid));
    });
  }

  private isParticipantAdmin(metadata: GroupMetadata, userJids: string[]): boolean {
    return metadata.participants.some((participant) => {
      const candidates = this.getParticipantCandidateJids(participant);

      return candidates.some((jid) => userJids.includes(jid)) && Boolean(participant.admin);
    });
  }

  private getBotCandidateJids(socket: WASocket): string[] {
    return getIdentityCandidateJids(socket.user?.id ?? "", [socket.user?.lid, socket.user?.jid]);
  }
}

function protectedTargetResult(): ModerationGuardResult {
  return {
    allowed: false,
    message: "[ERROR] Aksi dibatalkan. Target adalah user yang dilindungi.",
  };
}

export const moderationGuard = new ModerationGuard();
