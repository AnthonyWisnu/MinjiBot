import type { TenantAdmin } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class TenantAdminRepository {
  constructor(private readonly client: Client = prisma) {}

  listByGroupJid(groupJid: string): Promise<TenantAdmin[]> {
    return this.client.tenantAdmin.findMany({
      where: { groupJid },
      orderBy: { createdAt: "asc" },
    });
  }

  find(groupJid: string, userJid: string): Promise<TenantAdmin | null> {
    return this.client.tenantAdmin.findUnique({
      where: {
        groupJid_userJid: {
          groupJid,
          userJid,
        },
      },
    });
  }

  async exists(groupJid: string, userJid: string): Promise<boolean> {
    const count = await this.client.tenantAdmin.count({
      where: { groupJid, userJid },
    });

    return count > 0;
  }

  add(groupJid: string, userJid: string, createdBy?: string): Promise<TenantAdmin> {
    return this.client.tenantAdmin.upsert({
      where: {
        groupJid_userJid: {
          groupJid,
          userJid,
        },
      },
      create: {
        groupJid,
        userJid,
        createdBy,
      },
      update: {
        createdBy,
      },
    });
  }

  remove(groupJid: string, userJid: string): Promise<TenantAdmin> {
    return this.client.tenantAdmin.delete({
      where: {
        groupJid_userJid: {
          groupJid,
          userJid,
        },
      },
    });
  }
}
