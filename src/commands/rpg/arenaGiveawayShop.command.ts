import { identityResolverService } from "../../services/identity/identityResolver.service";
import { sendLiveEditedText } from "../../services/group/baileysNative.service";
import {
  ARENA_MAX_BET,
  ARENA_MIN_BET,
  arenaGiveawayShopService,
  LOTTERY_BASE_SEED_POOL,
  LOTTERY_MAX_TICKETS_PER_USER,
  LOTTERY_TICKET_PRICE,
  PET_ARENA_MIN_BET,
  POINT_DUEL_MIN_BET,
  POINT_SHOP_CRATE_PRICES,
  POINT_SHOP_XP_PER_POINT,
  SEDEKAH_MIN_AMOUNT,
  type CockfightSide,
  type ColorWheelChoice,
  type PointShopCrateKey,
} from "../../services/rpg/arenaGiveawayShop.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  absBigInt,
  formatCompactRupiah,
  formatRupiah,
  parsePositiveBigIntMoneyInput,
} from "../../utils/currency";
import { sendEventBannerOrReply } from "../../utils/eventBannerSender";
import { isBotUserJid, normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

async function ensureActiveGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di dalam grup aktif.");
    return false;
  }
  return true;
}

async function resolveSender(context: CommandContext): Promise<string> {
  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

async function resolveTargetMember(context: CommandContext): Promise<string | null> {
  let rawTarget: string | null = null;
  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTarget = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTarget = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args[0]) {
    const cleaned = context.args[0].replace(/^@/, "").trim();
    if (/^\d{8,15}$/.test(cleaned)) {
      rawTarget = normalizeUserJid(`${cleaned}@s.whatsapp.net`);
    }
  }
  if (!rawTarget) return null;
  return identityResolverService.resolveCanonicalUserJid(context.socket, context.chatJid, rawTarget);
}

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

function getDisplayName(context: CommandContext, jid: string): string {
  const push = context.message.pushName?.trim();
  if (push && push.length > 0) return push;
  return jid.split("@")[0] ?? "Sultan";
}

function isAdminRole(context: CommandContext): boolean {
  return (
    context.role === "SUPER_OWNER" ||
    context.role === "TENANT_OWNER" ||
    context.role === "TENANT_ADMIN"
  );
}

// ======================== 1. DANA KAGET, POIN KAGET & TRAKTIR ========================

