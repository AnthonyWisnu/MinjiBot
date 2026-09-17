import { TenantStatus } from "@prisma/client";

import { roleGuard } from "../../guards/roleGuard";
import { TenantAdminRepository } from "../../repositories/tenantAdmin.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { InvalidAmountError } from "../../types/memberEconomy";
import { memberAdminService } from "../../services/member/memberAdmin.service";
import type { AdminResult } from "../../services/member/memberAdmin.service";
import { getIdentityCandidateJids, normalizeUserJid } from "../../utils/jid";

const tenantGroupRepository = new TenantGroupRepository();
const tenantAdminRepository = new TenantAdminRepository();

function formatAdminResult(result: AdminResult): string {
  return [
    "Koreksi berhasil.",
    "",
    `Target      : @${normalizeUserJid(result.targetJid).split("@")[0] ?? result.targetJid}`,
    `Aset        : ${result.asset}`,
    `Sebelum     : ${result.before.toLocaleString("id-ID")}`,
    `Sesudah     : ${result.after.toLocaleString("id-ID")}`,
  ].join("\n");
}

function isSuperOwner(context: CommandContext): boolean {
  return context.role === "SUPER_OWNER";
}

function parseTarget(context: CommandContext): string | null {
  return context.mentionedJids[0] ?? null;
}

function parseAmount(context: CommandContext): number | null {
  const raw = context.args.find((arg) => /^\d+$/.test(arg));
  if (!raw) return null;
  return parseInt(raw, 10);
}

async function requireSuperOwnerGroup(context: CommandContext): Promise<boolean> {
  if (!isSuperOwner(context)) {
    await context.reply("Perintah ini hanya bisa digunakan oleh Super Owner.");
    return false;
  }
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return false;
  }
  return true;
}

