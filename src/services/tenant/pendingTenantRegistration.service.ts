import { TenantAuditAction, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { isGroupJid, normalizeJid } from "../../utils/jid";
import { tenantCodeService } from "./tenantCode.service";

export interface PendingTenantRegistrationInput {
  socket: WASocket;
  groupJid: string;
  actorJid?: string;
}

export class PendingTenantRegistrationService {
  private static readonly METADATA_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
  private readonly lastMetadataCheck = new Map<string, number>();

  constructor(private readonly tenantGroupRepository = new TenantGroupRepository()) {}

  async registerIfNeeded(input: PendingTenantRegistrationInput): Promise<TenantGroup | null> {
    const groupJid = normalizeJid(input.groupJid);
    if (!isGroupJid(groupJid)) {
      return null;
    }

    const existingTenant = await this.tenantGroupRepository.findByGroupJid(groupJid);
    if (existingTenant) {
      await this.updateGroupNameIfNeeded(input.socket, existingTenant);
      return existingTenant;
    }

    return this.createPendingTenant(input.socket, groupJid, input.actorJid);
  }

  private async createPendingTenant(
    socket: WASocket,
    groupJid: string,
    actorJid?: string,
  ): Promise<TenantGroup> {
    const groupName = await this.loadGroupName(socket, groupJid);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tenantCode = await tenantCodeService.generateUniqueCode();

      try {
        return await prisma.$transaction(async (tx) => {
          const tenantGroupRepository = new TenantGroupRepository(tx);
          const tenantAuditRepository = new TenantAuditRepository(tx);

          const tenantGroup = await tenantGroupRepository.createPending({
            groupJid,
            tenantCode,
            name: groupName,
          });

          await tenantAuditRepository.create({
            groupJid,
            actorJid,
            action: TenantAuditAction.TENANT_REGISTERED,
            metadata: {
              tenantCode,
              groupName,
            },
          });

          return tenantGroup;
        });
      } catch (error: unknown) {
        const existingTenant = await this.tenantGroupRepository.findByGroupJid(groupJid);
        if (existingTenant) {
          return existingTenant;
        }

        logger.warn(
          {
            error,
            groupJid,
            attempt: attempt + 1,
          },
          "Gagal membuat tenant pending, mencoba ulang",
        );
      }
    }

    throw new Error("Gagal mendaftarkan tenant pending");
  }

  private async updateGroupNameIfNeeded(socket: WASocket, tenantGroup: TenantGroup): Promise<void> {
    // Jika nama grup sudah tersimpan, batasi pengecekan ke server WhatsApp maksimal sekali per 6 jam
    if (tenantGroup.name) {
      const lastCheck = this.lastMetadataCheck.get(tenantGroup.groupJid) ?? 0;
      if (Date.now() - lastCheck < PendingTenantRegistrationService.METADATA_CHECK_INTERVAL_MS) {
        return;
      }
    }

    this.lastMetadataCheck.set(tenantGroup.groupJid, Date.now());
    const groupName = await this.loadGroupName(socket, tenantGroup.groupJid);

    if (!groupName || groupName === tenantGroup.name) {
      return;
    }

    await this.tenantGroupRepository.updateName(tenantGroup.groupJid, groupName);
  }

  private async loadGroupName(socket: WASocket, groupJid: string): Promise<string | undefined> {
    try {
      const metadata = await socket.groupMetadata(groupJid);
      const subject = metadata.subject.trim();

      return subject && subject.length > 0 ? subject : undefined;
    } catch (error: unknown) {
      logger.warn({ error, groupJid }, "Gagal membaca metadata grup");
      return undefined;
    }
  }
}

export const pendingTenantRegistrationService = new PendingTenantRegistrationService();
