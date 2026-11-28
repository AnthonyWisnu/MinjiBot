import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { eventBannerService } from "../../services/media/eventBanner.service";
import { careerPrestigeService } from "../../services/rpg/careerPrestige.service";
import {
  CAREER_MAX_LEVEL,
  JAIL_BAIL_COST,
  PINJOL_INTEREST_PERCENT,
  PINJOL_MIN_AMOUNT,
  PRESTIGE_BONUS_PERCENT_PER_STAR,
  PRESTIGE_MIN_PLAYER_LEVEL,
  PRESTIGE_REWARD_LIMIT,
  PRESTIGE_REWARD_POINTS,
  STARTUP_CREATE_COST,
  STARTUP_RECRUIT_COST,
  UGD_VIP_RELEASE_COST,
} from "../../services/rpg/careerPrestigeCatalog";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  formatCompactRupiah,
  formatRemainingDuration,
  formatRupiah,
  parseBigIntAmountOrAll,
} from "../../utils/currency";
import { sendEventBannerOrReply } from "../../utils/eventBannerSender";
import { normalizeUserJid } from "../../utils/jid";
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

function getPushOrPhone(context: CommandContext, jid: string): string {
  const push = context.message.pushName?.trim();
  if (push && push.length > 0) return push;
  return jid.split("@")[0] ?? "Member";
}

// ======================== KARIR ========================

