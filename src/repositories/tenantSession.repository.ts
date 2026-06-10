import type { TenantPrivateSession } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class TenantSessionRepository {
  constructor(private readonly client: Client = prisma) {}

  findByUserJid(userJid: string): Promise<TenantPrivateSession | null> {
    return this.client.tenantPrivateSession.findUnique({
      where: { userJid },
    });
  }

  upsert(userJid: string, groupJid: string, expiresAt?: Date): Promise<TenantPrivateSession> {
    return this.client.tenantPrivateSession.upsert({
      where: { userJid },
      create: {
        userJid,
        groupJid,
        expiresAt,
      },
      update: {
        groupJid,
        expiresAt,
      },
    });
  }

  deleteByUserJid(userJid: string): Promise<TenantPrivateSession> {
    return this.client.tenantPrivateSession.delete({
      where: { userJid },
    });
  }

  clearByUserJid(userJid: string): Promise<{ count: number }> {
    return this.client.tenantPrivateSession.deleteMany({
      where: { userJid },
    });
  }

  deleteExpired(now = new Date()): Promise<{ count: number }> {
    return this.client.tenantPrivateSession.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });
  }
}
