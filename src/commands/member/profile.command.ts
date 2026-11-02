import { roleGuard } from "../../guards/roleGuard";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import type {
  MemberProfileViewService,
  ProfileView,
} from "../../services/member/memberProfileView.service";
import { profileCardService } from "../../services/member/profileCard.service";
import { tenantAdminService } from "../../services/tenant/tenantAdmin.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { normalizeUserJid } from "../../utils/jid";

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
      "• Rank: Immortal [MAX]",
      "• XP: 999.999",
      "• Poin: 999.999",
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

  return [
    "*─── [ PROFIL MEMBER ] ───*",
    `• User: ${label}`,
    `• Role: ${role}`,
    `• Rank: ${rank}`,
    `• XP: ${profile.experience.toLocaleString("id-ID")}`,
    `• Poin: ${profile.pointsBalance.toLocaleString("id-ID")}`,
    `• Limit: ${String(profile.limitBalance)}`,
    `• Daily Streak: ${String(profile.currentStreak)} hari`,
    `• Game Menang: ${winRate}`,
    `• Profil Dibuat: ${createdAtWib}`,
  ].join("\n");
}

async function resolveTargetInfo(
  context: CommandContext,
  rawJid: string,
): Promise<{ userJid: string; phone: string; mentions: string[] }> {
  const canonicalJid = await identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    rawJid,
  );
  const mentions = [canonicalJid];
  const normalizedRaw = normalizeUserJid(rawJid);
  if (normalizedRaw && normalizedRaw !== canonicalJid) {
    mentions.push(normalizedRaw);
  }

  const phone = canonicalJid.split("@")[0] ?? canonicalJid;
  return { userJid: canonicalJid, phone, mentions };
}

interface SendProfileCardOptions {
  view: ProfileView;
  label: string;
  phone: string;
  role: string;
  isSuperOwner: boolean;
}

async function sendProfileMessage(
  context: CommandContext,
  text: string,
  targetUserJid: string,
  mentions: string[],
  cardOptions?: SendProfileCardOptions,
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

  let avatarBuffer: Buffer | null = await avatarService.fetchUserAvatar(
    context.socket,
    targetUserJid,
    mentions,
  );
  avatarBuffer ??= avatarService.getFallbackAvatar();

  if (cardOptions) {
    try {
      const cardBuffer = await profileCardService.generateCard({
        view: cardOptions.view,
        label: cardOptions.label,
        phone: cardOptions.phone,
        role: cardOptions.role,
        isSuperOwner: cardOptions.isSuperOwner,
        avatarBuffer,
      });

      await socket.sendMessage(
        context.chatJid,
        {
          image: cardBuffer,
          caption: text,
          mentions,
        },
        {
          quoted: context.message,
        },
      );
      return;
    } catch {
      // Fallback to text
    }
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

async function executeProfile(
  context: CommandContext,
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

  if (rawTargetJid && rawTargetJid !== ownSenderJid) {
    // View another member's profile (read-only, does NOT create ghost profile - LOG-09)
    const targetInfo = await resolveTargetInfo(context, rawTargetJid);
    const view =
      typeof service.getTargetProfile === "function"
        ? await service.getTargetProfile(context.chatJid, targetInfo.userJid)
        : await service.getOwnProfile(context.chatJid, targetInfo.userJid);
    if (!view) {
      await context.reply(
        "Member tersebut belum memiliki riwayat aktivitas atau profil di grup ini.",
      );
      return;
    }
    const label = `@${targetInfo.phone}`;
    const isSuperOwner = roleGuard.isSuperOwner(targetInfo.userJid);
    const role = await resolveMemberRole(context, targetInfo.userJid, targetInfo.mentions);
    const text = formatProfileView(view, label, role, isSuperOwner);
    await sendProfileMessage(context, text, targetInfo.userJid, targetInfo.mentions, {
      view,
      label,
      phone: targetInfo.phone,
      role,
      isSuperOwner,
    });
  } else {
    // View own profile (creates if not exists).
    const senderInfo = await resolveTargetInfo(context, ownSenderJid);
    const view = await service.getOwnProfile(context.chatJid, senderInfo.userJid);
    const label = `@${senderInfo.phone}`;
    const isSuperOwner = roleGuard.isSuperOwner(senderInfo.userJid);
    const role = await resolveMemberRole(context, senderInfo.userJid, senderInfo.mentions);
    const text = formatProfileView(view, label, role, isSuperOwner);
    await sendProfileMessage(context, text, senderInfo.userJid, senderInfo.mentions, {
      view,
      label,
      phone: senderInfo.phone,
      role,
      isSuperOwner,
    });
  }
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
      execute: (context) => executeProfile(context, service),
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
