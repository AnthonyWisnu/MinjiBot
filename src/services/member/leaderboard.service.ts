import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { resolveRank } from "./rank.service";
import { normalizeUserJid } from "../../utils/jid";

const TOP_N = 10;

export interface LeaderboardEntry {
  position: number;
  userJid: string;
  displayName: string;
  value: number;
  rank: string;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  /** Caller position if outside top N, or null if caller has no profile. */
  callerPosition: number | null;
}

// Minimal repository interface for DI and testing.
interface LeaderboardStore {
  listTopByExperience(groupJid: string, limit: number): Promise<GroupMemberProfile[]>;
  listTopByPoints(groupJid: string, limit: number): Promise<GroupMemberProfile[]>;
  getPositionByExperience(groupJid: string, userJid: string): Promise<number>;
  getPositionByPoints(groupJid: string, userJid: string): Promise<number>;
}

export class LeaderboardService {
  constructor(
    private readonly profileRepo: LeaderboardStore = new GroupMemberProfileRepository(),
  ) {}

  async getTopRank(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const top = await this.profileRepo.listTopByExperience(groupJid, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.experience));

    const callerInTop = top.some((p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid));
    let callerPosition: number | null = null;

    if (!callerInTop) {
      const pos = await this.profileRepo.getPositionByExperience(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }

    return { entries, callerPosition };
  }

  async getTopPoint(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const top = await this.profileRepo.listTopByPoints(groupJid, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.pointsBalance));

    const callerInTop = top.some((p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid));
    let callerPosition: number | null = null;

    if (!callerInTop) {
      const pos = await this.profileRepo.getPositionByPoints(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }

    return { entries, callerPosition };
  }

  private toEntry(position: number, profile: GroupMemberProfile, value: number): LeaderboardEntry {
    // Display name: extract phone number from JID as fallback.
    const normalized = normalizeUserJid(profile.userJid);
    const displayName = normalized.split("@")[0] ?? normalized;

    return {
      position,
      userJid: profile.userJid,
      displayName,
      value,
      rank: resolveRank(profile.experience),
    };
  }
}

export const leaderboardService = new LeaderboardService();
