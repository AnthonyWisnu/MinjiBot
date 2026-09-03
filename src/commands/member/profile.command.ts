import type { CommandContext, CommandDefinition } from "../../types/command";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import type { MemberProfileViewService, ProfileView } from "../../services/member/memberProfileView.service";
import { roleGuard } from "../../guards/roleGuard";
import { normalizeUserJid } from "../../utils/jid";

function formatProfileView(view: ProfileView, label: string, isSuperOwner = false): string {
  if (isSuperOwner) {
    return [
      "*─── [ PROFIL MEMBER ] ───*",
      `• User: ${label}`,
      "• Role: Super Owner (Master)",
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

  if (canonicalJid.endsWith("@lid") && context.isGroup) {
    try {
      const metadata = await context.socket.groupMetadata(context.chatJid);
      const participant = metadata.participants.find((p) => {
        const pJid = (p as { jid?: string }).jid;
        const pLid = (p as { lid?: string }).lid;
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
    await context.reply(formatProfileView(view, label, isSuperOwner), {
      mentions: targetInfo.mentions,
    });
  } else {
    // View own profile (creates if not exists).
    const senderInfo = await resolveTargetInfo(context, ownSenderJid);
    const view = await service.getOwnProfile(
      context.chatJid,
      senderInfo.userJid,
    );
    const label = `@${senderInfo.phone}`;
    const isSuperOwner = roleGuard.isSuperOwner(senderInfo.userJid);
    await context.reply(formatProfileView(view, label, isSuperOwner), {
      mentions: senderInfo.mentions,
    });
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
