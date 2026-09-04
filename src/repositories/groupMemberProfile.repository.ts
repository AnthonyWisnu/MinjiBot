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
}
