import type { GroupRedeemCode } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export function parseClaimedJids(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim().length > 0 && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export class GroupRedeemCodeRepository {
  constructor(private readonly client: Client = prisma) {}

  findByGroupAndCode(
    groupJid: string,
    code: string,
    tx?: PrismaTransactionClient,
  ): Promise<GroupRedeemCode | null> {
    const db = tx ?? this.client;
    return db.groupRedeemCode.findUnique({
      where: {
        groupJid_code: {
          groupJid,
          code: code.toUpperCase(),
        },
      },
    });
  }

  listByGroup(groupJid: string, limit = 15): Promise<GroupRedeemCode[]> {
    return this.client.groupRedeemCode.findMany({
      where: { groupJid },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  create(
    data: {
      groupJid: string;
      code: string;
      rewardLimit: number;
      rewardMoney: bigint;
      rewardPoints?: number;
      maxClaims: number;
      createdBy: string;
      expiresAt?: Date | null;
    },
    tx?: PrismaTransactionClient,
  ): Promise<GroupRedeemCode> {
    const db = tx ?? this.client;
    return db.groupRedeemCode.create({
      data: {
        groupJid: data.groupJid,
        code: data.code.toUpperCase(),
        rewardLimit: data.rewardLimit,
        rewardMoney: data.rewardMoney,
        rewardPoints: data.rewardPoints ?? 0,
        maxClaims: data.maxClaims,
        claimedByJids: [],
        createdBy: data.createdBy,
        expiresAt: data.expiresAt ?? null,
      },
    });
  }

  updateClaimedBy(
    id: string,
    claimedByJids: string[],
    tx?: PrismaTransactionClient,
  ): Promise<GroupRedeemCode> {
    const db = tx ?? this.client;
    return db.groupRedeemCode.update({
      where: { id },
      data: {
        claimedByJids,
      },
    });
  }
}

export const groupRedeemCodeRepository = new GroupRedeemCodeRepository();
