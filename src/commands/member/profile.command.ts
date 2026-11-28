import { roleGuard } from "../../guards/roleGuard";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { xpRequiredForLevel } from "../../services/member/level.service";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import type {
  MemberProfileViewService,
  ProfileView,
} from "../../services/member/memberProfileView.service";
import { profileCardService } from "../../services/member/profileCard.service";
import { getProfileThemeSpec } from "../../services/member/profileThemes";
import { PET_LABELS } from "../../services/rpg/rpgCatalog";
import { getFeaturedPet, parseRpgState } from "../../services/rpg/rpgState";
import { rpgEconomyService } from "../../services/rpg/rpgEconomy.service";
import { tenantAdminService } from "../../services/tenant/tenantAdmin.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatCompactRupiah, formatRupiah, toBigIntSafe } from "../../utils/currency";
import { isBotUserJid, normalizeUserJid } from "../../utils/jid";
import { toWibDateKey } from "../../utils/wibDate";

const BOT_WALLET_MONEY = 88_750_420_500_000n;
const BOT_BANK_BALANCE = 1_250_840_915_000_000n;
const BOT_TOTAL_WEALTH = BOT_WALLET_MONEY + BOT_BANK_BALANCE;

function formatBotProfileView(
  label: string,
  treasuryBalance: bigint,
  createdAtWib: string,
): string {
  return [
    "*─── [ PROFIL RESMI BOT ] ───*",
    `• User: ${label} (MinjiBot V2)`,
    "• Gelar: *Bank Sentral Tongkrongan*",
    "• Role: Official System Bot",
    "• Level: Lv. 999 (Celestial Sovereign [TOP])",
    "• Rank: Celestial Sovereign [TOP]",
    "• XP: 9.847.520",
    `• Uang Dompet: ${formatSultanRupiah(BOT_WALLET_MONEY)}`,
    `• Saldo Bank: ${formatSultanRupiah(BOT_BANK_BALANCE)}`,
    `• Kas Negara Grup: ${formatSultanRupiah(treasuryBalance)}`,
    "• Poin Game: 7.420.850",
    "• Limit: 99.850",
    "• Daily Streak: 1.095 hari",
    "• Game Menang: 9.998 / 10.000",
    "• Pasangan: Menikah dengan Server VPS",
    `• Profil Dibuat: ${createdAtWib}`,
    "",
    "_Proteksi Sistem: Kebal .maling, .pajak, .serang, .duel, .transfer & .warn._",
  ].join("\n");
}

function formatBotWalletView(label: string, treasuryBalance: bigint): string {
  return [
    "*─── [ BRANKAS RESMI BOT ] ───*",
    `• Pemilik         : ${label} (Bank Sentral MinjiBot)`,
    `• Uang Dompet     : ${formatSultanRupiah(BOT_WALLET_MONEY)}`,
    `• Bank / Cadangan : ${formatSultanRupiah(BOT_BANK_BALANCE)}`,
    `• Total Aset Bot  : ${formatSultanRupiah(BOT_TOTAL_WEALTH)}`,
    `• Kas Negara Grup : ${formatSultanRupiah(treasuryBalance)}`,
    "",
    "• Poin Game       : 7.420.850 Poin",
    "• Limit           : 99.850 Limit",
    "• Level           : Lv. 999 (Celestial Sovereign [TOP])",
    "• XP              : 9.847.520",
    "",
    "_Dompet bot dijaga sistem 24 jam. Tidak bisa dimaling, dipajaki, ditransfer, atau dibarter._",
  ].join("\n");
}

function formatSultanRupiah(amount: bigint | number): string {
  const val = toBigIntSafe(amount);
  const full = formatRupiah(val);
  if (val >= 1_000_000_000n) {
    return `${full} (${formatCompactRupiah(val)})`;
  }
  return full;
}