async function handleAdd(
  context: CommandContext,
  commandName: string,
  fn: (groupJid: string, targetJid: string, amount: number) => Promise<AdminResult>,
): Promise<void> {
  if (!(await requireSuperOwnerGroup(context))) return;

  const target = parseTarget(context);
  if (!target) {
    await context.reply(`Gunakan: .${commandName} @user <jumlah>`);
    return;
  }

  const amount = parseAmount(context);
  if (!amount || amount <= 0) {
    await context.reply("Jumlah harus bilangan bulat positif.");
    return;
  }

  try {
    const result = await fn(context.chatJid, target, amount);
    await context.reply(formatAdminResult(result));
  } catch (error: unknown) {
    if (error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply("Koreksi gagal. Silakan coba lagi.");
  }
}

async function handleSet(
  context: CommandContext,
  commandName: string,
  fn: (groupJid: string, targetJid: string, amount: number) => Promise<AdminResult>,
): Promise<void> {
  if (!(await requireSuperOwnerGroup(context))) return;

  const target = parseTarget(context);
  if (!target) {
    await context.reply(`Gunakan: .${commandName} @user <jumlah>`);
    return;
  }

  // set accepts 0, so check for digit pattern including "0"
  const rawArg = context.args.find((arg) => /^\d+$/.test(arg));
  if (rawArg === undefined) {
    await context.reply("Jumlah tidak valid. Gunakan angka 0 atau lebih.");
    return;
  }

  const amount = parseInt(rawArg, 10);

  try {
    const result = await fn(context.chatJid, target, amount);
    await context.reply(formatAdminResult(result));
  } catch (error: unknown) {
    if (error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply("Koreksi gagal. Silakan coba lagi.");
  }
}

async function handleMemberInfo(context: CommandContext): Promise<void> {
  if (!(await requireSuperOwnerGroup(context))) return;

  const target = parseTarget(context);
  if (!target) {
    await context.reply("Gunakan: .memberinfo @user");
    return;
  }

  const info = await memberAdminService.getMemberInfo(context.chatJid, target);
  if (!info) {
    await context.reply("Member belum memiliki profil di grup ini.");
    return;
  }

  const { profile, rank } = info;
  const winRate =
    profile.totalGamesPlayed > 0
      ? `${String(profile.totalGamesWon)} / ${String(profile.totalGamesPlayed)}`
      : "0 / 0";

  await context.reply(
    [
      `Info member: @${normalizeUserJid(target).split("@")[0] ?? target}`,
      "",
      `Poin    : ${profile.pointsBalance.toLocaleString("id-ID")}`,
      `Limit   : ${String(profile.limitBalance)}`,
      `XP      : ${profile.experience.toLocaleString("id-ID")}`,
      `Rank    : ${rank}`,
      `Streak  : ${String(profile.currentStreak)} hari`,
      `Menang  : ${winRate} game`,
    ].join("\n"),
  );
}

export interface HandleAddLimitAllDeps {
  tenantGroupRepo?: TenantGroupRepository;
  tenantAdminRepo?: TenantAdminRepository;
  adminService?: typeof memberAdminService;
}

export async function handleAddLimitAll(
  context: CommandContext,
  deps: HandleAddLimitAllDeps = {},
): Promise<void> {
  const tenantGroupRepo = deps.tenantGroupRepo ?? tenantGroupRepository;
  const tenantAdminRepo = deps.tenantAdminRepo ?? tenantAdminRepository;
  const adminService = deps.adminService ?? memberAdminService;

  let tenantCode: string | null = null;
  let amountStr: string | null = null;

  if (!context.isGroup) {
    if (context.args.length < 2) {
      await context.reply(
        "Format command salah.\nGunakan: .addlimitall <kode grup> <jumlah>\nContoh: .addlimitall ABC 10",
      );
      return;
    }
    tenantCode = (context.args[0] ?? "").trim().toUpperCase();
    amountStr = (context.args[1] ?? "").trim();
  } else {
    if (context.args.length === 1) {
      amountStr = (context.args[0] ?? "").trim();
    } else if (context.args.length >= 2) {
      tenantCode = (context.args[0] ?? "").trim().toUpperCase();
      amountStr = (context.args[1] ?? "").trim();
    } else {
      await context.reply(
        "Format command salah.\nGunakan: .addlimitall <jumlah> atau .addlimitall <kode grup> <jumlah>\nContoh: .addlimitall 10",
      );
      return;
    }
  }

  if (!amountStr || !/^\d+$/.test(amountStr)) {
    await context.reply("Jumlah limit harus berupa bilangan bulat positif.");
    return;
  }

  const amount = parseInt(amountStr, 10);
  if (amount < 1 || amount > 100) {
    await context.reply("Jumlah limit harus antara 1 sampai 100.");
    return;
  }

  let targetTenant = null;
  if (tenantCode) {
    targetTenant = await tenantGroupRepo.findByTenantCode(tenantCode);
    if (!targetTenant) {
      await context.reply(`Tenant dengan kode "${tenantCode}" tidak ditemukan.`);
      return;
    }
  } else {
    targetTenant = context.tenantGroup ?? (await tenantGroupRepo.findByGroupJid(context.chatJid));
    if (!targetTenant) {
      await context.reply("Grup ini belum terdaftar sebagai tenant.");
      return;
    }
  }

  if (targetTenant.status === TenantStatus.REMOVED) {
    await context.reply("Grup ini sudah dihapus dari sistem tenant.");
    return;
  }

  const senderJids = getIdentityCandidateJids(context.senderUserJid, context.senderAltJids);
  const isSuperOwner =
    context.role === "SUPER_OWNER" || senderJids.some((jid) => roleGuard.isSuperOwner(jid));

  let isTenantOwner = false;
  if (targetTenant.ownerJid) {
    const normalizedOwner = normalizeUserJid(targetTenant.ownerJid);
    isTenantOwner = senderJids.some((jid) => normalizeUserJid(jid) === normalizedOwner);
  }

  let isTenantAdmin = false;
  if (!isSuperOwner && !isTenantOwner) {
    for (const jid of senderJids) {
      const exists = await tenantAdminRepo.exists(targetTenant.groupJid, jid);
      if (exists) {
        isTenantAdmin = true;
        break;
      }
    }
  }

  if (!isSuperOwner && !isTenantOwner && !isTenantAdmin) {
    await context.reply("Kamu tidak memiliki izin untuk menambah limit di grup ini.");
    return;
  }

  try {
    const result = await adminService.addLimitAll(
      targetTenant.groupJid,
      amount,
      context.senderUserJid,
    );

    if (result.affectedCount === 0) {
      await context.reply(
        `Grup ${targetTenant.name ? `"${targetTenant.name}"` : targetTenant.tenantCode} belum memiliki member aktif terdaftar.`,
      );
      return;
    }

    const groupName = targetTenant.name ?? "-";
    const lines = [
      "Limit berhasil ditambahkan ke semua member.",
      "",
      `Grup         : ${groupName}`,
      `Kode Grup    : ${targetTenant.tenantCode}`,
      `Tambahan     : +${String(amount)} limit`,
      `Total Member : ${String(result.affectedCount)} member`,
    ];

    await context.reply(lines.join("\n"));
  } catch (error: unknown) {
    if (error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply("Gagal menambahkan limit ke semua member. Silakan coba lagi.");
  }
}

export const memberAdminCommands: CommandDefinition[] = [
  {
    name: "addpoint",
    execute: (ctx) =>
      handleAdd(ctx, "addpoint", (g, t, a) => memberAdminService.addPoints(g, t, a)),
  },
  {
    name: "setpoint",
    execute: (ctx) =>
      handleSet(ctx, "setpoint", (g, t, a) => memberAdminService.setPoints(g, t, a)),
  },
  {
    name: "addlimit",
    execute: (ctx) =>
      handleAdd(ctx, "addlimit", (g, t, a) => memberAdminService.addLimit(g, t, a)),
  },
  {
    name: "setlimit",
    execute: (ctx) =>
      handleSet(ctx, "setlimit", (g, t, a) => memberAdminService.setLimit(g, t, a)),
  },
  {
    name: "addxp",
    execute: (ctx) =>
      handleAdd(ctx, "addxp", (g, t, a) => memberAdminService.addXp(g, t, a)),
  },
  {
    name: "setxp",
    execute: (ctx) =>
      handleSet(ctx, "setxp", (g, t, a) => memberAdminService.setXp(g, t, a)),
  },
  {
    name: "memberinfo",
    execute: handleMemberInfo,
  },
  {
    name: "addlimitall",
    aliases: ["givelimitall", "tambahlimitall"],
    execute: handleAddLimitAll,
  },
];
