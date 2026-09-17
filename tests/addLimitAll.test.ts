import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantAuditAction, TenantStatus, type TenantGroup } from "@prisma/client";

import { MemberAdminService } from "../src/services/member/memberAdmin.service";
import { handleAddLimitAll } from "../src/commands/member/memberAdmin.command";
import { InvalidAmountError } from "../src/types/memberEconomy";
import type { CommandContext } from "../src/types/command";
import type { TenantGroupRepository } from "../src/repositories/tenantGroup.repository";
import type { TenantAdminRepository } from "../src/repositories/tenantAdmin.repository";

void test("MemberAdminService: addLimitAll throws InvalidAmountError if amount is not positive", async () => {
  const service = new MemberAdminService(
    {} as never,
    {
      findByGroupAndUser: () => Promise.resolve(null),
      addLimitToAll: () => Promise.resolve({ count: 0 }),
    },
    { create: () => Promise.resolve({}) },
  );

  await assert.rejects(
    () => service.addLimitAll("123@g.us", 0, "admin@s.whatsapp.net"),
    InvalidAmountError,
  );
  await assert.rejects(
    () => service.addLimitAll("123@g.us", -5, "admin@s.whatsapp.net"),
    InvalidAmountError,
  );
});

void test("MemberAdminService: addLimitAll updates profiles and records audit log", async () => {
  let addLimitCalledWith: { groupJid: string; amount: number } | null = null;
  let auditRecordedWith: unknown = null;

  const service = new MemberAdminService(
    {} as never,
    {
      findByGroupAndUser: () => Promise.resolve(null),
      addLimitToAll: (groupJid, amount) => {
        addLimitCalledWith = { groupJid, amount };
        return Promise.resolve({ count: 15 });
      },
    },
    {
      create: (input) => {
        auditRecordedWith = input;
        return Promise.resolve({});
      },
    },
  );

  const result = await service.addLimitAll("test-group@g.us", 20, "owner@s.whatsapp.net");

  assert.deepEqual(result, {
    groupJid: "test-group@g.us",
    amount: 20,
    affectedCount: 15,
  });
  assert.deepEqual(addLimitCalledWith, {
    groupJid: "test-group@g.us",
    amount: 20,
  });
  assert.deepEqual(auditRecordedWith, {
    groupJid: "test-group@g.us",
    actorJid: "owner@s.whatsapp.net",
    action: TenantAuditAction.QUOTA_ADDED,
    metadata: {
      amount: 20,
      affectedCount: 15,
      target: "ALL_MEMBERS",
    },
  });
});

function createMockContext(overrides: Partial<CommandContext> = {}): {
  context: CommandContext;
  replies: string[];
} {
  const replies: string[] = [];
  const context = {
    socket: {} as never,
    message: {} as never,
    chatJid: "user@s.whatsapp.net",
    senderJid: "user@s.whatsapp.net",
    senderUserJid: "user@s.whatsapp.net",
    senderAltJids: [],
    isGroup: false,
    commandName: "addlimitall",
    args: [],
    argsText: "",
    text: ".addlimitall",
    mentionedJids: [],
    role: "MEMBER",
    reply: (msg: string) => {
      replies.push(msg);
      return Promise.resolve();
    },
    ...overrides,
  } as CommandContext;

  return { context, replies };
}

function createMockTenant(overrides: Partial<TenantGroup> = {}): TenantGroup {
  return {
    id: "tenant-1",
    groupJid: "group-1@g.us",
    tenantCode: "GRP1",
    name: "Komunitas Alpha",
    ownerJid: "owner@s.whatsapp.net",
    status: TenantStatus.ACTIVE,
    isBlocked: false,
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

void test("handleAddLimitAll: private chat requires code and amount", async () => {
  const { context, replies } = createMockContext({
    isGroup: false,
    args: ["GRP1"],
  });

  await handleAddLimitAll(context);

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /Format command salah/);
  assert.match(replies[0]!, /\.addlimitall <kode grup> <jumlah>/);
});

void test("handleAddLimitAll: validates amount must be positive integer between 1 and 100", async () => {
  const { context: ctxInvalid, replies: repliesInvalid } = createMockContext({
    isGroup: false,
    args: ["GRP1", "abc"],
  });
  await handleAddLimitAll(ctxInvalid);
  assert.match(repliesInvalid[0]!, /Jumlah limit harus berupa bilangan bulat positif/);

  const { context: ctxOutOfRange, replies: repliesOutOfRange } = createMockContext({
    isGroup: false,
    args: ["GRP1", "150"],
  });
  await handleAddLimitAll(ctxOutOfRange);
  assert.match(repliesOutOfRange[0]!, /Jumlah limit harus antara 1 sampai 100/);
});

void test("handleAddLimitAll: rejects if tenant is not found", async () => {
  const { context, replies } = createMockContext({
    isGroup: false,
    args: ["UNKNOWN", "10"],
  });

  const mockTenantRepo = {
    findByTenantCode: () => Promise.resolve(null),
    findByGroupJid: () => Promise.resolve(null),
  } as unknown as TenantGroupRepository;

  await handleAddLimitAll(context, { tenantGroupRepo: mockTenantRepo });

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /Tenant dengan kode "UNKNOWN" tidak ditemukan/);
});

