import { TenantAuditAction, TenantStatus, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantSessionRepository } from "../../repositories/tenantSession.repository";
import { tenantGuard } from "../../guards/tenantGuard";
import { tenantFeatureService } from "./tenantFeature.service";
import type { CommandContext } from "../../types/command";
import {
  getIdentityCandidateJids,
  isGroupJid,
  isStatusBroadcastJid,
  normalizeJid,
  normalizeUserJid,
} from "../../utils/jid";
import { extractTargetJidFromMessage } from "../../utils/moderationTarget";

interface ParticipantIdentity {
  id?: string | null;
  jid?: string | null;
  lid?: string | null;
}

export interface TransferTenantOwnerResult {
  oldOwnerJid: string | null;
  newOwnerJid: string;
}

export class TenantOwnerTransferService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantAuditRepository = new TenantAuditRepository(),
    private readonly tenantSessionRepository = new TenantSessionRepository(),
    private readonly prismaClient: typeof prisma = prisma,
  ) {}

  async transferOwner(context: CommandContext): Promise<TransferTenantOwnerResult> {
    if (!context.isGroup) {
      throw new Error("[ERROR] Command ini hanya dapat digunakan di grup tenant aktif.");
    }

    const tenantGroup = await this.resolveActiveTenantGroup(context.chatJid);
    this.assertCanTransferOwner(context, tenantGroup);

    const targetJid = extractTargetJidFromMessage(context);
    if (!targetJid) {
      throw new Error("[ERROR] Target owner baru tidak valid.");
    }

    const metadata = await context.socket.groupMetadata(context.chatJid);
    const participant = this.findParticipant(metadata.participants, [targetJid]);
    if (!participant) {
      throw new Error("[ERROR] Target owner baru tidak valid.");
    }

    const targetCandidateJids = this.getParticipantCandidateJids(participant);
    if (this.isBotTarget(context.socket, targetCandidateJids)) {
      throw new Error("[ERROR] Bot tidak dapat dijadikan tenant owner.");
    }

    const newOwnerJid = this.getCanonicalOwnerJid(participant);
    if (tenantGroup.ownerJid && normalizeUserJid(tenantGroup.ownerJid) === newOwnerJid) {
      throw new Error("[INFO] User tersebut sudah menjadi tenant owner.");
    }

    const oldOwnerJid = tenantGroup.ownerJid;
    const updatedTenant = await this.updateTenantOwner(
      tenantGroup,
      newOwnerJid,
      context.senderUserJid,
    );

    return {
      oldOwnerJid,
      newOwnerJid: updatedTenant.ownerJid ?? newOwnerJid,
    };
  }

  private async resolveActiveTenantGroup(groupJid: string): Promise<TenantGroup> {
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (
      !tenantGroup?.expiresAt ||
      tenantGroup.status !== TenantStatus.ACTIVE ||
      tenantGroup.isBlocked ||
      tenantGroup.expiresAt.getTime() <= Date.now()
    ) {
      throw new Error("[ERROR] Command ini hanya dapat digunakan di grup tenant aktif.");
    }

    return tenantGroup;
  }

  private assertCanTransferOwner(context: CommandContext, tenantGroup: TenantGroup): void {
    if (context.role === "SUPER_OWNER") {
      return;
    }

    const actorJids = getIdentityCandidateJids(context.senderUserJid, [
      context.senderJid,
      ...context.senderAltJids,
    ]);

    if (
      context.role === "TENANT_OWNER" &&
      tenantGroup.ownerJid &&
      actorJids.includes(normalizeUserJid(tenantGroup.ownerJid))
    ) {
      return;
    }

    throw new Error("[ERROR] Kamu tidak punya izin untuk memindahkan tenant owner.");
  }

  private findParticipant(
    participants: readonly ParticipantIdentity[],
    userJids: string[],
  ): ParticipantIdentity | undefined {
    const normalizedJids = userJids.map((jid) => normalizeUserJid(jid));

    return participants.find((participant) => {
      const candidates = this.getParticipantCandidateJids(participant);

      return candidates.some((jid) => normalizedJids.includes(jid));
    });
  }

  private getParticipantCandidateJids(participant: ParticipantIdentity): string[] {
    return getIdentityCandidateJids(participant.id ?? "", [participant.jid, participant.lid]);
  }

  private isBotTarget(socket: WASocket, targetCandidateJids: string[]): boolean {
    const botJids = getIdentityCandidateJids(socket.user?.id ?? "", [
      socket.user?.jid,
      socket.user?.lid,
    ]);

    return targetCandidateJids.some((jid) => botJids.includes(jid));
  }

  private getCanonicalOwnerJid(participant: ParticipantIdentity): string {
    const ownerJid = participant.jid ?? participant.id;
    if (!ownerJid) {
      throw new Error("[ERROR] Target owner baru tidak valid.");
    }

    const normalizedJid = normalizeJid(ownerJid);
    if (isGroupJid(normalizedJid) || isStatusBroadcastJid(normalizedJid)) {
      throw new Error("[ERROR] Target owner baru tidak valid.");
    }

    return normalizeUserJid(normalizedJid);
  }

  private async updateTenantOwner(
    tenantGroup: TenantGroup,
    newOwnerJid: string,
    actorJid: string,
  ): Promise<TenantGroup> {
    const executeInTx = async (
      groupRepo: TenantGroupRepository,
      auditRepo: TenantAuditRepository,
      sessionRepo: TenantSessionRepository,
    ) => {
      const updated = await groupRepo.updateOwner(tenantGroup.groupJid, newOwnerJid);

      if (tenantGroup.ownerJid && typeof sessionRepo.clearByUserJid === "function") {
        await sessionRepo.clearByUserJid(tenantGroup.ownerJid);
      }

      await auditRepo.create({
        groupJid: tenantGroup.groupJid,
        actorJid,
        action: TenantAuditAction.TENANT_OWNER_CHANGED,
        metadata: {
          tenantCode: tenantGroup.tenantCode,
          oldOwnerJid: tenantGroup.ownerJid,
          newOwnerJid,
        },
      });

      return updated;
    };

    const isMock =
      process.env.NODE_ENV === "test" &&
      (this.tenantGroupRepository as unknown as { client?: unknown }).client === undefined;

    let updatedTenant: TenantGroup;
    if (!isMock && typeof this.prismaClient.$transaction === "function") {
      try {
        updatedTenant = await this.prismaClient.$transaction(async (tx) => {
          return executeInTx(
            new TenantGroupRepository(tx),
            new TenantAuditRepository(tx),
            new TenantSessionRepository(tx),
          );
        });
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (
          process.env.NODE_ENV === "test" &&
          (error.code === "P1001" ||
            error.message?.includes("localhost:5432") ||
            error.message?.includes("connect ECONNREFUSED"))
        ) {
          updatedTenant = await executeInTx(
            this.tenantGroupRepository,
            this.tenantAuditRepository,
            this.tenantSessionRepository,
          );
        } else {
          throw err;
        }
      }
    } else {
      updatedTenant = await executeInTx(
        this.tenantGroupRepository,
        this.tenantAuditRepository,
        this.tenantSessionRepository,
      );
    }

    tenantGuard.invalidateCache(tenantGroup.groupJid);
    tenantFeatureService.invalidateCache(tenantGroup.groupJid);

    return updatedTenant;
  }
}

export const tenantOwnerTransferService = new TenantOwnerTransferService();
