import { MemberTransactionAsset } from "@prisma/client";

import { identityResolverService } from "../../services/identity/identityResolver.service";
import {
  BUDGET_DEFAULT_AMOUNT,
  BUDGET_MAX_AMOUNT,
  BUDGET_MIN_AMOUNT,
  CANDIDATE_MIN_LEVEL,
  CANDIDATE_REGISTRATION_FEE,
  COUP_COST,
  COUP_MIN_LEVEL,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  politicsClanAnalyticsService,
} from "../../services/rpg/politicsClanAnalytics.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  formatCompactRupiah,
  formatRemainingDuration,
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

function renderProgressBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round(clamped / 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${String(clamped)}%`;
}

function formatWibShort(date: Date): string {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("day")}/${pick("month")} ${pick("hour")}:${pick("minute")}`;
}

function formatSignedAssetDelta(asset: MemberTransactionAsset, amount: bigint): string {
  const sign = amount >= 0n ? "+" : "-";
  const abs = amount >= 0n ? amount : -amount;
  if (asset === MemberTransactionAsset.MONEY || asset === MemberTransactionAsset.BANK) {
    const prefix = asset === MemberTransactionAsset.BANK ? "ATM " : "";
    return `${sign}${prefix}${formatCompactRupiah(abs)}`;
  }
  if (asset === MemberTransactionAsset.POINT) {
    return `${sign}${abs.toString()} Poin`;
  }
  if (asset === MemberTransactionAsset.LIMIT) {
    return `${sign}${abs.toString()} Limit`;
  }
  return `${sign}${abs.toString()} XP`;
}

function isPrivilegedElectionRole(context: CommandContext): boolean {
  return (
    context.role === "SUPER_OWNER" ||
    context.role === "TENANT_OWNER" ||
    context.role === "TENANT_ADMIN"
  );
}

// ==================== 1. PEMILU & PRESIDEN GRUP ====================

