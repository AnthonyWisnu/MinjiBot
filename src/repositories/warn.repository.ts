import type { GroupMemberWarning, Prisma } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class WarnRepository {
  constructor(private readonly client: Client = prisma) {}

  create(data: Prisma.GroupMemberWarningUncheckedCreateInput): Promise<GroupMemberWarning> {
    return this.client.groupMemberWarning.create({
      data,
    });
  }

  countActiveWarnings(groupJid: string, userJid: string): Promise<number> {
    return this.client.groupMemberWarning.count({
      where: {
        groupJid,
        userJid,
      },
    });
  }

  findWarnings(groupJid: string, userJid: string): Promise<GroupMemberWarning[]> {
    return this.client.groupMemberWarning.findMany({
      where: {
        groupJid,
        userJid,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async removeLatestWarning(groupJid: string, userJid: string): Promise<GroupMemberWarning | null> {
    const latest = await this.client.groupMemberWarning.findFirst({
      where: {
        groupJid,
        userJid,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!latest) {
      return null;
    }

    await this.client.groupMemberWarning.delete({
      where: {
        id: latest.id,
      },
    });

    return latest;
  }

  async resetWarnings(groupJid: string, userJid: string): Promise<number> {
    const result = await this.client.groupMemberWarning.deleteMany({
      where: {
        groupJid,
        userJid,
      },
    });

    return result.count;
  }
}

export const warnRepository = new WarnRepository();
