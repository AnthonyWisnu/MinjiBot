import { TenantStatus, type GroupMemberProfile, type Prisma } from "@prisma/client";

import { parseRpgState } from "../services/rpg/rpgState";
import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export const INITIAL_LIMIT_BALANCE = 100;
export const INITIAL_MONEY_BALANCE = 500_000n;

export class GroupMemberProfileRepository {
  constructor(private readonly client: Client = prisma) {}

  // Lazy-create: dipanggil saat member pertama kali berinteraksi di grup.
  // Tidak mereset saldo jika profil sudah ada.
  async findOrCreate(
    groupJid: string,
    userJid: string,
    tx?: PrismaTransactionClient,
  ): Promise<GroupMemberProfile> {
    const client = tx ?? this.client;

    try {
      return await client.groupMemberProfile.upsert({
        where: { groupJid_userJid: { groupJid, userJid } },
        create: {
          groupJid,
          userJid,
          limitBalance: INITIAL_LIMIT_BALANCE,
          totalLimitsEarned: INITIAL_LIMIT_BALANCE,
          moneyBalance: INITIAL_MONEY_BALANCE,
          totalMoneyEarned: INITIAL_MONEY_BALANCE,
        },
        update: {},
      });
    } catch (error: unknown) {
      const maybePrismaError = error as { code?: string };
      if (maybePrismaError.code === "P2002") {
        return client.groupMemberProfile.findUniqueOrThrow({
          where: { groupJid_userJid: { groupJid, userJid } },
        });
      }
      throw error;
    }
  }

