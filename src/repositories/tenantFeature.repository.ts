import type { Prisma, TenantFeatureSetting } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class TenantFeatureRepository {
  constructor(private readonly client: Client = prisma) {}

  findByGroupJid(groupJid: string): Promise<TenantFeatureSetting | null> {
    return this.client.tenantFeatureSetting.findUnique({
      where: { groupJid },
    });
  }

  ensureForGroup(groupJid: string): Promise<TenantFeatureSetting> {
    return this.client.tenantFeatureSetting.upsert({
      where: { groupJid },
      create: { groupJid },
      update: {},
    });
  }

  update(
    groupJid: string,
    data: Prisma.TenantFeatureSettingUpdateInput,
  ): Promise<TenantFeatureSetting> {
    return this.client.tenantFeatureSetting.update({
      where: { groupJid },
      data,
    });
  }
}
