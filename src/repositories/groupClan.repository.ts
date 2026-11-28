import type { GroupClan } from "@prisma/client";

import { prisma } from "./prismaClient";

export function parseClanMembers(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export class GroupClanRepository {
  findBySlug(groupJid: string, slug: string): Promise<GroupClan | null> {
    return prisma.groupClan.findUnique({
      where: { groupJid_slug: { groupJid, slug } },
    });
  }

  listByGroup(groupJid: string): Promise<GroupClan[]> {
    return prisma.groupClan.findMany({
      where: { groupJid },
      orderBy: [{ treasuryBalance: "desc" }, { createdAt: "asc" }],
    });
  }

  countByGroup(groupJid: string): Promise<number> {
    return prisma.groupClan.count({ where: { groupJid } });
  }

  async findByMember(groupJid: string, userJid: string): Promise<GroupClan | null> {
    const clans = await this.listByGroup(groupJid);
    return clans.find((c) => parseClanMembers(c.memberJids).includes(userJid)) ?? null;
  }

  create(data: {
    groupJid: string;
    name: string;
    slug: string;
    leaderJid: string;
    memberJids: string[];
  }): Promise<GroupClan> {
    return prisma.groupClan.create({
      data: {
        groupJid: data.groupJid,
        name: data.name,
        slug: data.slug,
        leaderJid: data.leaderJid,
        memberJids: data.memberJids,
      },
    });
  }

  update(
    id: string,
    data: {
      leaderJid?: string;
      memberJids?: string[];
      treasuryBalance?: bigint | { increment?: bigint; decrement?: bigint };
      level?: number | { increment: number };
      warWins?: number | { increment: number };
    },
  ): Promise<GroupClan> {
    return prisma.groupClan.update({
      where: { id },
      data: {
        ...(data.leaderJid !== undefined ? { leaderJid: data.leaderJid } : {}),
        ...(data.memberJids !== undefined ? { memberJids: data.memberJids } : {}),
        ...(data.treasuryBalance !== undefined ? { treasuryBalance: data.treasuryBalance } : {}),
        ...(data.level !== undefined ? { level: data.level } : {}),
        ...(data.warWins !== undefined ? { warWins: data.warWins } : {}),
      },
    });
  }

  async deleteById(id: string): Promise<void> {
    await prisma.groupClan.delete({ where: { id } });
  }
}

export const groupClanRepository = new GroupClanRepository();
