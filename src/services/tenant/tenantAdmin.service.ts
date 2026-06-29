import { TenantStatus, type TenantAdmin, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { TenantAdminRepository } from "../../repositories/tenantAdmin.repository";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import {
  getIdentityCandidateJids,
  isGroupJid,
  isStatusBroadcastJid,
  normalizeJid,
  normalizeUserJid,
} from "../../utils/jid";
import { extractTargetJidFromMessage } from "../../utils/moderationTarget";
import { tenantOwnerSessionService, type CurrentTenantResult } from "./tenantOwnerSession.service";

interface ParticipantIdentity {
  id?: string | null;
  jid?: string | null;
  lid?: string | null;
}

export interface TenantAdminMutationResult {
  tenantGroup: TenantGroup;
  adminJid: string;
}

export interface TenantAdminListResult {
  tenantGroup: TenantGroup;
  admins: TenantAdmin[];
}

export class TenantAdminService {
  private readonly superOwnerJids = new Set(
    env.SUPER_OWNER_JIDS.map((jid) => normalizeUserJid(jid)),
  );

  constructor(
    private readonly tenantAdminRepository = new TenantAdminRepository(),
    private readonly currentTenantService: {
      getCurrentTenant(actorJid: string): Promise<CurrentTenantResult>;
    } = tenantOwnerSessionService,
  ) {}

  async addTenantAdmin(context: CommandContext): Promise<TenantAdminMutationResult> {
    const tenantGroup = await this.resolveTenantForManagement(context, [
      "SUPER_OWNER",
      "TENANT_OWNER",
    ]);
    const adminJid = await this.resolveTargetJid(context, tenantGroup);

    await this.tenantAdminRepository.add(tenantGroup.groupJid, adminJid, context.senderUserJid);

    return {
      tenantGroup,
      adminJid,
    };
  }

  async removeTenantAdmin(context: CommandContext): Promise<TenantAdminMutationResult | null> {
    const tenantGroup = await this.resolveTenantForManagement(context, [
      "SUPER_OWNER",
      "TENANT_OWNER",
    ]);
    const adminJid = await this.resolveTargetJid(context, tenantGroup);
    const existingAdmin = await this.tenantAdminRepository.find(tenantGroup.groupJid, adminJid);
    if (!existingAdmin) {
      return null;
    }

    await this.tenantAdminRepository.remove(tenantGroup.groupJid, adminJid);

    return {
      tenantGroup,
      adminJid,
    };
  }

  async listTenantAdmins(context: CommandContext): Promise<TenantAdminListResult> {
    const tenantGroup = await this.resolveTenantForManagement(context, [
      "SUPER_OWNER",
      "TENANT_OWNER",
      "TENANT_ADMIN",
    ]);
    const admins = await this.tenantAdminRepository.listByGroupJid(tenantGroup.groupJid);

    return {
      tenantGroup,
      admins,
    };
  }

  private async resolveTenantForManagement(
    context: CommandContext,
    allowedRoles: Role[],
  ): Promise<TenantGroup> {
    if (!allowedRoles.includes(context.role)) {
      throw new Error("[ERROR] Kamu tidak punya izin untuk mengelola tenant admin.");
    }

    const tenantGroup = context.isGroup
      ? context.tenantGroup
      : await this.resolveCurrentPrivateTenant(context.senderUserJid);

    if (!tenantGroup) {
      throw new Error(
        "[ERROR] Belum ada tenant aktif dipilih. Gunakan .mytenant lalu .usetenant <nomor/kode>.",
      );
    }

    if (
      !tenantGroup.expiresAt ||
      tenantGroup.status !== TenantStatus.ACTIVE ||
      tenantGroup.isBlocked ||
      tenantGroup.expiresAt.getTime() <= Date.now()
    ) {
      throw new Error("[ERROR] Command ini hanya dapat digunakan untuk tenant aktif.");
    }

    if (
      context.role === "TENANT_OWNER" &&
      tenantGroup.ownerJid &&
      !this.getActorCandidateJids(context).includes(normalizeUserJid(tenantGroup.ownerJid))
    ) {
      throw new Error("[ERROR] Kamu tidak punya izin untuk mengelola tenant admin.");
    }

    return tenantGroup;
  }

  private async resolveCurrentPrivateTenant(actorJid: string): Promise<TenantGroup | null> {
    const currentTenant = await this.currentTenantService.getCurrentTenant(actorJid);

    return currentTenant.tenantGroup;
  }

  private async resolveTargetJid(
    context: CommandContext,
    tenantGroup: TenantGroup,
  ): Promise<string> {
    const rawTarget =
      context.mentionedJids[0] ?? context.quoted?.participantJid ?? context.args[0] ?? null;
    if (rawTarget?.includes("@")) {
      const normalizedRawTarget = normalizeJid(rawTarget);
      if (isGroupJid(normalizedRawTarget) || isStatusBroadcastJid(normalizedRawTarget)) {
        throw new Error("[ERROR] Target tenant admin tidak valid.");
      }
    }

    const targetJid = extractTargetJidFromMessage(context, { allowPhoneArgument: true });
    if (!targetJid) {
      throw new Error("[ERROR] Target tenant admin tidak valid.");
    }

    const participant = context.isGroup
      ? await this.resolveGroupParticipant(context.socket, context.chatJid, targetJid)
      : null;
    const targetCandidateJids = participant
      ? this.getParticipantCandidateJids(participant)
      : getIdentityCandidateJids(targetJid);
    const canonicalTargetJid = participant
      ? this.getCanonicalParticipantJid(participant)
      : targetJid;

    this.assertValidTarget(context.socket, tenantGroup, targetCandidateJids, canonicalTargetJid);

    return canonicalTargetJid;
  }

  private async resolveGroupParticipant(
    socket: WASocket,
    groupJid: string,
    targetJid: string,
  ): Promise<ParticipantIdentity | null> {
    const metadata = await socket.groupMetadata(groupJid);
    const normalizedTargetJid = normalizeUserJid(targetJid);

    return (
      metadata.participants.find((participant) =>
        this.getParticipantCandidateJids(participant).includes(normalizedTargetJid),
      ) ?? null
    );
  }

  private getParticipantCandidateJids(participant: ParticipantIdentity): string[] {
    return getIdentityCandidateJids(participant.id ?? "", [participant.jid, participant.lid]);
  }

  private getCanonicalParticipantJid(participant: ParticipantIdentity): string {
    return normalizeUserJid(participant.jid ?? participant.id ?? "");
  }

  private assertValidTarget(
    socket: WASocket,
    tenantGroup: TenantGroup,
    targetCandidateJids: string[],
    canonicalTargetJid: string,
  ): void {
    const normalizedTargetJid = normalizeJid(canonicalTargetJid);
    if (isGroupJid(normalizedTargetJid) || isStatusBroadcastJid(normalizedTargetJid)) {
      throw new Error("[ERROR] Target tenant admin tidak valid.");
    }

    if (this.isBotTarget(socket, targetCandidateJids)) {
      throw new Error("[ERROR] Bot tidak dapat dijadikan tenant admin.");
    }

    if (targetCandidateJids.some((jid) => this.superOwnerJids.has(jid))) {
      throw new Error("[ERROR] Super owner tidak dapat dijadikan tenant admin.");
    }

    if (
      tenantGroup.ownerJid &&
      targetCandidateJids.includes(normalizeUserJid(tenantGroup.ownerJid))
    ) {
      throw new Error("[ERROR] Tenant owner tidak dapat dijadikan tenant admin.");
    }
  }

  private isBotTarget(socket: WASocket, targetCandidateJids: string[]): boolean {
    const botJids = getIdentityCandidateJids(socket.user?.id ?? "", [
      socket.user?.jid,
      socket.user?.lid,
    ]);

    return targetCandidateJids.some((jid) => botJids.includes(jid));
  }

  private getActorCandidateJids(context: CommandContext): string[] {
    return getIdentityCandidateJids(context.senderUserJid, [
      context.senderJid,
      ...context.senderAltJids,
    ]);
  }
}

export const tenantAdminService = new TenantAdminService();
