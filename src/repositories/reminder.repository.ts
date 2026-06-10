import type { Prisma, Reminder } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export interface CreateReminderInput {
  groupJid: string;
  message: string;
  remindAt: Date;
  createdBy: string;
  mentionAll: boolean;
}

export class ReminderRepository {
  constructor(private readonly client: Client = prisma) {}

  create(input: CreateReminderInput): Promise<Reminder> {
    return this.client.reminder.create({
      data: input,
    });
  }

  findById(id: string): Promise<Reminder | null> {
    return this.client.reminder.findUnique({
      where: { id },
    });
  }

  listByGroupJid(groupJid: string): Promise<Reminder[]> {
    return this.client.reminder.findMany({
      where: { groupJid, isSent: false },
      orderBy: { remindAt: "asc" },
    });
  }

  listDue(now = new Date()): Promise<Reminder[]> {
    return this.client.reminder.findMany({
      where: {
        isSent: false,
        remindAt: {
          lte: now,
        },
      },
      orderBy: { remindAt: "asc" },
    });
  }

  markSent(id: string, sentAt = new Date()): Promise<Reminder> {
    return this.client.reminder.update({
      where: { id },
      data: {
        isSent: true,
        sentAt,
      },
    });
  }

  deleteById(id: string): Promise<Reminder> {
    return this.client.reminder.delete({
      where: { id },
    });
  }

  deleteByIdAndGroupJid(id: string, groupJid: string): Promise<Reminder> {
    return this.client.reminder.delete({
      where: { id, groupJid },
    });
  }

  update(id: string, data: Prisma.ReminderUpdateInput): Promise<Reminder> {
    return this.client.reminder.update({
      where: { id },
      data,
    });
  }
}
