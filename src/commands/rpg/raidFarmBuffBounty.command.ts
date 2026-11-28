import { identityResolverService } from "../../services/identity/identityResolver.service";
import {
  BLACK_MARKET_CATALOG,
  BOUNTY_MIN_AMOUNT,
  FARM_CROP_CATALOG,
  FARM_WATER_SPEEDUP_PERCENT,
  raidFarmBuffBountyService,
  SKILL_RESET_COST,
  SKILL_SPECS,
} from "../../services/rpg/raidFarmBuffBounty.service";
import { MAX_SKILL_STAT, SKILL_KEYS } from "../../services/rpg/rpgState";
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

function getDisplayName(context: CommandContext, jid: string): string {
  const push = context.message.pushName?.trim();
  if (push && push.length > 0) return push;
  return jid.split("@")[0] ?? "Petualang";
}

function renderHpBar(current: number, max: number): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const filled = Math.round(ratio * 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${String(Math.round(ratio * 100))}%`;
}

// ======================== 1. WORLD BOSS RAID ========================

async function handleWorldBoss(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  try {
    const res = await raidFarmBuffBountyService.inspectOrSpawnWorldBoss(context.chatJid);
    const topLines =
      res.topDamagers.length > 0
        ? [
            "",
            "*Top Damage Sementara:*",
            ...res.topDamagers
              .slice(0, 5)
              .map(
                (r, idx) =>
                  `${String(idx + 1)}. ${tagOf(r.userJid)} - ${r.damage.toLocaleString("id-ID")} dmg (${String(r.sharePercent)}%)`,
              ),
          ]
        : ["", "Belum ada yang menyerang. Jadilah yang pertama memukul boss!"];

    const mentions = res.topDamagers.slice(0, 5).map((r) => r.userJid);
    const text = [
      res.spawned ? "*── [ WORLD BOSS MUNCUL! ] ──*" : "*── [ WORLD BOSS AKTIF ] ──*",
      `Boss    : *${res.boss.spec.name}* (${res.boss.spec.title})`,
      `HP Boss : ${res.boss.currentHp.toLocaleString("id-ID")} / ${res.boss.spec.maxHp.toLocaleString("id-ID")}`,
      `Bar HP  : ${renderHpBar(res.boss.currentHp, res.boss.spec.maxHp)}`,
      `Pool    : *${formatRupiah(res.boss.spec.rewardPool)}* + Crate *${res.boss.spec.crateDrop.toUpperCase()}*`,
      `Sisa    : ${formatRemainingDuration(res.remainingMs)}`,
      ...topLines,
      "",
      "Serang bersama grup: *.serangboss* | Cek log: *.topdamage*",
    ].join("\n");

    if (res.spawned) {
      await sendEventBannerOrReply(context, {
        scene: "world_boss",
        headline: "WORLD BOSS MUNCUL!",
        subjectName: res.boss.spec.name,
        targetUserJid: context.senderUserJid,
        details: [
          `HP: ${res.boss.spec.maxHp.toLocaleString("id-ID")} | Pool: ${formatCompactRupiah(res.boss.spec.rewardPool)}`,
          "Ketik .serangboss rame-rame!",
        ],
        caption: text,
        mentions,
      });
      return;
    }

    await context.socket.sendMessage(
      context.chatJid,
      { text, mentions },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses World Boss."));
  }
}

async function handleSerangBoss(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await raidFarmBuffBountyService.attackWorldBoss(context.chatJid, senderJid);

    if (!res.defeated) {
      const hitText = [
        res.autoSpawned
          ? "*── [ WORLD BOSS MUNCUL & DISERANG! ] ──*"
          : res.isCrit
            ? "*── [ SERANGAN CRITICAL BOSS! ] ──*"
            : "*── [ SERANGAN WORLD BOSS ] ──*",
        `Target   : *${res.bossName}*`,
        `Damage   : *-${res.damageDealt.toLocaleString("id-ID")} HP*${res.isCrit ? " (CRIT!)" : ""}`,
        `Sisa HP  : ${res.bossHpAfter.toLocaleString("id-ID")} / ${res.bossMaxHp.toLocaleString("id-ID")}`,
        `Bar HP   : ${renderHpBar(res.bossHpAfter, res.bossMaxHp)}`,
        `HP Kamu  : ${String(res.hpAfter)}/100 (-${String(res.hpLost)} serangan balik)`,
        `Bonus    : +${String(res.participationXp)} XP (dicatat ke All-Time Damage!)`,
        "",
        "Ajak teman grup ketik *.serangboss* | Cek rekor: *.topdamage [all|riwayat]*",
      ].join("\n");

      if (res.autoSpawned) {
        await sendEventBannerOrReply(context, {
          scene: "world_boss",
          headline: "WORLD BOSS MUNCUL!",
          subjectName: res.bossName,
          targetUserJid: senderJid,
          details: [
            `Serangan pembuka: -${res.damageDealt.toLocaleString("id-ID")} HP`,
            `Sisa HP: ${res.bossHpAfter.toLocaleString("id-ID")} / ${res.bossMaxHp.toLocaleString("id-ID")}`,
          ],
          caption: hitText,
          mentions: [senderJid],
        });
        return;
      }

      await context.reply(hitText);
      return;
    }

    const mvp = res.distributions[0];
    const distLines = res.distributions.slice(0, 8).map((d, idx) => {
      const badge = d.isMvp ? " [MVP]" : d.isFinisher ? " [FINISHER]" : "";
      return `${String(idx + 1)}. ${tagOf(d.userJid)}${badge} (${String(d.sharePercent)}%) -> *+${formatCompactRupiah(d.moneyGained)}*, +${String(d.xpGained)} XP${d.crateGained ? `, +1 ${d.crateGained}` : ""}`;
    });
    const mentions = res.distributions.slice(0, 8).map((d) => d.userJid);

    const caption = [
      "*── [ WORLD BOSS TUMBANG!! ] ──*",
      `Boss     : *${res.bossName}* telah dikalahkan!`,
      `Finisher : ${tagOf(senderJid)} (-${res.damageDealt.toLocaleString("id-ID")} dmg)`,
      `Total    : *${formatRupiah(res.totalPoolPaid)}* dibagikan ke ${String(res.distributions.length)} pejuang!`,
      "",
      "*Pembagian Hadiah Raid:*",
      ...distLines,
    ].join("\n");

    await sendEventBannerOrReply(context, {
      scene: "world_boss",
      headline: "WORLD BOSS TUMBANG!",
      subjectName: getDisplayName(context, mvp?.userJid ?? senderJid),
      targetUserJid: mvp?.userJid ?? senderJid,
      details: [
        `${res.bossName} Kalah!`,
        `Total Hadiah: ${formatCompactRupiah(res.totalPoolPaid)}`,
      ],
      caption,
      mentions,
    });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menyerang World Boss."));
  }
}

async function handleStatusBoss(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const status = await raidFarmBuffBountyService.getWorldBossStatus(context.chatJid);
  if (status.active) {
    const b = status.active;
    const mentions = status.topDamagers.slice(0, 3).map((r) => r.userJid);
    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ STATUS WORLD BOSS ] ──*",
          `Boss    : *${b.spec.name}*`,
          `HP      : ${b.currentHp.toLocaleString("id-ID")} / ${b.spec.maxHp.toLocaleString("id-ID")}`,
          `Bar HP  : ${renderHpBar(b.currentHp, b.spec.maxHp)}`,
          `Hit     : ${String(b.hitsCount)} serangan dari ${String(b.damageByUser.size)} pemain`,
          `Pool    : ${formatRupiah(b.spec.rewardPool)}`,
          `Sisa    : ${formatRemainingDuration(status.remainingMs)}`,
          ...(status.topDamagers.length > 0
            ? [
                "",
                "*Top 3 Damage:*",
                ...status.topDamagers
                  .slice(0, 3)
                  .map(
                    (r, i) =>
                      `${String(i + 1)}. ${tagOf(r.userJid)} - ${r.damage.toLocaleString("id-ID")} (${String(r.sharePercent)}%)`,
                  ),
              ]
            : []),
        ].join("\n"),
        mentions,
      },
      { quoted: context.message },
    );
    return;
  }

  if (status.respawnRemainingMs > 0) {
    await context.reply(
      [
        "*── [ STATUS WORLD BOSS ] ──*",
        "Tidak ada World Boss aktif saat ini.",
        ...(status.lastDefeated
          ? [
              `Boss Terakhir : *${status.lastDefeated.bossName}* (${status.lastDefeated.outcome === "escaped" ? "Kabur" : "Tumbang"})`,
            ]
          : []),
        `Respawn Dalam : *${formatRemainingDuration(status.respawnRemainingMs)}*`,
        "",
        "Cek rekor: *.topdamage* | *.topdamage all* | *.topdamage riwayat*",
      ].join("\n"),
    );
    return;
  }

  await context.reply(
    "Belum ada World Boss yang aktif. Langsung ketik *.serangboss* (auto-spawn) atau *.worldboss*!",
  );
}

function formatWibDateTime(timestampMs: number): string {
  if (timestampMs <= 0) return "-";
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs));
  const pick = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return `${pick("day")}/${pick("month")} ${pick("hour")}:${pick("minute")} WIB`;
}

async function handleTopDamage(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const sub = (context.args[0] ?? "").trim().toLowerCase();

  if (sub === "all" || sub === "total" || sub === "alltime") {
    const allTime = await raidFarmBuffBountyService.getAllTimeTopBossDamage(context.chatJid, 10);
    if (allTime.length === 0) {
      await context.reply(
        "Belum ada rekor All-Time Damage World Boss di grup ini. Serang boss sekarang dengan *.serangboss*!",
      );
      return;
    }
    const mentions = allTime.map((r) => r.userJid);
    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ TOP DAMAGE ALL-TIME ] ──*",
          "Akumulasi permanen seluruh raid World Boss grup:",
          "",
          ...allTime.map(
            (r, idx) =>
              `${String(idx + 1)}. ${tagOf(r.userJid)} - *${r.totalDamage.toLocaleString("id-ID")} dmg* (${String(r.bossKills)} kill | ${String(r.bossMvpCount)} MVP)`,
          ),
          "",
          "_Lihat 5 boss terakhir: *.topdamage riwayat*_",
        ].join("\n"),
        mentions,
      },
      { quoted: context.message },
    );
    return;
  }

  if (sub === "riwayat" || sub === "history" || sub === "log") {
    const history = await raidFarmBuffBountyService.getWorldBossHistory(context.chatJid);
    if (history.length === 0) {
      await context.reply(
        "Belum ada riwayat World Boss yang selesai di grup ini. Mulai raid dengan *.serangboss*!",
      );
      return;
    }
    const mentionSet = new Set<string>();
    const lines = history.map((h, idx) => {
      const mvp = h.rankings[0];
      if (mvp) mentionSet.add(mvp.userJid);
      if (h.finisherJid) mentionSet.add(h.finisherJid);
      const statusLabel = h.outcome === "escaped" ? "KABUR" : "TUMBANG";
      const mvpText = mvp
        ? `MVP: ${tagOf(mvp.userJid)} (${mvp.damage.toLocaleString("id-ID")})`
        : "Tanpa damage";
      return `${String(idx + 1)}. *${h.bossName}* [${statusLabel}] - ${formatWibDateTime(h.defeatedAt)}\n   ${mvpText}${h.finisherJid ? ` | Finisher: ${tagOf(h.finisherJid)}` : ""}`;
    });
    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ RIWAYAT 5 WORLD BOSS ] ──*",
          ...lines,
          "",
          "_Lihat peringkat kumulatif: *.topdamage all*_",
        ].join("\n"),
        mentions: Array.from(mentionSet),
      },
      { quoted: context.message },
    );
    return;
  }

  const log = await raidFarmBuffBountyService.getTopBossDamage(context.chatJid);
  if (!log) {
    await context.reply(
      "Belum ada catatan damage World Boss di grup ini. Langsung ketik *.serangboss* untuk memunculkan & menyerang boss!",
    );
    return;
  }

  const mentionSet = new Set<string>();
  const lines: string[] = ["*── [ TOP DAMAGE WORLD BOSS ] ──*"];

  if (log.source === "active" || log.source === "last") {
    const statusText =
      log.source === "active"
        ? "AKTIF"
        : log.outcome === "escaped"
          ? "BOSS TERAKHIR - KABUR"
          : "BOSS TERAKHIR - TUMBANG";
    lines.push(`Boss   : *${log.bossName}* (${statusText})`);
    lines.push(`HP     : ${log.currentHp.toLocaleString("id-ID")} / ${log.maxHp.toLocaleString("id-ID")}`);
    if (log.activeBossPendingName) {
      lines.push(`Info   : *${log.activeBossPendingName}* sedang aktif (belum dipukul, ketik *.serangboss*!)`);
    }
    lines.push("");
    for (const [idx, r] of log.rankings.slice(0, 10).entries()) {
      mentionSet.add(r.userJid);
      lines.push(
        `${String(idx + 1)}. ${tagOf(r.userJid)} - *${r.damage.toLocaleString("id-ID")} dmg* (${String(r.sharePercent)}%)`,
      );
    }
  }

  if (log.allTimeTop.length > 0) {
    lines.push("", "*Top All-Time Damage Grup:*");
    for (const [idx, r] of log.allTimeTop.slice(0, 5).entries()) {
      mentionSet.add(r.userJid);
      lines.push(
        `${String(idx + 1)}. ${tagOf(r.userJid)} - *${r.totalDamage.toLocaleString("id-ID")} dmg* (${String(r.bossKills)} kill | ${String(r.bossMvpCount)} MVP)`,
      );
    }
  }

  lines.push("", "_Ketik *.topdamage all* (All-Time) atau *.topdamage riwayat* (5 boss terakhir)._");

  await context.socket.sendMessage(
    context.chatJid,
    {
      text: lines.join("\n"),
      mentions: Array.from(mentionSet),
    },
    { quoted: context.message },
  );
}

// ======================== 2. SKILL TREE ========================

async function handleSkill(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const info = await raidFarmBuffBountyService.getSkillOverview(context.chatJid, senderJid);
    const lines = SKILL_KEYS.map((key) => {
      const spec = SKILL_SPECS[key];
      return `• *${key.toUpperCase()}* (${String(info.skills[key])}/${String(MAX_SKILL_STAT)}) - ${spec.effect}`;
    });

    await context.reply(
      [
        "*── [ SKILL TREE KARAKTER ] ──*",
        `Level Kamu    : Lv. ${String(info.level)} (+2 SP per level)`,
        `Sisa SP       : *${String(info.freeSkillPoints)}* (Terpakai: ${String(info.spentSkillPoints)}/${String(info.totalSkillPoints)})`,
        `Combat Power  : *${info.combatPower.toLocaleString("id-ID")}*`,
        "",
        ...lines,
        "",
        "Alokasi SP : *.upskill <str|agi|luk|int|cha> [jumlah]*",
        `Reset SP   : *.resetskill* (biaya ${formatCompactRupiah(SKILL_RESET_COST)})`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menampilkan skill tree."));
  }
}

async function handleUpSkill(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  const rawStat = context.args[0];
  if (!rawStat) {
    await context.reply(
      "Format: *.upskill <str|agi|luk|int|cha> [jumlah]*\nContoh: *.upskill str 2*",
    );
    return;
  }

  const amount = context.args[1] ? Number.parseInt(context.args[1], 10) : 1;
  if (!Number.isInteger(amount) || amount <= 0) {
    await context.reply("Jumlah poin skill harus berupa angka positif.");
    return;
  }

  try {
    const res = await raidFarmBuffBountyService.upgradeSkill(
      context.chatJid,
      senderJid,
      rawStat,
      amount,
    );
    await context.reply(
      [
        "*── [ UPGRADE SKILL BERHASIL ] ──*",
        `Stat         : *${res.statLabel}* (+${String(res.added)})`,
        `Level Stat   : *${String(res.newStatValue)} / ${String(MAX_SKILL_STAT)}*`,
        `Sisa SP      : ${String(res.freeSkillPoints)}`,
        `Combat Power : *${res.combatPower.toLocaleString("id-ID")}*`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menaikkan skill."));
  }
}

async function handleResetSkill(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await raidFarmBuffBountyService.resetSkills(context.chatJid, senderJid);
    await context.reply(
      [
        "*── [ RESET SKILL TREE ] ──*",
        `Biaya         : -${formatRupiah(res.costPaid)}`,
        `SP Dikembali  : *+${String(res.refundedPoints)} Skill Points*`,
        `Saldo Dompet  : ${formatRupiah(res.currentMoney)}`,
        "",
        "Alokasikan ulang stat kamu lewat *.upskill <str|agi|luk|int|cha> [jumlah]*!",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mereset skill."));
  }
}

// ======================== 3. LADANG & PASAR KOMODITAS ========================

async function handleLadang(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const ov = await raidFarmBuffBountyService.getFarmOverview(context.chatJid, senderJid);
    const plotLines =
      ov.plots.length > 0
        ? ov.plots.map((p, idx) => {
            const status = p.ready
              ? "*SIAP PANEN!*"
              : `Tumbuh (${formatRemainingDuration(p.remainingMs)})${p.watered ? " [Disiram]" : ""}`;
            return `${String(idx + 1)}. ${p.label} - ${status}`;
          })
        : ["(Semua petak masih kosong. Tanam lewat *.tanam <bibit> [jumlah]*)"];

    const harvestLines =
      ov.harvest.length > 0
        ? [
            "",
            "*Gudang Hasil Panen:*",
            ...ov.harvest.map(
              (h) => `• ${h.label} x${String(h.qty)} (~${formatCompactRupiah(h.subtotal)})`,
            ),
            `Estimasi Jual : *${formatRupiah(ov.estimatedSellTotal)}*`,
          ]
        : [];

    const seedLines = FARM_CROP_CATALOG.map(
      (c) =>
        `• *${c.id}* (${c.label}) [Lv.${String(c.minLevel)}+] - Bibit ${formatCompactRupiah(c.seedPrice)} | ${String(c.growMinutes)}m`,
    );

    await context.reply(
      [
        `*── [ LADANG KOMODITAS (${String(ov.plots.length)}/${String(ov.maxPlots)}) ] ──*`,
        ...plotLines,
        ...harvestLines,
        "",
        "*Katalog Bibit:*",
        ...seedLines,
        "",
        "Aksi: *.tanam <bibit> [jml]* | *.siram* | *.panenladang* | *.pasarharga* | *.jualsemua*",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka ladang."));
  }
}

async function handleTanam(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  const cropId = context.args[0];
  if (!cropId) {
    const ids = FARM_CROP_CATALOG.map((c) => c.id).join(", ");
    await context.reply(
      `Format: *.tanam <bibit> [jumlah]*\nBibit tersedia: ${ids}\nContoh: *.tanam kopi 3*`,
    );
    return;
  }

  const qty = context.args[1] ? Number.parseInt(context.args[1], 10) : 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    await context.reply("Jumlah petak tanam harus berupa angka positif.");
    return;
  }

  try {
    const res = await raidFarmBuffBountyService.plantCrop(
      context.chatJid,
      senderJid,
      cropId,
      qty,
    );
    await context.reply(
      [
        "*── [ TANAM BIBIT BERHASIL ] ──*",
        `Bibit      : *${res.crop.label}* x${String(res.plantedCount)} petak`,
        `Biaya      : -${formatRupiah(res.totalCost)}`,
        `Waktu Panen: ${String(res.crop.growMinutes)} menit (ketik *.siram* untuk -${String(FARM_WATER_SPEEDUP_PERCENT)}% waktu!)`,
        `Petak      : ${String(res.usedPlots)} / ${String(res.maxPlots)}`,
        `Dompet     : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menanam bibit."));
  }
}

