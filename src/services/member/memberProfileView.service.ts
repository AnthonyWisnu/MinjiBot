import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { MemberEconomyService } from "./memberEconomy.service";
import { roleGuard } from "../../guards/roleGuard";
import { resolveRank } from "./rank.service";
import { toWibDateKey } from "../../utils/wibDate";

export interface ProfileView {
  profile: GroupMemberProfile;
  rank: string;
  createdAtWib: string;
}

// Minimal interface for DI and testing.
interface ProfileStore {
  findOrCreate(groupJid: string, userJid: string): Promise<GroupMemberProfile>;
  findByGroupAndUser(groupJid: string, userJid: string): Promise<GroupMemberProfile | null>;
}

export class MemberProfileViewService {
  constructor(
    private readonly profileRepo: ProfileStore = new GroupMemberProfileRepository(),
    // economyService used via findOrCreateProfile to keep consistent write path.
    private readonly economyService: Pick<MemberEconomyService, "findOrCreateProfile"> = new MemberEconomyService(),
  ) {}

  /** Caller profile — creates if not exists. */
  async getOwnProfile(groupJid: string, userJid: string): Promise<ProfileView> {
    const profile = await this.economyService.findOrCreateProfile(groupJid, userJid);
    return this.toView(profile);
  }

  /** Target profile — read-only, does NOT create. Returns null if no profile. */
  async getTargetProfile(groupJid: string, targetJid: string): Promise<ProfileView | null> {
    const profile = await this.profileRepo.findByGroupAndUser(groupJid, targetJid);
    if (!profile) return null;
    return this.toView(profile);
  }

  private toView(profile: GroupMemberProfile): ProfileView {
    const isSuperOwner = roleGuard.isSuperOwner(profile.userJid);
    return {
      profile,
      rank: isSuperOwner ? "Immortal [MAX]" : resolveRank(profile.experience),
      createdAtWib: toWibDateKey(profile.createdAt),
    };
  }
}

export const memberProfileViewService = new MemberProfileViewService();