async function handlePemilu(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);
  const sub = (context.args[0] ?? "").trim().toLowerCase();

  try {
    if (sub === "tutup" || sub === "lantik" || sub === "close" || sub === "selesai") {
      const fin = await politicsClanAnalyticsService.finalizeElection(
        context.chatJid,
        isPrivilegedElectionRole(context),
      );
      if (!fin.winnerJid) {
        await context.reply(
          "Pemilu ditutup tanpa pemenang karena tidak ada kandidat yang mendaftar. Ketik *.pemilu* lagi untuk membuka pemilihan baru.",
        );
        return;
      }

      const rankLines = fin.ranking.slice(0, 5).map(
        (c, idx) =>
          `${String(idx + 1)}. ${tagOf(c.userJid)} - ${String(c.votes)} suara (${String(c.percent)}%)`,
      );
      const mentions = Array.from(new Set([fin.winnerJid, ...fin.ranking.map((r) => r.userJid)]));
      const caption = [
        "*── [ PELANTIKAN PRESIDEN GRUP ] ──*",
        `Presiden Terpilih : ${tagOf(fin.winnerJid)}`,
        `Slogan            : "${fin.winnerSlogan}"`,
        `Perolehan Suara   : *${String(fin.winnerVotes)}* / ${String(fin.totalVotes)} suara`,
        `Bonus Pelantikan  : +${String(fin.xpAwarded)} XP`,
        `Masa Jabatan      : 7 Hari`,
        "",
        "*Hasil Rekapitulasi:*",
        ...rankLines,
        "",
        "Cek istana: *.presiden* | Cairkan Kas Negara: *.bagianggaran [jumlah]*",
      ].join("\n");

      await sendEventBannerOrReply(context, {
        scene: "istana_presiden",
        headline: "PRESIDEN BARU DILANTIK!",
        subjectName: tagOf(fin.winnerJid),
        targetUserJid: fin.winnerJid,
        details: [
          `Perolehan: ${String(fin.winnerVotes)} dari ${String(fin.totalVotes)} suara`,
          `Masa Jabatan: 7 Hari (+${String(fin.xpAwarded)} XP)`,
        ],
        caption,
        mentions,
      });
      return;
    }

    const res = await politicsClanAnalyticsService.inspectOrStartElection(context.chatJid, senderJid);

    if (res.mode === "president_serving" && res.president) {
      await context.reply(
        [
          "*── [ PEMILU BELUM DIBUKA ] ──*",
          `Presiden Aktif : ${tagOf(res.president.presidentJid)}`,
          `Sisa Jabatan   : ${formatRemainingDuration(res.remainingMs)}`,
          "",
          "Pemilu baru otomatis bisa dimulai setelah masa jabatan berakhir, atau rebut tahta lewat *.kudeta*!",
        ].join("\n"),
        { mentions: [res.president.presidentJid] },
      );
      return;
    }

    if (res.mode === "auto_finalized") {
      if (!res.winnerJid) {
        await context.reply(
          "Waktu Pemilu telah habis namun tidak ada calon yang mendaftar. Ketik *.pemilu* lagi untuk membuka Pemilu baru.",
        );
        return;
      }
      const caption = [
        "*── [ HASIL PEMILU GRUP ] ──*",
        `Presiden Baru : ${tagOf(res.winnerJid)}`,
        `Perolehan     : *${String(res.winnerVotes)}* / ${String(res.totalVotes)} suara`,
        `Bonus         : +${String(res.winnerXpBonus)} XP`,
        `Masa Jabatan  : 7 Hari`,
        "",
        "Cek status: *.presiden* | Salurkan subsidi: *.bagianggaran*",
      ].join("\n");

      await sendEventBannerOrReply(context, {
        scene: "istana_presiden",
        headline: "PRESIDEN BARU DILANTIK!",
        subjectName: tagOf(res.winnerJid),
        targetUserJid: res.winnerJid,
        details: [
          `Suara: ${String(res.winnerVotes)} / ${String(res.totalVotes)}`,
          "Masa Jabatan 7 Hari Dimulai!",
        ],
        caption,
        mentions: [res.winnerJid],
      });
      return;
    }

    const candLines =
      res.candidates.length > 0
        ? res.candidates.map((c) =>
            [
              `*${String(c.index)}.* ${tagOf(c.userJid)}`,
              `  ├ Suara  : *${String(c.votes)}* (${String(c.percent)}%)`,
              `  └ Slogan : _"${c.slogan}"_`,
            ].join("\n"),
          )
        : [
            `  _Belum ada calon (Min Lv.${String(CANDIDATE_MIN_LEVEL)}, biaya ${formatCompactRupiah(CANDIDATE_REGISTRATION_FEE)})._`,
          ];
    const mentions = res.candidates.map((c) => c.userJid);

    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          res.mode === "started" ? "╭─〔 PEMILU GRUP DIBUKA! 〕─╮" : "╭─〔 PEMILU GRUP AKTIF 〕─╮",
          `│ Sisa Waktu : ${formatRemainingDuration(res.remainingMs)}`,
          `│ Partisipasi: ${String(res.totalVotes)} pemilih`,
          res.mode === "started" ? "╰──────────────────────────╯" : "╰────────────────────────╯",
          "",
          "*Daftar Calon Presiden:*",
          ...candLines,
          "",
          "*Perintah Cepat:*",
          "• `.daftarcalon <slogan>`",
          "• `.coblos @calon` atau `.coblos <no>` (+50 XP)",
          "• `.pemilu lantik` (Admin/Owner)",
        ].join("\n"),
        mentions,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses Pemilu Grup."));
  }
}

