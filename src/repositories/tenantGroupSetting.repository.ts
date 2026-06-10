import type { Prisma, TenantGroupSetting } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export class TenantGroupSettingRepository {
  constructor(private readonly client: Client = prisma) {}

  findByGroupJid(groupJid: string): Promise<TenantGroupSetting | null> {
    return this.client.tenantGroupSetting.findUnique({
      where: { groupJid },
    });
  }

  ensureForGroup(groupJid: string): Promise<TenantGroupSetting> {
    return this.client.tenantGroupSetting.upsert({
      where: { groupJid },
      create: { groupJid },
      update: {},
    });
  }

  update(
    groupJid: string,
    data: Prisma.TenantGroupSettingUpdateInput,
  ): Promise<TenantGroupSetting> {
    return this.client.tenantGroupSetting.update({
      where: { groupJid },
      data,
    });
  }
}