async function handleSiram(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await raidFarmBuffBountyService.waterFarm(context.chatJid, senderJid);
    await context.reply(
      [
        "*── [ LADANG DISIRAM ] ──*",
        `Petak Disiram : *${String(res.wateredCount)} petak*`,
        `Efek          : Sisa waktu tumbuh dipercepat *${String(FARM_WATER_SPEEDUP_PERCENT)}%*!`,
        `Bonus         : +${String(res.xpGained)} XP`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menyiram ladang."));
  }
}

async function handlePanenLadang(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await raidFarmBuffBountyService.harvestFarm(context.chatJid, senderJid);
    const items = Object.entries(res.yielded).map(([id, qty]) => {
      const label = FARM_CROP_CATALOG.find((c) => c.id === id)?.label ?? id;
      return `• ${label} : *+${String(qty)} unit*`;
    });

    await context.reply(
      [
        "*── [ PANEN LADANG BERHASIL ] ──*",
        `Petak Dipanen : *${String(res.harvestedPlots)} petak*`,
        ...items,
        `Bonus         : +${String(res.xpGained)} XP`,
        "",
        "Cek harga pasar di *.pasarharga* lalu jual saat tinggi lewat *.jualsemua*!",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memanen ladang."));
  }
}

async function handlePasarHarga(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const { quotes, nextRefreshMs } = raidFarmBuffBountyService.getCommodityMarket();
  const lines = quotes.map((q) => {
    const sign = q.changePercent > 0 ? "+" : "";
    return `• *${q.crop.label}* (${q.crop.id}) : *${formatRupiah(q.price)}* [${q.trend} ${sign}${String(q.changePercent)}%]`;
  });

  await context.reply(
    [
      "*── [ PASAR KOMODITAS LIVE ] ──*",
      ...lines,
      "",
      `Update Harga Berikutnya : *${formatRemainingDuration(nextRefreshMs)}*`,
      "Jual semua hasil panenmu: *.jualsemua*",
    ].join("\n"),
  );
}

async function handleJualSemua(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const res = await raidFarmBuffBountyService.sellAllHarvest(context.chatJid, senderJid);
    const lines = res.itemsSold.map(
      (item) => `• ${item.label} x${String(item.qty)} = ${formatCompactRupiah(item.subtotal)}`,
    );
    const bonusParts: string[] = [];
    if (res.chaBonusPercent > 0) bonusParts.push(`CHA +${String(res.chaBonusPercent)}%`);
    if (res.buffBonusPercent > 0) bonusParts.push(`Jimat Cuan +${String(res.buffBonusPercent)}%`);

    await context.reply(
      [
        "*── [ PENJUALAN KOMODITAS ] ──*",
        ...lines,
        ...(bonusParts.length > 0 ? [`Bonus Harga : *${bonusParts.join(" + ")}*`] : []),
        `Total Masuk : *+${formatRupiah(res.totalReceived)}*`,
        `Dompet      : ${formatRupiah(res.currentMoney)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menjual hasil panen."));
  }
}

// ======================== 4. BLACK MARKET BUFFS ========================

async function handleBlackMarket(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const ov = await raidFarmBuffBountyService.getBlackMarketOverview(context.chatJid, senderJid);
    const lines = ov.items.map((item) => {
      const activeText =
        item.activeRemainingMs > 0
          ? ` | AKTIF (${formatRemainingDuration(item.activeRemainingMs)})`
          : "";
      return [
        `• *${item.spec.id}* - ${item.spec.label} (*${formatCompactRupiah(item.spec.price)}*)`,
        `  ${item.spec.effect}`,
        `  Stok Tas: ${String(item.ownedQty)}${activeText}`,
      ].join("\n");
    });

    await context.reply(
      [
        "*── [ BLACK MARKET BUFF ] ──*",
        `Dompetmu : ${formatRupiah(ov.currentMoney)}`,
        "",
        ...lines,
        "",
        "Beli    : *.belibuff <item> [jumlah]*",
        "Pakai   : *.gunakan <item>* | Cek aktif: *.buffaktif*",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka Black Market."));
  }
}

async function handleBeliBuff(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  const itemId = context.args[0];
  if (!itemId) {
    const ids = BLACK_MARKET_CATALOG.map((b) => b.id).join(", ");
    await context.reply(
      `Format: *.belibuff <item> [jumlah]*\nItem: ${ids}\nContoh: *.belibuff jamukuat 1*`,
    );
    return;
  }

  const qty = context.args[1] ? Number.parseInt(context.args[1], 10) : 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    await context.reply("Jumlah pembelian harus berupa angka positif.");
    return;
  }

  try {
    const res = await raidFarmBuffBountyService.buyBlackMarketBuff(
      context.chatJid,
      senderJid,
      itemId,
      qty,
    );
    await context.reply(
      [
        "*── [ PEMBELIAN BLACK MARKET ] ──*",
        `Item      : *${res.spec.label}* x${String(res.quantity)}`,
        `Total     : -${formatRupiah(res.totalCost)}`,
        `Stok Tas  : ${String(res.ownedAfter)}`,
        `Dompet    : ${formatRupiah(res.currentMoney)}`,
        "",
        `Aktifkan sekarang: *.gunakan ${res.spec.id}*`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli buff Black Market."));
  }
}

async function handleBuffAktif(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  try {
    const ov = await raidFarmBuffBountyService.getBlackMarketOverview(context.chatJid, senderJid);
    const active = ov.items.filter((i) => i.activeRemainingMs > 0);
    const stocked = ov.items.filter((i) => i.ownedQty > 0);

    await context.reply(
      [
        "*── [ STATUS BUFF AKTIF ] ──*",
        ...(active.length > 0
          ? active.map(
              (a) =>
                `• *${a.spec.label}* - Sisa *${formatRemainingDuration(a.activeRemainingMs)}*\n  (${a.spec.effect})`,
            )
          : ["Belum ada buff yang sedang aktif."]),
        "",
        "*Stok Buff di Tas:*",
        ...(stocked.length > 0
          ? stocked.map((s) => `• ${s.spec.id} (${s.spec.label}) x${String(s.ownedQty)}`)
          : ["Kosong. Kunjungi *.blackmarket* untuk membeli buff!"]),
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memeriksa buff aktif."));
  }
}

async function handleGunakan(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);

  const itemId = context.args[0];
  if (!itemId) {
    const ids = BLACK_MARKET_CATALOG.map((b) => b.id).join(", ");
    await context.reply(`Format: *.gunakan <item>*\nItem buff: ${ids}`);
    return;
  }

  try {
    const res = await raidFarmBuffBountyService.useBlackMarketBuff(
      context.chatJid,
      senderJid,
      itemId,
    );
    await context.reply(
      [
        "*── [ BUFF DIAKTIFKAN! ] ──*",
        `Item        : *${res.spec.label}*`,
        `Efek        : ${res.spec.effect}`,
        `Durasi Aktif: *${formatRemainingDuration(res.activeRemainingMs)}*`,
        `Sisa di Tas : ${String(res.remainingOwned)}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengaktifkan buff."));
  }
}

// ======================== 5. SAYEMBARA BURONAN (BOUNTY) ========================

async function handleBounty(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);
  const targetJid = await resolveTargetMember(context);

  if (!targetJid) {
    await context.reply(
      `Format: *.bounty @user <uang>* (atau reply pesan target).\nMinimal: ${formatRupiah(BOUNTY_MIN_AMOUNT)}\nContoh: *.bounty @user 5jt*`,
    );
    return;
  }

  if (isBotUserJid(context.socket, targetJid, ...context.mentionedJids)) {
    await context.reply("Tidak bisa memasang sayembara buronan pada MinjiBot!");
    return;
  }

  const rawAmount = context.quoted?.participantJid
    ? (context.args[0] ?? context.args[1])
    : (context.args[1] ?? context.args[0]);
  const amount = parsePositiveBigIntMoneyInput(rawAmount);
  if (!amount) {
    await context.reply(
      `Masukkan nominal uang sayembara yang valid (minimal ${formatRupiah(BOUNTY_MIN_AMOUNT)}). Contoh: *.bounty @user 5jt*`,
    );
    return;
  }

  try {
    const res = await raidFarmBuffBountyService.postBounty(
      context.chatJid,
      senderJid,
      targetJid,
      amount,
    );
    const mentions = [senderJid, res.targetJid];
    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ SAYEMBARA BURONAN BARU! ] ──*",
          `Target Buronan : ${tagOf(res.targetJid)}`,
          `Hadiah Ditambah: +${formatRupiah(res.addedAmount)}`,
          `Total Bounty   : *${formatRupiah(res.totalBounty)}*`,
          `Pemasang       : ${tagOf(senderJid)}`,
          `Dompetmu       : ${formatRupiah(res.posterMoney)}`,
          "",
          "Siapa berani menangkapnya? Ketik *.burubounty @target*!",
        ].join("\n"),
        mentions,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memasang bounty."));
  }
}

