import fs from "node:fs";
import path from "node:path";

import type { CommandContext, CommandDefinition } from "../../types/command";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import type { MemberProfileViewService, ProfileView } from "../../services/member/memberProfileView.service";
import { roleGuard } from "../../guards/roleGuard";
import { normalizeUserJid } from "../../utils/jid";
import { TenantAdminRepository } from "../../repositories/tenantAdmin.repository";

const tenantAdminRepo = new TenantAdminRepository();

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
  let canonicalJid = normalizeUserJid(rawJid);
  const mentions = [canonicalJid];

  const rawSocket = (context as { socket?: unknown }).socket;
  if (
    canonicalJid.endsWith("@lid") &&
    context.isGroup &&
    rawSocket &&
    typeof rawSocket === "object" &&
    "groupMetadata" in rawSocket
  ) {
    try {
      const socket = rawSocket as {
        groupMetadata: (jid: string) => Promise<{
          participants: {
            id: string;
            jid?: string;
            lid?: string;
          }[];
        }>;
      };
      const metadata = await socket.groupMetadata(context.chatJid);
      const participant = metadata.participants.find((p) => {
        const pJid = p.jid;
        const pLid = p.lid;
        const matchId = normalizeUserJid(p.id) === canonicalJid;
        const matchJid = pJid ? normalizeUserJid(pJid) === canonicalJid : false;
        const matchLid = pLid ? normalizeUserJid(pLid) === canonicalJid : false;
        return matchId || matchJid || matchLid;
      });

      if (participant) {
        const phoneJid = (participant as { jid?: string }).jid ?? participant.id;
        if (phoneJid && !phoneJid.endsWith("@lid")) {
          canonicalJid = normalizeUserJid(phoneJid);
          mentions.push(canonicalJid);
        }
      }
    } catch {
      // ignore metadata lookup failure
    }
  }

  const phone = canonicalJid.split("@")[0] ?? canonicalJid;
  return { userJid: canonicalJid, phone, mentions };
}

function getFallbackAvatarBuffer(): Buffer | null {
  const possiblePaths = [
    path.resolve(process.cwd(), "assets/minji.png"),
    path.resolve(process.cwd(), "src/Minji.png"),
    path.resolve(__dirname, "../../assets/minji.png"),
    path.resolve(__dirname, "../../../assets/minji.png"),
    path.resolve(__dirname, "../../Minji.png"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {
        // ignore read error
      }
    }
  }
  return null;
}

