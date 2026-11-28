import { identityResolverService } from "../../services/identity/identityResolver.service";
import { liveCryptoService } from "../../services/info/liveCrypto.service";
import { gachaCardService } from "../../services/media/gachaCard.service";
import { rpgExpansionService } from "../../services/rpg/rpgExpansion.service";
import {
  DEPOSITO_DAILY_INTEREST_PERCENT,
  DEPOSITO_MAX_INTEREST_DAYS,
  DEPOSITO_MAX_PRINCIPAL,
  DEPOSITO_MIN_AMOUNT,
  GACHA_PULL_PRICE,
  PROPERTY_SELL_REFUND_PERCENT,
} from "../../services/rpg/rpgExpansionCatalog";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  formatCompactRupiah,
  formatRemainingDuration,
  formatRupiah,
  parseBigIntAmountOrAll,
} from "../../utils/currency";
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

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

function formatPct(val: number): string {
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

async function resolveMentionedTarget(context: CommandContext): Promise<string | null> {
  const mentioned = context.mentionedJids[0];
  if (mentioned) {
    return identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      normalizeUserJid(mentioned),
    );
  }
  const quotedSender = context.message.message?.extendedTextMessage?.contextInfo?.participant;
  if (quotedSender) {
    return identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      normalizeUserJid(quotedSender),
    );
  }
  return null;
}