async function handleKarir(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const info = await careerPrestigeService.getCareerOverview(context.chatJid, sender);

    const statusBlock = info.current
      ? [
          `Profesi : *${info.current.spec.title}* (Lv.${String(info.current.level)}/${String(CAREER_MAX_LEVEL)})`,
          `Shift   : ${String(info.current.shiftsDone)}x selesai`,
          `Status  : ${info.current.shiftCooldownMs > 0 ? `Cooldown ${formatRemainingDuration(info.current.shiftCooldownMs)}` : "Siap .shift sekarang!"}`,
          ...(info.current.nextPromoteCost
            ? [`Promosi : ${formatCompactRupiah(info.current.nextPromoteCost)} (.promosi)`]
            : ["Jabatan : MAX LEVEL"]),
        ]
      : ["Profesi : Belum bekerja (lamar lewat .lamar <kode>)"];

    const listLines = info.catalog.map(
      (c) =>
        `- *${c.id}* (${c.title}) | Min Lv.${String(c.minLevel)} | Gaji: ${formatCompactRupiah(c.basePay)}/shift`,
    );

    await context.reply(
      [
        "*── [ PUSAT KARIR GRUP ] ──*",
        `Pemain  : ${tagOf(sender)} (Lv.${String(info.playerLevel)} | Prestige ★${String(info.prestige)})`,
        ...statusBlock,
        "",
        "*Daftar Lowongan Profesi:*",
        ...listLines,
        "",
        "Lamar: .lamar <kode> | Kerja: .shift | Naik: .promosi | Keluar: .resign",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka pusat karir."));
  }
}

async function handleLamar(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawJob = context.args[0];
  if (!rawJob) {
    await context.reply("Format: .lamar <kode_profesi>\nContoh: .lamar kurir\nLihat daftar di .karir");
    return;
  }
  try {
    const sender = await resolveSender(context);
    const spec = await careerPrestigeService.applyCareer(context.chatJid, sender, rawJob);
    await context.reply(
      [
        "*── [ DITERIMA KERJA! ] ──*",
        `${tagOf(sender)} resmi bekerja sebagai *${spec.title}*!`,
        `Gaji Awal : ${formatRupiah(spec.basePay)} / shift`,
        `Bonus     : +${String(spec.baseXp)} XP | +${String(spec.basePoints)} Poin`,
        "",
        "Langsung mulai kerja dengan ketik *.shift*!",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melamar profesi."));
  }
}

async function handleShift(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.workShift(context.chatJid, sender);
    const debtLines =
      res.debtSeized > 0n
        ? [
            "",
            `*RAZIA DEBT COLLECTOR PINJOL!*`,
            `Disita otomatis: -${formatRupiah(res.debtSeized)} (Sisa utang: ${formatRupiah(res.remainingDebt)})`,
          ]
        : [];

    const caption = [
      "*── [ GAJI SHIFT KARIR ] ──*",
      `Pekerja : ${tagOf(sender)}`,
      `Profesi : *${res.spec.title}* (Lv.${String(res.careerLevel)})`,
      `Diterima: +${formatRupiah(res.moneyEarned)}`,
      `Bonus   : +${String(res.xpEarned)} XP | +${String(res.pointsEarned)} Poin`,
      `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ...debtLines,
    ].join("\n");

    if (res.debtSeized > 0n) {
      await sendEventBannerOrReply(context, {
        scene: "debt_collector",
        headline: "TAGIHAN PINJOL DISITA!",
        subjectName: getPushOrPhone(context, sender),
        details: [
          `Disita Otomatis: -${formatCompactRupiah(res.debtSeized)}`,
          `Sisa Utang: ${formatCompactRupiah(res.remainingDebt)}`,
          "Lunasi segera lewat .bayarutang",
        ],
        targetUserJid: sender,
        avatarAltJids: context.senderAltJids,
        caption,
        mentions: [sender],
      });
      return;
    }

    await context.reply(caption, { mentions: [sender] });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menyelesaikan shift kerja."));
  }
}

async function handlePromosi(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.promoteCareer(context.chatJid, sender);
    await context.reply(
      [
        "*── [ PROMOSI JABATAN ] ──*",
        `${tagOf(sender)} naik pangkat di profesi *${res.spec.title}*!`,
        `Level Baru: *Lv.${String(res.newLevel)}/${String(CAREER_MAX_LEVEL)}* (+35% gaji shift)`,
        `Biaya     : -${formatRupiah(res.costPaid)}`,
        `Dompet    : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal promosi karir."));
  }
}

async function handleResign(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const prevTitle = await careerPrestigeService.resignCareer(context.chatJid, sender);
    await context.reply(
      `${tagOf(sender)} resmi mengundurkan diri dari profesi *${prevTitle}*. Cari profesi baru di *.karir*!`,
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal resign dari karir."));
  }
}

// ======================== STARTUP ========================

async function handleStartup(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const info = await careerPrestigeService.getStartupOverview(context.chatJid, sender);
    if (!info.startup) {
      await context.reply(
        [
          "*── [ STARTUP & PERUSAHAAN ] ──*",
          `Founder : ${tagOf(sender)}`,
          `Status  : Belum memiliki perusahaan`,
          `Modal   : ${formatRupiah(STARTUP_CREATE_COST)}`,
          `Dompet  : ${formatRupiah(info.moneyBalance)}`,
          "",
          "Dirikan startup: *.buatstartup <nama perusahaan>*",
          "Contoh: *.buatstartup PT Minji Nusantara*",
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    const s = info.startup;
    await context.reply(
      [
        `*── [ ${s.name.toUpperCase()} ] ──*`,
        `Founder   : ${tagOf(sender)}`,
        `Level     : Lv.${String(s.level)} / 10`,
        `Karyawan  : ${String(s.employees)} / ${String(s.maxEmployees)} orang (.rekruit)`,
        `Valuasi   : ${formatRupiah(s.valuation)}`,
        `Dividen   : ${formatRupiah(s.dividendPayout)} / 6 jam`,
        `Status    : ${s.dividendCooldownMs > 0 ? `Tersedia ${formatRemainingDuration(s.dividendCooldownMs)} lagi` : "Siap ditarik (.dividen)!"}`,
        ...(s.nextUpgradeCost
          ? [`Upgrade   : ${formatCompactRupiah(s.nextUpgradeCost)} (.upgradestartup)`]
          : ["Upgrade   : MAX LEVEL"]),
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka info startup."));
  }
}

async function handleBuatStartup(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const name = context.argsText.trim();
  if (!name) {
    await context.reply(
      `Format: .buatstartup <nama perusahaan>\nModal: ${formatRupiah(STARTUP_CREATE_COST)}\nContoh: .buatstartup PT Sultan Maju`,
    );
    return;
  }
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.createStartup(context.chatJid, sender, name);
    await context.reply(
      [
        "*── [ STARTUP RESMI BERDIRI! ] ──*",
        `Founder    : ${tagOf(sender)}`,
        `Perusahaan : *${res.name}* (Lv.1 | 1 Karyawan)`,
        `Modal      : -${formatRupiah(res.costPaid)}`,
        `Dompet     : ${formatRupiah(res.currentMoney)}`,
        "",
        "Tarik profit rutin dengan *.dividen*, tambah tim lewat *.rekruit*, dan naikkan level lewat *.upgradestartup*!",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mendirikan startup."));
  }
}

async function handleRekruit(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const qty = context.args[0] ? Number.parseInt(context.args[0], 10) : 1;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.recruitEmployees(context.chatJid, sender, qty);
    await context.reply(
      [
        "*── [ REKRUIT KARYAWAN ] ──*",
        `Perusahaan : *${res.startupName}*`,
        `Direkrut   : +${String(res.added)} orang (${formatCompactRupiah(STARTUP_RECRUIT_COST)}/org)`,
        `Total Tim  : ${String(res.totalEmployees)} karyawan`,
        `Biaya      : -${formatRupiah(res.costPaid)}`,
        `Dompet     : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal merekrut karyawan."));
  }
}

async function handleUpgradeStartup(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.upgradeStartup(context.chatJid, sender);
    await context.reply(
      [
        "*── [ UPGRADE STARTUP ] ──*",
        `Perusahaan: *${res.startupName}*`,
        `Level Baru: *Lv.${String(res.newLevel)}* (Kapasitas ${String(res.maxEmployees)} karyawan)`,
        `Biaya     : -${formatRupiah(res.costPaid)}`,
        `Dompet    : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal upgrade startup."));
  }
}

async function handleDividen(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.claimDividend(context.chatJid, sender);
    const debtLines =
      res.debtSeized > 0n
        ? [
            "",
            `*RAZIA DEBT COLLECTOR PINJOL!*`,
            `Disita: -${formatRupiah(res.debtSeized)} (Sisa utang: ${formatRupiah(res.remainingDebt)})`,
          ]
        : [];

    const caption = [
      "*── [ PENCAIRAN DIVIDEN ] ──*",
      `Founder    : ${tagOf(sender)}`,
      `Perusahaan : *${res.startupName}* (Lv.${String(res.level)} | ${String(res.employees)} karyawan)`,
      `Dividen    : +${formatRupiah(res.dividendGross)}`,
      `Bonus XP   : +${String(res.xpEarned)} XP`,
      `Dompet     : ${formatRupiah(res.currentMoney)}`,
      ...debtLines,
    ].join("\n");

    if (res.debtSeized > 0n) {
      await sendEventBannerOrReply(context, {
        scene: "debt_collector",
        headline: "DIVIDEN DISITA PINJOL!",
        subjectName: getPushOrPhone(context, sender),
        details: [
          `Disita Otomatis: -${formatCompactRupiah(res.debtSeized)}`,
          `Sisa Utang: ${formatCompactRupiah(res.remainingDebt)}`,
          "Lunasi segera lewat .bayarutang",
        ],
        targetUserJid: sender,
        avatarAltJids: context.senderAltJids,
        caption,
        mentions: [sender],
      });
      return;
    }

    await context.reply(caption, { mentions: [sender] });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menarik dividen startup."));
  }
}

async function handleTopStartup(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const rows = await careerPrestigeService.listTopStartups(context.chatJid, 10);
    if (rows.length === 0) {
      await context.reply("Belum ada startup berdiri di grup ini. Jadilah yang pertama dengan *.buatstartup <nama>*!");
      return;
    }
    const mentions = rows.map((r) => r.userJid);
    const lines = rows.map(
      (r, idx) =>
        `${String(idx + 1)}. *${r.startupName}* (Lv.${String(r.level)})\n   Founder: ${tagOf(r.userJid)} | Valuasi: ${formatCompactRupiah(r.valuation)}`,
    );
    await context.reply(["*── [ TOP STARTUP GRUP ] ──*", "", ...lines].join("\n"), { mentions });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat peringkat startup."));
  }
}

// ======================== PINJOL ========================

async function handleCekUtang(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const info = await careerPrestigeService.getLoanOverview(context.chatJid, sender);
    if (!info.active) {
      await context.reply(
        [
          "*── [ KOPERASI PINJOL GRUP ] ──*",
          `Nasabah  : ${tagOf(sender)}`,
          `Status   : Bebas Utang`,
          `Rank     : *${info.rank}*`,
          `Plafon   : Maks ${formatRupiah(info.maxBorrowLimit)}`,
          `Bunga    : Flat ${String(PINJOL_INTEREST_PERCENT)}% (tenor 48 jam)`,
          "",
          `Ajukan pinjaman: *.pinjam <jumlah>* (min ${formatCompactRupiah(PINJOL_MIN_AMOUNT)})`,
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    const status = info.overdue
      ? "*MENUNGGAK! Debt Collector aktif memotong 50% gaji/dividen!*"
      : `Jatuh tempo ${formatRemainingDuration(info.remainingMs)} lagi`;

    await context.reply(
      [
        "*── [ TAGIHAN PINJOL AKTIF ] ──*",
        `Nasabah : ${tagOf(sender)}`,
        `Pokok   : ${formatRupiah(info.principal)}`,
        `Bunga   : ${formatRupiah(info.interest)}`,
        `Total   : *${formatRupiah(info.totalDue)}*`,
        `Status  : ${status}`,
        "",
        "Lunasi: *.bayarutang all* atau *.bayarutang <jumlah>*",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengecek tagihan pinjol."));
  }
}

async function handlePinjam(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const parsed = parseBigIntAmountOrAll(context.args[0]);
  if (!parsed || parsed === "all") {
    await context.reply(
      "Format: .pinjam <jumlah>\nContoh: .pinjam 20jt\nCek plafon sesuai Rank di .cekutang",
    );
    return;
  }
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.borrowLoan(context.chatJid, sender, parsed);
    await context.reply(
      [
        "*── [ PINJAMAN CAIR! ] ──*",
        `Nasabah : ${tagOf(sender)}`,
        `Cair    : +${formatRupiah(res.amount)}`,
        `Tagihan : *${formatRupiah(res.totalDebtRemaining)}* (bunga ${String(PINJOL_INTEREST_PERCENT)}%)`,
        `Tenor   : 48 jam (lewat tempo kena razia Debt Collector!)`,
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencairkan pinjaman."));
  }
}

async function handleBayarUtang(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const parsed = context.args[0] ? parseBigIntAmountOrAll(context.args[0]) : "all";
  if (!parsed) {
    await context.reply("Format: .bayarutang [jumlah|all]\nContoh: .bayarutang all atau .bayarutang 10jt");
    return;
  }
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.repayLoan(context.chatJid, sender, parsed);
    const statusLine =
      res.totalDebtRemaining <= 0n
        ? "Status  : *LUNAS! Bebas dari Debt Collector!*"
        : `Sisa    : ${formatRupiah(res.totalDebtRemaining)}`;
    await context.reply(
      [
        "*── [ PEMBAYARAN PINJOL ] ──*",
        `Nasabah : ${tagOf(sender)}`,
        `Dibayar : -${formatRupiah(res.amount)}`,
        statusLine,
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membayar utang."));
  }
}

// ======================== ASURANSI & BEBAS STATUS ========================

async function handleAsuransi(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const info = await careerPrestigeService.getInsuranceOverview(context.chatJid, sender);
    const lines = info.items.map((item) => {
      const stateText =
        item.remainingMs > 0
          ? `AKTIF (${formatRemainingDuration(item.remainingMs)})`
          : "Belum aktif";
      return `- *${item.spec.id}* (${item.spec.name})\n  Harga: ${formatCompactRupiah(item.spec.price)}/24j | Status: *${stateText}*\n  Manfaat: ${item.spec.benefit}`;
    });

    await context.reply(
      [
        "*── [ ASURANSI & PROTEKSI ] ──*",
        `Pemilik : ${tagOf(sender)}`,
        `Dompet  : ${formatCompactRupiah(info.moneyBalance)}`,
        "",
        ...lines,
        "",
        "Beli: .beliasuransi <brankas|bpjs|pengacara>",
        `Tebus Penjara: .bebaspenjara (${formatCompactRupiah(JAIL_BAIL_COST)} / gratis dgn Pengacara)`,
        `Keluar UGD   : .bebasugd (${formatCompactRupiah(UGD_VIP_RELEASE_COST)} / gratis dgn BPJS)`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka info asuransi."));
  }
}

async function handleBeliAsuransi(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const rawType = context.args[0];
  if (!rawType) {
    await context.reply(
      "Format: .beliasuransi <brankas|bpjs|pengacara>\nContoh: .beliasuransi brankas",
    );
    return;
  }
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.buyInsurance(context.chatJid, sender, rawType);
    await context.reply(
      [
        "*── [ POLIS ASURANSI AKTIF ] ──*",
        `Pemilik : ${tagOf(sender)}`,
        `Paket   : *${res.spec.name}*`,
        `Manfaat : ${res.spec.benefit}`,
        `Biaya   : -${formatRupiah(res.spec.price)}`,
        `Dompet  : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli asuransi."));
  }
}

async function handleBebasPenjara(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.releaseFromJail(context.chatJid, sender);
    const sourceDetail =
      res.bankPaid > 0n
        ? ` (Dompet: ${formatCompactRupiah(res.walletPaid)} + Auto-debit ATM: ${formatCompactRupiah(res.bankPaid)})`
        : "";
    const note = res.coveredByInsurance
      ? "Ditanggung penuh oleh *Pengacara Elit* (Gratis!)"
      : `Uang tebusan dibayar: -${formatRupiah(res.costPaid)}${sourceDetail}`;
    await context.reply(
      [
        "*── [ BEBAS DARI PENJARA ] ──*",
        `${tagOf(sender)} resmi keluar dari sel tahanan!`,
        note,
        `Dompet: ${formatRupiah(res.currentMoney)} | ATM: ${formatRupiah(res.currentBank)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses pembebasan penjara."));
  }
}

async function handleBebasUgd(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.releaseFromUgd(context.chatJid, sender);
    const sourceDetail =
      res.bankPaid > 0n
        ? ` (Dompet: ${formatCompactRupiah(res.walletPaid)} + Auto-debit ATM: ${formatCompactRupiah(res.bankPaid)})`
        : "";
    const note = res.coveredByInsurance
      ? "Ditanggung penuh oleh *BPJS Sultan VIP* (Gratis!)"
      : `Biaya perawatan VIP: -${formatRupiah(res.costPaid)}${sourceDetail}`;
    await context.reply(
      [
        "*── [ PULIH DARI UGD ] ──*",
        `${tagOf(sender)} sembuh total (HP 100/100) dan keluar dari UGD!`,
        note,
        `Dompet: ${formatRupiah(res.currentMoney)} | ATM: ${formatRupiah(res.currentBank)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal keluar dari UGD."));
  }
}

// ======================== PRESTIGE & FLEXING ========================

async function handlePrestige(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const info = await careerPrestigeService.getPrestigeOverview(context.chatJid, sender);
    await context.reply(
      [
        "*── [ STATUS PRESTIGE ] ──*",
        `Pemain   : ${tagOf(sender)}`,
        `Prestige : *★${String(info.prestige)} / ★${String(info.maxPrestige)}*`,
        `Boost    : *+${String(info.currentBoostPercent)}%* penghasilan Karir/Startup & XP permanen`,
        `Level    : Lv.${String(info.playerLevel)} (Min Lv.${String(PRESTIGE_MIN_PLAYER_LEVEL)} untuk rebirth)`,
        ...(info.nextCost
          ? [
              `Biaya ★${String(info.prestige + 1)}: ${formatRupiah(info.nextCost)}`,
              `Bonus    : +${String(PRESTIGE_BONUS_PERCENT_PER_STAR)}% permanen, +${String(PRESTIGE_REWARD_LIMIT)} Limit, +${String(PRESTIGE_REWARD_POINTS)} Poin`,
              "",
              "Naik bintang: *.rebirth*",
            ]
          : ["Status   : PRESTIGE TERTINGGI TERCAPAI!"]),
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat info prestige."));
  }
}

async function handleRebirth(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await careerPrestigeService.performRebirth(context.chatJid, sender);
    const caption = [
      "*── [ REBIRTH PRESTIGE SUKSES! ] ──*",
      `${tagOf(sender)} menembus *PRESTIGE ★${String(res.newPrestige)}*!`,
      `Boost Permanen : *+${String(res.newBoostPercent)}%* Uang & XP`,
      `Hadiah Langsung: +${String(res.limitBonus)} Limit | +${String(res.pointsBonus)} Poin`,
      `Biaya Rebirth  : -${formatRupiah(res.costPaid)}`,
      `Dompet         : ${formatRupiah(res.currentMoney)}`,
    ].join("\n");

    await sendEventBannerOrReply(context, {
      scene: "jackpot_sultan",
      headline: `PRESTIGE ★${String(res.newPrestige)} UNLOCKED!`,
      subjectName: getPushOrPhone(context, sender),
      details: [
        `Permanent Boost: +${String(res.newBoostPercent)}% Uang & XP`,
        `Bonus: +${String(res.limitBonus)} Limit & +${String(res.pointsBonus)} Poin`,
        `Biaya: ${formatCompactRupiah(res.costPaid)}`,
      ],
      targetUserJid: sender,
      avatarAltJids: context.senderAltJids,
      caption,
      mentions: [sender],
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melakukan rebirth."));
  }
}

async function handleTopRebirth(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const rows = await careerPrestigeService.listTopPrestige(context.chatJid, 10);
    if (rows.length === 0) {
      await context.reply("Belum ada member yang mencapai Prestige. Ketik *.prestige* untuk melihat syaratnya!");
      return;
    }
    const mentions = rows.map((r) => r.userJid);
    const lines = rows.map(
      (r, idx) =>
        `${String(idx + 1)}. ${tagOf(r.userJid)} — *★${String(r.prestige)}* (Lv.${String(r.level)})`,
    );
    await context.reply(["*── [ TOP PRESTIGE GRUP ] ──*", "", ...lines].join("\n"), { mentions });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat top prestige."));
  }
}

async function resolveOptionalTarget(context: CommandContext): Promise<string> {
  const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
  if (rawTarget) {
    return identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      normalizeUserJid(rawTarget),
    );
  }
  return resolveSender(context);
}

async function handleFlex(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const target = await resolveOptionalTarget(context);
    const summary = await careerPrestigeService.getAssetSummary(context.chatJid, target);
    const memberName =
      target === (await resolveSender(context))
        ? getPushOrPhone(context, target)
        : (target.split("@")[0] ?? "Sultan");

    const avatarBuffer = await avatarService
      .getAvatarWithFallback(context.socket, target, [])
      .catch(() => null);

    const cardPng = await eventBannerService.renderSultanBlackCard({
      memberName,
      customTitle: summary.customTitle,
      rank: summary.rank,
      level: summary.level,
      prestige: summary.prestige,
      netWorth: summary.netWorth,
      cashBalance: summary.moneyBalance,
      bankBalance: summary.bankBalance + summary.depositoValue,
      investAndAssetValue:
        summary.stocksValue + summary.cryptoValue + summary.propertyValue + summary.startupValuation,
      wealthPosition: summary.wealthPosition,
      avatarBuffer,
    });

    const caption = [
      "*── [ MINJIBOT BLACK CARD ] ──*",
      `Pemilik  : ${tagOf(target)}`,
      `Net Worth: *${formatRupiah(summary.netWorth)}*`,
      `Rank     : *${summary.rank}* (Lv.${String(summary.level)} | Prestige ★${String(summary.prestige)})`,
      ...(summary.wealthPosition > 0
        ? [`Peringkat: Top #${String(summary.wealthPosition)} Terkaya di Grup`]
        : []),
    ].join("\n");

    const rawSocket = (context as { socket?: unknown }).socket as {
      sendMessage?: (
        chatJid: string,
        content: { image: Buffer; caption: string; mentions?: string[] },
        opts?: { quoted?: unknown },
      ) => Promise<unknown>;
    };

    if (typeof rawSocket.sendMessage === "function") {
      await rawSocket.sendMessage(
        context.chatJid,
        { image: cardPng, caption, mentions: [target] },
        { quoted: context.message },
      );
      return;
    }

    await context.reply(caption, { mentions: [target] });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencetak Black Card Sultan."));
  }
}

async function handleCekAset(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const target = await resolveOptionalTarget(context);
    const s = await careerPrestigeService.getAssetSummary(context.chatJid, target);
    await context.reply(
      [
        "*── [ RINCIAN KEKAYAAN BERSIH ] ──*",
        `Pemilik   : ${tagOf(target)}`,
        `Tier      : *${s.rank}* | Lv.${String(s.level)} | Prestige ★${String(s.prestige)}`,
        "",
        `- Dompet    : ${formatCompactRupiah(s.moneyBalance)}`,
        `- Bank      : ${formatCompactRupiah(s.bankBalance)}`,
        `- Deposito  : ${formatCompactRupiah(s.depositoValue)}`,
        `- Saham     : ${formatCompactRupiah(s.stocksValue)}`,
        `- Kripto    : ${formatCompactRupiah(s.cryptoValue)}`,
        `- Properti  : ${formatCompactRupiah(s.propertyValue)}`,
        `- Startup   : ${formatCompactRupiah(s.startupValuation)}${s.startupName ? ` (${s.startupName})` : ""}`,
        `- Utang     : -${formatCompactRupiah(s.loanDebt)}`,
        "",
        `*Net Worth  : ${formatRupiah(s.netWorth)}*`,
        `_Cetak kartu VIP: ketik .flex_`,
      ].join("\n"),
      { mentions: [target] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung kekayaan bersih."));
  }
}

export const careerPrestigeCommands: CommandDefinition[] = [
  { name: "karir", aliases: ["career"], execute: handleKarir },
  { name: "lamar", aliases: ["apply"], execute: handleLamar },
  { name: "shift", aliases: ["kerjashift"], execute: handleShift },
  { name: "promosi", execute: handlePromosi },
  { name: "resign", execute: handleResign },
  { name: "startup", aliases: ["perusahaan"], execute: handleStartup },
  { name: "buatstartup", execute: handleBuatStartup },
  { name: "rekruit", execute: handleRekruit },
  { name: "upgradestartup", execute: handleUpgradeStartup },
  { name: "dividen", execute: handleDividen },
  { name: "topstartup", execute: handleTopStartup },
  { name: "pinjam", aliases: ["pinjol"], execute: handlePinjam },
  { name: "bayarutang", aliases: ["lunasi"], execute: handleBayarUtang },
  { name: "cekutang", aliases: ["utang"], execute: handleCekUtang },
  { name: "asuransi", execute: handleAsuransi },
  { name: "beliasuransi", execute: handleBeliAsuransi },
  { name: "bebaspenjara", execute: handleBebasPenjara },
  { name: "bebasugd", execute: handleBebasUgd },
  { name: "prestige", execute: handlePrestige },
  { name: "rebirth", execute: handleRebirth },
  { name: "toprebirth", execute: handleTopRebirth },
  { name: "flex", aliases: ["sultancard", "blackcard"], execute: handleFlex },
  { name: "networth", aliases: ["cekaset"], execute: handleCekAset },
];
