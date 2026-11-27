import type { GroupNote } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class GroupNoteRepository {
  constructor(private readonly client: Client = prisma) {}

  findByTitle(groupJid: string, title: string): Promise<GroupNote | null> {
    return this.client.groupNote.findUnique({
      where: {
        groupJid_title: {
          groupJid,
          title: normalizeNoteTitle(title),
        },
      },
    });
  }

  listByGroup(groupJid: string): Promise<GroupNote[]> {
    return this.client.groupNote.findMany({
      where: { groupJid },
      orderBy: { title: "asc" },
    });
  }

  countByGroup(groupJid: string): Promise<number> {
    return this.client.groupNote.count({ where: { groupJid } });
  }

  upsert(groupJid: string, title: string, content: string, createdBy: string): Promise<GroupNote> {
    const cleanTitle = normalizeNoteTitle(title);
    return this.client.groupNote.upsert({
      where: {
        groupJid_title: {
          groupJid,
          title: cleanTitle,
        },
      },
      create: {
        groupJid,
        title: cleanTitle,
        content,
        createdBy,
      },
      update: {
        content,
        createdBy,
      },
    });
  }

  async deleteByTitle(groupJid: string, title: string): Promise<boolean> {
    const res = await this.client.groupNote.deleteMany({
      where: {
        groupJid,
        title: normalizeNoteTitle(title),
      },
    });
    return res.count > 0;
  }
}

export function normalizeNoteTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export const groupNoteRepository = new GroupNoteRepository();
