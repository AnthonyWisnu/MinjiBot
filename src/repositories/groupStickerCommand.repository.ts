import type { GroupStickerCommand } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class GroupStickerCommandRepository {
  constructor(private readonly client: Client = prisma) {}

  findByGroupAndHash(
    groupJid: string,
    stickerHash: string,
  ): Promise<GroupStickerCommand | null> {
    return this.client.groupStickerCommand.findUnique({
      where: {
        groupJid_stickerHash: {
          groupJid,
          stickerHash,
        },
      },
    });
  }

  listByGroup(groupJid: string): Promise<GroupStickerCommand[]> {
    return this.client.groupStickerCommand.findMany({
      where: { groupJid },
      orderBy: { createdAt: "asc" },
    });
  }

  countByGroup(groupJid: string): Promise<number> {
    return this.client.groupStickerCommand.count({
      where: { groupJid },
    });
  }

  upsert(
    groupJid: string,
    stickerHash: string,
    commandText: string,
    createdBy: string,
  ): Promise<GroupStickerCommand> {
    return this.client.groupStickerCommand.upsert({
      where: {
        groupJid_stickerHash: {
          groupJid,
          stickerHash,
        },
      },
      create: {
        groupJid,
        stickerHash,
        commandText,
        createdBy,
      },
      update: {
        commandText,
        createdBy,
      },
    });
  }

  async deleteByGroupAndHash(groupJid: string, stickerHash: string): Promise<boolean> {
    const res = await this.client.groupStickerCommand.deleteMany({
      where: { groupJid, stickerHash },
    });
    return res.count > 0;
  }
}

export const groupStickerCommandRepository = new GroupStickerCommandRepository();