void test("handleAddLimitAll: rejects if caller lacks permission", async () => {
  const tenant = createMockTenant({ ownerJid: "another_owner@s.whatsapp.net" });
  const { context, replies } = createMockContext({
    isGroup: false,
    senderUserJid: "stranger@s.whatsapp.net",
    role: "MEMBER",
    args: ["GRP1", "10"],
  });

  const mockTenantRepo = {
    findByTenantCode: () => Promise.resolve(tenant),
  } as unknown as TenantGroupRepository;

  const mockAdminRepo = {
    exists: () => Promise.resolve(false),
  } as unknown as TenantAdminRepository;

  await handleAddLimitAll(context, {
    tenantGroupRepo: mockTenantRepo,
    tenantAdminRepo: mockAdminRepo,
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /Kamu tidak memiliki izin/);
});

void test("handleAddLimitAll: allows Super Owner in private chat", async () => {
  const tenant = createMockTenant();
  const { context, replies } = createMockContext({
    isGroup: false,
    senderUserJid: "super_owner@s.whatsapp.net",
    role: "SUPER_OWNER",
    args: ["GRP1", "25"],
  });

  const mockTenantRepo = {
    findByTenantCode: () => Promise.resolve(tenant),
  } as unknown as TenantGroupRepository;

  const mockAdminService = {
    addLimitAll: () => Promise.resolve({ groupJid: tenant.groupJid, amount: 25, affectedCount: 12 }),
  } as unknown as MemberAdminService;

  await handleAddLimitAll(context, {
    tenantGroupRepo: mockTenantRepo,
    adminService: mockAdminService,
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /Limit berhasil ditambahkan ke semua member/);
  assert.match(replies[0]!, /Grup\s+:\s+Komunitas Alpha/);
  assert.match(replies[0]!, /Kode Grup\s+:\s+GRP1/);
  assert.match(replies[0]!, /\+25 limit/);
  assert.match(replies[0]!, /12 member/);
});

void test("handleAddLimitAll: allows Tenant Owner in private chat for own group", async () => {
  const tenant = createMockTenant({ ownerJid: "owner@s.whatsapp.net" });
  const { context, replies } = createMockContext({
    isGroup: false,
    senderUserJid: "owner@s.whatsapp.net",
    role: "TENANT_OWNER",
    args: ["GRP1", "15"],
  });

  const mockTenantRepo = {
    findByTenantCode: () => Promise.resolve(tenant),
  } as unknown as TenantGroupRepository;

  const mockAdminService = {
    addLimitAll: () => Promise.resolve({ groupJid: tenant.groupJid, amount: 15, affectedCount: 8 }),
  } as unknown as MemberAdminService;

  await handleAddLimitAll(context, {
    tenantGroupRepo: mockTenantRepo,
    adminService: mockAdminService,
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /Limit berhasil ditambahkan ke semua member/);
  assert.match(replies[0]!, /\+15 limit/);
  assert.match(replies[0]!, /8 member/);
});

void test("handleAddLimitAll: works in group chat with single amount argument", async () => {
  const tenant = createMockTenant({
    groupJid: "group-123@g.us",
    ownerJid: "owner@s.whatsapp.net",
  });
  const { context, replies } = createMockContext({
    isGroup: true,
    chatJid: "group-123@g.us",
    senderUserJid: "owner@s.whatsapp.net",
    role: "TENANT_OWNER",
    tenantGroup: tenant,
    args: ["10"],
  });

  const mockAdminService = {
    addLimitAll: () => Promise.resolve({ groupJid: tenant.groupJid, amount: 10, affectedCount: 5 }),
  } as unknown as MemberAdminService;

  await handleAddLimitAll(context, {
    adminService: mockAdminService,
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /Limit berhasil ditambahkan ke semua member/);
  assert.match(replies[0]!, /\+10 limit/);
  assert.match(replies[0]!, /5 member/);
});

void test("handleAddLimitAll: informs if 0 members were affected", async () => {
  const tenant = createMockTenant();
  const { context, replies } = createMockContext({
    isGroup: false,
    senderUserJid: "owner@s.whatsapp.net",
    role: "TENANT_OWNER",
    args: ["GRP1", "10"],
  });

  const mockTenantRepo = {
    findByTenantCode: () => Promise.resolve(tenant),
  } as unknown as TenantGroupRepository;

  const mockAdminService = {
    addLimitAll: () => Promise.resolve({ groupJid: tenant.groupJid, amount: 10, affectedCount: 0 }),
  } as unknown as MemberAdminService;

  await handleAddLimitAll(context, {
    tenantGroupRepo: mockTenantRepo,
    adminService: mockAdminService,
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /belum memiliki member aktif terdaftar/);
});
