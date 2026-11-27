import { TenantStatus } from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { prisma } from "../../repositories/prismaClient";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { WarnRepository } from "../../repositories/warn.repository";
import type { CommandContext } from "../../types/command";
import { identityResolverService } from "../identity/identityResolver.service";
import { tenantFeatureService } from "../tenant/tenantFeature.service";
import { tenantGuard } from "../../guards/tenantGuard";

export class DataPrivacyService {
  constructor(
    private readonly tenantGroupRepo = new TenantGroupRepository(),
    private readonly warnRepo = new WarnRepository(),
  ) {}

  async deleteMyData(context: CommandContext, confirmed: boolean): Promise<string> {
    if (!confirmed) {
      return [
        "⚠️ *[ KONFIRMASI PENGHAPUSAN DATA ]*",
        "",
        "Aksi ini akan menghapus seluruh data profil pribadimu (saldo Poin, Limit, XP, status AFK, dan sesi privat).",
        "",
        "Ketik *.deletemydata confirm* untuk melanjutkan.",
      ].join("\n");
    }

    const candidateJids = [
      ...identityResolverService.getCanonicalCandidateSet(
        context.senderUserJid,
        context.senderAltJids,
      ),
    ];

    if (context.isGroup) {
      const activeWarns = await this.warnRepo.countActiveWarnings(
        context.chatJid,
        context.senderUserJid,
      );
      if (activeWarns > 0) {
        throw new AppUserError(
          "Tidak dapat menghapus data di grup ini karena kamu memiliki catatan peringatan (warning) aktif.",
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.afkStatus.deleteMany({
          where: {
            groupJid: context.chatJid,
            userJid: { in: candidateJids },
          },
        });

        await tx.groupMemberProfile.deleteMany({
          where: {
            groupJid: context.chatJid,
            userJid: { in: candidateJids },
          },
        });

        await tx.tenantPrivateSession.deleteMany({
          where: {
            userJid: { in: candidateJids },
          },
        });
      });

      return "✅ Seluruh data profilmu di grup ini dan sesi privat berhasil dihapus.";
    }

    // Invocation in private chat
    const warningCount = await prisma.groupMemberWarning.count({
      where: {
        userJid: { in: candidateJids },
      },
    });

    if (warningCount > 0) {
      throw new AppUserError(
        "Tidak dapat menghapus data karena kamu masih memiliki peringatan aktif di satu atau lebih grup tenant.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenantPrivateSession.deleteMany({
        where: {
          userJid: { in: candidateJids },
        },
      });

      await tx.afkStatus.deleteMany({
        where: {
          userJid: { in: candidateJids },
        },
      });

      await tx.groupMemberProfile.deleteMany({
        where: {
          userJid: { in: candidateJids },
        },
      });
    });

    return "✅ Seluruh data profil dan sesi pribadimu di seluruh grup berhasil dihapus secara permanen.";
  }

  async purgeTenant(tenantCode: string, _actorJid?: string): Promise<string> {
    const tenant = await this.tenantGroupRepo.findByTenantCode(tenantCode.toUpperCase());
    if (!tenant) {
      throw new AppUserError("Tenant dengan kode tersebut tidak ditemukan.");
    }

    if (tenant.status !== TenantStatus.REMOVED && tenant.status !== TenantStatus.EXPIRED) {
      throw new AppUserError(
        "Hanya tenant dengan status REMOVED atau EXPIRED yang dapat dihapus secara permanen.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenantPrivateSession.deleteMany({
        where: {
          groupJid: tenant.groupJid,
        },
      });

      await tx.tenantGroup.delete({
        where: {
          tenantCode: tenant.tenantCode,
        },
      });
    });

    tenantGuard.invalidateCache(tenant.groupJid);
    tenantFeatureService.invalidateCache(tenant.groupJid);
    identityResolverService.invalidateGroup(tenant.groupJid);

    return `🗑️ Tenant *${tenant.tenantCode}* (*${tenant.name ?? tenant.groupJid}*) dan seluruh data terkait berhasil dihapus permanen.`;
  }
}

export const dataPrivacyService = new DataPrivacyService();