function formatProfileView(
  view: ProfileView,
  label: string,
  role: string,
  isSuperOwner = false,
): string {
  if (isSuperOwner) {
    return [
      "*─── [ PROFIL MEMBER ] ───*",
      `• User: ${label}`,
      `• Role: ${role}`,
      "• Level: Lv. MAX (Immortal)",
      "• Rank: Immortal [MAX]",
      "• XP: 999.999",
      "• Uang Dompet: Rp 999.999.999.999 (Rp 1 T)",
      "• Saldo Bank: Rp 999.999.999.999 (Rp 1 T)",
      "• Poin Game: 999.999",
      "• Limit: 999 (Unlimited)",
      "• Daily Streak: 999 hari",
      "• Game Menang: 999 / 999",
      `• Profil Dibuat: ${view.createdAtWib}`,
    ].join("\n");
  }

  const { profile, rank, createdAtWib } = view;
  const winRate =
    profile.totalGamesPlayed > 0
      ? `${String(profile.totalGamesWon)} / ${String(profile.totalGamesPlayed)}`
      : "0 / 0";
  const currentLevel = Math.max(1, profile.level);
  const nextLevelXp = xpRequiredForLevel(currentLevel + 1);
  const rpgState = parseRpgState(profile.rpgState);
  const titleLine = rpgState.customTitle ? `• Gelar: *${rpgState.customTitle}*` : null;
  const featuredPet = getFeaturedPet(rpgState);
  const petLine = featuredPet
    ? `• Pet Andalan: *${PET_LABELS[featuredPet.id]}* (Lv.${String(featuredPet.level)} | Power ${String(featuredPet.power)})`
    : "• Pet Andalan: Belum punya (.petshop)";
  const themeSpec = getProfileThemeSpec(rpgState.profileTheme);
  const themeLine =
    themeSpec.id !== "midnight" ? `• Tema Kartu: *${themeSpec.name}*` : null;
  const partnerLine = rpgState.spouseJid
    ? `• Status: Menikah dengan @${rpgState.spouseJid.split("@")[0] ?? rpgState.spouseJid}`
    : profile.partnerJid
      ? `• Pasangan: @${profile.partnerJid.split("@")[0] ?? profile.partnerJid}`
      : "• Pasangan: Jomblo";

  return [
    "*─── [ PROFIL MEMBER ] ───*",
    `• User: ${label}`,
    ...(titleLine ? [titleLine] : []),
    `• Role: ${role}`,
    `• Level: Lv. ${String(currentLevel)} (${rank})`,
    `• XP: ${profile.experience.toLocaleString("id-ID")} / ${nextLevelXp.toLocaleString("id-ID")}`,
    `• Uang Dompet: ${formatSultanRupiah(profile.moneyBalance)}`,
    `• Saldo Bank: ${formatSultanRupiah(profile.bankBalance)}`,
    `• Poin Game: ${profile.pointsBalance.toLocaleString("id-ID")}`,
    `• Limit: ${String(profile.limitBalance)}`,
    `• Daily Streak: ${String(profile.currentStreak)} hari`,
    `• Game Menang: ${winRate}`,
    petLine,
    ...(themeLine ? [themeLine] : []),
    partnerLine,
    `• Profil Dibuat: ${createdAtWib}`,
  ].join("\n");
}

function formatWalletView(
  view: ProfileView,
  label: string,
  isSuperOwner = false,
): string {
  if (isSuperOwner) {
    return [
      "*─── [ DOMPET & KEKAYAAN ] ───*",
      `• Pemilik: ${label}`,
      "• Uang Dompet : Rp 999.999.999.999 (Rp 1 T)",
      "• Bank / ATM  : Rp 999.999.999.999 (Rp 1 T)",
      "• Total Aset  : Rp 1.999.999.999.998 (Rp 2 T)",
      "• Poin Game   : 999.999 Poin",
      "• Limit       : Unlimited",
      "• Level       : Lv. MAX (Immortal)",
    ].join("\n");
  }

  const { profile, rank } = view;
  const money = toBigIntSafe(profile.moneyBalance);
  const bank = toBigIntSafe(profile.bankBalance);
  const totalWealth = money + bank;
  const currentLevel = Math.max(1, profile.level);
  const nextLevelXp = xpRequiredForLevel(currentLevel + 1);
  const partnerLabel = profile.partnerJid
    ? `@${profile.partnerJid.split("@")[0] ?? profile.partnerJid}`
    : "Jomblo";

  return [
    "*─── [ DOMPET & KEKAYAAN ] ───*",
    `• Pemilik     : ${label}`,
    `• Uang Dompet : ${formatSultanRupiah(money)}`,
    `• Bank / ATM  : ${formatSultanRupiah(bank)}`,
    `• Total Aset  : ${formatSultanRupiah(totalWealth)}`,
    "",
    `• Poin Game   : ${profile.pointsBalance.toLocaleString("id-ID")} Poin`,
    `• Limit       : ${String(profile.limitBalance)} Limit`,
    `• Level       : Lv. ${String(currentLevel)} (${rank})`,
    `• XP          : ${profile.experience.toLocaleString("id-ID")} / ${nextLevelXp.toLocaleString("id-ID")}`,
    `• Pasangan    : ${partnerLabel}`,
    "",
    "_Tips: .atm <jumlah> untuk simpan aman ke Bank, .tukar <poin> untuk ubah Uang jadi Poin, .levelup untuk naik level._",
  ].join("\n");
}

