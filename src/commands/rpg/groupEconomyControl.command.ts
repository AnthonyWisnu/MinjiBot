import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import { profileCardService } from "../../services/member/profileCard.service";
import {
  getProfileThemeSpec,
  normalizeProfileThemeId,
} from "../../services/member/profileThemes";
import {
  groupEconomyControlService,
  parseXpEventDurationMs,
  parseXpEventMultiplier,
  XP_EVENT_DEFAULT_DURATION_MS,
} from "../../services/rpg/groupEconomyControl.service";
import { PET_LABELS } from "../../services/rpg/rpgCatalog";
import { getFeaturedPet, parseRpgState } from "../../services/rpg/rpgState";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  absBigInt,
  formatCompactRupiah,
  formatRemainingDuration,
  formatRupiah,
} from "../../utils/currency";
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

export async function canManageGroupEconomyControl(context: CommandContext): Promise<boolean> {
  if (
    context.role === "SUPER_OWNER" ||
    context.role === "TENANT_OWNER" ||
    context.role === "TENANT_ADMIN"
  ) {
    return true;
  }
  return identityResolverService.isGroupAdmin(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

// ==================== 1. DASHBOARD EKONOMI & INFLASI GRUP ====================

async function handleEkonomiGrup(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const allowed = await canManageGroupEconomyControl(context);
  if (!allowed) {
    await context.reply(
      "Dashboard *.ekonomigrup* hanya bisa diakses oleh Admin Grup, Tenant Admin, atau Owner.",
    );
    return;
  }

  try {
    const rep = await groupEconomyControlService.getGroupEconomyReport(context.chatJid);
    const netSign = rep.netFlow24h >= 0n ? "+" : "-";
    const top3Lines =
      rep.top3Holders.length > 0
        ? rep.top3Holders.map(
            (h, i) => `${String(i + 1)}. ${tagOf(h.userJid)} — *${formatCompactRupiah(h.wealth)}*`,
          )
        : ["Belum ada data kekayaan member."];
    const mentions = rep.top3Holders.map((h) => h.userJid);

    const xpLine = rep.activeXpEvent
      ? `*AKTIF ${String(rep.activeXpEvent.multiplier)}x XP* (sisa ${formatRemainingDuration(Math.max(0, rep.activeXpEvent.endsAt - Date.now()))})`
      : "Tidak aktif (.eventxp <durasi>)";

    await context.reply(
      [
        "*── [ EKONOMI & INFLASI GRUP ] ──*",
        `Status       : *${rep.healthStatus}*`,
        `Member       : ${String(rep.totalMembers)} total (${String(rep.activeMembers7d)} aktif 7 hari)`,
        `Kas Negara   : *${formatCompactRupiah(rep.treasuryBalance)}*`,
        "",
        "*Peredaran Uang (M2 Grup):*",
        `• Total Beredar : *${formatCompactRupiah(rep.totalMoneySupply)}*`,
        `• Dompet Warga  : ${formatCompactRupiah(rep.totalWallet)}`,
        `• Bank / ATM    : ${formatCompactRupiah(rep.totalBank)}`,
        `• Deposito      : ${formatCompactRupiah(rep.totalDeposito)}`,
        `• Kas Geng      : ${formatCompactRupiah(rep.totalClanTreasury)}`,
        `• Total Utang   : ${formatCompactRupiah(rep.totalLoanDebt)}`,
        `• Poin / Limit  : ${rep.totalPoints.toLocaleString("id-ID")} Poin | ${rep.totalLimits.toLocaleString("id-ID")} Limit`,
        "",
        "*Distribusi & Kesenjangan:*",
        `• Rata-rata     : ${formatCompactRupiah(rep.averageWealth)} / member`,
        `• Median        : ${formatCompactRupiah(rep.medianWealth)}`,
        `• Porsi Top 3   : *${String(rep.top3ConcentrationPercent)}%* dari total uang beredar`,
        ...top3Lines,
        "",
        `*Arus Uang 24 Jam (${String(rep.txCount24h)} transaksi):*`,
        `• Uang Masuk    : +${formatCompactRupiah(rep.inflow24h)}`,
        `• Money Sink    : -${formatCompactRupiah(rep.outflow24h)}`,
        `• Net Flow 24j  : *${netSign}${formatCompactRupiah(absBigInt(rep.netFlow24h))}*`,
        `• Event XP      : ${xpLine}`,
        "",
        "*Rekomendasi:*",
        ...rep.recommendations.map((r) => `• ${r}`),
      ].join("\n"),
      { mentions },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat dashboard ekonomi grup."));
  }
}

// ==================== 2. TOKO TEMA PROFIL & FLEX ====================

async function handleTemaProfil(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const sub = (context.args[0] ?? "list").trim().toLowerCase();
  const argTheme = context.args[1];

  try {
    const sender = await resolveSender(context);

    if (sub === "list" || sub === "daftar" || sub === "katalog" || sub === "info") {
      const ov = await groupEconomyControlService.getProfileThemesOverview(context.chatJid, sender);
      const lines = ov.items.map((item) => {
        const tag = item.equipped
          ? "[DIPAKAI]"
          : item.owned
            ? "[DIMILIKI]"
            : item.spec.price > 0n
              ? formatCompactRupiah(item.spec.price)
              : "GRATIS";
        return `• *${item.spec.id}* (${item.spec.name}) — *${tag}*\n  _${item.spec.tagline}_`;
      });

      await context.reply(
        [
          "*── [ TOKO TEMA PROFIL & FLEX ] ──*",
          `Pemilik : ${tagOf(sender)}`,
          `Dompet  : ${formatRupiah(ov.moneyBalance)}`,
          `Aktif   : *${getProfileThemeSpec(ov.activeTheme).name}*`,
          "",
          ...lines,
          "",
          "Beli tema   : *.temaprofil beli <kode>*",
          "Pasang tema : *.temaprofil pakai <kode>*",
          "Lihat contoh: *.temaprofil preview <kode>*",
          "_Tema otomatis berlaku di kartu visual .profile dan Black Card .flex!_",
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "beli" || sub === "buy") {
      const themeId = normalizeProfileThemeId(argTheme);
      if (!themeId) {
        await context.reply(
          "Format: *.temaprofil beli <kode>*\nContoh: *.temaprofil beli sakura*\nCek daftar: *.temaprofil*",
        );
        return;
      }
      const res = await groupEconomyControlService.buyProfileTheme(context.chatJid, sender, themeId);
      await context.reply(
        [
          "*── [ TEMA BARU TERPASANG! ] ──*",
          `Pemilik : ${tagOf(sender)}`,
          `Tema    : *${res.spec.name}* (${res.spec.id})`,
          `Biaya   : -${formatRupiah(res.pricePaid)}`,
          `Dompet  : ${formatRupiah(res.currentMoney)}`,
          "",
          "Langsung pamerkan kartu barumu dengan *.profile* atau *.flex*!",
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "pakai" || sub === "use" || sub === "equip" || sub === "pasang") {
      const themeId = normalizeProfileThemeId(argTheme);
      if (!themeId) {
        await context.reply("Format: *.temaprofil pakai <kode>*\nContoh: *.temaprofil pakai midnight*");
        return;
      }
      const res = await groupEconomyControlService.equipProfileTheme(context.chatJid, sender, themeId);
      await context.reply(
        `Tema kartu profil & Black Card kamu diganti ke *${res.spec.name}*! Cek hasilnya lewat *.profile* atau *.flex*.`,
      );
      return;
    }

    if (sub === "preview" || sub === "contoh") {
      const themeId = normalizeProfileThemeId(argTheme);
      if (!themeId) {
        await context.reply("Format: *.temaprofil preview <kode>*\nContoh: *.temaprofil preview celestial*");
        return;
      }
      const spec = getProfileThemeSpec(themeId);
      const view = await memberProfileViewService.getOwnProfile(context.chatJid, sender);
      const state = parseRpgState(view.profile.rpgState);
      const featured = getFeaturedPet(state);
      const avatar = await avatarService
        .getAvatarWithFallback(context.socket, sender, context.senderAltJids)
        .catch(() => null);
      const phone = sender.split("@")[0] ?? sender;
      const pushName = context.message.pushName?.trim();
      const label = pushName && pushName.length > 0 ? pushName : phone;

      const cardPng = await profileCardService.generateCard({
        view,
        label,
        phone,
        role: "PREVIEW TEMA",
        isSuperOwner: false,
        avatarBuffer: avatar,
        themeId: spec.id,
        featuredPet: featured ? { label: PET_LABELS[featured.id], level: featured.level } : null,
        customTitle: state.customTitle,
      });

      const caption = [
        `*── [ PREVIEW TEMA: ${spec.name.toUpperCase()} ] ──*`,
        `Harga : *${spec.price > 0n ? formatRupiah(spec.price) : "GRATIS"}*`,
        spec.price > 0n
          ? `Tertarik? Beli dengan *.temaprofil beli ${spec.id}*`
          : `Pasang dengan *.temaprofil pakai ${spec.id}*`,
      ].join("\n");

      const rawSocket = ((context as { socket?: unknown }).socket ?? {}) as {
        sendMessage?: (
          chatJid: string,
          content: { image: Buffer; caption: string },
          options?: { quoted?: unknown },
        ) => Promise<unknown>;
      };
      if (typeof rawSocket.sendMessage === "function") {
        await rawSocket.sendMessage(
          context.chatJid,
          { image: cardPng, caption },
          { quoted: context.message },
        );
        return;
      }
      await context.reply(caption);
      return;
    }

    await context.reply(
      "Sub-perintah tema:\n• *.temaprofil* (daftar tema)\n• *.temaprofil beli <kode>*\n• *.temaprofil pakai <kode>*\n• *.temaprofil preview <kode>*",
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses tema profil."));
  }
}

// ==================== 3. HAPPY HOUR DOUBLE XP (.eventxp) ====================

async function handleEventXp(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const arg0 = (context.args[0] ?? "").trim().toLowerCase();
  const arg1 = (context.args[1] ?? "").trim().toLowerCase();

  try {
    if (!arg0 || arg0 === "status" || arg0 === "cek" || arg0 === "info") {
      const active = await groupEconomyControlService.getXpEventStatus(context.chatJid);
      if (!active) {
        await context.reply(
          [
            "*── [ EVENT XP GRUP ] ──*",
            "Status : Tidak ada Event XP yang aktif saat ini.",
            "",
            "Admin Grup / Owner dapat memulai Happy Hour XP:",
            "• *.eventxp 1j*       (2x XP selama 1 jam)",
            "• *.eventxp 30m 3x*   (3x XP selama 30 menit)",
            "• *.eventxp off*      (hentikan event lebih awal)",
          ].join("\n"),
        );
        return;
      }

      const remaining = Math.max(0, active.endsAt - Date.now());
      await context.reply(
        [
          "*── [ HAPPY HOUR XP AKTIF! ] ──*",
          `Event   : *${active.label}*`,
          `Pengali : *${String(active.multiplier)}x XP* (Game, Kuis, Daily, RPG, Boss & Ekspedisi!)`,
          `Sisa    : *${formatRemainingDuration(remaining)}*`,
          ...(active.startedByJid ? [`Host    : ${tagOf(active.startedByJid)}`] : []),
          "",
          "Ayo main game, kerja RPG, & serang World Boss mumpung XP berlipat!",
        ].join("\n"),
        { mentions: active.startedByJid ? [active.startedByJid] : [] },
      );
      return;
    }

    const allowed = await canManageGroupEconomyControl(context);
    if (!allowed) {
      await context.reply(
        "Hanya Admin Grup, Tenant Admin, atau Owner yang dapat menyalakan atau mematikan *.eventxp*.",
      );
      return;
    }

    if (arg0 === "off" || arg0 === "stop" || arg0 === "mati" || arg0 === "hapus") {
      await groupEconomyControlService.stopXpEvent(context.chatJid);
      await context.reply("Event Happy Hour XP di grup ini telah dihentikan. XP kembali normal (1x).");
      return;
    }

    const sender = await resolveSender(context);
    let durationMs: number | null = XP_EVENT_DEFAULT_DURATION_MS;
    let multiplier: number | null = 2;

    if (arg0 === "on" || arg0 === "mulai" || arg0 === "start") {
      durationMs = arg1 ? parseXpEventDurationMs(arg1) : XP_EVENT_DEFAULT_DURATION_MS;
      multiplier = context.args[2] ? parseXpEventMultiplier(context.args[2]) : 2;
    } else if (/^[23]x?$/i.test(arg0)) {
      multiplier = parseXpEventMultiplier(arg0);
      durationMs = arg1 ? parseXpEventDurationMs(arg1) : XP_EVENT_DEFAULT_DURATION_MS;
    } else {
      durationMs = parseXpEventDurationMs(arg0);
      multiplier = arg1 ? parseXpEventMultiplier(arg1) : 2;
    }

    if (durationMs === null || multiplier === null) {
      await context.reply(
        "Format salah.\nContoh:\n• *.eventxp 1j* (2x XP, 1 jam)\n• *.eventxp 45m 2x*\n• *.eventxp 2j 3x*\n• *.eventxp off*",
      );
      return;
    }

    const started = await groupEconomyControlService.startXpEvent(
      context.chatJid,
      sender,
      durationMs,
      multiplier,
    );
    await context.reply(
      [
        "*── [ HAPPY HOUR XP DIMULAI!! ] ──*",
        `Event   : *${started.label}*`,
        `Pengali : *${String(started.multiplier)}x XP* aktif otomatis di seluruh grup!`,
        `Durasi  : *${formatRemainingDuration(durationMs)}*`,
        `Host    : ${tagOf(sender)}`,
        "",
        "Berlaku pada Kuis, Game, Daily, Slot, RPG Kerja, Boss Raid, & Ekspedisi Pet!",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengatur Event XP grup."));
  }
}

export const groupEconomyControlCommands: CommandDefinition[] = [
  { name: "ekonomigrup", aliases: ["inflasi", "ekonomi"], execute: handleEkonomiGrup },
  { name: "temaprofil", aliases: ["tema", "theme", "belitema"], execute: handleTemaProfil },
  { name: "eventxp", aliases: ["doublexp", "happyhour", "xpevent"], execute: handleEventXp },
];
