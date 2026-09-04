import { TenantStatus, type GroupMemberProfile, type Prisma } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

const INITIAL_LIMIT_BALANCE = 10;

export class GroupMemberProfileRepository {
  constructor(private readonly client: Client = prisma) {}

  // Lazy-create: dipanggil saat member pertama kali berinteraksi di grup.
  // Tidak mereset saldo jika profil sudah ada.
  findOrCreate(
    groupJid: string,
    userJid: string,
    tx?: PrismaTransactionClient,
  ): Promise<GroupMemberProfile> {
    const client = tx ?? this.client;

    return client.groupMemberProfile.upsert({
      where: { groupJid_userJid: { groupJid, userJid } },
      create: {
        groupJid,
        userJid,
        limitBalance: INITIAL_LIMIT_BALANCE,
        totalLimitsEarned: INITIAL_LIMIT_BALANCE,
      },
      update: {},
    });
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
          expiresAt: { gt: now },
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

  // Catat aktivitas pesan member (non-blocking)
  async recordActivity(groupJid: string, userJid: string): Promise<void> {
    await this.client.groupMemberProfile.upsert({
      where: { groupJid_userJid: { groupJid, userJid } },
      create: {
        groupJid,
        userJid,
        limitBalance: INITIAL_LIMIT_BALANCE,
        totalLimitsEarned: INITIAL_LIMIT_BALANCE,
        messageCount: 1,
        lastActiveAt: new Date(),
      },
      update: {
        messageCount: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });
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
        OR: [
          { messageCount: 0 },
          { lastActiveAt: { lt: since } },
        ],
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
}
