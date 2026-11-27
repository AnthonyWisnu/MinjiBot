import type { Prisma, TenantAuditAction, TenantAuditLog } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export interface TenantAuditLogInput {
  groupJid?: string;
  actorJid?: string;
  action: TenantAuditAction;
  metadata?: Prisma.InputJsonValue;
}

export class TenantAuditRepository {
  constructor(private readonly client: Client = prisma) {}

  create(input: TenantAuditLogInput): Promise<TenantAuditLog> {
    return this.client.tenantAuditLog.create({
      data: {
        groupJid: input.groupJid,
        actorJid: input.actorJid,
        action: input.action,
        metadata: input.metadata,
      },
    });
  }

  listByGroupJid(groupJid: string): Promise<TenantAuditLog[]> {
    return this.client.tenantAuditLog.findMany({
      where: { groupJid },
      orderBy: { createdAt: "desc" },
    });
  }

  listByActorJid(actorJid: string): Promise<TenantAuditLog[]> {
    return this.client.tenantAuditLog.findMany({
      where: { actorJid },
      orderBy: { createdAt: "desc" },
    });
  }
}