async function sendProfileMessage(
  context: CommandContext,
  text: string,
  targetUserJid: string,
  mentions: string[],
): Promise<void> {
  const rawSocket = (context as { socket?: unknown }).socket;
  if (!rawSocket || typeof rawSocket !== "object") {
    await context.reply(text, { mentions });
    return;
  }

  const socket = rawSocket as {
    sendMessage?: (
      chatJid: string,
      content: { image: { url: string } | Buffer; caption: string; mentions?: string[] },
      options?: { quoted?: unknown },
    ) => Promise<unknown>;
    profilePictureUrl?: (jid: string, type?: "image" | "preview") => Promise<string>;
  };

  if (typeof socket.sendMessage !== "function") {
    await context.reply(text, { mentions });
    return;
  }

  let profilePictureUrl: string | null = null;

  if (typeof socket.profilePictureUrl === "function") {
    try {
      profilePictureUrl = await socket.profilePictureUrl(targetUserJid, "image");
    } catch {
      for (const altJid of mentions) {
        if (altJid !== targetUserJid) {
          try {
            profilePictureUrl = await socket.profilePictureUrl(altJid, "image");
            if (profilePictureUrl) break;
          } catch {
            // ignore
          }
        }
      }
    }
  }

  if (profilePictureUrl) {
    try {
      await socket.sendMessage(
        context.chatJid,
        {
          image: { url: profilePictureUrl },
          caption: text,
          mentions,
        },
        {
          quoted: context.message,
        },
      );
      return;
    } catch {
      // Fallback to local avatar or text
    }
  }

  const fallbackBuffer = getFallbackAvatarBuffer();
  if (fallbackBuffer) {
    try {
      await socket.sendMessage(
        context.chatJid,
        {
          image: fallbackBuffer,
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
    const isTenantAdmin = await tenantAdminRepo.exists(context.chatJid, targetUserJid);
    if (isTenantAdmin) {
      return "Tenant Admin";
    }
  } catch {
    // ignore
  }

  // 4. Admin WhatsApp Grup
  if (context.isGroup) {
    try {
      const rawSocket = (context as { socket?: unknown }).socket;
      if (rawSocket && typeof rawSocket === "object" && "groupMetadata" in rawSocket) {
        const socket = rawSocket as {
          groupMetadata: (jid: string) => Promise<{
            participants: {
              id: string;
              jid?: string;
              lid?: string;
              admin?: "admin" | "superadmin" | null;
            }[];
          }>;
        };

        if (typeof socket.groupMetadata === "function") {
          const metadata = await socket.groupMetadata(context.chatJid);
          const participant = metadata.participants.find((p) => {
            const matchId =
              normalizeUserJid(p.id) === targetUserJid || targetMentions.includes(normalizeUserJid(p.id));
            const matchJid = p.jid
              ? normalizeUserJid(p.jid) === targetUserJid || targetMentions.includes(normalizeUserJid(p.jid))
              : false;
            const matchLid = p.lid
              ? normalizeUserJid(p.lid) === targetUserJid || targetMentions.includes(normalizeUserJid(p.lid))
              : false;
            return matchId || matchJid || matchLid;
          });

          if (participant?.admin === "admin" || participant?.admin === "superadmin") {
            return "Admin Grup";
          }
        }
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
  service: Pick<MemberProfileViewService, "getOwnProfile"> = memberProfileViewService,
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
    // View another member's profile
    const targetInfo = await resolveTargetInfo(context, rawTargetJid);
    const view = await service.getOwnProfile(
      context.chatJid,
      targetInfo.userJid,
    );
    const label = `@${targetInfo.phone}`;
    const isSuperOwner = roleGuard.isSuperOwner(targetInfo.userJid);
    const role = await resolveMemberRole(context, targetInfo.userJid, targetInfo.mentions);
    const text = formatProfileView(view, label, role, isSuperOwner);
    await sendProfileMessage(context, text, targetInfo.userJid, targetInfo.mentions);
  } else {
    // View own profile (creates if not exists).
    const senderInfo = await resolveTargetInfo(context, ownSenderJid);
    const view = await service.getOwnProfile(
      context.chatJid,
      senderInfo.userJid,
    );
    const label = `@${senderInfo.phone}`;
    const isSuperOwner = roleGuard.isSuperOwner(senderInfo.userJid);
    const role = await resolveMemberRole(context, senderInfo.userJid, senderInfo.mentions);
    const text = formatProfileView(view, label, role, isSuperOwner);
    await sendProfileMessage(context, text, senderInfo.userJid, senderInfo.mentions);
  }
}

export function createProfileCommands(
  service: Pick<MemberProfileViewService, "getOwnProfile"> = memberProfileViewService,
): CommandDefinition[] {
  return [
    {
      name: "profile",
      execute: (context) => executeProfile(context, service),
    },
    {
      name: "poin",
      execute: async (context) => {
        if (!context.isGroup || !context.tenantGroup) {
          await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
          return;
        }
        if (roleGuard.isSuperOwner(context.senderUserJid)) {
          await context.reply(
            [
              "*─── [ SALDO MEMBER ] ───*",
              "• Role: Super Owner (Master)",
              "• Rank: Immortal [MAX]",
              "• Poin: 999.999",
              "• Limit: 999 (Unlimited)",
              "• XP: 999.999",
            ].join("\n"),
          );
          return;
        }
        const view = await service.getOwnProfile(
          context.chatJid,
          context.senderUserJid,
        );
        await context.reply(
          [
            "*─── [ SALDO MEMBER ] ───*",
            `• Rank: ${view.rank}`,
            `• Poin: ${view.profile.pointsBalance.toLocaleString("id-ID")}`,
            `• Limit: ${String(view.profile.limitBalance)}`,
            `• XP: ${view.profile.experience.toLocaleString("id-ID")}`,
          ].join("\n"),
        );
      },
    },
  ];
}

export const profileCommands: CommandDefinition[] = createProfileCommands();
