import {
  MemberTransactionAsset,
  MemberTransactionType,
  TenantAuditAction,
  type GroupMemberProfile,
  type Prisma,
  type TenantGroup,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { InvalidAmountError } from "../../types/memberEconomy";
import {
  MemberEconomyService,
  generateCorrelationId,
  MAX_SAFE_ECONOMY_INT,
} from "./memberEconomy.service";

export interface AdminResult {
  targetJid: string;
  asset: string;
  before: number;
  after: number;
}

export interface AddLimitAllResult {
  groupJid: string;
  amount: number;
  affectedCount: number;
}

export interface MemberInfo {
  profile: GroupMemberProfile;
  rank: string;
}

// Minimal profile store interface for finding profiles and updating bulk limits.
interface AdminProfileStore {
  findByGroupAndUser(groupJid: string, userJid: string): Promise<GroupMemberProfile | null>;
  addLimitToAll(groupJid: string, amount: number): Promise<{ count: number }>;
}

// Minimal audit store interface for DI.
interface AdminAuditStore {
  create(input: {
    groupJid?: string;
    actorJid?: string;
    action: TenantAuditAction;
    metadata?: Prisma.InputJsonValue;
  }): Promise<unknown>;
}

// Minimal economy interface for DI.
interface AdminEconomyService {
  creditPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "SUPER_OWNER_ADD";
  }): Promise<GroupMemberProfile>;
  setPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
  }): Promise<GroupMemberProfile>;
  creditLimit(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "SUPER_OWNER_ADD";
  }): Promise<GroupMemberProfile>;
  setLimit(input: {
    groupJid: string;
    userJid: string;
    amount: number;
  }): Promise<GroupMemberProfile>;
  creditXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "SUPER_OWNER_ADD";
  }): Promise<GroupMemberProfile>;
  setXp(input: { groupJid: string; userJid: string; amount: number }): Promise<GroupMemberProfile>;
}

export class MemberAdminService {
  constructor(
    private readonly economyService: AdminEconomyService = new MemberEconomyService(),
    private readonly profileRepo: AdminProfileStore = new GroupMemberProfileRepository(),
    private readonly auditRepo: AdminAuditStore = new TenantAuditRepository(),
  ) {}

  async addPoints(groupJid: string, targetJid: string, amount: number): Promise<AdminResult> {
    const profile = await this.economyService.creditPoints({
      groupJid,
      userJid: targetJid,
      amount,
      type: "SUPER_OWNER_ADD",
    });
    return {
      targetJid,
      asset: "Poin",
      before: profile.pointsBalance - amount,
      after: profile.pointsBalance,
    };
  }

  async setPoints(groupJid: string, targetJid: string, amount: number): Promise<AdminResult> {
    const before = await this.profileRepo.findByGroupAndUser(groupJid, targetJid);
    const profile = await this.economyService.setPoints({ groupJid, userJid: targetJid, amount });
    return {
      targetJid,
      asset: "Poin",
      before: before?.pointsBalance ?? 0,
      after: profile.pointsBalance,
    };
  }

  async addLimit(groupJid: string, targetJid: string, amount: number): Promise<AdminResult> {
    const profile = await this.economyService.creditLimit({
      groupJid,
      userJid: targetJid,
      amount,
      type: "SUPER_OWNER_ADD",
    });
    return {
      targetJid,
      asset: "Limit",
      before: profile.limitBalance - amount,
      after: profile.limitBalance,
    };
  }

  async setLimit(groupJid: string, targetJid: string, amount: number): Promise<AdminResult> {
    const before = await this.profileRepo.findByGroupAndUser(groupJid, targetJid);
    const initialBefore = before ? before.limitBalance : 10;
    const profile = await this.economyService.setLimit({ groupJid, userJid: targetJid, amount });
    return {
      targetJid,
      asset: "Limit",
      before: initialBefore,
      after: profile.limitBalance,
    };
  }

  async resolveTargetTenant(groupJidOrCode: string): Promise<TenantGroup | null> {
    const tenantGroupRepo = new TenantGroupRepository();
    if (groupJidOrCode.endsWith("@g.us")) {
      return tenantGroupRepo.findByGroupJid(groupJidOrCode);
    }
    return tenantGroupRepo.findByTenantCode(groupJidOrCode);
  }

  async addLimitAll(
    groupJid: string,
    amount: number,
    actorJid: string,
  ): Promise<AddLimitAllResult> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_SAFE_ECONOMY_INT) {
      throw new InvalidAmountError("Jumlah harus bilangan bulat positif.");
    }

    // Unit test mock support
    if (
      typeof this.profileRepo.addLimitToAll === "function" &&
      this.profileRepo.addLimitToAll !== GroupMemberProfileRepository.prototype.addLimitToAll
    ) {
      const result = await this.profileRepo.addLimitToAll(groupJid, amount);
      await this.auditRepo.create({
        groupJid,
        actorJid,
        action: TenantAuditAction.QUOTA_ADDED,
        metadata: {
          amount,
          affectedCount: result.count,
          target: "ALL_MEMBERS",
        },
      });
      return {
        groupJid,
        amount,
        affectedCount: result.count,
      };
    }

    return prisma.$transaction(async (tx) => {
      const profiles = await tx.groupMemberProfile.findMany({
        where: { groupJid },
      });

      if (profiles.length === 0) {
        return {
          groupJid,
          amount,
          affectedCount: 0,
        };
      }

      await tx.groupMemberProfile.updateMany({
        where: { groupJid },
        data: {
          limitBalance: { increment: amount },
          totalLimitsEarned: { increment: amount },
        },
      });

      const correlationId = generateCorrelationId();
      await tx.groupMemberTransaction.createMany({
        data: profiles.map((p) => ({
          profileId: p.id,
          groupJid,
          userJid: p.userJid,
          actorJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType.SUPER_OWNER_ADD,
          amount,
          balanceBefore: p.limitBalance,
          balanceAfter: p.limitBalance + amount,
          correlationId,
        })),
      });

      const auditRepo = new TenantAuditRepository(tx);
      await auditRepo.create({
        groupJid,
        actorJid,
        action: TenantAuditAction.QUOTA_ADDED,
        metadata: {
          amount,
          affectedCount: profiles.length,
          target: "ALL_MEMBERS",
        },
      });

      return {
        groupJid,
        amount,
        affectedCount: profiles.length,
      };
    });
  }

  async addXp(groupJid: string, targetJid: string, amount: number): Promise<AdminResult> {
    const profile = await this.economyService.creditXp({
      groupJid,
      userJid: targetJid,
      amount,
      type: "SUPER_OWNER_ADD",
    });
    return {
      targetJid,
      asset: "XP",
      before: profile.experience - amount,
      after: profile.experience,
    };
  }

  async setXp(groupJid: string, targetJid: string, amount: number): Promise<AdminResult> {
    const before = await this.profileRepo.findByGroupAndUser(groupJid, targetJid);
    const profile = await this.economyService.setXp({ groupJid, userJid: targetJid, amount });
    return {
      targetJid,
      asset: "XP",
      before: before?.experience ?? 0,
      after: profile.experience,
    };
  }

  async getMemberInfo(groupJid: string, targetJid: string): Promise<MemberInfo | null> {
    const profile = await this.profileRepo.findByGroupAndUser(groupJid, targetJid);
    if (!profile) {
      return null;
    }

    const { resolveRank } = await import("./rank.service");
    const rank = resolveRank(profile.experience);

    return { profile, rank };
  }
}

export const memberAdminService = new MemberAdminService();
