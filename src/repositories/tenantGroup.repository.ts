import { TenantStatus, type Prisma, type TenantGroup } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export interface CreatePendingTenantGroupInput {
  groupJid: string;
  tenantCode: string;
  name?: string;
}

export interface ActivateTenantGroupInput {
  tenantCode: string;
  ownerJid: string;
  expiresAt: Date;
  actorJid: string;
}

export class TenantGroupRepository {
  constructor(private readonly client: Client = prisma) {}

  findByGroupJid(groupJid: string): Promise<TenantGroup | null> {
    return this.client.tenantGroup.findUnique({
      where: { groupJid },
    });
  }

  findByTenantCode(tenantCode: string): Promise<TenantGroup | null> {
    return this.client.tenantGroup.findUnique({
      where: { tenantCode },
    });
  }

  listPending(): Promise<TenantGroup[]> {
    return this.client.tenantGroup.findMany({
      where: { status: TenantStatus.PENDING },
      orderBy: { createdAt: "asc" },
    });
  }

  listByOwnerJid(ownerJid: string): Promise<TenantGroup[]> {
    return this.client.tenantGroup.findMany({
      where: { ownerJid },
      orderBy: { createdAt: "asc" },
    });
  }

  async ownerExists(ownerJid: string): Promise<boolean> {
    const count = await this.client.tenantGroup.count({
      where: { ownerJid },
    });

    return count > 0;
  }

  listActiveByOwnerJid(ownerJid: string, now = new Date()): Promise<TenantGroup[]> {
    return this.client.tenantGroup.findMany({
      where: {
        ownerJid,
        status: TenantStatus.ACTIVE,
        isBlocked: false,
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: "asc" },
    });
  }

  listAll(): Promise<TenantGroup[]> {
    return this.client.tenantGroup.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  createPending(input: CreatePendingTenantGroupInput): Promise<TenantGroup> {
    return this.client.tenantGroup.create({
      data: {
        groupJid: input.groupJid,
        tenantCode: input.tenantCode,
        name: input.name,
        status: TenantStatus.PENDING,
      },
    });
  }

  updateName(groupJid: string, name: string | null): Promise<TenantGroup> {
    return this.client.tenantGroup.update({
      where: { groupJid },
      data: { name },
    });
  }

  activate(input: ActivateTenantGroupInput): Promise<TenantGroup> {
    const now = new Date();

    return this.client.tenantGroup.update({
      where: { tenantCode: input.tenantCode },
      data: {
        ownerJid: input.ownerJid,
        expiresAt: input.expiresAt,
        status: TenantStatus.ACTIVE,
        isBlocked: false,
        approvedAt: now,
        activatedAt: now,
      },
    });
  }

  updateStatus(tenantCode: string, status: TenantStatus): Promise<TenantGroup> {
    return this.client.tenantGroup.update({
      where: { tenantCode },
      data: { status },
    });
  }

  setExpiresAt(tenantCode: string, expiresAt: Date): Promise<TenantGroup> {
    return this.client.tenantGroup.update({
      where: { tenantCode },
      data: {
        expiresAt,
        status: TenantStatus.ACTIVE,
        isBlocked: false,
      },
    });
  }

  setBlocked(tenantCode: string, blocked: boolean): Promise<TenantGroup> {
    return this.client.tenantGroup.update({
      where: { tenantCode },
      data: {
        isBlocked: blocked,
        status: blocked ? TenantStatus.BLOCKED : TenantStatus.ACTIVE,
      },
    });
  }

  remove(tenantCode: string): Promise<TenantGroup> {
    return this.client.tenantGroup.update({
      where: { tenantCode },
      data: { status: TenantStatus.REMOVED },
    });
  }

  updateByGroupJid(groupJid: string, data: Prisma.TenantGroupUpdateInput): Promise<TenantGroup> {
    return this.client.tenantGroup.update({
      where: { groupJid },
      data,
    });
  }
}
