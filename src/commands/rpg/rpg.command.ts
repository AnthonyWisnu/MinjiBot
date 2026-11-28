import { identityResolverService } from "../../services/identity/identityResolver.service";
import { cryptoMarketService } from "../../services/rpg/cryptoMarket.service";
import { duelService } from "../../services/rpg/duel.service";
import {
  BANSOS_POVERTY_BONUS,
  rpgEconomyService,
  type RpgJobType,
} from "../../services/rpg/rpgEconomy.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  absBigInt,
  formatCompactRupiah,
  formatRemainingDuration,
  formatRupiah,
  parseBigIntAmountOrAll,
  parsePositiveBigIntMoneyInput,
} from "../../utils/currency";
import { sendEventBannerOrReply } from "../../utils/eventBannerSender";
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

async function resolveTargetMemberJid(context: CommandContext): Promise<string | null> {
  let rawTarget: string | null = null;
  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTarget = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTarget = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args[0]) {
    const raw = context.args[0].replace(/^@/, "").trim();
    if (/^\d{8,15}$/.test(raw)) {
      rawTarget = normalizeUserJid(`${raw}@s.whatsapp.net`);
    }
  }

  if (!rawTarget) {
    return null;
  }

  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    rawTarget,
  );
}

function phoneTag(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

async function handleJob(context: CommandContext, jobType: RpgJobType): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const result = await rpgEconomyService.runJob(context.chatJid, senderJid, jobType);
    const header = result.isRare
      ? `*─── [ ${result.title} • RARE! ] ───*`
      : `*─── [ ${result.title} ] ───*`;

    await context.reply(
      [
        header,
        "",
        `${phoneTag(senderJid)} ${result.story}.`,
        "",
        `• Pendapatan  : +${formatRupiah(result.moneyGained)}`,
        `• XP Didapat  : +${String(result.xpGained)} XP`,
        `• Uang Dompet : ${formatRupiah(result.currentMoney)}`,
      ].join("\n"),
      { mentions: [senderJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjalankan aktivitas RPG."));
  }
}

async function handleCorruption(context: CommandContext, mega: boolean): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const res = await rpgEconomyService.runCorruption(context.chatJid, senderJid, mega);
    const title = mega ? "MEGAKORUPSI GRUP" : "KORUPSI KAS GRUP";

    if (res.success) {
      await context.reply(
        [
          `*─── [ ${title} BERHASIL ] ───*`,
          "",
          `${phoneTag(senderJid)} ${res.story}`,
          "",
          `• Hasil Korupsi : +${formatRupiah(res.amountDelta)}`,
          `• XP Didapat    : +${String(res.xpGained)} XP`,
          `• Dompetmu      : ${formatRupiah(res.currentMoney)}`,
          `• Sisa Kas Grup : ${formatRupiah(res.treasuryBalance)}`,
        ].join("\n"),
        { mentions: [senderJid] },
      );
      return;
    }

    const ottCaption = [
      `*─── [ OTT KPK GRUP ] ───*`,
      "",
      `${phoneTag(senderJid)} ${res.story}`,
      "",
      `• Denda Disita  : -${formatRupiah(absBigInt(res.amountDelta))}`,
      `• Masa Tahanan  : ${String(res.jailMinutes)} menit`,
      `• Sisa Dompet   : ${formatRupiah(res.currentMoney)}`,
      `• Kas Negara    : ${formatRupiah(res.treasuryBalance)}`,
      "",
      "_Pakai .bebaspenjara atau asuransi Pengacara untuk langsung bebas!_",
    ].join("\n");

    const pushOffender = context.message.pushName?.trim();
    const offenderName =
      pushOffender && pushOffender.length > 0 ? pushOffender : (senderJid.split("@")[0] ?? "Tersangka");
    await sendEventBannerOrReply(context, {
      scene: "kpk_ott",
      headline: mega ? "OTT MEGAKORUPSI!" : "DITANGKAP KPK!",
      subjectName: offenderName,
      details: [
        `Denda Disita: -${formatCompactRupiah(absBigInt(res.amountDelta))}`,
        `Tahanan Penjara: ${String(res.jailMinutes)} Menit`,
        `Sisa Dompet: ${formatCompactRupiah(res.currentMoney)}`,
      ],
      targetUserJid: senderJid,
      avatarAltJids: context.senderAltJids,
      caption: ottCaption,
      mentions: [senderJid],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses aksi korupsi."));
  }
}

async function handleTax(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const targetJid = await resolveTargetMemberJid(context);
    if (!targetJid) {
      const treasury = await rpgEconomyService.getGroupTreasury(context.chatJid);
      await context.reply(
        [
          "*─── [ KAS NEGARA GRUP ] ───*",
          "",
          `• Saldo Kas Negara : ${formatRupiah(treasury)}`,
          "",
          "Cara pakai:",
          "• .pajak @user — Tarik pajak kekayaan dari dompet member sultan",
          "• .bansos — Klaim bantuan sosial dari Kas Grup",
          "• .korupsi — Coba tilap Kas Negara (hati-hati KPK!)",
        ].join("\n"),
      );
      return;
    }

    const senderJid = await resolveCanonicalSender(context);
    if (
      isBotUserJid(
        context.socket,
        context.mentionedJids[0],
        context.quoted?.participantJid,
        targetJid,
      )
    ) {
      await context.reply("Bot bebas pajak ya, cari member sultan lain!");
      return;
    }

    const res = await rpgEconomyService.collectTax(context.chatJid, senderJid, targetJid);
    if (!res.success) {
      await context.reply(
        [
          "*─── [ PENAGIHAN PAJAK GAGAL ] ───*",
          "",
          `${phoneTag(targetJid)} ${res.story}`,
        ].join("\n"),
        { mentions: [senderJid, targetJid] },
      );
      return;
    }

    await context.reply(
      [
        "*─── [ TARIK PAJAK SULTAN ] ───*",
        "",
        `Petugas ${phoneTag(senderJid)} memajaki ${phoneTag(targetJid)}!`,
        res.story,
        "",
        `• Total Pajak     : ${formatRupiah(res.taxCollected)}`,
        `• Insentif Kamu   : +${formatRupiah(res.collectorShare)}`,
        `• Masuk Kas Grup  : +${formatRupiah(res.treasuryShare)}`,
        `• Saldo Kas Grup  : ${formatRupiah(res.treasuryBalance)}`,
      ].join("\n"),
      { mentions: [senderJid, targetJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses pajak."));
  }
}

async function handleRob(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const targetJid = await resolveTargetMemberJid(context);
    if (!targetJid) {
      await context.reply("Tag atau reply target yang mau dimailing.\nContoh: .maling @user");
      return;
    }

    const senderJid = await resolveCanonicalSender(context);
    if (
      isBotUserJid(
        context.socket,
        context.mentionedJids[0],
        context.quoted?.participantJid,
        targetJid,
      )
    ) {
      await context.reply("Dompet bot dijaga CCTV 24 jam, tidak bisa dimailing!");
      return;
    }

    const res = await rpgEconomyService.robMember(context.chatJid, senderJid, targetJid);
    if (res.success) {
      await context.reply(
        [
          "*─── [ AKSI MALING SUKSES ] ───*",
          "",
          `${phoneTag(senderJid)} menyikat dompet ${phoneTag(targetJid)}!`,
          res.story,
          "",
          `• Uang Dicuri     : +${formatRupiah(res.amountMoved)}`,
          `• Dompet Maling   : ${formatRupiah(res.thiefMoney)}`,
          `• Dompet Korban   : ${formatRupiah(res.victimMoney)}`,
          "",
          "_Tips: Simpan uangmu di .atm agar aman dari maling!_",
        ].join("\n"),
        { mentions: [senderJid, targetJid] },
      );
      return;
    }

    const arrestCaption = [
      "*─── [ MALING KETANGKAP RONDA ] ───*",
      "",
      `${phoneTag(senderJid)} gagal merampok ${phoneTag(targetJid)}!`,
      res.story,
      "",
      `• Denda Dibayar : -${formatRupiah(res.amountMoved)}`,
      `• Masa Tahanan  : ${String(res.jailMinutes)} menit`,
      `• Sisa Dompet   : ${formatRupiah(res.thiefMoney)}`,
    ].join("\n");

    const pushThief = context.message.pushName?.trim();
    const thiefName =
      pushThief && pushThief.length > 0 ? pushThief : (senderJid.split("@")[0] ?? "Pelaku");
    await sendEventBannerOrReply(context, {
      scene: "penjara_ronda",
      headline: "MALING DITANGKAP!",
      subjectName: thiefName,
      details: [
        `Denda Ronda: -${formatCompactRupiah(res.amountMoved)}`,
        `Masuk Sel: ${String(res.jailMinutes)} Menit`,
        "Bebas cepat: .bebaspenjara",
      ],
      targetUserJid: senderJid,
      avatarAltJids: context.senderAltJids,
      caption: arrestCaption,
      mentions: [senderJid, targetJid],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses aksi maling."));
  }
}

async function handleBansos(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const res = await rpgEconomyService.claimBansos(context.chatJid, senderJid);
    const notes: string[] = [];
    if (res.povertyBonus) {
      notes.push(`Dapat tambahan subsidi warga dompet tipis (+${formatRupiah(BANSOS_POVERTY_BONUS)})!`);
    }
    if (res.wasSkimmed) {
      notes.push("Aduh! Dananya sempat disunat oknum jadi cair setengah saja.");
    }

    await context.reply(
      [
        "*─── [ BANTUAN SOSIAL GRUP ] ───*",
        "",
        `${phoneTag(senderJid)} mencairkan dana bansos!`,
        ...notes,
        "",
        `• Bansos Diterima : +${formatRupiah(res.moneyGained)}`,
        `• Dompet saat ini : ${formatRupiah(res.currentMoney)}`,
        `• Sisa Kas Grup   : ${formatRupiah(res.treasuryBalance)}`,
      ].join("\n"),
      { mentions: [senderJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencairkan bansos."));
  }
}

async function handleCasino(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const parsedBet = parseBigIntAmountOrAll(context.args[0]);
  if (parsedBet === null) {
    await context.reply(
      "Format salah.\nGunakan: .casino <jumlah|all>\nContoh: .casino 500k atau .judi 2jt",
    );
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const res = await rpgEconomyService.playCasino(context.chatJid, senderJid, parsedBet);
    const pSum = res.playerDice[0] + res.playerDice[1];
    const dSum = res.dealerDice[0] + res.dealerDice[1];

    const verdict =
      res.outcome === "jackpot"
        ? `JACKPOT DOUBLE 6! Profit +${formatRupiah(res.netDelta)}`
        : res.outcome === "win"
          ? `MENANG! Profit +${formatRupiah(res.netDelta)}`
          : res.outcome === "draw"
            ? "SERI! Uang taruhan kembali utuh."
            : `KALAH! Taruhan hangus -${formatRupiah(absBigInt(res.netDelta))}`;

    const casinoCaption = [
      "*─── [ MINJI CASINO ] ───*",
      "",
      `• Dadu Kamu   : [${String(res.playerDice[0])}] + [${String(res.playerDice[1])}] = *${String(pSum)}*`,
      `• Dadu Bandar : [${String(res.dealerDice[0])}] + [${String(res.dealerDice[1])}] = *${String(dSum)}*`,
      "",
      `*${verdict}*`,
      `• XP Didapat  : +${String(res.xpGained)} XP`,
      `• Dompetmu    : ${formatRupiah(res.currentMoney)}`,
    ].join("\n");

    if (res.outcome === "jackpot") {
      const pushWinner = context.message.pushName?.trim();
      const winnerName =
        pushWinner && pushWinner.length > 0 ? pushWinner : (senderJid.split("@")[0] ?? "Sultan");
      await sendEventBannerOrReply(context, {
        scene: "jackpot_sultan",
        headline: "JACKPOT DOUBLE 6!",
        subjectName: winnerName,
        details: [
          `Profit: +${formatCompactRupiah(res.netDelta)}`,
          `Dompet: ${formatCompactRupiah(res.currentMoney)}`,
          `Bonus XP: +${String(res.xpGained)} XP`,
        ],
        targetUserJid: senderJid,
        avatarAltJids: context.senderAltJids,
        caption: casinoCaption,
        mentions: [senderJid],
      });
      return;
    }

    await context.reply(casinoCaption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal bermain casino."));
  }
}

async function handleDuel(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const firstArg = (context.args[0] ?? "").toLowerCase();
  if (firstArg === "terima" || firstArg === "acc" || firstArg === "accept") {
    await handleAcceptDuel(context);
    return;
  }
  if (firstArg === "tolak" || firstArg === "batal" || firstArg === "cancel") {
    await handleRejectDuel(context);
    return;
  }

  const targetJid = await resolveTargetMemberJid(context);
  const rawBetArg =
    context.mentionedJids.length > 0
      ? context.args.find((a) => !a.startsWith("@"))
      : context.quoted?.participantJid
        ? context.args[0]
        : context.args[1];
  const betAmount = parsePositiveBigIntMoneyInput(rawBetArg);

  if (!targetJid || betAmount === null) {
    await context.reply(
      "Format salah.\nGunakan: .duel @user <taruhan>\nContoh: .duel @user 1jt\nTerima duel: .terimaduel | Tolak: .tolakduel",
    );
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    if (
      isBotUserJid(
        context.socket,
        context.mentionedJids[0],
        context.quoted?.participantJid,
        targetJid,
      )
    ) {
      await context.reply("Tidak bisa duel melawan bot. Gunakan .casino untuk melawan bandar!");
      return;
    }

    const pending = await duelService.createChallenge(
      context.chatJid,
      senderJid,
      targetJid,
      betAmount,
    );

    await context.reply(
      [
        "*─── [ TANTANGAN DUEL PVP ] ───*",
        "",
        `${phoneTag(pending.challengerJid)} menantang ${phoneTag(pending.opponentJid)} duel taruhan!`,
        `• Taruhan : ${formatRupiah(pending.betAmount)} (Total pot: ${formatRupiah(pending.betAmount * 2n)})`,
        `• Waktu   : 3 menit`,
        "",
        `${phoneTag(pending.opponentJid)} ketik *.terimaduel* untuk menerima atau *.tolakduel* untuk menolak!`,
      ].join("\n"),
      { mentions: [pending.challengerJid, pending.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat tantangan duel."));
  }
}

async function handleAcceptDuel(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const res = await duelService.acceptChallenge(context.chatJid, senderJid);

    await context.reply(
      [
        "*─── [ HASIL DUEL PVP ] ───*",
        "",
        `• ${phoneTag(res.challengerJid)} : kekuatan *${String(res.challengerRoll)}*`,
        `• ${phoneTag(res.opponentJid)} : kekuatan *${String(res.opponentRoll)}*`,
        "",
        `PEMENANG: ${phoneTag(res.winnerJid)} (+${formatRupiah(res.betAmount)} & +60 XP)!`,
        `KALAH: ${phoneTag(res.loserJid)} (-${formatRupiah(res.betAmount)} & +20 XP)`,
        "",
        `• Dompet Pemenang : ${formatRupiah(res.winnerMoney)}`,
      ].join("\n"),
      { mentions: [res.challengerJid, res.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menerima tantangan duel."));
  }
}

async function handleRejectDuel(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const cancelled = duelService.rejectChallenge(context.chatJid, senderJid);
    await context.reply(
      `Tantangan duel antara ${phoneTag(cancelled.challengerJid)} dan ${phoneTag(cancelled.opponentJid)} dibatalkan.`,
      { mentions: [cancelled.challengerJid, cancelled.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membatalkan duel."));
  }
}

async function handleCrypto(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const sub = (context.args[0] ?? "market").toLowerCase();

  try {
    const senderJid = await resolveCanonicalSender(context);

    if (sub === "market" || sub === "harga" || sub === "list") {
      const quotes = cryptoMarketService.getMarketSnapshot();
      const lines = [
        "*─── [ PASAR KRIPTO GRUP ] ───*",
        "_Harga berubah dinamis setiap 5 menit_",
        "",
        ...quotes.map((q) => {
          const arrow = q.changePercent > 0 ? "NAIK" : q.changePercent < 0 ? "TURUN" : "STABIL";
          const sign = q.changePercent > 0 ? "+" : "";
          return `• *${q.symbol}* (${q.name}): ${formatRupiah(q.price)} [${arrow} ${sign}${String(q.changePercent)}%]`;
        }),
        "",
        "Perintah:",
        "• .crypto buy <koin> <unit>  (contoh: .crypto buy MINJI 2)",
        "• .crypto sell <koin> <unit|all>",
        "• .crypto portofolio",
      ];
      await context.reply(lines.join("\n"));
      return;
    }

    if (sub === "portofolio" || sub === "porto" || sub === "aset" || sub === "wallet") {
      const portfolio = await cryptoMarketService.getPortfolio(context.chatJid, senderJid);
      const lines = ["*─── [ PORTOFOLIO KRIPTO ] ───*", ""];
      if (portfolio.items.length === 0) {
        lines.push("Kamu belum memiliki koin kripto.");
        lines.push("Ketik *.crypto market* untuk melihat harga koin saat ini.");
      } else {
        for (const item of portfolio.items) {
          const sign = item.changePercent > 0 ? "+" : "";
          lines.push(
            `• *${item.symbol}*: ${String(item.units)} unit x ${formatRupiah(item.unitPrice)} = *${formatRupiah(item.marketValue)}* (${sign}${String(item.changePercent)}%)`,
          );
        }
        lines.push("");
        lines.push(`• Total Nilai Kripto : *${formatRupiah(portfolio.totalValue)}*`);
      }
      lines.push(`• Uang Dompet        : ${formatRupiah(portfolio.moneyBalance)}`);
      await context.reply(lines.join("\n"));
      return;
    }

    if (sub === "buy" || sub === "beli") {
      const symbol = context.args[1];
      const rawUnits = context.args[2];
      const units = rawUnits ? Number.parseInt(rawUnits, 10) : NaN;
      if (!symbol || !Number.isInteger(units) || units <= 0) {
        await context.reply("Format salah.\nGunakan: .crypto buy <koin> <unit>\nContoh: .crypto buy DOGE 5");
        return;
      }

      const trade = await cryptoMarketService.buyCrypto(context.chatJid, senderJid, symbol, units);
      await context.reply(
        [
          "*─── [ BELI KRIPTO BERHASIL ] ───*",
          "",
          `• Koin        : ${trade.symbol} (${trade.coinName})`,
          `• Dibeli      : ${String(trade.units)} unit @ ${formatRupiah(trade.unitPrice)}`,
          `• Total Bayar : ${formatRupiah(trade.totalMoney)}`,
          `• Kepemilikan : ${String(trade.newHolding)} ${trade.symbol}`,
          `• Sisa Dompet : ${formatRupiah(trade.currentMoney)}`,
        ].join("\n"),
      );
      return;
    }

    if (sub === "sell" || sub === "jual") {
      const symbol = context.args[1];
      const rawUnits = (context.args[2] ?? "").toLowerCase();
      if (!symbol || !rawUnits) {
        await context.reply(
          "Format salah.\nGunakan: .crypto sell <koin> <unit|all>\nContoh: .crypto sell MINJI all",
        );
        return;
      }

      const unitsOrAll =
        rawUnits === "all" || rawUnits === "semua" ? "all" : Number.parseInt(rawUnits, 10);
      if (unitsOrAll !== "all" && (!Number.isInteger(unitsOrAll) || unitsOrAll <= 0)) {
        await context.reply("Jumlah unit jual harus bilangan bulat positif atau 'all'.");
        return;
      }

      const trade = await cryptoMarketService.sellCrypto(
        context.chatJid,
        senderJid,
        symbol,
        unitsOrAll,
      );
      await context.reply(
        [
          "*─── [ JUAL KRIPTO BERHASIL ] ───*",
          "",
          `• Koin          : ${trade.symbol} (${trade.coinName})`,
          `• Dijual        : ${String(trade.units)} unit @ ${formatRupiah(trade.unitPrice)}`,
          `• Hasil Cair    : +${formatRupiah(trade.totalMoney)}`,
          `• Sisa Koin     : ${String(trade.newHolding)} ${trade.symbol}`,
          `• Dompetmu      : ${formatRupiah(trade.currentMoney)}`,
        ].join("\n"),
      );
      return;
    }

    await context.reply(
      "Perintah kripto:\n• .crypto market\n• .crypto buy <koin> <unit>\n• .crypto sell <koin> <unit|all>\n• .crypto portofolio",
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses transaksi kripto."));
  }
}

async function handleCooldown(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const summary = await rpgEconomyService.getCooldownSummary(context.chatJid, senderJid);
    const lines = ["*─── [ STATUS COOLDOWN RPG ] ───*", ""];

    if (summary.jailedRemainingMs > 0) {
      lines.push(
        `Status Penjara KPK/Ronda: Bebas dalam *${formatRemainingDuration(summary.jailedRemainingMs)}*`,
      );
      lines.push("");
    }

    for (const entry of summary.entries) {
      const status =
        entry.remainingMs > 0 ? `Tunggu ${formatRemainingDuration(entry.remainingMs)}` : "SIAP";
      lines.push(`• ${entry.label}: ${status}`);
    }

    await context.reply(lines.join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil status cooldown."));
  }
}

export const rpgCommands: CommandDefinition[] = [
  { name: "mulung", execute: (context) => handleJob(context, "mulung") },
  { name: "kerja", aliases: ["work"], execute: (context) => handleJob(context, "kerja") },
  { name: "ojek", execute: (context) => handleJob(context, "ojek") },
  { name: "nambang", execute: (context) => handleJob(context, "nambang") },
  { name: "berburu", aliases: ["hunt"], execute: (context) => handleJob(context, "berburu") },
  { name: "mancing", aliases: ["kolam"], execute: (context) => handleJob(context, "mancing") },
  { name: "korupsi", execute: (context) => handleCorruption(context, false) },
  { name: "megakorupsi", execute: (context) => handleCorruption(context, true) },
  { name: "pajak", aliases: ["kas"], execute: handleTax },
  { name: "maling", aliases: ["rob", "merampok"], execute: handleRob },
  { name: "bansos", execute: handleBansos },
  { name: "casino", aliases: ["judi"], execute: handleCasino },
  { name: "duel", execute: handleDuel },
  { name: "terimaduel", execute: handleAcceptDuel },
  { name: "tolakduel", execute: handleRejectDuel },
  { name: "crypto", aliases: ["kripto"], execute: handleCrypto },
  { name: "cooldown", aliases: ["cd"], execute: handleCooldown },
];
