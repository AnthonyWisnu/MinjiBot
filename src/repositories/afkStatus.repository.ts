import type { AfkStatus } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export interface SetAfkStatusInput {
  groupJid: string;
  userJid: string;
  reason: string;
}

export class AfkStatusRepository {
  constructor(private readonly client: Client = prisma) {}

  setAfkStatus(input: SetAfkStatusInput): Promise<AfkStatus> {
    const now = new Date();

    return this.client.afkStatus.upsert({
      where: {
        groupJid_userJid: {
          groupJid: input.groupJid,
          userJid: input.userJid,
        },
      },
      create: {
        groupJid: input.groupJid,
        userJid: input.userJid,
        reason: input.reason,
        startedAt: now,
      },
      update: {
        reason: input.reason,
        startedAt: now,
      },
    });
  }

  getAfkStatus(groupJid: string, userJid: string): Promise<AfkStatus | null> {
    return this.client.afkStatus.findUnique({
      where: {
        groupJid_userJid: {
          groupJid,
          userJid,
        },
      },
    });
  }

  getAfkStatusesByUsers(groupJid: string, userJids: string[]): Promise<AfkStatus[]> {
    if (userJids.length === 0) {
      return Promise.resolve([]);
    }

    return this.client.afkStatus.findMany({
      where: {
        groupJid,
        userJid: {
          in: userJids,
        },
      },
      orderBy: {
        startedAt: "asc",
      },
    });
  }

  async clearAfkStatus(groupJid: string, userJid: string): Promise<AfkStatus | null> {
    const status = await this.getAfkStatus(groupJid, userJid);
    if (!status) {
      return null;
    }

    return this.client.afkStatus.delete({
      where: {
        groupJid_userJid: {
          groupJid,
          userJid,
        },
      },
    });
  }
}
