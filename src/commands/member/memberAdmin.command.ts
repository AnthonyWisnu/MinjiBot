import type { CommandContext, CommandDefinition } from "../../types/command";
import { InvalidAmountError } from "../../types/memberEconomy";
import { memberAdminService } from "../../services/member/memberAdmin.service";
import type { AdminResult } from "../../services/member/memberAdmin.service";
import { normalizeUserJid } from "../../utils/jid";

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
];