async function handleMisi(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const overview = await rpgExpansionService.getDailyQuests(context.chatJid, sender);
    const lines = overview.items.map((item, idx) => {
      const status = item.claimed ? "[DIKLAIM]" : item.completed ? "[SIAP]" : "[BELUM]";
      return [
        `*${String(idx + 1)}. ${status} ${item.spec.title}*`,
        `  ├ Tugas  : ${item.spec.description}`,
        `  └ Hadiah : ${formatCompactRupiah(item.spec.rewardMoney)} + ${String(item.spec.rewardLimit)} Limit + ${String(item.spec.rewardXp)} XP`,
      ].join("\n");
    });

    const footer =
      overview.claimableCount > 0
        ? `Ada *${String(overview.claimableCount)} misi* siap diklaim! Ketik \`.klaimmisi\`.`
        : "Selesaikan misi lalu ketik `.klaimmisi` (reset 00:00 WIB).";

    await context.reply(
      [
        "╭─〔 MISI HARIAN 〕─╮",
        `│ Pemain : ${tagOf(sender)}`,
        `│ Tanggal: ${overview.dateKey} WIB`,
        `│ Siap   : *${String(overview.claimableCount)}* / ${String(overview.items.length)} misi`,
        "╰──────────────────╯",
        "",
        ...lines,
        "",
        footer,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat misi harian."));
  }
}

async function handleKlaimMisi(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const result = await rpgExpansionService.claimDailyQuests(context.chatJid, sender);
    const titles = result.claimedQuests.map((q) => `- ${q.title}`);

    await context.reply(
      [
        "*── [ KLAIM MISI BERHASIL ] ──*",
        `Pemain : ${tagOf(sender)}`,
        "",
        "*Misi Diklaim:*",
        ...titles,
        "",
        `*Total Hadiah:*`,
        `- Uang  : +${formatRupiah(result.totalMoney)}`,
        `- Limit : +${String(result.totalLimit)}`,
        `- XP    : +${String(result.totalXp)}`,
        "",
        `Dompet : ${formatRupiah(result.currentMoney)}`,
        `Limit  : ${String(result.currentLimit)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengklaim misi harian."));
  }
}

async function handleAchievement(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.getAchievements(context.chatJid, sender);
    const total = res.unlocked.length + res.locked.length;

    const lines: string[] = [
      "╭─〔 LENCANA & ACHIEVEMENT 〕─╮",
      `│ Pemain  : ${tagOf(sender)}`,
      `│ Terbuka : *${String(res.unlocked.length)} / ${String(total)}* lencana`,
      "╰────────────────────────────╯",
    ];

    if (res.newlyUnlocked.length > 0) {
      lines.push(
        "",
        `*BARU TERBUKA (+${formatCompactRupiah(res.bonusMoney)} | +${String(res.bonusLimit)} Lmt | +${String(res.bonusXp)} XP):*`,
        ...res.newlyUnlocked.map((a, idx) => {
          const branch = idx === res.newlyUnlocked.length - 1 ? "└" : "├";
          return `  ${branch} ${a.badge} *${a.title}*`;
        }),
      );
    }

    if (res.unlocked.length > 0) {
      lines.push(
        "",
        "*Sudah Dimiliki:*",
        ...res.unlocked.map((a, idx) => {
          const branch = idx === res.unlocked.length - 1 ? "└" : "├";
          return `  ${branch} ${a.badge} ${a.title}`;
        }),
      );
    }

    if (res.locked.length > 0) {
      const nextSlice = res.locked.slice(0, 5);
      lines.push(
        "",
        "*Target Berikutnya:*",
        ...nextSlice.map((a, idx) => {
          const branch = idx === nextSlice.length - 1 ? "└" : "├";
          return `  ${branch} *${a.title}* — ${a.requirement}`;
        }),
      );
    }

    await context.reply(lines.join("\n"), { mentions: [sender] });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat lencana."));
  }
}

async function handleProperti(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const overview = await rpgExpansionService.getPropertiesOverview(context.chatJid, sender);
    const dailyIncome = overview.totalHourlyIncome * 24n;

    const listLines = overview.items.map((item, idx) => {
      const perDay = item.spec.incomePerHour * 24n;
      const ownedBadge =
        item.owned > 0 ? `*${String(item.owned)}/${String(item.spec.maxOwned)}*` : `0/${String(item.spec.maxOwned)}`;
      return [
        `*${String(idx + 1)}. ${item.spec.name}* (\`${item.spec.id}\`)`,
        `  ├ Harga  : *${formatCompactRupiah(item.spec.price)}* (Min Lv.${String(item.spec.minLevel)})`,
        `  ├ Income : ${formatCompactRupiah(item.spec.incomePerHour)}/jam (${formatCompactRupiah(perDay)}/hari)`,
        `  └ Punya  : ${ownedBadge} unit`,
      ].join("\n");
    });

    await context.reply(
      [
        "╭─〔 PASAR PROPERTI 〕─╮",
        `│ Juragan   : ${tagOf(sender)}`,
        `│ Dompet    : *${formatCompactRupiah(overview.moneyBalance)}*`,
        `│ Total Aset: ${String(overview.totalOwned)} unit`,
        `│ Passive   : ${formatCompactRupiah(overview.totalHourlyIncome)}/jam (${formatCompactRupiah(dailyIncome)}/hari)`,
        `│ Siap Panen: *${formatCompactRupiah(overview.pendingHarvest)}*`,
        "╰──────────────────────╯",
        "",
        ...listLines,
        "",
        "*Perintah Cepat:*",
        "• `.beliproperti <kode> [jml]`",
        `• \`.jualproperti <kode> [jml]\` (refund ${String(PROPERTY_SELL_REFUND_PERCENT)}%)`,
        "• `.panen` (akumulasi maks 24 jam)",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka daftar properti."));
  }
}

async function handleBeliProperti(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawId = context.args[0];
  if (!rawId) {
    await context.reply(
      "Format: .beliproperti <kode> [jumlah]\nContoh: .beliproperti warung 2\nCek daftar kode di .properti",
    );
    return;
  }
  const qty = context.args[1] ? Number.parseInt(context.args[1], 10) : 1;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.buyProperty(context.chatJid, sender, rawId, qty);
    const extra =
      res.autoHarvested > 0n
        ? `\nAuto-Panen sebelumnya: +${formatRupiah(res.autoHarvested)}`
        : "";
    await context.reply(
      [
        "*── [ PEMBELIAN PROPERTI ] ──*",
        `Pembeli : ${tagOf(sender)}`,
        `Aset    : ${res.spec.name} x${String(res.quantity)}`,
        `Biaya   : -${formatRupiah(res.totalMoney)}`,
        `Dimiliki: ${String(res.ownedAfter)}/${String(res.spec.maxOwned)} unit`,
        `Dompet  : ${formatRupiah(res.currentMoney)}${extra}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli properti."));
  }
}

async function handleJualProperti(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawId = context.args[0];
  if (!rawId) {
    await context.reply("Format: .jualproperti <kode> [jumlah]\nContoh: .jualproperti warung 1");
    return;
  }
  const qty = context.args[1] ? Number.parseInt(context.args[1], 10) : 1;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.sellProperty(context.chatJid, sender, rawId, qty);
    await context.reply(
      [
        "*── [ PENJUALAN PROPERTI ] ──*",
        `Penjual : ${tagOf(sender)}`,
        `Aset    : ${res.spec.name} x${String(res.quantity)}`,
        `Hasil   : +${formatRupiah(res.totalMoney)} (${String(PROPERTY_SELL_REFUND_PERCENT)}%)`,
        `Sisa    : ${String(res.ownedAfter)} unit`,
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjual properti."));
  }
}

async function handlePanen(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.harvestProperties(context.chatJid, sender);
    await context.reply(
      [
        "*── [ PANEN PASSIVE INCOME ] ──*",
        `Juragan : ${tagOf(sender)}`,
        `Properti: ${String(res.totalOwned)} unit`,
        `Durasi  : ${formatRemainingDuration(res.elapsedMs)}`,
        ...(res.operationalTax > 0n
          ? [
              `Kotor   : ${formatRupiah(res.grossMoney)}`,
              `PajakOps: -${formatRupiah(res.operationalTax)} (10% ke Kas Grup)`,
            ]
          : []),
        `Hasil   : +${formatRupiah(res.harvestedMoney)}`,
        ...(res.autoWealthTaxPaid > 0n
          ? [`AutoTax : -${formatRupiah(res.autoWealthTaxPaid)} (>2M 1,5%/hr ke Kas Grup)`]
          : []),
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memanen hasil properti."));
  }
}

async function handleGaji(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.claimSalary(context.chatJid, sender);
    await context.reply(
      [
        "*── [ GAJI HARIAN RANK ] ──*",
        `Penerima: ${tagOf(sender)}`,
        `Tier    : *${res.rank}*`,
        `Uang    : +${formatRupiah(res.money)}`,
        `Limit   : +${String(res.limit)}`,
        `XP      : +${String(res.xp)}`,
        ...(res.autoWealthTaxPaid > 0n
          ? [`AutoTax : -${formatRupiah(res.autoWealthTaxPaid)} (>2M 1,5%/hr ke Kas Grup)`]
          : []),
        "",
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
        `Limit   : ${String(res.currentLimit)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil gaji harian."));
  }
}

async function handleDeposito(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const arg = context.args[0]?.trim().toLowerCase();

    if (!arg || arg === "info" || arg === "status") {
      const info = await rpgExpansionService.getDepositoInfo(context.chatJid, sender);
      if (!info.active) {
        await context.reply(
          [
            "╭─〔 BANK DEPOSITO 〕─╮",
            `│ Nasabah : ${tagOf(sender)}`,
            `│ Status  : Belum aktif`,
            `│ Bunga   : *${String(DEPOSITO_DAILY_INTEREST_PERCENT)}% / 24 jam* (maks ${String(DEPOSITO_MAX_INTEREST_DAYS)} hari)`,
            `│ Minimal : ${formatCompactRupiah(DEPOSITO_MIN_AMOUNT)}`,
            `│ Maksimal: ${formatCompactRupiah(DEPOSITO_MAX_PRINCIPAL)}`,
            `│ Dompet  : *${formatCompactRupiah(info.moneyBalance)}*`,
            "╰────────────────────╯",
            "",
            "*Cara Buka:* `.deposito <jumlah|all>`",
          ].join("\n"),
          { mentions: [sender] },
        );
        return;
      }

      await context.reply(
        [
          "╭─〔 BANK DEPOSITO AKTIF 〕─╮",
          `│ Nasabah  : ${tagOf(sender)}`,
          `│ Pokok    : *${formatCompactRupiah(info.principal)}*`,
          `│ Durasi   : ${String(info.daysHeld)} hari (${String(info.ratePercent)}%/hari)`,
          `│ Bunga    : *+${formatCompactRupiah(info.accruedInterest)}*`,
          `│ Nilai    : *${formatCompactRupiah(info.totalWithdrawValue)}*`,
          "╰──────────────────────────╯",
          "",
          "*Cairkan:* `.cairdeposito` atau `.deposito cair`",
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    if (arg === "cair" || arg === "tarik" || arg === "withdraw") {
      await handleCairDeposito(context);
      return;
    }

    const parsed = parseBigIntAmountOrAll(arg);
    if (!parsed) {
      await context.reply(
        "Format: .deposito <jumlah|all|info|cair>\nContoh: .deposito 50jt atau .deposito all",
      );
      return;
    }

    const res = await rpgExpansionService.openDeposito(context.chatJid, sender, parsed);
    await context.reply(
      [
        "*── [ DEPOSITO DIBUKA ] ──*",
        `Nasabah : ${tagOf(sender)}`,
        `Pokok   : ${formatRupiah(res.principal)}`,
        `Bunga   : ${String(res.ratePercent)}% setiap 24 jam (maks ${String(DEPOSITO_MAX_INTEREST_DAYS)} hari)`,
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
        "",
        "Ketik *.deposito* untuk cek bunga atau *.cairdeposito* untuk mencairkan.",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses deposito."));
  }
}

async function handleCairDeposito(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.withdrawDeposito(context.chatJid, sender);
    const note =
      res.daysHeld === 0
        ? "\nCatatan: Dicairkan kurang dari 24 jam, pokok kembali utuh tanpa bunga."
        : "";
    await context.reply(
      [
        "*── [ PENCAIRAN DEPOSITO ] ──*",
        `Nasabah : ${tagOf(sender)}`,
        `Pokok   : ${formatRupiah(res.principal)}`,
        `Durasi  : ${String(res.daysHeld)} hari penuh`,
        `Bunga   : +${formatRupiah(res.interest)}`,
        `Diterima: +${formatRupiah(res.totalReceived)}`,
        `Dompet  : ${formatRupiah(res.currentMoney)}${note}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencairkan deposito."));
  }
}

async function handleSaham(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const quotes = rpgExpansionService.getStockMarket();
  const lines = quotes.map((q) => {
    const trend = q.changePercent > 0 ? "▲" : q.changePercent < 0 ? "▼" : "•";
    return [
      `*${q.ticker}* — ${q.name}`,
      `  └ ${trend} *${formatCompactRupiah(q.lotPrice)}*/lot (${formatPct(q.changePercent)})`,
    ].join("\n");
  });

  await context.reply(
    [
      "╭─〔 BURSA SAHAM LOKAL 〕─╮",
      "│ Update tiap 10 menit (1 lot = 100 lbr)",
      "╰────────────────────────╯",
      "",
      ...lines,
      "",
      "*Perintah Cepat:*",
      "• `.belisaham <kode> <lot>`",
      "• `.jualsaham <kode> <lot|all>`",
      "• `.portofolio`",
    ].join("\n"),
  );
}

async function handleBeliSaham(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const ticker = context.args[0];
  const rawLots = context.args[1];
  const lots = rawLots ? Number.parseInt(rawLots, 10) : NaN;
  if (!ticker || !Number.isInteger(lots) || lots <= 0) {
    await context.reply("Format: .belisaham <kode> <lot>\nContoh: .belisaham BBCA 5");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.buyStock(context.chatJid, sender, ticker, lots);
    await context.reply(
      [
        "*── [ ORDER BELI SAHAM ] ──*",
        `Investor : ${tagOf(sender)}`,
        `Emiten   : *${res.quote.ticker}* (${res.quote.name})`,
        `Jumlah   : ${String(res.lots)} lot @ ${formatRupiah(res.quote.lotPrice)}`,
        `Total    : -${formatRupiah(res.totalMoney)}`,
        `Kepemilikan: ${String(res.remainingLots)} lot (Avg ${formatRupiah(res.avgPrice)})`,
        `Dompet   : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli saham."));
  }
}

async function handleJualSaham(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const ticker = context.args[0];
  const rawLots = context.args[1]?.trim().toLowerCase();
  if (!ticker || !rawLots) {
    await context.reply("Format: .jualsaham <kode> <lot|all>\nContoh: .jualsaham BBCA all");
    return;
  }
  const lotsOrAll: number | "all" =
    rawLots === "all" || rawLots === "semua" ? "all" : Number.parseInt(rawLots, 10);

  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.sellStock(context.chatJid, sender, ticker, lotsOrAll);
    const pnl = res.realizedPnl ?? 0n;
    const pnlLabel = pnl >= 0n ? `+${formatRupiah(pnl)}` : formatRupiah(pnl);
    await context.reply(
      [
        "*── [ ORDER JUAL SAHAM ] ──*",
        `Investor: ${tagOf(sender)}`,
        `Emiten  : *${res.quote.ticker}* (${res.quote.name})`,
        `Terjual : ${String(res.lots)} lot @ ${formatRupiah(res.quote.lotPrice)}`,
        `Diterima: +${formatRupiah(res.totalMoney)}`,
        `Laba/Rugi: ${pnlLabel}`,
        `Sisa Lot: ${String(res.remainingLots)} lot`,
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjual saham."));
  }
}

async function handlePortofolio(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const pf = await rpgExpansionService.getFullPortfolio(context.chatJid, sender);
    const stockLines =
      pf.stocks.length > 0
        ? pf.stocks.map(
            (s) =>
              `- *${s.ticker}*: ${String(s.lots)} lot | Nilai ${formatCompactRupiah(s.marketValue)} (${formatPct(s.pnlPercent)})`,
          )
        : ["Belum ada saham. Lihat .saham"];

    await context.reply(
      [
        "╭─〔 PORTOFOLIO KEKAYAAN 〕─╮",
        `│ Investor  : ${tagOf(sender)}`,
        `│ Net Worth : *${formatCompactRupiah(pf.netWorth)}*`,
        "╰──────────────────────────╯",
        "",
        "*Rincian Aset:*",
        `  ├ Dompet   : ${formatCompactRupiah(pf.moneyBalance)}`,
        `  ├ Bank     : ${formatCompactRupiah(pf.bankBalance)}`,
        `  ├ Deposito : ${formatCompactRupiah(pf.depositoValue)}`,
        `  ├ Saham    : ${formatCompactRupiah(pf.totalStocksValue)}`,
        `  ├ Kripto   : ${formatCompactRupiah(pf.totalCryptoValue)}`,
        `  ├ Properti : ${formatCompactRupiah(pf.totalPropertyValue)} (${String(pf.totalPropertyOwned)} unit)`,
        `  └ Kartu    : ${String(pf.uniqueCards)} unik (${String(pf.totalCardCopies)} lbr)`,
        "",
        "*Kepemilikan Saham:*",
        ...stockLines,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka portofolio."));
  }
}

async function handleHargaKripto(context: CommandContext): Promise<void> {
  try {
    const query = context.argsText.trim();
    const tickers = await liveCryptoService.getPrices(query);
    const lines = tickers.map((t, idx) => {
      const trend = t.change24h > 0 ? "▲" : t.change24h < 0 ? "▼" : "•";
      const idrText =
        t.idr >= 1
          ? `Rp ${Math.round(t.idr).toLocaleString("id-ID")}`
          : `Rp ${t.idr.toFixed(6)}`;
      const usdText =
        t.usd >= 1
          ? `$${t.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
          : `$${t.usd.toFixed(6)}`;
      return [
        `*${String(idx + 1)}. ${t.symbol}* — ${t.name}`,
        `  ├ IDR : *${idrText}*`,
        `  └ USD : ${usdText} (${trend} ${formatPct(t.change24h)} 24j)`,
      ].join("\n");
    });

    await context.reply(
      [
        "╭─〔 HARGA KRIPTO LIVE 〕─╮",
        "│ Sumber: CoinGecko Real-Time",
        "╰────────────────────────╯",
        "",
        ...lines,
        "",
        "*Cek Koin:* `.hargakripto <btc|eth|sol|doge|ton|pepe|sui>`",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil harga kripto live."));
  }
}

async function handleGachaKartu(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.pullGachaCard(context.chatJid, sender);
    const trimmedName = context.message.pushName?.trim();
    const ownerLabel =
      trimmedName && trimmedName.length > 0 ? trimmedName : (sender.split("@")[0] ?? "Member");

    const imageBuffer = await gachaCardService.renderCard({
      card: res.card,
      ownerLabel,
      isNew: res.isNew,
      ownedCopies: res.ownedCopies,
      cashbackMoney: res.cashback,
    });

    const dupLine = res.isNew
      ? "Status : *KARTU BARU!*"
      : `Status : Duplikat (x${String(res.ownedCopies)}) -> Cashback +${formatRupiah(res.cashback)}`;

    const caption = [
      "*── [ GACHA KARTU KOLEKSI ] ──*",
      `Kolektor: ${tagOf(sender)}`,
      `Kartu   : *[${res.card.rarity}] ${res.card.name}* (#${res.card.serial})`,
      `Power   : ${String(res.card.power)}`,
      dupLine,
      `Koleksi : ${String(res.uniqueOwned)} / ${String(res.totalCatalog)} unik (+${String(res.xpAwarded)} XP)`,
      `Biaya   : ${formatCompactRupiah(GACHA_PULL_PRICE)} | Dompet: ${formatCompactRupiah(res.currentMoney)}`,
    ].join("\n");

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: imageBuffer,
        caption,
        mentions: [sender],
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melakukan gacha kartu."));
  }
}

async function handleKoleksi(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const col = await rpgExpansionService.getCardCollection(context.chatJid, sender);
    const cardLines =
      col.entries.length > 0
        ? col.entries.map((e, idx) => {
            const branch = idx === col.entries.length - 1 ? "└" : "├";
            return `  ${branch} #${e.card.serial} *[${e.card.rarity}] ${e.card.name}* x${String(e.count)} (PWR ${String(e.card.power)})`;
          })
        : ["  _Belum punya kartu. Tarik gacha lewat `.gachakartu`!_"];

    await context.reply(
      [
        "╭─〔 ALBUM KOLEKSI KARTU 〕─╮",
        `│ Kolektor : ${tagOf(sender)}`,
        `│ Unik     : *${String(col.uniqueOwned)} / ${String(col.totalCatalog)}* kartu`,
        `│ Total    : ${String(col.totalCopies)} lbr | Power *${String(col.totalPower)}*`,
        "╰──────────────────────────╯",
        "",
        "*Daftar Kartu:*",
        ...cardLines,
        "",
        "*Perintah Cepat:*",
        "• `.gachakartu` | `.trade @user <kode> <jml>`",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka album koleksi."));
  }
}

async function handleTrade(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const target = await resolveMentionedTarget(context);
  const nonMentionArgs = context.args.filter((a) => !a.startsWith("@"));
  const rawItem = nonMentionArgs[0];
  const rawQty = nonMentionArgs[1];
  const qty = rawQty ? Number.parseInt(rawQty, 10) : 1;

  if (!target || !rawItem || !Number.isInteger(qty) || qty <= 0) {
    await context.reply(
      "Format: .trade @user <item/crate/nomor_kartu> [jumlah]\nContoh:\n- .trade @user berlian 2\n- .trade @user mythic 1\n- .trade @user 015 1",
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
        target,
      )
    ) {
      await context.reply("Tidak bisa mengirim item barter ke bot.");
      return;
    }

    const res = await rpgExpansionService.tradeItem(
      context.chatJid,
      sender,
      target,
      rawItem,
      qty,
    );
    await context.reply(
      [
        "*── [ BARTER BERHASIL ] ──*",
        `Pengirim: ${tagOf(sender)}`,
        `Penerima: ${tagOf(target)}`,
        `Barang  : *${res.itemLabel}* x${String(res.quantity)}`,
        `Sisa Pengirim: ${String(res.senderRemaining)}`,
        `Total Penerima: ${String(res.recipientTotal)}`,
      ].join("\n"),
      { mentions: [sender, target] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses barter item."));
  }
}

async function handleBuatKode(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const allowed = context.role === "SUPER_OWNER" || context.role === "TENANT_OWNER";
  if (!allowed) {
    await context.reply("Hanya Owner Grup atau Super Owner yang dapat membuat kode redeem.");
    return;
  }

  const rawCode = context.args[0];
  const rawLimit = context.args[1];
  const rawMoney = context.args[2];
  const rawMaxClaims = context.args[3];

  if (!rawCode || !rawLimit || !rawMoney) {
    await context.reply(
      "Format: .buatkode <kode> <limit> <uang> [kuota_klaim]\nContoh: .buatkode SULTAN2026 10 50jt 25",
    );
    return;
  }

  const rewardLimit = Number.parseInt(rawLimit, 10);
  const parsedMoney = rawMoney === "0" ? 0n : parseBigIntAmountOrAll(rawMoney);
  const maxClaims = rawMaxClaims ? Number.parseInt(rawMaxClaims, 10) : 20;

  if (!Number.isInteger(rewardLimit) || parsedMoney === null || parsedMoney === "all") {
    await context.reply(
      "Format angka salah.\nContoh: .buatkode BAGIBAGI 5 25jt 30 (atau 0 jika tanpa limit/uang)",
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const created = await rpgExpansionService.createRedeemCode(
      context.chatJid,
      sender,
      rawCode,
      rewardLimit,
      parsedMoney,
      maxClaims,
    );

    await context.reply(
      [
        "*── [ KODE REDEEM DIBUAT ] ──*",
        `Kode   : *${created.code}*`,
        `Hadiah : +${String(created.rewardLimit)} Limit | +${formatRupiah(created.rewardMoney)}`,
        `Kuota  : ${String(created.maxClaims)} member`,
        "",
        `Member bisa klaim dengan: *.redeem ${created.code}*`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat kode redeem."));
  }
}

async function handleRedeem(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawCode = context.args[0];
  if (!rawCode) {
    await context.reply("Format: .redeem <kode>\nContoh: .redeem SULTAN2026");
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await rpgExpansionService.redeemCode(context.chatJid, sender, rawCode);
    await context.reply(
      [
        "*── [ REDEEM BERHASIL ] ──*",
        `Penerima: ${tagOf(sender)}`,
        `Kode    : *${res.code}* (${String(res.claimsUsed)}/${String(res.maxClaims)})`,
        `Hadiah  : +${String(res.rewardLimit)} Limit | +${formatRupiah(res.rewardMoney)}`,
        "",
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
        `Limit   : ${String(res.currentLimit)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menukar kode redeem."));
  }
}

async function handleListKode(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const list = await rpgExpansionService.listRedeemCodes(context.chatJid);
    if (list.length === 0) {
      await context.reply(
        "Belum ada kode redeem di grup ini. Owner bisa membuatnya lewat .buatkode <kode> <limit> <uang>.",
      );
      return;
    }

    const lines = list.map((item) => {
      const status =
        item.claimsUsed >= item.maxClaims
          ? "HABIS"
          : `Sisa ${String(item.maxClaims - item.claimsUsed)}`;
      return `- *${item.code}* (${status}) | +${String(item.rewardLimit)} Limit, +${formatCompactRupiah(item.rewardMoney)}`;
    });

    await context.reply(["*── [ DAFTAR KODE REDEEM ] ──*", "", ...lines].join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil daftar kode redeem."));
  }
}

export const rpgExpansionCommands: CommandDefinition[] = [
  { name: "misi", aliases: ["quest"], execute: handleMisi },
  { name: "klaimmisi", aliases: ["claimquest"], execute: handleKlaimMisi },
  { name: "achievement", aliases: ["lencana"], execute: handleAchievement },
  { name: "properti", aliases: ["property"], execute: handleProperti },
  { name: "beliproperti", aliases: ["buyproperti"], execute: handleBeliProperti },
  { name: "jualproperti", aliases: ["sellproperti"], execute: handleJualProperti },
  { name: "panen", aliases: ["collect"], execute: handlePanen },
  { name: "gaji", aliases: ["salary"], execute: handleGaji },
  { name: "deposito", aliases: ["depo"], execute: handleDeposito },
  { name: "cairdeposito", execute: handleCairDeposito },
  { name: "saham", aliases: ["stocks"], execute: handleSaham },
  { name: "belisaham", aliases: ["buysaham"], execute: handleBeliSaham },
  { name: "jualsaham", aliases: ["sellsaham"], execute: handleJualSaham },
  { name: "portofolio", aliases: ["portfolio"], execute: handlePortofolio },
  { name: "hargakripto", aliases: ["cekcrypto"], execute: handleHargaKripto },
  { name: "gachakartu", aliases: ["pullcard"], execute: handleGachaKartu },
  { name: "koleksi", aliases: ["cards"], execute: handleKoleksi },
  { name: "trade", aliases: ["barter"], execute: handleTrade },
  { name: "buatkode", aliases: ["createcode"], execute: handleBuatKode },
  { name: "redeem", aliases: ["klaimkode"], execute: handleRedeem },
  { name: "listkode", execute: handleListKode },
];