async function resolveTargetInfo(
  context: CommandContext,
  rawJid: string,
  extraAltJids: string[] = [],
): Promise<{ userJid: string; phone: string; mentions: string[]; avatarAltJids: string[] }> {
  const canonicalJid = await identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    rawJid,
    extraAltJids,
  );
  const mentions = [canonicalJid];
  const normalizedRaw = normalizeUserJid(rawJid);
  if (normalizedRaw && normalizedRaw !== canonicalJid) {
    mentions.push(normalizedRaw);
  }

  const avatarAltSet = new Set<string>(mentions);
  for (const alt of extraAltJids) {
    const normalizedAlt = normalizeUserJid(alt);
    if (normalizedAlt) {
      avatarAltSet.add(normalizedAlt);
    }
  }

  try {
    const metadata = await identityResolverService.getGroupMetadata(context.socket, context.chatJid);
    if (metadata) {
      for (const candidate of identityResolverService.getCanonicalCandidateSet(metadata, rawJid)) {
        avatarAltSet.add(candidate);
      }
    }
  } catch {
    // Abaikan error metadata agar lookup profil tetap berjalan
  }

  const phone = canonicalJid.split("@")[0] ?? canonicalJid;
  return { userJid: canonicalJid, phone, mentions, avatarAltJids: [...avatarAltSet] };
}

async function sendProfileMessage(
  context: CommandContext,
  text: string,
  targetUserJid: string,
  mentions: string[],
  avatarAltJids: string[] = [],
): Promise<void> {
  const rawSocket = (context as { socket?: unknown }).socket;
  const socket = (rawSocket ?? {}) as {
    sendMessage?: (
      chatJid: string,
      content: { image: Buffer; caption: string; mentions?: string[] },
      options?: { quoted?: unknown },
    ) => Promise<unknown>;
  };

  if (typeof socket.sendMessage !== "function") {
    await context.reply(text, { mentions });
    return;
  }

  try {
    const avatar = await avatarService.getAvatarWithFallback(
      context.socket,
      targetUserJid,
      avatarAltJids,
    );

    if (avatar.length > 0) {
      await socket.sendMessage(
        context.chatJid,
        {
          image: avatar,
          caption: text,
          mentions,
        },
        {
          quoted: context.message,
        },
      );
      return;
    }
  } catch {
    // Fallback ke teks apabila pengiriman gambar profil gagal
  }

  await context.reply(text, { mentions });
}

async function resolveMemberRole(
  context: CommandContext,
  targetUserJid: string,
  targetMentions: string[],
): Promise<string> {
  // 1. Super Owner
  if (
    roleGuard.isSuperOwner(targetUserJid) ||
    targetMentions.some((jid) => roleGuard.isSuperOwner(jid))
  ) {
    return "Super Owner (Master)";
  }

  // 2. Tenant Owner
  const ownerJid = context.tenantGroup?.ownerJid;
  if (ownerJid) {
    const normOwner = normalizeUserJid(ownerJid);
    if (normOwner === targetUserJid || targetMentions.includes(normOwner)) {
      return "Owner Tenant";
    }
  }

  // 3. Tenant Admin
  try {
    const isTenantAdmin = await tenantAdminService.isTenantAdmin(context.chatJid, targetUserJid);
    if (isTenantAdmin) {
      return "Tenant Admin";
    }
  } catch {
    // ignore
  }

  // 4. Admin WhatsApp Grup
  if (context.isGroup) {
    try {
      const isGroupAdmin = await identityResolverService.isGroupAdmin(
        context.socket,
        context.chatJid,
        targetUserJid,
      );
      if (isGroupAdmin) {
        return "Admin Grup";
      }
    } catch {
      // ignore
    }
  }

  // 5. Member Biasa
  return "Member Grup";
}