  // Read-only lookup: tidak membuat profil baru jika belum ada.
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: PrismaTransactionClient,
  ): Promise<GroupMemberProfile | null> {
    const client = tx ?? this.client;

    return client.groupMemberProfile.findUnique({
      where: { groupJid_userJid: { groupJid, userJid } },
    });
  }

  // Untuk private chat resolution: cari semua profil user di semua grup tenant aktif.
  // Urut limitBalance DESC sehingga profil dengan limit terbesar ada di index 0.
  findActiveByUser(userJid: string, now = new Date()): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: {
        userJid,
        tenantGroup: {
          status: TenantStatus.ACTIVE,
          isBlocked: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
      orderBy: { limitBalance: "desc" },
    });
  }

  // Leaderboard XP - untuk .toprank
  listTopByExperience(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: { groupJid },
      orderBy: { experience: "desc" },
      take: limit,
    });
  }

  // Leaderboard poin - untuk .toppoint
  listTopByPoints(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: { groupJid },
      orderBy: { pointsBalance: "desc" },
      take: limit,
    });
  }

  // Leaderboard kekayaan total (Dompet + Bank) - untuk .toprich / .leaderboard
  async listTopByWealth(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    const profiles = await this.client.groupMemberProfile.findMany({
      where: { groupJid },
    });

    return profiles
      .sort((a, b) => {
        const diff = b.moneyBalance + b.bankBalance - (a.moneyBalance + a.bankBalance);
        if (diff > 0n) return 1;
        if (diff < 0n) return -1;
        return 0;
      })
      .slice(0, limit);
  }

  // Posisi caller di leaderboard kekayaan total (1-indexed). 0 jika belum punya profil.
  async getPositionByWealth(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);
    if (!profile) {
      return 0;
    }

    const targetWealth = profile.moneyBalance + profile.bankBalance;
    const profiles = await this.client.groupMemberProfile.findMany({
      where: { groupJid },
      select: { moneyBalance: true, bankBalance: true },
    });

    const countAbove = profiles.filter((p) => p.moneyBalance + p.bankBalance > targetWealth).length;
    return countAbove + 1;
  }

  // Top-up idempotent satu kali untuk member lama yang totalLimitsEarned & limitBalance < minLimit
  async topUpLegacyMembersToMinimumLimit(minLimit = INITIAL_LIMIT_BALANCE): Promise<number> {
    const result = await this.client.groupMemberProfile.updateMany({
      where: {
        totalLimitsEarned: { lt: minLimit },
        limitBalance: { lt: minLimit },
      },
      data: {
        limitBalance: minLimit,
        totalLimitsEarned: minLimit,
      },
    });
    return result.count;
  }

  // Posisi caller di leaderboard XP (1-indexed). Mengembalikan 0 jika profil tidak ditemukan.
  async getPositionByExperience(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);

    if (!profile) {
      return 0;
    }

    const countAbove = await this.client.groupMemberProfile.count({
      where: { groupJid, experience: { gt: profile.experience } },
    });

    return countAbove + 1;
  }

  // Posisi caller di leaderboard poin (1-indexed). Mengembalikan 0 jika profil tidak ditemukan.
  async getPositionByPoints(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);

    if (!profile) {
      return 0;
    }

    const countAbove = await this.client.groupMemberProfile.count({
      where: { groupJid, pointsBalance: { gt: profile.pointsBalance } },
    });

    return countAbove + 1;
  }

  // Update atomik saldo - dipakai oleh service layer di dalam Prisma transaction atau langsung.
  updateBalances(
    id: string,
    data: Prisma.GroupMemberProfileUpdateInput,
    tx?: PrismaTransactionClient,
  ): Promise<GroupMemberProfile> {
    const client = tx ?? this.client;
    return client.groupMemberProfile.update({ where: { id }, data });
  }

  // Tambah limit ke semua member dalam satu grup secara atomik.
  addLimitToAll(
    groupJid: string,
    amount: number,
    tx?: PrismaTransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.client;
    return client.groupMemberProfile.updateMany({
      where: { groupJid },
      data: {
        limitBalance: { increment: amount },
        totalLimitsEarned: { increment: amount },
      },
    });
  }

  // Catat aktivitas pesan member (non-blocking)
  async recordActivity(groupJid: string, userJid: string): Promise<void> {
    await this.recordActivityBatch(groupJid, userJid, 1);
  }

  // Batch recording untuk ActivityBufferService (mengurangi beban SQL)
  async recordActivityBatch(
    groupJid: string,
    userJid: string,
    count: number,
    lastActiveAt: Date = new Date(),
  ): Promise<void> {
    try {
      await this.client.groupMemberProfile.upsert({
        where: { groupJid_userJid: { groupJid, userJid } },
        create: {
          groupJid,
          userJid,
          limitBalance: INITIAL_LIMIT_BALANCE,
          totalLimitsEarned: INITIAL_LIMIT_BALANCE,
          moneyBalance: INITIAL_MONEY_BALANCE,
          totalMoneyEarned: INITIAL_MONEY_BALANCE,
          messageCount: count,
          lastActiveAt,
        },
        update: {
          messageCount: { increment: count },
          lastActiveAt,
        },
      });
    } catch (error: unknown) {
      const maybePrismaError = error as { code?: string };
      if (maybePrismaError.code === "P2002") {
        await this.client.groupMemberProfile.update({
          where: { groupJid_userJid: { groupJid, userJid } },
          data: {
            messageCount: { increment: count },
            lastActiveAt,
          },
        });
      } else {
        throw error;
      }
    }
  }

  // Top aktif chat - untuk .topaktif / .topchat
  listTopByMessageCount(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: { groupJid, messageCount: { gt: 0 } },
      orderBy: { messageCount: "desc" },
      take: limit,
    });
  }

  // Ringkasan aktivitas grup - untuk .stats
  async getGroupActivityStats(groupJid: string): Promise<{
    totalMessages: number;
    activeMembers: number;
    latestActiveAt: Date | null;
  }> {
    const aggregate = await this.client.groupMemberProfile.aggregate({
      where: { groupJid },
      _sum: { messageCount: true },
      _count: { id: true },
      _max: { lastActiveAt: true },
    });

    return {
      totalMessages: aggregate._sum.messageCount ?? 0,
      activeMembers: aggregate._count.id,
      latestActiveAt: aggregate._max.lastActiveAt,
    };
  }

  // Daftar member pasif / sider - untuk .silent
  findInactiveMembers(groupJid: string, since: Date): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: {
        groupJid,
        OR: [{ messageCount: 0 }, { lastActiveAt: { lt: since } }],
      },
      orderBy: { lastActiveAt: "asc" },
    });
  }

  // Daftar user JID yang aktif mengirim pesan sejak tanggal tertentu
  async listActiveUserJidsSince(groupJid: string, since: Date): Promise<string[]> {
    const active = await this.client.groupMemberProfile.findMany({
      where: {
        groupJid,
        messageCount: { gt: 0 },
        lastActiveAt: { gte: since },
      },
      select: { userJid: true },
    });

    return active.map((profile) => profile.userJid);
  }

  // Leaderboard level tertinggi - untuk .toplevel
  listTopByLevel(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: { groupJid },
      orderBy: [{ level: "desc" }, { experience: "desc" }],
      take: limit,
    });
  }

  async getPositionByLevel(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);
    if (!profile) return 0;

    const countAbove = await this.client.groupMemberProfile.count({
      where: {
        groupJid,
        OR: [
          { level: { gt: profile.level } },
          { level: profile.level, experience: { gt: profile.experience } },
        ],
      },
    });
    return countAbove + 1;
  }

  // Leaderboard daily streak - untuk .topstreak
  listTopByStreak(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: { groupJid, longestStreak: { gt: 0 } },
      orderBy: [{ longestStreak: "desc" }, { currentStreak: "desc" }],
      take: limit,
    });
  }

  async getPositionByStreak(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);
    if (!profile || profile.longestStreak <= 0) return 0;

    const countAbove = await this.client.groupMemberProfile.count({
      where: {
        groupJid,
        OR: [
          { longestStreak: { gt: profile.longestStreak } },
          { longestStreak: profile.longestStreak, currentStreak: { gt: profile.currentStreak } },
        ],
      },
    });
    return countAbove + 1;
  }

  // Leaderboard game menang terbanyak - untuk .topmenang
  listTopByGamesWon(groupJid: string, limit = 10): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: { groupJid, totalGamesWon: { gt: 0 } },
      orderBy: [{ totalGamesWon: "desc" }, { experience: "desc" }],
      take: limit,
    });
  }

  async getPositionByGamesWon(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);
    if (!profile || profile.totalGamesWon <= 0) return 0;

    const countAbove = await this.client.groupMemberProfile.count({
      where: { groupJid, totalGamesWon: { gt: profile.totalGamesWon } },
    });
    return countAbove + 1;
  }

  // Leaderboard dermawan (sedekah + danakaget + traktir) - untuk .topdermawan
  async listTopByDonated(
    groupJid: string,
    limit = 10,
  ): Promise<{ profile: GroupMemberProfile; totalDonated: bigint }[]> {
    const profiles = await this.client.groupMemberProfile.findMany({
      where: { groupJid },
    });

    const scored: { profile: GroupMemberProfile; totalDonated: bigint }[] = [];
    for (const profile of profiles) {
      const state = parseRpgState(profile.rpgState);
      const donated = BigInt(state.totalDonated);
      if (donated > 0n) {
        scored.push({ profile, totalDonated: donated });
      }
    }

    scored.sort((a, b) => {
      if (b.totalDonated > a.totalDonated) return 1;
      if (b.totalDonated < a.totalDonated) return -1;
      return 0;
    });
    return scored.slice(0, limit);
  }

  async getPositionByDonated(groupJid: string, userJid: string): Promise<number> {
    const profile = await this.findByGroupAndUser(groupJid, userJid);
    if (!profile) return 0;
    const mine = BigInt(parseRpgState(profile.rpgState).totalDonated);
    if (mine <= 0n) return 0;

    const profiles = await this.client.groupMemberProfile.findMany({
      where: { groupJid },
      select: { rpgState: true },
    });
    let countAbove = 0;
    for (const row of profiles) {
      if (BigInt(parseRpgState(row.rpgState).totalDonated) > mine) {
        countAbove += 1;
      }
    }
    return countAbove + 1;
  }

  // Daftar profil member yang terakhir aktif di grup - untuk .traktir
  listRecentActiveProfiles(
    groupJid: string,
    excludeUserJid: string,
    limit = 10,
  ): Promise<GroupMemberProfile[]> {
    return this.client.groupMemberProfile.findMany({
      where: {
        groupJid,
        userJid: { not: excludeUserJid },
      },
      orderBy: [{ lastActiveAt: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });
  }
}

export const groupMemberProfileRepository = new GroupMemberProfileRepository();
