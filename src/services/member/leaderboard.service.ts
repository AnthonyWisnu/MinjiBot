import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { resolveRank } from "./rank.service";
import { roleGuard } from "../../guards/roleGuard";
import { normalizeUserJid } from "../../utils/jid";

const TOP_N = 10;

export interface LeaderboardEntry {
  position: number;
  userJid: string;
  displayName: string;
  value: number | bigint;
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
  listTopByWealth?(groupJid: string, limit: number): Promise<GroupMemberProfile[]>;
  getPositionByWealth?(groupJid: string, userJid: string): Promise<number>;
  listTopByLevel?(groupJid: string, limit: number): Promise<GroupMemberProfile[]>;
  getPositionByLevel?(groupJid: string, userJid: string): Promise<number>;
  listTopByStreak?(groupJid: string, limit: number): Promise<GroupMemberProfile[]>;
  getPositionByStreak?(groupJid: string, userJid: string): Promise<number>;
  listTopByGamesWon?(groupJid: string, limit: number): Promise<GroupMemberProfile[]>;
  getPositionByGamesWon?(groupJid: string, userJid: string): Promise<number>;
  listTopByDonated?(
    groupJid: string,
    limit: number,
  ): Promise<{ profile: GroupMemberProfile; totalDonated: bigint }[]>;
  getPositionByDonated?(groupJid: string, userJid: string): Promise<number>;
}

export class LeaderboardService {
  constructor(
    private readonly profileRepo: LeaderboardStore = new GroupMemberProfileRepository(),
  ) {}

  async getTopRank(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const rawTop = await this.profileRepo.listTopByExperience(groupJid, TOP_N + 5);
    const top = rawTop.filter((p) => !roleGuard.isSuperOwner(p.userJid)).slice(0, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.experience));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;

    if (!callerInTop && !isCallerSuperOwner) {
      const pos = await this.profileRepo.getPositionByExperience(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }

    return { entries, callerPosition };
  }

  async getTopPoint(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const rawTop = await this.profileRepo.listTopByPoints(groupJid, TOP_N + 5);
    const top = rawTop.filter((p) => !roleGuard.isSuperOwner(p.userJid)).slice(0, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.pointsBalance));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;

    if (!callerInTop && !isCallerSuperOwner) {
      const pos = await this.profileRepo.getPositionByPoints(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }

    return { entries, callerPosition };
  }

  async getTopWealth(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const listFn = this.profileRepo.listTopByWealth?.bind(this.profileRepo);
    const posFn = this.profileRepo.getPositionByWealth?.bind(this.profileRepo);
    const rawTop = listFn ? await listFn(groupJid, TOP_N + 5) : [];
    const top = rawTop.filter((p) => !roleGuard.isSuperOwner(p.userJid)).slice(0, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.moneyBalance + p.bankBalance));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;

    if (!callerInTop && !isCallerSuperOwner && posFn) {
      const pos = await posFn(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }

    return { entries, callerPosition };
  }

  async getTopLevel(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const listFn = this.profileRepo.listTopByLevel?.bind(this.profileRepo);
    const posFn = this.profileRepo.getPositionByLevel?.bind(this.profileRepo);
    const rawTop = listFn ? await listFn(groupJid, TOP_N + 5) : [];
    const top = rawTop.filter((p) => !roleGuard.isSuperOwner(p.userJid)).slice(0, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, Math.max(1, p.level)));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;
    if (!callerInTop && !isCallerSuperOwner && posFn) {
      const pos = await posFn(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }
    return { entries, callerPosition };
  }

  async getTopStreak(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const listFn = this.profileRepo.listTopByStreak?.bind(this.profileRepo);
    const posFn = this.profileRepo.getPositionByStreak?.bind(this.profileRepo);
    const rawTop = listFn ? await listFn(groupJid, TOP_N + 5) : [];
    const top = rawTop.filter((p) => !roleGuard.isSuperOwner(p.userJid)).slice(0, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.longestStreak));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;
    if (!callerInTop && !isCallerSuperOwner && posFn) {
      const pos = await posFn(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }
    return { entries, callerPosition };
  }

  async getTopGamesWon(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const listFn = this.profileRepo.listTopByGamesWon?.bind(this.profileRepo);
    const posFn = this.profileRepo.getPositionByGamesWon?.bind(this.profileRepo);
    const rawTop = listFn ? await listFn(groupJid, TOP_N + 5) : [];
    const top = rawTop.filter((p) => !roleGuard.isSuperOwner(p.userJid)).slice(0, TOP_N);
    const entries = top.map((p, i) => this.toEntry(i + 1, p, p.totalGamesWon));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (p) => normalizeUserJid(p.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;
    if (!callerInTop && !isCallerSuperOwner && posFn) {
      const pos = await posFn(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }
    return { entries, callerPosition };
  }

  async getTopDonated(groupJid: string, callerJid: string): Promise<LeaderboardResult> {
    const listFn = this.profileRepo.listTopByDonated?.bind(this.profileRepo);
    const posFn = this.profileRepo.getPositionByDonated?.bind(this.profileRepo);
    const rawTop = listFn ? await listFn(groupJid, TOP_N + 5) : [];
    const top = rawTop.filter((r) => !roleGuard.isSuperOwner(r.profile.userJid)).slice(0, TOP_N);
    const entries = top.map((r, i) => this.toEntry(i + 1, r.profile, r.totalDonated));

    const isCallerSuperOwner = roleGuard.isSuperOwner(callerJid);
    const callerInTop = top.some(
      (r) => normalizeUserJid(r.profile.userJid) === normalizeUserJid(callerJid),
    );
    let callerPosition: number | null = null;
    if (!callerInTop && !isCallerSuperOwner && posFn) {
      const pos = await posFn(groupJid, callerJid);
      callerPosition = pos > 0 ? pos : null;
    }
    return { entries, callerPosition };
  }

  private toEntry(
    position: number,
    profile: GroupMemberProfile,
    value: number | bigint,
  ): LeaderboardEntry {
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
