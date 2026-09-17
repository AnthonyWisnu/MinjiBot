import { TenantAuditAction, type GroupMemberProfile, type Prisma } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { InvalidAmountError } from "../../types/memberEconomy";
import { MemberEconomyService } from "./memberEconomy.service";

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
  setXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
  }): Promise<GroupMemberProfile>;
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
    const profile = await this.economyService.setLimit({ groupJid, userJid: targetJid, amount });
    return {
      targetJid,
      asset: "Limit",
      before: before?.limitBalance ?? 0,
      after: profile.limitBalance,
    };
  }

  async addLimitAll(
    groupJid: string,
    amount: number,
    actorJid: string,
  ): Promise<AddLimitAllResult> {
    if (amount <= 0) {
      throw new InvalidAmountError("Jumlah harus bilangan bulat positif.");
    }

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