async function executeProfileOrWallet(
  context: CommandContext,
  mode: "profile" | "wallet",
  service: Pick<
    MemberProfileViewService,
    "getOwnProfile" | "getTargetProfile"
  > = memberProfileViewService,
): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  let rawTargetJid: string | null = null;

  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTargetJid = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTargetJid = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args.length > 0 && context.args[0]) {
    const raw = context.args[0].replace(/^@/, "").trim();
    if (/^\d+$/.test(raw)) {
      rawTargetJid = normalizeUserJid(`${raw}@s.whatsapp.net`);
    }
  }

  const ownSenderJid = normalizeUserJid(context.senderUserJid);
  const senderAltJids = Array.isArray(context.senderAltJids) ? context.senderAltJids : [];
  const senderCandidates = identityResolverService.getCanonicalCandidateSet(
    ownSenderJid,
    senderAltJids,
  );

  let resolvedInfo: {
    userJid: string;
    phone: string;
    mentions: string[];
    avatarAltJids: string[];
  };
  let view: ProfileView;

  if (rawTargetJid && !senderCandidates.has(rawTargetJid)) {
    const candidateTargetInfo = await resolveTargetInfo(context, rawTargetJid);
    if (
      isBotUserJid(
        context.socket,
        rawTargetJid,
        candidateTargetInfo.userJid,
        ...candidateTargetInfo.avatarAltJids,
      )
    ) {
      let treasuryBalance = toBigIntSafe(context.tenantGroup.treasuryBalance);
      try {
        treasuryBalance = await rpgEconomyService.getGroupTreasury(context.chatJid);
      } catch {
        // Fallback ke snapshot tenantGroup bila lookup kas gagal
      }
      const label = `@${candidateTargetInfo.phone}`;
      const createdAtWib = toWibDateKey(context.tenantGroup.createdAt);
      const botText =
        mode === "wallet"
          ? formatBotWalletView(label, treasuryBalance)
          : formatBotProfileView(label, treasuryBalance, createdAtWib);
      await sendProfileMessage(
        context,
        botText,
        candidateTargetInfo.userJid,
        candidateTargetInfo.mentions,
        candidateTargetInfo.avatarAltJids,
      );
      return;
    }

    if (senderCandidates.has(candidateTargetInfo.userJid)) {
      resolvedInfo = await resolveTargetInfo(context, ownSenderJid, senderAltJids);
      view = await service.getOwnProfile(context.chatJid, resolvedInfo.userJid);
    } else {
      // View another member's profile (read-only, does NOT create ghost profile - LOG-09)
      resolvedInfo = candidateTargetInfo;
      const targetView =
        typeof service.getTargetProfile === "function"
          ? await service.getTargetProfile(context.chatJid, resolvedInfo.userJid)
          : await service.getOwnProfile(context.chatJid, resolvedInfo.userJid);
      if (!targetView) {
        await context.reply(
          "Member tersebut belum memiliki riwayat aktivitas atau profil di grup ini.",
        );
        return;
      }
      view = targetView;
    }
  } else {
    // View own profile (creates if not exists).
    resolvedInfo = await resolveTargetInfo(context, ownSenderJid, senderAltJids);
    view = await service.getOwnProfile(context.chatJid, resolvedInfo.userJid);
  }

  const label = `@${resolvedInfo.phone}`;
  const isSuperOwner = roleGuard.isSuperOwner(resolvedInfo.userJid);
  const mentions = [...resolvedInfo.mentions];
  if (view.profile.partnerJid && !mentions.includes(view.profile.partnerJid)) {
    mentions.push(view.profile.partnerJid);
  }

  let text: string;
  if (mode === "wallet") {
    text = formatWalletView(view, label, isSuperOwner);
    await sendProfileMessage(
      context,
      text,
      resolvedInfo.userJid,
      mentions,
      resolvedInfo.avatarAltJids,
    );
    return;
  }

  const role = await resolveMemberRole(context, resolvedInfo.userJid, resolvedInfo.mentions);
  text = formatProfileView(view, label, role, isSuperOwner);

  const rpgState = parseRpgState(view.profile.rpgState);
  const requestedCard = context.args.some((a) => {
    const lower = a.trim().toLowerCase();
    return lower === "card" || lower === "kartu";
  });
  const shouldRenderVisualCard = rpgState.profileTheme !== "midnight" || requestedCard;

  const rawSocket = ((context as { socket?: unknown }).socket ?? {}) as {
    sendMessage?: (
      chatJid: string,
      content: { image: Buffer; caption: string; mentions?: string[] },
      options?: { quoted?: unknown },
    ) => Promise<unknown>;
  };

  if (shouldRenderVisualCard && typeof rawSocket.sendMessage === "function") {
    const avatar = await avatarService
      .getAvatarWithFallback(context.socket, resolvedInfo.userJid, resolvedInfo.avatarAltJids)
      .catch(() => null);
    try {
      const featured = getFeaturedPet(rpgState);
      const isSelfTarget = senderCandidates.has(resolvedInfo.userJid);
      const maybeMsg = (context as { message?: { pushName?: string | null } }).message;
      const pushName = maybeMsg?.pushName?.trim();
      const cardName = isSelfTarget && pushName && pushName.length > 0 ? pushName : resolvedInfo.phone;
      const cardPng = await profileCardService.generateCard({
        view,
        label: cardName,
        phone: resolvedInfo.phone,
        role,
        isSuperOwner,
        avatarBuffer: avatar,
        themeId: rpgState.profileTheme,
        featuredPet: featured ? { label: PET_LABELS[featured.id], level: featured.level } : null,
        customTitle: rpgState.customTitle,
      });
      await rawSocket.sendMessage(
        context.chatJid,
        { image: cardPng, caption: text, mentions },
        { quoted: context.message },
      );
      return;
    } catch {
      if (avatar && avatar.length > 0) {
        await rawSocket.sendMessage(
          context.chatJid,
          { image: avatar, caption: text, mentions },
          { quoted: context.message },
        );
        return;
      }
    }
  }

  await sendProfileMessage(context, text, resolvedInfo.userJid, mentions, resolvedInfo.avatarAltJids);
}

