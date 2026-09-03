import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { MemberEconomyService } from "./memberEconomy.service";

export interface AdminResult {
  targetJid: string;
  asset: string;
  before: number;
  after: number;
}

export interface MemberInfo {
  profile: GroupMemberProfile;
  rank: string;
}

// Minimal profile store interface for finding profiles without creating them.
interface AdminProfileStore {
  findByGroupAndUser(groupJid: string, userJid: string): Promise<GroupMemberProfile | null>;
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
