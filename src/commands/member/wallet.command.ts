import { identityResolverService } from "../../services/identity/identityResolver.service";
import { levelService } from "../../services/member/level.service";
import {
  PeriodicCooldownError,
  periodicRewardService,
} from "../../services/member/periodicReward.service";
import {
  EXCHANGE_MONEY_PER_POINT,
  walletBankService,
} from "../../services/member/walletBank.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  InsufficientBankError,
  InsufficientMoneyError,
  InvalidAmountError,
} from "../../types/memberEconomy";
import {
  formatRemainingDuration,
  formatRupiah,
  parseBigIntAmountOrAll,
  parsePositiveBigIntMoneyInput,
  parsePositiveMoneyInput,
} from "../../utils/currency";
import { isBotUserJid, normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

async function ensureActiveGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return false;
  }
  return true;
}

async function resolveCanonicalSender(context: CommandContext): Promise<string> {
  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

async function handleDeposit(context: CommandContext, forceAll = false): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const parsed = forceAll ? "all" : parseBigIntAmountOrAll(context.args[0]);
  if (parsed === null) {
    await context.reply(
      "Format salah.\nGunakan: .atm <jumlah|all> atau .atmall\nContoh: .atm 5jt atau .atm all",
    );
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const result = await walletBankService.depositToBank(context.chatJid, senderJid, parsed);
    await context.reply(
      [
        "*─── [ SETOR BANK / ATM ] ───*",
        "",
        `• Setoran    : ${formatRupiah(result.amount)}`,
        `• Dompet     : ${formatRupiah(result.moneyBalance)}`,
        `• Saldo Bank : ${formatRupiah(result.bankBalance)}`,
        "",
        "_Uang di Bank aman dari maling dan pajak._",
      ].join("\n"),
    );
  } catch (error: unknown) {
    if (error instanceof InsufficientMoneyError || error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply(formatUserSafeError(error, "Gagal menyetor uang ke Bank."));
  }
}

async function handleWithdraw(context: CommandContext, forceAll = false): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const parsed = forceAll ? "all" : parseBigIntAmountOrAll(context.args[0]);
  if (parsed === null) {
    await context.reply(
      "Format salah.\nGunakan: .pull <jumlah|all> atau .pullall\nContoh: .pull 2jt atau .pull all",
    );
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const result = await walletBankService.withdrawFromBank(context.chatJid, senderJid, parsed);
    await context.reply(
      [
        "*─── [ TARIK TUNAI ATM ] ───*",
        "",
        `• Penarikan  : ${formatRupiah(result.amount)}`,
        `• Dompet     : ${formatRupiah(result.moneyBalance)}`,
        `• Saldo Bank : ${formatRupiah(result.bankBalance)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    if (error instanceof InsufficientBankError || error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply(formatUserSafeError(error, "Gagal menarik uang dari Bank."));
  }
}

async function handleTransferMoney(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  let rawTargetJid: string | null = null;
  let rawAmountArg: string | undefined;

  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTargetJid = normalizeUserJid(context.mentionedJids[0]);
    rawAmountArg = context.args.find((arg) => !arg.startsWith("@"));
  } else if (context.quoted?.participantJid) {
    rawTargetJid = normalizeUserJid(context.quoted.participantJid);
    rawAmountArg = context.args[0];
  } else if (context.args.length >= 2 && context.args[0]) {
    const rawNum = context.args[0].replace(/^@/, "").trim();
    if (/^\d{8,15}$/.test(rawNum)) {
      rawTargetJid = normalizeUserJid(`${rawNum}@s.whatsapp.net`);
      rawAmountArg = context.args[1];
    }
  }

  const amount = parsePositiveBigIntMoneyInput(rawAmountArg);
  if (!rawTargetJid || amount === null) {
    await context.reply(
      "Format salah.\nGunakan: .transfer @user <jumlah> (atau reply pesan target: .transfer <jumlah>)\nContoh: .transfer @user 5jt",
    );
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const targetJid = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      rawTargetJid,
    );

    if (isBotUserJid(context.socket, rawTargetJid, targetJid)) {
      await context.reply("Tidak dapat mentransfer uang ke bot.");
      return;
    }

    const result = await walletBankService.transferMoney(
      context.chatJid,
      senderJid,
      targetJid,
      amount,
    );

    const senderPhone = senderJid.split("@")[0] ?? senderJid;
    const targetPhone = targetJid.split("@")[0] ?? targetJid;

    await context.reply(
      [
        "*─── [ TRANSFER UANG BERHASIL ] ───*",
        "",
        `• Pengirim   : @${senderPhone}`,
        `• Penerima   : @${targetPhone}`,
        `• Nominal    : ${formatRupiah(result.amount)}`,
        `• Sisa Dompet: ${formatRupiah(result.senderMoneyBalance)}`,
      ].join("\n"),
      { mentions: [senderJid, targetJid] },
    );
  } catch (error: unknown) {
    if (error instanceof InsufficientMoneyError || error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply(formatUserSafeError(error, "Gagal melakukan transfer uang."));
  }
}

async function handleExchangeMoneyToPoints(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const pointsAmount = parsePositiveMoneyInput(context.args[0]);
  if (pointsAmount === null) {
    await context.reply(
      `Format salah.\nGunakan: .tukar <jumlah poin>\nKurs: ${formatRupiah(EXCHANGE_MONEY_PER_POINT)} = 1 Poin\nContoh: .tukar 100`,
    );
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const result = await walletBankService.exchangeMoneyToPoints(
      context.chatJid,
      senderJid,
      pointsAmount,
    );

    await context.reply(
      [
        "*─── [ TUKAR UANG KE POIN ] ───*",
        "",
        `• Uang dipakai : ${formatRupiah(result.moneySpent)}`,
        `• Poin didapat : +${result.pointsGained.toLocaleString("id-ID")} Poin`,
        `• Sisa Dompet  : ${formatRupiah(result.moneyBalance)}`,
        `• Total Poin   : ${result.pointsBalance.toLocaleString("id-ID")} Poin`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    if (error instanceof InsufficientMoneyError || error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply(formatUserSafeError(error, "Gagal menukar uang ke poin."));
  }
}

async function handlePeriodicReward(
  context: CommandContext,
  period: "weekly" | "monthly",
): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const label = period === "weekly" ? "MINGGUAN" : "BULANAN";

  try {
    const senderJid = await resolveCanonicalSender(context);
    const result =
      period === "weekly"
        ? await periodicRewardService.claimWeekly(context.chatJid, senderJid)
        : await periodicRewardService.claimMonthly(context.chatJid, senderJid);

    await context.reply(
      [
        `*─── [ BONUS ${label} ] ───*`,
        "",
        `• Uang   : +${formatRupiah(result.moneyGained)}`,
        `• Poin   : +${result.pointsGained.toLocaleString("id-ID")} Poin`,
        `• XP     : +${result.xpGained.toLocaleString("id-ID")} XP`,
        `• Limit  : +${String(result.limitGained)} Limit`,
        "",
        `• Dompet saat ini : ${formatRupiah(result.currentMoney)}`,
        `• Poin saat ini   : ${result.currentPoints.toLocaleString("id-ID")}`,
        `• Limit saat ini  : ${String(result.currentLimit)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    if (error instanceof PeriodicCooldownError) {
      const waitStr = formatRemainingDuration(error.remainingMs);
      const periodText = period === "weekly" ? "mingguan" : "bulanan";
      await context.reply(
        `Bonus ${periodText} sudah diambil. Kamu bisa klaim lagi dalam *${waitStr}*.`,
      );
      return;
    }
    await context.reply(formatUserSafeError(error, "Gagal mengambil bonus berkala."));
  }
}

async function handleLevelUp(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const result = await levelService.claimLevelUp(context.chatJid, senderJid);

    if (!result.leveledUp) {
      const needed = Math.max(0, result.nextLevelXp - result.currentXp);
      await context.reply(
        [
          "*─── [ STATUS LEVEL ] ───*",
          "",
          `• Level saat ini : Lv. ${String(result.oldLevel)}`,
          `• XP saat ini    : ${result.currentXp.toLocaleString("id-ID")} / ${result.nextLevelXp.toLocaleString("id-ID")} XP`,
          `• Kurang         : ${needed.toLocaleString("id-ID")} XP lagi untuk Lv. ${String(result.oldLevel + 1)}`,
          "",
          "_Kumpulkan XP dari .daily, .weekly, game, atau aktivitas RPG!_",
        ].join("\n"),
      );
      return;
    }

    const phone = senderJid.split("@")[0] ?? senderJid;
    await context.reply(
      [
        "*─── [ LEVEL UP! ] ───*",
        "",
        `Selamat @${phone}! Naik dari *Lv. ${String(result.oldLevel)}* ke *Lv. ${String(result.newLevel)}* (+${String(result.levelsGained)} level)!`,
        "",
        "Hadiah Naik Level:",
        `• Uang  : +${formatRupiah(result.moneyGained)}`,
        `• Poin  : +${result.pointsGained.toLocaleString("id-ID")} Poin`,
        `• Limit : +${String(result.limitGained)} Limit`,
        "",
        `• Target Lv. ${String(result.newLevel + 1)} : ${result.currentXp.toLocaleString("id-ID")} / ${result.nextLevelXp.toLocaleString("id-ID")} XP`,
      ].join("\n"),
      { mentions: [senderJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses level up."));
  }
}

export const walletCommands: CommandDefinition[] = [
  {
    name: "atm",
    aliases: ["nabung", "setor", "deposit"],
    execute: (context) => handleDeposit(context, false),
  },
  {
    name: "atmall",
    execute: (context) => handleDeposit(context, true),
  },
  {
    name: "pull",
    aliases: ["tarik", "withdraw"],
    execute: (context) => handleWithdraw(context, false),
  },
  {
    name: "pullall",
    execute: (context) => handleWithdraw(context, true),
  },
  {
    name: "transfer",
    aliases: ["tf", "kirimuang"],
    execute: handleTransferMoney,
  },
  {
    name: "tukar",
    aliases: ["tukarpoin", "exchange"],
    execute: handleExchangeMoneyToPoints,
  },
  {
    name: "weekly",
    aliases: ["mingguan"],
    execute: (context) => handlePeriodicReward(context, "weekly"),
  },
  {
    name: "monthly",
    aliases: ["bulanan"],
    execute: (context) => handlePeriodicReward(context, "monthly"),
  },
  {
    name: "levelup",
    aliases: ["lvlup"],
    execute: handleLevelUp,
  },
];