async function handleDaftarCalon(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await politicsClanAnalyticsService.registerCandidate(
      context.chatJid,
      senderJid,
      context.argsText,
    );
    await context.reply(
      [
        "*── [ PENDAFTARAN CAPRES SAH ] ──*",
        `Nomor Urut : *#${String(res.candidateNumber)}*`,
        `Kandidat   : ${tagOf(res.candidateJid)}`,
        `Slogan     : "${res.slogan}"`,
        `Biaya      : -${formatRupiah(res.feePaid)} (masuk Kas Negara)`,
        `Dompetmu   : ${formatRupiah(res.currentMoney)}`,
        "",
        `Ajak warga grup mencoblosmu lewat *.coblos @${res.candidateJid.split("@")[0] ?? ""}* atau *.coblos ${String(res.candidateNumber)}*!`,
      ].join("\n"),
      { mentions: [res.candidateJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mendaftar sebagai calon Presiden."));
  }
}

async function handleCoblos(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  let target: string | number | null = null;
  const firstArg = (context.args[0] ?? "").trim();
  if (context.mentionedJids.length === 0 && !context.quoted && /^[1-8]$/.test(firstArg)) {
    target = Number.parseInt(firstArg, 10);
  } else {
    const resolved = await resolveTargetMember(context);
    if (resolved) {
      if (isBotUserJid(context.socket, context.mentionedJids[0], resolved)) {
        await context.reply("Minji netral sebagai KPU Grup! Pilih calon dari member manusia ya.");
        return;
      }
      target = resolved;
    }
  }

  if (target === null) {
    await context.reply("Format: *.coblos @calon* atau *.coblos <nomor_urut>*\nCek daftar calon di *.pemilu*.");
    return;
  }

  try {
    const res = await politicsClanAnalyticsService.castVote(context.chatJid, senderJid, target);
    await context.reply(
      [
        "*── [ SUARA SAH TERCATAT ] ──*",
        `Pemilih     : ${tagOf(res.voterJid)}`,
        `Memilih     : ${tagOf(res.candidateJid)}`,
        `Suara Calon : *${String(res.candidateVotes)}* / ${String(res.totalVotes)} total suara`,
        `Apresiasi   : +${String(res.xpGained)} XP partisipasi Pemilu!`,
      ].join("\n"),
      { mentions: [res.voterJid, res.candidateJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencatat suara Pemilu."));
  }
}

async function handlePresiden(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  try {
    const snap = await politicsClanAnalyticsService.getPresidentStatus(context.chatJid);
    if (!snap.president) {
      await context.reply(
        [
          "╭─〔 ISTANA PRESIDEN GRUP 〕─╮",
          "│ Status : *Kursi Kosong*",
          `│ Kas    : *${formatCompactRupiah(snap.treasuryBalance)}*`,
          snap.hasActiveElection
            ? `│ Pemilu : Aktif (${formatRemainingDuration(snap.electionRemainingMs)})`
            : "│ Pemilu : Belum dimulai",
          "╰───────────────────────────╯",
          "",
          "*Mulai Pemilu:* `.pemilu`",
        ].join("\n"),
      );
      return;
    }

    const p = snap.president;
    await context.reply(
      [
        "╭─〔 ISTANA PRESIDEN GRUP 〕─╮",
        `│ Presiden : ${tagOf(p.presidentJid)}${p.viaCoup ? " [KUDETA]" : ""}`,
        `│ Slogan   : _"${p.slogan}"_`,
        `│ Sisa Masa: ${formatRemainingDuration(snap.termRemainingMs)}`,
        `│ Kas Grup : *${formatCompactRupiah(snap.treasuryBalance)}*`,
        "╰───────────────────────────╯",
        "",
        "*Catatan Pemerintahan:*",
        `  ├ Tersalurkan : ${formatCompactRupiah(p.totalDistributed)}`,
        `  ├ Kudeta Gagal: ${String(p.coupsRepelled)}x`,
        `  ├ Anggaran CD : ${snap.budgetCooldownMs > 0 ? formatRemainingDuration(snap.budgetCooldownMs) : "*SIAP* (`.bagianggaran`)"}`,
        `  └ Kudeta CD   : ${snap.coupCooldownMs > 0 ? formatRemainingDuration(snap.coupCooldownMs) : `*TERBUKA* (Lv.${String(COUP_MIN_LEVEL)}, ${formatCompactRupiah(COUP_COST)})`}`,
        "",
        "*Perintah Cepat:* `.bagianggaran` | `.kudeta`",
      ].join("\n"),
      { mentions: [p.presidentJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memeriksa status Presiden Grup."));
  }
}

async function handleBagiAnggaran(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  let amount = BUDGET_DEFAULT_AMOUNT;
  if (context.args[0]) {
    const parsed = parsePositiveBigIntMoneyInput(context.args[0]);
    if (parsed === null) {
      await context.reply(
        `Nominal tidak valid (${formatCompactRupiah(BUDGET_MIN_AMOUNT)} - ${formatCompactRupiah(BUDGET_MAX_AMOUNT)}).\nContoh: *.bagianggaran 50jt*`,
      );
      return;
    }
    amount = parsed;
  }

  try {
    const res = await politicsClanAnalyticsService.distributeBudget(context.chatJid, senderJid, amount);
    const previewTags = res.recipients.slice(0, 10).map((jid) => tagOf(jid)).join(", ");
    const extraCount = Math.max(0, res.recipients.length - 10);

    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ PENCAIRAN ANGGARAN PRESIDEN ] ──*",
          `Presiden     : ${tagOf(res.presidentJid)}`,
          `Total Cair   : *${formatRupiah(res.distributedTotal)}*`,
          `Penerima     : ${String(res.recipients.length)} warga aktif`,
          `Per Warga    : *+${formatRupiah(res.perMember)}*`,
          `Sisa Kas     : ${formatRupiah(res.remainingTreasury)}`,
          "",
          `Warga Penerima: ${previewTags}${extraCount > 0 ? ` (+${String(extraCount)} lainnya)` : ""}`,
        ].join("\n"),
        mentions: Array.from(new Set([res.presidentJid, ...res.recipients])),
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencairkan anggaran Presiden."));
  }
}

async function handleKudeta(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await politicsClanAnalyticsService.attemptCoup(context.chatJid, senderJid);
    const mentions = [res.challengerJid, res.formerPresidentJid];

    if (res.success) {
      const caption = [
        "*── [ KUDETA BERHASIL! REZIM BERGANTI ] ──*",
        `Presiden Baru : ${tagOf(res.challengerJid)}`,
        `Digulingkan   : ${tagOf(res.formerPresidentJid)}`,
        `Biaya Aksi    : -${formatRupiah(res.costPaid)} (ke Kas Negara)`,
        `Bonus         : +${String(res.xpGained)} XP`,
        `Masa Jabatan  : 7 Hari`,
        "",
        "Istana kini milikmu! Cek status di *.presiden* atau cairkan subsidi lewat *.bagianggaran*.",
      ].join("\n");

      await sendEventBannerOrReply(context, {
        scene: "istana_presiden",
        headline: "KUDETA BERHASIL!",
        subjectName: tagOf(res.challengerJid),
        targetUserJid: res.challengerJid,
        details: [
          `Menggulingkan ${tagOf(res.formerPresidentJid)}`,
          `Biaya: ${formatCompactRupiah(res.costPaid)} | +${String(res.xpGained)} XP`,
        ],
        caption,
        mentions,
      });
      return;
    }

    const failCaption = [
      "*── [ KUDETA GAGAL! MASUK PENJARA ] ──*",
      `Pelaku        : ${tagOf(res.challengerJid)}`,
      `Presiden Aman : ${tagOf(res.formerPresidentJid)} (${String(res.coupsRepelled)}x lolos kudeta)`,
      `Dana Hangus   : -${formatRupiah(res.costPaid)} (masuk Kas Negara)`,
      `Hukuman       : Dipenjara *${String(res.jailMinutes)} menit*`,
      "",
      "Ingin bebas cepat? Gunakan *.bebaspenjara*!",
    ].join("\n");

    await sendEventBannerOrReply(context, {
      scene: "penjara_ronda",
      headline: "KUDETA GAGAL! MASUK SEL",
      subjectName: tagOf(res.challengerJid),
      targetUserJid: res.challengerJid,
      details: [
        `Dana ${formatCompactRupiah(res.costPaid)} disita negara`,
        `Hukuman Penjara: ${String(res.jailMinutes)} Menit`,
      ],
      caption: failCaption,
      mentions,
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjalankan aksi kudeta."));
  }
}

// ==================== 2. UPGRADE & PERANG GENG ====================

async function handleGengUpgrade(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await politicsClanAnalyticsService.upgradeClan(context.chatJid, senderJid);
    await context.reply(
      [
        "*── [ UPGRADE MARKAS GENG ] ──*",
        `Geng       : *${res.clanName}*`,
        `Level      : Lv.${String(res.oldLevel)} -> *Lv.${String(res.newLevel)}*`,
        `Biaya Kas  : -${formatRupiah(res.costPaid)}`,
        `Sisa Kas   : ${formatRupiah(res.remainingTreasury)}`,
        `Bonus War  : *+${String(res.warPowerBonusPercent)}%* Power Tim`,
        `Durasi Buff: *${String(res.buffDurationMinutes)} menit* (.gengbuff)`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal meng-upgrade level geng."));
  }
}

async function handleGengBuff(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await politicsClanAnalyticsService.claimClanBuff(context.chatJid, senderJid);
    await context.reply(
      [
        "*── [ BUFF MARKAS GENG AKTIF ] ──*",
        `Geng       : *${res.clanName}* (Lv.${String(res.clanLevel)})`,
        `HP Pulih   : *${String(res.hpAfter)} / 100*`,
        `Bonus XP   : *+${String(res.xpGained)} XP*`,
        `Jamu Kuat  : +35% Power (+${String(res.buffMinutesAdded)} mnt | sisa ${formatRemainingDuration(res.jamuRemainingMs)})`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengklaim buff geng."));
  }
}

async function handleGengWar(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);
  const targetName = context.argsText.trim();
  if (!targetName) {
    await context.reply("Sebutkan nama geng lawan.\nContoh: *.gengwar Garuda*\nCek daftar geng: *.geng top*");
    return;
  }

  try {
    const res = await politicsClanAnalyticsService.startClanWar(context.chatJid, senderJid, targetName);
    const mentions = Array.from(
      new Set(
        [res.attackerMvpJid, res.defenderMvpJid, ...res.rewardedMemberJids.slice(0, 6)].filter(
          (v): v is string => Boolean(v),
        ),
      ),
    );

    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ HASIL PERANG GENG ] ──*",
          `*${res.attackerClanName}* (Lv.${String(res.attackerLevel)}, ${String(res.attackerMemberCount)} org) vs *${res.defenderClanName}* (Lv.${String(res.defenderLevel)}, ${String(res.defenderMemberCount)} org)`,
          "",
          `Power Penyerang : *${res.attackerPower.toLocaleString("id-ID")}*${res.attackerMvpJid ? ` (MVP: ${tagOf(res.attackerMvpJid)})` : ""}`,
          `Power Bertahan  : *${res.defenderPower.toLocaleString("id-ID")}*${res.defenderMvpJid ? ` (MVP: ${tagOf(res.defenderMvpJid)})` : ""}`,
          "",
          `Pemenang        : *${res.winnerClanName}* (Total Menang: ${String(res.winnerWarWins)}x)`,
          `Rampasan Kas    : *+${formatRupiah(res.treasuryLoot)}* dari ${res.loserClanName}`,
          `Kas Pemenang    : ${formatRupiah(res.winnerTreasuryAfter)}`,
          `Bonus Anggota   : +${formatCompactRupiah(res.memberBonusMoney)} & +${String(res.memberBonusXp)} XP (${String(res.rewardedMemberJids.length)} org)`,
        ].join("\n"),
        mentions,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjalankan Perang Geng."));
  }
}

// ==================== 3. ANALISIS PROGRES & HEAD-TO-HEAD ====================

async function handleBandingkan(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);
  const targetJid = await resolveTargetMember(context);

  if (!targetJid) {
    await context.reply("Tag atau reply pesan lawan yang ingin dibandingkan.\nContoh: *.bandingkan @user*");
    return;
  }
  if (isBotUserJid(context.socket, context.mentionedJids[0], targetJid)) {
    await context.reply("Jangan bandingkan sama Minji dong, Minji kan servernya sendiri!");
    return;
  }

  try {
    const res = await politicsClanAnalyticsService.comparePlayers(context.chatJid, senderJid, targetJid);
    const L = res.left;
    const R = res.right;
    const verdict = res.overallWinnerJid
      ? `Dominasi: ${tagOf(res.overallWinnerJid)} (*${String(res.leftWins)} - ${String(res.rightWins)}*, seri ${String(res.ties)})`
      : `Hasil Seimbang! (*${String(res.leftWins)} - ${String(res.rightWins)}*, seri ${String(res.ties)})`;

    await context.reply(
      [
        "╭─〔 HEAD-TO-HEAD PEMAIN 〕─╮",
        `│ ${tagOf(L.userJid)}  VS  ${tagOf(R.userJid)}`,
        `│ ${verdict}`,
        "╰──────────────────────────╯",
        "",
        "*Perbandingan Utama:*",
        `  ├ Level    : Lv.${String(L.level)} vs Lv.${String(R.level)}`,
        `  ├ Rank     : ${L.rank} vs ${R.rank}`,
        `  ├ XP       : ${L.experience.toLocaleString("id-ID")} vs ${R.experience.toLocaleString("id-ID")}`,
        `  ├ Total Kas: ${formatCompactRupiah(L.totalCash)} vs ${formatCompactRupiah(R.totalCash)}`,
        `  ├ Power    : ${L.combatPower.toLocaleString("id-ID")} vs ${R.combatPower.toLocaleString("id-ID")}`,
        `  └ Prestige : ★${String(L.prestige)} vs ★${String(R.prestige)}`,
        "",
        "*Aktivitas & Aset:*",
        `  ├ Menang   : ${String(L.gamesWon)} (${String(L.winRatePercent)}%) vs ${String(R.gamesWon)} (${String(R.winRatePercent)}%)`,
        `  ├ Dermawan : ${formatCompactRupiah(L.totalDonated)} vs ${formatCompactRupiah(R.totalDonated)}`,
        `  ├ Streak   : ${String(L.longestStreak)}h vs ${String(R.longestStreak)}h`,
        `  ├ Properti : ${String(L.propertyCount)} vs ${String(R.propertyCount)} unit`,
        `  ├ Karir    : ${L.careerTitle} | ${R.careerTitle}`,
        `  └ Geng     : ${L.clanName ?? "-"} vs ${R.clanName ?? "-"}`,
      ].join("\n"),
      { mentions: [L.userJid, R.userJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membandingkan profil pemain."));
  }
}

async function handleTargetRank(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await politicsClanAnalyticsService.getTargetRank(context.chatJid, senderJid);
    const levelReadyNote =
      res.reachableLevel > res.currentLevel
        ? [`*SIAP NAIK!* Ketik \`.levelup\` -> *Lv.${String(res.reachableLevel)}*`, ""]
        : [];

    const milestoneLines =
      res.upcomingMilestones.length > 0
        ? [
            "",
            "*Target Unlock Level Berikutnya:*",
            ...res.upcomingMilestones.map((m, idx) => {
              const branch = idx === res.upcomingMilestones.length - 1 ? "└" : "├";
              return `  ${branch} Lv.${String(m.requiredLevel)} (+${String(m.levelsAway)} lv) — ${m.label}`;
            }),
          ]
        : ["", "_Semua milestone level utama sudah terbuka!_"];

    await context.reply(
      [
        "╭─〔 TARGET RANK & LEVEL 〕─╮",
        `│ Pemain : ${tagOf(res.userJid)}`,
        `│ Level  : *Lv.${String(res.currentLevel)}* (${res.experience.toLocaleString("id-ID")} XP)`,
        `│ Rank   : *${res.currentRank}* -> ${res.nextRank ? `*${res.nextRank}*` : "*MAX*"}`,
        "╰──────────────────────────╯",
        "",
        ...levelReadyNote,
        "*Progres Level:*",
        `  ├ ${renderProgressBar(res.levelProgressPercent)}`,
        `  └ Kurang *${res.xpToNextLevel.toLocaleString("id-ID")} XP* ke Lv.${String(res.currentLevel + 1)}`,
        "",
        "*Progres Rank:*",
        `  ├ ${renderProgressBar(res.rankProgressPercent)}`,
        `  └ ${res.nextRank ? `Kurang *${res.xpToNextRank.toLocaleString("id-ID")} XP* ke ${res.nextRank}` : "Tier tertinggi tercapai!"}`,
        "",
        "*Estimasi Aksi Menuju Target:*",
        `  ├ \`.kuis\` (~80 XP)       : ~${String(res.estimatedKuisRuns)}x`,
        `  ├ \`.kerja\` (~55 XP)      : ~${String(res.estimatedKerjaRuns)}x`,
        `  └ \`.serangboss\` (~350 XP): ~${String(res.estimatedBossRuns)}x`,
        ...milestoneLines,
      ].join("\n"),
      { mentions: [res.userJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung target rank."));
  }
}

async function handleRiwayat(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  let limit = HISTORY_DEFAULT_LIMIT;
  if (context.args[0]) {
    const parsed = Number.parseInt(context.args[0], 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > HISTORY_MAX_LIMIT) {
      await context.reply(
        `Jumlah baris mutasi harus antara 1 sampai ${String(HISTORY_MAX_LIMIT)}. Contoh: *.riwayat 15*`,
      );
      return;
    }
    limit = parsed;
  }

  try {
    const res = await politicsClanAnalyticsService.getTransactionHistory(
      context.chatJid,
      senderJid,
      limit,
    );
    if (res.entries.length === 0) {
      await context.reply("Belum ada riwayat transaksi yang tercatat untuk akunmu di grup ini.");
      return;
    }

    const lines = res.entries.map((e, idx) => {
      const timeStr = formatWibShort(e.createdAt);
      const deltaStr = formatSignedAssetDelta(e.asset, e.amount);
      return [
        `*${String(idx + 1)}. ${e.label}* (\`${timeStr}\`)`,
        `  └ ${deltaStr}`,
      ].join("\n");
    });

    await context.reply(
      [
        `╭─〔 MUTASI ${String(res.entries.length)} TRANSAKSI 〕─╮`,
        `│ Pemilik : ${tagOf(res.userJid)}`,
        "│ Zona    : WIB (Asia/Jakarta)",
        "╰──────────────────────────╯",
        "",
        ...lines,
      ].join("\n"),
      { mentions: [res.userJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat riwayat transaksi."));
  }
}

async function handleStatistik(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const target = (await resolveTargetMember(context)) ?? (await resolveSender(context));
  if (isBotUserJid(context.socket, context.mentionedJids[0], target)) {
    await context.reply("Statistik Minji: 100% Online, 0% Tidur!");
    return;
  }

  try {
    const s = await politicsClanAnalyticsService.getPlayerStatistics(context.chatJid, target);
    await context.reply(
      [
        "╭─〔 STATISTIK LENGKAP 〕─╮",
        `│ Pemain : ${tagOf(s.userJid)}${s.customTitle ? ` [${s.customTitle}]` : ""}`,
        `│ Tier   : *${s.rank}* | Lv.${String(s.level)} (★${String(s.prestige)})`,
        `│ Rank   : Kaya #${String(s.wealthRank)} | XP #${String(s.xpRank)} | Lv #${String(s.levelRank)}`,
        `│ Tempur : Power *${s.combatPower.toLocaleString("id-ID")}* | HP ${String(s.hp)}/100`,
        `│ Skill  : SP Bebas ${String(s.unspentSkillPoints)}/${String(s.totalSkillPoints)}`,
        "╰────────────────────────╯",
        "",
        "*Keuangan & Saldo:*",
        `  ├ Total Kas : *${formatCompactRupiah(s.totalCash)}*`,
        `  ├ Dompet/ATM: ${formatCompactRupiah(s.wallet)} / ${formatCompactRupiah(s.bank)}`,
        `  ├ Total Cuan: ${formatCompactRupiah(s.totalMoneyEarned)}`,
        `  ├ Donasi    : ${formatCompactRupiah(s.totalDonated)}`,
        `  └ Poin/Limit: ${s.pointsBalance.toLocaleString("id-ID")} P | ${s.limitBalance.toLocaleString("id-ID")} L`,
        "",
        "*Aktivitas & Karir:*",
        `  ├ Game    : ${String(s.gamesWon)}/${String(s.gamesPlayed)} (${String(s.winRatePercent)}% WR)`,
        `  ├ Streak  : ${String(s.currentStreak)}h (Rekor ${String(s.longestStreak)}h)`,
        `  ├ Chat    : ${s.messageCount.toLocaleString("id-ID")}x pesan`,
        `  ├ Koleksi : ${String(s.propertyUnits)} Prop | ${String(s.uniqueCards)} Kartu | ${String(s.achievementsCount)} Lencana`,
        `  ├ Karir   : ${s.careerLabel}`,
        `  ├ Startup : ${s.startupLabel}`,
        `  └ Geng    : ${s.clanLabel}`,
      ].join("\n"),
      { mentions: [s.userJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat statistik pemain."));
  }
}

// ==================== 4. TAHTA KEHORMATAN GRUP ====================

async function handleHallOfFame(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  try {
    const h = await politicsClanAnalyticsService.getHallOfFame(context.chatJid);
    const mentionSet = new Set<string>();
    if (h.president) mentionSet.add(h.president.presidentJid);
    if (h.richest) mentionSet.add(h.richest.userJid);
    if (h.topXp) mentionSet.add(h.topXp.userJid);
    if (h.topLevel) mentionSet.add(h.topLevel.userJid);
    if (h.topPrestige) mentionSet.add(h.topPrestige.userJid);
    if (h.topGamesWon) mentionSet.add(h.topGamesWon.userJid);
    if (h.topDonated) mentionSet.add(h.topDonated.userJid);
    if (h.topStreak) mentionSet.add(h.topStreak.userJid);

    const lines = [
      "╭─〔 HALL OF FAME GRUP 〕─╮",
      "│ Tahta Kehormatan & Legenda Grup",
      "╰────────────────────────╯",
      "",
      "*1. Presiden Grup*",
      `  └ ${h.president ? `${tagOf(h.president.presidentJid)}${h.president.viaCoup ? " [KUDETA]" : ""}` : "_Kursi Kosong (`.pemilu`)_"}`,
      "*2. Sultan Terkaya*",
      `  └ ${h.richest ? `${tagOf(h.richest.userJid)} — *${formatCompactRupiah(h.richest.totalCash)}*` : "-"}`,
      "*3. Rank Tertinggi*",
      `  └ ${h.topXp ? `${tagOf(h.topXp.userJid)} — ${h.topXp.rank} (${h.topXp.experience.toLocaleString("id-ID")} XP)` : "-"}`,
      "*4. Level Tertinggi*",
      `  └ ${h.topLevel ? `${tagOf(h.topLevel.userJid)} — *Lv.${String(h.topLevel.level)}*` : "-"}`,
      "*5. Raja Prestige*",
      `  └ ${h.topPrestige ? `${tagOf(h.topPrestige.userJid)} — *★${String(h.topPrestige.prestige)}*` : "-"}`,
      "*6. Raja Game*",
      `  └ ${h.topGamesWon ? `${tagOf(h.topGamesWon.userJid)} — ${String(h.topGamesWon.gamesWon)} menang` : "-"}`,
      "*7. Paling Dermawan*",
      `  └ ${h.topDonated ? `${tagOf(h.topDonated.userJid)} — ${formatCompactRupiah(h.topDonated.totalDonated)}` : "-"}`,
      "*8. Streak Terlama*",
      `  └ ${h.topStreak ? `${tagOf(h.topStreak.userJid)} — ${String(h.topStreak.longestStreak)} hari` : "-"}`,
      "*9. Geng Terkuat*",
      `  └ ${h.topClan ? `*${h.topClan.name}* (Lv.${String(h.topClan.level)} | ${String(h.topClan.warWins)}x War | Kas ${formatCompactRupiah(h.topClan.treasuryBalance)})` : "-"}`,
      "",
      "*Bandingkan Profil:* `.bandingkan @user`",
    ];

    await context.socket.sendMessage(
      context.chatJid,
      { text: lines.join("\n"), mentions: Array.from(mentionSet) },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat Hall of Fame grup."));
  }
}

export const politicsClanAnalyticsCommands: CommandDefinition[] = [
  {
    name: "pemilu",
    aliases: ["pilpres", "pemilugrup"],
    execute: handlePemilu,
  },
  {
    name: "daftarcalon",
    aliases: ["capres", "nyalon"],
    execute: handleDaftarCalon,
  },
  {
    name: "coblos",
    aliases: ["votecapres", "pilihpresiden"],
    execute: handleCoblos,
  },
  {
    name: "presiden",
    aliases: ["istana", "cekpresiden"],
    execute: handlePresiden,
  },
  {
    name: "bagianggaran",
    aliases: ["subsidi", "anggaran"],
    execute: handleBagiAnggaran,
  },
  {
    name: "kudeta",
    aliases: ["gulingkan", "rebuttahta"],
    execute: handleKudeta,
  },
  {
    name: "gengupgrade",
    aliases: ["upgradegeng", "clanupgrade"],
    execute: handleGengUpgrade,
  },
  {
    name: "gengbuff",
    aliases: ["buffgeng", "clanbuff"],
    execute: handleGengBuff,
  },
  {
    name: "gengwar",
    aliases: ["peranggeng", "clanwar"],
    execute: handleGengWar,
  },
  {
    name: "bandingkan",
    aliases: ["compare", "versus", "vs"],
    execute: handleBandingkan,
  },
  {
    name: "targetrank",
    aliases: ["cekrank", "nextrank"],
    execute: handleTargetRank,
  },
  {
    name: "riwayat",
    aliases: ["mutasi", "histori", "ledger"],
    execute: handleRiwayat,
  },
  {
    name: "statistik",
    aliases: ["statku", "mystat"],
    execute: handleStatistik,
  },
  {
    name: "halloffame",
    aliases: ["hof", "kehormatan", "legenda"],
    execute: handleHallOfFame,
  },
];