async function executeSimpleBalance(
  context: CommandContext,
  asset: "poin" | "limit" | "xp",
  service: Pick<MemberProfileViewService, "getOwnProfile"> = memberProfileViewService,
): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const senderInfo = await resolveTargetInfo(context, context.senderUserJid);
  const view = await service.getOwnProfile(context.chatJid, senderInfo.userJid);
  const isSuperOwner = roleGuard.isSuperOwner(senderInfo.userJid);

  if (asset === "poin") {
    const val = isSuperOwner
      ? "999.999 (Unlimited)"
      : `${view.profile.pointsBalance.toLocaleString("id-ID")} Poin`;
    await context.reply(`💰 Poin kamu: *${val}*`);
    return;
  }

  if (asset === "limit") {
    const val = isSuperOwner ? "Unlimited" : `${String(view.profile.limitBalance)} Limit`;
    await context.reply(`⚡ Limit kamu: *${val}*`);
    return;
  }

  const val = isSuperOwner
    ? "999.999 XP (Immortal [MAX])"
    : `${view.profile.experience.toLocaleString("id-ID")} XP (${view.rank})`;
  await context.reply(`⭐ XP kamu: *${val}*`);
}

export function createProfileCommands(
  service: Pick<
    MemberProfileViewService,
    "getOwnProfile" | "getTargetProfile"
  > = memberProfileViewService,
): CommandDefinition[] {
  return [
    {
      name: "profile",
      aliases: ["profil", "me"],
      execute: (context) => executeProfileOrWallet(context, "profile", service),
    },
    {
      name: "dompet",
      aliases: ["wallet", "uang", "duit"],
      execute: (context) => executeProfileOrWallet(context, "wallet", service),
    },
    {
      name: "poin",
      aliases: ["point", "saldo", "ceksaldo"],
      execute: (context) => executeSimpleBalance(context, "poin", service),
    },
    {
      name: "limit",
      aliases: ["sisa-limit"],
      execute: (context) => executeSimpleBalance(context, "limit", service),
    },
    {
      name: "xp",
      aliases: ["exp", "rank"],
      execute: (context) => executeSimpleBalance(context, "xp", service),
    },
  ];
}

export const profileCommands: CommandDefinition[] = createProfileCommands();