async function handleListBounty(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const list = await raidFarmBuffBountyService.loadBounties(context.chatJid);
  if (list.length === 0) {
    await context.reply(
      "Papan buronan grup masih bersih! Pasang sayembara dengan *.bounty @user <uang>*.",
    );
    return;
  }

  const nowMs = Date.now();
  const mentions = list.map((b) => b.targetJid);
  const lines = list.map(
    (b, idx) =>
      `${String(idx + 1)}. ${tagOf(b.targetJid)} - *${formatRupiah(b.amount)}* (${String(b.postersCount)} pemasang, sisa ${formatRemainingDuration(Math.max(0, b.expiresAt - nowMs))})`,
  );

  await context.socket.sendMessage(
    context.chatJid,
    {
      text: [
        "*── [ PAPAN BURONAN GRUP ] ──*",
        ...lines,
        "",
        "Tangkap target & klaim hadiah: *.burubounty @target*",
      ].join("\n"),
      mentions,
    },
    { quoted: context.message },
  );
}

async function handleBuruBounty(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const senderJid = await resolveSender(context);
  const targetJid = await resolveTargetMember(context);

  if (!targetJid) {
    await context.reply(
      "Format: *.burubounty @user* (atau reply pesan target buronan).\nCek target aktif di *.listbounty*.",
    );
    return;
  }

  if (isBotUserJid(context.socket, targetJid, ...context.mentionedJids)) {
    await context.reply("MinjiBot bukan buronan!");
    return;
  }

  try {
    const res = await raidFarmBuffBountyService.huntBounty(
      context.chatJid,
      senderJid,
      targetJid,
    );
    const mentions = [res.hunterJid, res.targetJid];

    if (res.won) {
      const targetNote = res.targetProtectedByBpjs
        ? "Target selamat dari UGD berkat *Asuransi BPJS*!"
        : res.targetSentToUgd
          ? "Target dilarikan ke *UGD selama 5 menit*!"
          : "";

      const caption = [
        "*── [ BURONAN TERTANGKAP!! ] ──*",
        `Pemburu   : ${tagOf(res.hunterJid)} (Power: *${String(res.hunterPower)}*)`,
        `Buronan   : ${tagOf(res.targetJid)} (Power: *${String(res.targetPower)}*)`,
        `Hadiah    : *+${formatRupiah(res.netReward)}* (Pajak kas: ${formatCompactRupiah(res.taxPaid)})`,
        `Bonus XP  : +${String(res.xpGained)} XP`,
        ...(targetNote ? [targetNote] : []),
        `Dompetmu  : ${formatRupiah(res.hunterMoneyAfter)}`,
      ].join("\n");

      await sendEventBannerOrReply(context, {
        scene: "jackpot_sultan",
        headline: "BOUNTY TERTANGKAP!",
        subjectName: getDisplayName(context, res.hunterJid),
        targetUserJid: res.hunterJid,
        details: [
          `Hadiah: +${formatCompactRupiah(res.netReward)}`,
          `Power ${String(res.hunterPower)} vs ${String(res.targetPower)}`,
        ],
        caption,
        mentions,
      });
      return;
    }

    await context.socket.sendMessage(
      context.chatJid,
      {
        text: [
          "*── [ PERBURUAN GAGAL! ] ──*",
          `Pemburu : ${tagOf(res.hunterJid)} (Power: ${String(res.hunterPower)})`,
          `Target  : ${tagOf(res.targetJid)} (Power: *${String(res.targetPower)}*)`,
          "Buronan berhasil meloloskan diri! Bounty tetap aktif di papan.",
          `Denda   : -${formatRupiah(res.failPenaltyPaid)} | HP Kamu: ${String(res.hunterHpAfter)}/100`,
          `Bonus   : +${String(res.xpGained)} XP pengalaman`,
        ].join("\n"),
        mentions,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memburu buronan."));
  }
}

export const raidFarmBuffBountyCommands: CommandDefinition[] = [
  // 1. World Boss Raid
  { name: "worldboss", aliases: ["wb", "raidboss"], execute: handleWorldBoss },
  { name: "serangboss", aliases: ["hitboss", "raid"], execute: handleSerangBoss },
  { name: "statusboss", aliases: ["cekboss", "hpboss"], execute: handleStatusBoss },
  { name: "topdamage", aliases: ["bossdmg", "damagelog"], execute: handleTopDamage },
  // 2. Skill Tree
  { name: "skill", aliases: ["skilltree", "statskill"], execute: handleSkill },
  { name: "upskill", aliases: ["addskill", "alokasiskill"], execute: handleUpSkill },
  { name: "resetskill", aliases: ["resetsp"], execute: handleResetSkill },
  // 3. Ladang & Pasar Komoditas
  { name: "ladang", aliases: ["kebun", "farm"], execute: handleLadang },
  { name: "tanam", aliases: ["plant", "tanambibit"], execute: handleTanam },
  { name: "siram", aliases: ["waterfarm", "siramkebun"], execute: handleSiram },
  { name: "panenladang", aliases: ["harvest", "panenkebun"], execute: handlePanenLadang },
  { name: "pasarharga", aliases: ["hargakomoditas", "hargapasar"], execute: handlePasarHarga },
  { name: "jualsemua", aliases: ["jualpanen", "sellharvest"], execute: handleJualSemua },
  // 4. Black Market Buffs
  { name: "blackmarket", aliases: ["bm", "pasargelap"], execute: handleBlackMarket },
  { name: "belibuff", aliases: ["buybuff", "belibm"], execute: handleBeliBuff },
  { name: "buffaktif", aliases: ["buff", "cekbuff"], execute: handleBuffAktif },
  { name: "gunakan", aliases: ["pakaibuff", "usebuff"], execute: handleGunakan },
  // 5. Sayembara Buronan (Bounty)
  { name: "bounty", aliases: ["buronan", "sayembara"], execute: handleBounty },
  { name: "listbounty", aliases: ["daftarbounty", "daftarburonan"], execute: handleListBounty },
  { name: "burubounty", aliases: ["huntbounty", "tangkapburonan"], execute: handleBuruBounty },
];