async function handleDanaKaget(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const amount = parsePositiveBigIntMoneyInput(context.args[0]);
  const quota = context.args[1] ? Number.parseInt(context.args[1], 10) : NaN;
  if (!amount || !Number.isInteger(quota)) {
    await context.reply(
      "Format: .danakaget <uang> <kuota>\nContoh: .danakaget 10jt 5\nAnggota lain rebutan pakai *.ambilkaget*!",
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const drop = await arenaGiveawayShopService.createDanaKaget(
      context.chatJid,
      sender,
      amount,
      quota,
    );

    const caption = [
      "*── [ DANA KAGET SULTAN! ] ──*",
      `Donatur : ${tagOf(sender)}`,
      `Total   : *${formatRupiah(drop.totalAmount)}*`,
      `Kuota   : *${String(drop.totalQuota)} orang* (nominal acak!)`,
      "Masa    : 30 menit",
      "",
      "Cepat ketik *.ambilkaget* sebelum habis!",
    ].join("\n");

    await sendEventBannerOrReply(context, {
      scene: "dana_kaget",
      headline: "DANA KAGET DIBUKA!",
      subjectName: getDisplayName(context, sender),
      details: [
        `Total Hadiah: ${formatCompactRupiah(drop.totalAmount)}`,
        `Kuota: ${String(drop.totalQuota)} Penerima Tercepat`,
        "Ketik .ambilkaget sekarang!",
      ],
      targetUserJid: sender,
      avatarAltJids: context.senderAltJids,
      caption,
      mentions: [sender],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat Dana Kaget."));
  }
}

async function handleAmbilKaget(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.claimDanaKaget(context.chatJid, sender);
    const tail = res.finished
      ? "Dana Kaget telah *HABIS TERBAGI*! Terima kasih untuk donaturnya!"
      : `Sisa Kuota: *${String(res.remainingQuota)}/${String(res.totalQuota)}* (Sisa ${formatCompactRupiah(res.remainingAmount)})`;

    await context.reply(
      [
        "*── [ KLAIM DANA KAGET ] ──*",
        `${tagOf(sender)} berhasil merebut amplop dari ${tagOf(res.creatorJid)}!`,
        `Diterima : *+${formatRupiah(res.amountWon)}* (+${String(res.xpGained)} XP)`,
        `Dompet   : ${formatRupiah(res.currentMoney)}`,
        tail,
      ].join("\n"),
      { mentions: [sender, res.creatorJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil Dana Kaget."));
  }
}

async function handlePoinKaget(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const totalPoints = context.args[0] ? Number.parseInt(context.args[0], 10) : NaN;
  const quota = context.args[1] ? Number.parseInt(context.args[1], 10) : NaN;
  if (!Number.isInteger(totalPoints) || !Number.isInteger(quota)) {
    await context.reply(
      "Format: .poinkaget <poin> <kuota>\nContoh: .poinkaget 300 5\nAnggota lain rebutan pakai *.ambilpoin*!",
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const drop = await arenaGiveawayShopService.createPoinKaget(
      context.chatJid,
      sender,
      totalPoints,
      quota,
    );

    const caption = [
      "*── [ POIN KAGET GRUP! ] ──*",
      `Donatur : ${tagOf(sender)}`,
      `Total   : *${drop.totalPoints.toLocaleString("id-ID")} Poin*`,
      `Kuota   : *${String(drop.totalQuota)} orang*`,
      "Masa    : 30 menit",
      "",
      "Cepat ketik *.ambilpoin* sebelum ludes!",
    ].join("\n");

    await sendEventBannerOrReply(context, {
      scene: "dana_kaget",
      headline: "POIN KAGET DIBUKA!",
      subjectName: getDisplayName(context, sender),
      details: [
        `Total: ${drop.totalPoints.toLocaleString("id-ID")} Poin Game`,
        `Kuota: ${String(drop.totalQuota)} Penerima Tercepat`,
        "Ketik .ambilpoin sekarang!",
      ],
      targetUserJid: sender,
      avatarAltJids: context.senderAltJids,
      caption,
      mentions: [sender],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat Poin Kaget."));
  }
}

async function handleAmbilPoin(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.claimPoinKaget(context.chatJid, sender);
    const tail = res.finished
      ? "Poin Kaget sudah *HABIS TERBAGI*!"
      : `Sisa Kuota: *${String(res.remainingQuota)}/${String(res.totalQuota)}* (Sisa ${res.remainingPoints.toLocaleString("id-ID")} Poin)`;

    await context.reply(
      [
        "*── [ KLAIM POIN KAGET ] ──*",
        `${tagOf(sender)} kebagian poin dari ${tagOf(res.creatorJid)}!`,
        `Diterima  : *+${res.pointsWon.toLocaleString("id-ID")} Poin* (+${String(res.xpGained)} XP)`,
        `Saldo Poin: ${res.currentPoints.toLocaleString("id-ID")} Poin`,
        tail,
      ].join("\n"),
      { mentions: [sender, res.creatorJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil Poin Kaget."));
  }
}

async function handleTraktir(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const amount = parsePositiveBigIntMoneyInput(context.args[0]);
  if (!amount) {
    await context.reply("Format: .traktir <uang>\nContoh: .traktir 20jt\nMembagi uang ke hingga 10 member aktif terakhir!");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.treatActiveMembers(context.chatJid, sender, amount);
    const recipientTags = res.recipients.map((j) => tagOf(j)).join(", ");
    const caption = [
      "*── [ TRAKTIRAN SULTAN! ] ──*",
      `Traktir oleh : ${tagOf(sender)} (+${String(res.xpGained)} XP)`,
      `Total Keluar : ${formatRupiah(res.totalSpent)}`,
      `Per Member   : *+${formatRupiah(res.shareEach)}* (${String(res.recipients.length)} orang)`,
      `Penerima     : ${recipientTags}`,
      `Sisa Dompet  : ${formatRupiah(res.currentMoney)}`,
    ].join("\n");

    await sendEventBannerOrReply(context, {
      scene: "dana_kaget",
      headline: "TRAKTIRAN SULTAN!",
      subjectName: getDisplayName(context, sender),
      details: [
        `Total Traktir: ${formatCompactRupiah(res.totalSpent)}`,
        `Dibagi ke ${String(res.recipients.length)} Member Aktif`,
        `Masing-masing: +${formatCompactRupiah(res.shareEach)}`,
      ],
      targetUserJid: sender,
      avatarAltJids: context.senderAltJids,
      caption,
      mentions: [sender, ...res.recipients],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses traktiran grup."));
  }
}

// ======================== 2. LOTERE JACKPOT GRUP ========================

async function handleLotere(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const state = await arenaGiveawayShopService.loadLotteryOverview(context.chatJid);
  const uniqueBuyers = new Set(state.tickets.map((t) => t.userJid)).size;
  const ticketList =
    state.tickets.length > 0
      ? state.tickets
          .slice(0, 15)
          .map((t) => `${tagOf(t.userJid)} [*${String(t.number).padStart(2, "0")}*]`)
          .join(", ")
      : "Belum ada tiket terjual di ronde ini.";
  const mentions = Array.from(new Set(state.tickets.slice(0, 15).map((t) => t.userJid)));

  const lastInfo =
    state.lastWinningNumber !== null
      ? `Undian Terakhir: Angka *${String(state.lastWinningNumber).padStart(2, "0")}* (${state.lastOutcome ?? "-"})`
      : "Belum ada riwayat undian.";

  await context.reply(
    [
      `*── [ LOTERE GRUP #${String(state.roundNumber)} ] ──*`,
      `Jackpot Pool : *${formatRupiah(state.jackpotPool)}*`,
      `Harga Tiket  : ${formatRupiah(LOTTERY_TICKET_PRICE)} (Maks ${String(LOTTERY_MAX_TICKETS_PER_USER)}/orang)`,
      `Terjual      : ${String(state.tickets.length)} tiket (${String(uniqueBuyers)} peserta)`,
      `Peserta      : ${ticketList}`,
      lastInfo,
      "",
      "Beli tiket : *.belitiket <00-99>*",
      "Undi angka : *.undilotere* (min 2 tiket)",
      "_Tebakan tepat = 100% Jackpot! Jarak <=5 = 25% Hiburan + 75% Rollover!_",
    ].join("\n"),
    { mentions },
  );
}

async function handleBeliTiket(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const raw = context.args[0];
  if (!raw || !/^\d{1,2}$/.test(raw.trim())) {
    await context.reply("Format: .belitiket <00-99>\nContoh: .belitiket 07 atau .belitiket 88");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const num = Number.parseInt(raw.trim(), 10);
    const res = await arenaGiveawayShopService.buyLotteryTicket(context.chatJid, sender, num);
    await context.reply(
      [
        `*── [ TIKET LOTERE #${String(res.roundNumber)} ] ──*`,
        `Pembeli      : ${tagOf(sender)}`,
        `Nomor Tiket  : *[ ${String(res.number).padStart(2, "0")} ]* (${String(res.userTicketCount)}/${String(LOTTERY_MAX_TICKETS_PER_USER)})`,
        `Harga        : -${formatRupiah(res.pricePaid)}`,
        `Jackpot Pool : *${formatRupiah(res.jackpotPool)}* (${String(res.totalTickets)} tiket)`,
        `Sisa Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli tiket lotere."));
  }
}

async function handleUndiLotere(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.drawLottery(
      context.chatJid,
      sender,
      isAdminRole(context),
    );
    const numStr = String(res.winningNumber).padStart(2, "0");
    const winnerMentions = Array.from(new Set(res.winners.map((w) => w.userJid)));

    if (res.outcome === "jackpot" && res.winners.length > 0) {
      const winnerLines = res.winners.map(
        (w) => `- ${tagOf(w.userJid)} [No. ${String(w.ticketNumber).padStart(2, "0")}]: *+${formatRupiah(w.payout)}* (+60 XP)`,
      );
      const caption = [
        `*── [ JACKPOT LOTERE #${String(res.roundNumber)}!! ] ──*`,
        `Angka Keluar : *[ ${numStr} ]*`,
        "",
        "*PEMENANG JACKPOT UTAMA:*",
        ...winnerLines,
        "",
        `Pool Ronde Berikutnya: ${formatRupiah(res.nextJackpotPool)}`,
      ].join("\n");

      const topWinner = res.winners[0];
      await sendEventBannerOrReply(context, {
        scene: "jackpot_sultan",
        headline: `JACKPOT LOTERE [${numStr}]!`,
        subjectName: topWinner ? (topWinner.userJid.split("@")[0] ?? "Sultan") : "Pemenang",
        details: [
          `Total Cair: ${formatCompactRupiah(res.totalPaid)}`,
          `Pemenang: ${String(res.winners.length)} Tiket Tepat`,
          `Ronde #${String(res.roundNumber)} Selesai`,
        ],
        targetUserJid: topWinner?.userJid ?? sender,
        caption,
        mentions: winnerMentions,
      });
      return;
    }

    if (res.outcome === "consolation" && res.winners.length > 0) {
      const winnerLines = res.winners.map(
        (w) => `- ${tagOf(w.userJid)} [No. ${String(w.ticketNumber).padStart(2, "0")}]: *+${formatRupiah(w.payout)}* (+24 XP)`,
      );
      await context.reply(
        [
          `*── [ HASIL LOTERE #${String(res.roundNumber)} ] ──*`,
          `Angka Keluar : *[ ${numStr} ]*`,
          "Belum ada yang tepat, tapi ada tiket terdekat (jarak <= 5)!",
          "",
          "*Pemenang Hiburan (25% Pool):*",
          ...winnerLines,
          "",
          `Rollover Ronde #${String(res.roundNumber + 1)}: *${formatRupiah(res.nextJackpotPool)}*`,
        ].join("\n"),
        { mentions: winnerMentions },
      );
      return;
    }

    await context.reply(
      [
        `*── [ HASIL LOTERE #${String(res.roundNumber)} ] ──*`,
        `Angka Keluar : *[ ${numStr} ]*`,
        "Tidak ada tiket tepat maupun mendekati (<= 5)!",
        "",
        `100% Pool Rollover ke Ronde #${String(res.roundNumber + 1)}: *${formatRupiah(res.nextJackpotPool)}*`,
        "Beli tiket lagi dengan *.belitiket <00-99>*!",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengundi lotere."));
  }
}

async function handleJackpot(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const state = await arenaGiveawayShopService.loadLotteryOverview(context.chatJid);
  const lastWinnersText =
    state.lastWinners.length > 0
      ? `${state.lastWinners.map((j) => tagOf(j)).join(", ")} (${formatCompactRupiah(state.lastPayoutEach)})`
      : "Belum ada pemenang";

  await context.reply(
    [
      "*── [ POOL JACKPOT GRUP ] ──*",
      `Ronde Aktif   : #${String(state.roundNumber)}`,
      `Total Jackpot : *${formatRupiah(state.jackpotPool)}*`,
      `Seed Awal     : ${formatCompactRupiah(LOTTERY_BASE_SEED_POOL)} (+ rollover tak terbatas!)`,
      `Tiket Terjual : ${String(state.tickets.length)} tiket`,
      `Pemenang Lalu : ${lastWinnersText}`,
      "",
      "Ikut berebut jackpot: *.belitiket <00-99>*",
    ].join("\n"),
    { mentions: state.lastWinners },
  );
}

// ======================== 3. ARENA TARUHAN CEPAT ========================

async function handleRace(context: CommandContext, kind: "kuda" | "siput"): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const lane = context.args[0] ? Number.parseInt(context.args[0], 10) : NaN;
  const bet = parsePositiveBigIntMoneyInput(context.args[1]);
  if (!Number.isInteger(lane) || lane < 1 || lane > 5 || !bet) {
    await context.reply(
      `Format: .balap${kind} <1-5> <taruhan>\nContoh: .balap${kind} 3 500k\nTaruhan: ${formatCompactRupiah(ARENA_MIN_BET)} - ${formatCompactRupiah(ARENA_MAX_BET)} | Menang = +2.8x Profit!`,
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.playRace(context.chatJid, sender, kind, lane, bet);
    const icon = kind === "kuda" ? "🐎" : "🐌";
    const trackLines = res.lanes.map((l) => {
      const bar = "=".repeat(l.progress) + icon + " ".repeat(Math.max(0, 10 - l.progress));
      const mark = l.lane === res.winnerLane ? " [JUARA]" : l.lane === res.pickedLane ? " [PILIHANMU]" : "";
      return `${String(l.lane)}. [${bar}] ${l.name}${mark}`;
    });

    const title = kind === "kuda" ? "BALAP KUDA SULTAN" : "BALAP SIPUT TURBO";
    const verdict = res.won
      ? `MENANG! Profit *+${formatRupiah(res.netDelta)}* (+${String(res.xpGained)} XP)`
      : `KALAH! Taruhan hangus *-${formatRupiah(absBigInt(res.netDelta))}* (+${String(res.xpGained)} XP)`;

    const midTrackLines = res.lanes.map((l) => {
      const half = Math.max(1, Math.min(8, Math.floor(l.progress / 2)));
      const bar = "=".repeat(half) + icon + " ".repeat(Math.max(0, 10 - half));
      const mark = l.lane === res.pickedLane ? " [PILIHANMU]" : "";
      return `${String(l.lane)}. [${bar}] ${l.name}${mark}`;
    });

    const finalBoard = [
      `*── [ ${title} ] ──*`,
      ...trackLines,
      "",
      `Juara   : Lintasan #${String(res.winnerLane)}`,
      `Hasil   : ${verdict}`,
      `Dompet  : ${formatRupiah(res.currentMoney)}`,
    ].join("\n");

    await sendLiveEditedText(
      context,
      [
        `*── [ ${title} - START! ] ──*\n${res.lanes.map((l) => `${String(l.lane)}. [${icon}          ] ${l.name}`).join("\n")}\n\n_Lintasan dimulai..._`,
        `*── [ ${title} - TENGAH LOMBA! ] ──*\n${midTrackLines.join("\n")}\n\n_Saling salip menuju garis finish..._`,
      ],
      finalBoard,
      550,
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, `Gagal menjalankan balap ${kind}.`));
  }
}

async function handleAduAyam(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  let side: CockfightSide = "merah";
  let betArg = context.args[0];

  const firstLower = (context.args[0] ?? "").trim().toLowerCase();
  if (firstLower === "merah" || firstLower === "putih") {
    side = firstLower;
    betArg = context.args[1];
  }

  const bet = parsePositiveBigIntMoneyInput(betArg);
  if (!bet) {
    await context.reply(
      "Format: .aduayam [merah|putih] <taruhan>\nContoh: .aduayam merah 1jt atau .aduayam 1jt",
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.playCockfight(context.chatJid, sender, side, bet);
    const verdict = res.won
      ? `MENANG! Profit *+${formatRupiah(res.netDelta)}* (+${String(res.xpGained)} XP)`
      : `KALAH! Taruhan hangus *-${formatRupiah(absBigInt(res.netDelta))}* (+${String(res.xpGained)} XP)`;

    await context.reply(
      [
        "*── [ ARENA ADU AYAM ] ──*",
        `Jagoanmu : Jago *${res.pickedSide.toUpperCase()}*`,
        `Pemenang : Jago *${res.winnerSide.toUpperCase()}*`,
        res.story,
        "",
        `Hasil    : ${verdict}`,
        `Dompet   : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses adu ayam."));
  }
}

async function handleTebakWarna(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawColor = (context.args[0] ?? "").trim().toLowerCase();
  const bet = parsePositiveBigIntMoneyInput(context.args[1]);
  const validColors: readonly ColorWheelChoice[] = ["merah", "biru", "hijau", "emas"];
  if (!validColors.includes(rawColor as ColorWheelChoice) || !bet) {
    await context.reply(
      [
        "Format: .tebakwarna <merah|biru|hijau|emas> <taruhan>",
        "Contoh: .tebakwarna emas 500k",
        "Payout: merah/biru (+0.8x) | hijau (+1.5x) | emas (+5x JACKPOT!)",
      ].join("\n"),
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.playColorWheel(
      context.chatJid,
      sender,
      rawColor as ColorWheelChoice,
      bet,
    );
    const verdict = res.won
      ? `TEPAT! Profit *+${formatRupiah(res.netDelta)}* (+${String(res.xpGained)} XP)`
      : `MELESET! Taruhan hangus *-${formatRupiah(absBigInt(res.netDelta))}* (+${String(res.xpGained)} XP)`;

    const caption = [
      "*── [ RODA TEBAK WARNA ] ──*",
      `Pilihanmu : *${res.pickedColor.toUpperCase()}*`,
      `Hasil     : *${res.landedColor.toUpperCase()}*`,
      `Status    : ${verdict}`,
      `Dompet    : ${formatRupiah(res.currentMoney)}`,
    ].join("\n");

    if (res.isJackpotGold) {
      await sendEventBannerOrReply(context, {
        scene: "jackpot_sultan",
        headline: "JACKPOT WARNA EMAS 6X!",
        subjectName: getDisplayName(context, sender),
        details: [
          `Profit: +${formatCompactRupiah(res.netDelta)}`,
          `Dompet: ${formatCompactRupiah(res.currentMoney)}`,
          `Bonus XP: +${String(res.xpGained)} XP`,
        ],
        targetUserJid: sender,
        avatarAltJids: context.senderAltJids,
        caption,
        mentions: [sender],
      });
      return;
    }

    await context.reply(caption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memutar roda tebak warna."));
  }
}

// ======================== 4. DUEL POIN & SABUNG PET ========================

async function handleDuelPoin(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const targetJid = await resolveTargetMember(context);
  const rawPtsArg =
    context.mentionedJids.length > 0
      ? context.args.find((a) => !a.startsWith("@"))
      : context.quoted?.participantJid
        ? context.args[0]
        : context.args[1];
  const betPoints = rawPtsArg ? Number.parseInt(rawPtsArg, 10) : NaN;

  if (!targetJid || !Number.isInteger(betPoints)) {
    await context.reply(
      `Format: .duelpoin @user <poin>\nContoh: .duelpoin @teman 100 (min ${String(POINT_DUEL_MIN_BET)} Poin)\nTerima: .terimaduelpoin | Tolak: .tolakduelpoin`,
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    if (
      isBotUserJid(
        context.socket,
        context.mentionedJids[0],
        context.quoted?.participantJid,
        targetJid,
      )
    ) {
      await context.reply("Tidak bisa duel poin melawan bot! Tag member lain di grup.");
      return;
    }

    const pending = await arenaGiveawayShopService.createPointDuel(
      context.chatJid,
      sender,
      targetJid,
      betPoints,
    );
    await context.reply(
      [
        "*── [ TANTANGAN DUEL POIN ] ──*",
        `${tagOf(pending.challengerJid)} menantang ${tagOf(pending.opponentJid)} adu nasib!`,
        `Taruhan : *${pending.betPoints.toLocaleString("id-ID")} Poin*`,
        "Waktu   : 3 menit",
        "",
        `${tagOf(pending.opponentJid)} ketik *.terimaduelpoin* atau *.tolakduelpoin*!`,
      ].join("\n"),
      { mentions: [pending.challengerJid, pending.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat tantangan duel poin."));
  }
}

async function handleTerimaDuelPoin(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.acceptPointDuel(context.chatJid, sender);
    await context.reply(
      [
        "*── [ HASIL DUEL POIN ] ──*",
        `- ${tagOf(res.challengerJid)} : skor *${String(res.challengerRoll)}*`,
        `- ${tagOf(res.opponentJid)} : skor *${String(res.opponentRoll)}*`,
        "",
        `PEMENANG : ${tagOf(res.winnerJid)} (+${res.betPoints.toLocaleString("id-ID")} Poin & +${String(res.winnerXp)} XP)`,
        `KALAH    : ${tagOf(res.loserJid)} (-${res.betPoints.toLocaleString("id-ID")} Poin & +${String(res.loserXp)} XP)`,
        `Poin Pemenang: ${res.winnerPoints.toLocaleString("id-ID")} Poin`,
      ].join("\n"),
      { mentions: [res.challengerJid, res.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menerima duel poin."));
  }
}

async function handleTolakDuelPoin(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const cancelled = arenaGiveawayShopService.rejectPointDuel(context.chatJid, sender);
    await context.reply(
      `Tantangan duel poin antara ${tagOf(cancelled.challengerJid)} dan ${tagOf(cancelled.opponentJid)} dibatalkan.`,
      { mentions: [cancelled.challengerJid, cancelled.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membatalkan duel poin."));
  }
}

async function handleSabungPet(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const targetJid = await resolveTargetMember(context);
  const rawBetArg =
    context.mentionedJids.length > 0
      ? context.args.find((a) => !a.startsWith("@"))
      : context.quoted?.participantJid
        ? context.args[0]
        : context.args[1];
  const bet = parsePositiveBigIntMoneyInput(rawBetArg);

  if (!targetJid || !bet) {
    await context.reply(
      `Format: .sabungpet @user <taruhan>\nContoh: .sabungpet @teman 2jt (min ${formatCompactRupiah(PET_ARENA_MIN_BET)})\nKedua pemain wajib punya Pet di *.kandang*!`,
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    if (
      isBotUserJid(
        context.socket,
        context.mentionedJids[0],
        context.quoted?.participantJid,
        targetJid,
      )
    ) {
      await context.reply("Pet milik bot terlalu OP untuk dilawan! Tantang pet milik teman grupmu.");
      return;
    }

    const res = await arenaGiveawayShopService.fightPetArena(
      context.chatJid,
      sender,
      targetJid,
      bet,
    );
    const lvlUpNote = res.winnerPetLeveledUp
      ? ` (*NAIK KE LV.${String(res.winnerPetNewLevel)}!*)`
      : "";

    await context.reply(
      [
        "*── [ ARENA SABUNG PET ] ──*",
        `${tagOf(res.challengerJid)} : *${res.challengerPet.label}* Lv.${String(res.challengerPet.level)} (Power ${String(res.challengerPet.power)})`,
        `${tagOf(res.opponentJid)} : *${res.opponentPet.label}* Lv.${String(res.opponentPet.level)} (Power ${String(res.opponentPet.power)})`,
        "",
        `JUARA : ${tagOf(res.winnerJid)} (+${formatRupiah(res.bet)} & +30 XP)`,
        `Pet Menang: +${String(res.winnerPetExpGained)} Pet EXP${lvlUpNote}`,
        `Dompet Juara: ${formatRupiah(res.winnerMoney)}`,
      ].join("\n"),
      { mentions: [res.challengerJid, res.opponentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjalankan sabung pet."));
  }
}

// ======================== 5. TOKO POIN & SEDEKAH ========================

async function handleTokoPoin(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  await context.reply(
    [
      "*── [ TOKO TUKAR POIN ] ──*",
      "Tukar Poin Game kamu jadi Limit, XP, atau Peti Gacha!",
      "",
      "1. *Beli Limit Bot* -> *.buy <jumlah>* (1.000 Poin / Limit)",
      `2. *Beli XP Instan*  -> *.belixp <poin>* (1 Poin = ${String(POINT_SHOP_XP_PER_POINT)} XP)`,
      "3. *Beli Peti Gacha* -> *.belikotak <common|uncommon|mythic> [qty]*",
      `   - common   : ${String(POINT_SHOP_CRATE_PRICES.common)} Poin`,
      `   - uncommon : ${String(POINT_SHOP_CRATE_PRICES.uncommon)} Poin`,
      `   - mythic   : ${String(POINT_SHOP_CRATE_PRICES.mythic)} Poin`,
      "",
      "Butuh Poin? Main game (.kuis, .daily, .shift, .duelpoin) atau tukar uang lewat *.tukar <poin>*!",
    ].join("\n"),
  );
}

async function handleBeliXp(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const pts = context.args[0] ? Number.parseInt(context.args[0], 10) : NaN;
  if (!Number.isInteger(pts)) {
    await context.reply(
      `Format: .belixp <poin>\nContoh: .belixp 100 (dapat ${String(100 * POINT_SHOP_XP_PER_POINT)} XP)`,
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.buyXpWithPoints(context.chatJid, sender, pts);
    await context.reply(
      [
        "*── [ BELI XP BERHASIL ] ──*",
        `Pembeli    : ${tagOf(sender)}`,
        `Poin Dipakai: -${res.pointsSpent.toLocaleString("id-ID")} Poin`,
        `XP Didapat : *+${res.xpGained.toLocaleString("id-ID")} XP*`,
        `Sisa Poin  : ${res.currentPoints.toLocaleString("id-ID")} Poin`,
        `Total XP   : ${res.currentXp.toLocaleString("id-ID")} XP (Cek *.levelup*!)`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli XP dengan poin."));
  }
}

async function handleBeliKotak(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawArg = (context.args[0] ?? "").trim().toLowerCase();
  if (!rawArg) {
    await context.reply(
      [
        "Format: .belikotak <common|uncommon|mythic> [jumlah]",
        `Harga: common (${String(POINT_SHOP_CRATE_PRICES.common)} Poin) | uncommon (${String(POINT_SHOP_CRATE_PRICES.uncommon)} Poin) | mythic (${String(POINT_SHOP_CRATE_PRICES.mythic)} Poin)`,
        "Contoh: .belikotak common 2 atau .belikotak 220",
      ].join("\n"),
    );
    return;
  }

  let crate: PointShopCrateKey | null = null;
  let qty = context.args[1] ? Number.parseInt(context.args[1], 10) : 1;

  if (rawArg === "common" || rawArg === "uncommon" || rawArg === "mythic") {
    crate = rawArg;
  } else if (/^\d+$/.test(rawArg)) {
    const budget = Number.parseInt(rawArg, 10);
    if (budget >= POINT_SHOP_CRATE_PRICES.mythic) {
      crate = "mythic";
      qty = Math.min(10, Math.floor(budget / POINT_SHOP_CRATE_PRICES.mythic));
    } else if (budget >= POINT_SHOP_CRATE_PRICES.uncommon) {
      crate = "uncommon";
      qty = Math.min(10, Math.floor(budget / POINT_SHOP_CRATE_PRICES.uncommon));
    } else if (budget >= POINT_SHOP_CRATE_PRICES.common) {
      crate = "common";
      qty = Math.min(10, Math.floor(budget / POINT_SHOP_CRATE_PRICES.common));
    } else {
      await context.reply(
        `Minimal ${String(POINT_SHOP_CRATE_PRICES.common)} Poin untuk membeli Common Crate. Lihat *.tokopoin*!`,
      );
      return;
    }
  }

  if (!crate) {
    await context.reply("Pilih peti: *common*, *uncommon*, atau *mythic*. Contoh: .belikotak uncommon 1");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.buyCrateWithPoints(
      context.chatJid,
      sender,
      crate,
      qty,
    );
    await context.reply(
      [
        "*── [ BELI PETI DENGAN POIN ] ──*",
        `Pembeli    : ${tagOf(sender)}`,
        `Item       : *${String(res.quantity)}x ${res.crate.toUpperCase()} CRATE*`,
        `Biaya      : -${res.pointsSpent.toLocaleString("id-ID")} Poin`,
        `Sisa Poin  : ${res.currentPoints.toLocaleString("id-ID")} Poin`,
        `Stok Peti  : ${String(res.ownedCrates)}x (Buka dengan *.open ${res.crate}*)`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli peti dengan poin."));
  }
}

async function handleSedekah(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const amount = parsePositiveBigIntMoneyInput(context.args[0]);
  if (!amount) {
    await context.reply(
      `Format: .sedekah <uang>\nContoh: .sedekah 5jt (min ${formatCompactRupiah(SEDEKAH_MIN_AMOUNT)})\nMasuk Kas Negara Grup & naikkan peringkat di *.topdermawan*!`,
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await arenaGiveawayShopService.donateToTreasury(context.chatJid, sender, amount);
    await context.reply(
      [
        "*── [ SEDEKAH KAS GRUP ] ──*",
        `Dermawan     : ${tagOf(sender)}`,
        `Disumbangkan : *${formatRupiah(res.amountDonated)}*`,
        `Berkah XP    : *+${String(res.xpGained)} XP*`,
        `Total Amalmu : ${formatCompactRupiah(res.totalDonatedAllTime)} (Cek *.topdermawan*)`,
        `Kas Negara   : ${formatRupiah(res.treasuryBalance)}`,
        `Sisa Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses sedekah."));
  }
}

export const arenaGiveawayShopCommands: CommandDefinition[] = [
  { name: "danakaget", aliases: ["daget", "angpao"], execute: handleDanaKaget },
  { name: "ambilkaget", aliases: ["klaimkaget", "rebutkaget"], execute: handleAmbilKaget },
  { name: "poinkaget", aliases: ["droppoin"], execute: handlePoinKaget },
  { name: "ambilpoin", aliases: ["klaimpoin"], execute: handleAmbilPoin },
  { name: "traktir", execute: handleTraktir },
  { name: "lotere", aliases: ["togelgrup", "undian"], execute: handleLotere },
  { name: "belitiket", aliases: ["tiketlotere"], execute: handleBeliTiket },
  { name: "undilotere", aliases: ["drawlotere"], execute: handleUndiLotere },
  { name: "jackpot", execute: handleJackpot },
  { name: "balapkuda", aliases: ["kuda"], execute: (ctx) => handleRace(ctx, "kuda") },
  { name: "balapsiput", aliases: ["siput"], execute: (ctx) => handleRace(ctx, "siput") },
  { name: "aduayam", aliases: ["sabungayam"], execute: handleAduAyam },
  { name: "tebakwarna", aliases: ["twarna"], execute: handleTebakWarna },
  { name: "duelpoin", execute: handleDuelPoin },
  { name: "terimaduelpoin", execute: handleTerimaDuelPoin },
  { name: "tolakduelpoin", execute: handleTolakDuelPoin },
  { name: "sabungpet", aliases: ["adupet", "petfight"], execute: handleSabungPet },
  { name: "tokopoin", aliases: ["pointshop"], execute: handleTokoPoin },
  { name: "belixp", execute: handleBeliXp },
  { name: "belikotak", aliases: ["belicrate"], execute: handleBeliKotak },
  { name: "sedekah", aliases: ["donasi", "amal"], execute: handleSedekah },
];
