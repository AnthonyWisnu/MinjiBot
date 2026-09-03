import type { CommandContext, CommandDefinition } from "../../types/command";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import type { MemberProfileViewService, ProfileView } from "../../services/member/memberProfileView.service";
import { normalizeUserJid } from "../../utils/jid";

function formatProfileView(view: ProfileView, label: string): string {
  const { profile, rank, createdAtWib } = view;
  const winRate =
    profile.totalGamesPlayed > 0
      ? `${String(profile.totalGamesWon)} / ${String(profile.totalGamesPlayed)}`
      : "0 / 0";

  return [
    `PROFIL MEMBER - ${label}`,
    "",
    `Rank          : ${rank}`,
    `XP            : ${profile.experience.toLocaleString("id-ID")}`,
    `Poin          : ${profile.pointsBalance.toLocaleString("id-ID")}`,
    `Limit         : ${String(profile.limitBalance)}`,
    `Daily Streak  : ${String(profile.currentStreak)} hari`,
    `Game Menang   : ${winRate}`,
    `Profil Dibuat : ${createdAtWib}`,
  ].join("\n");
}

async function executeProfile(
  context: CommandContext,
  service: Pick<MemberProfileViewService, "getOwnProfile"> = memberProfileViewService,
): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  let targetUserJid: string | null = null;

  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    targetUserJid = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    targetUserJid = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args.length > 0 && context.args[0]) {
    const raw = context.args[0].replace(/^@/, "").trim();
    if (/^\d+$/.test(raw)) {
      targetUserJid = normalizeUserJid(`${raw}@s.whatsapp.net`);
    }
  }

  if (targetUserJid && targetUserJid !== normalizeUserJid(context.senderUserJid)) {
    // View another member's profile
    const view = await service.getOwnProfile(
      context.chatJid,
      targetUserJid,
    );
    const userPhone = targetUserJid.split("@")[0] ?? targetUserJid;
    const label = `@${userPhone}`;
    await context.reply(formatProfileView(view, label));
  } else {
    // View own profile (creates if not exists).
    const view = await service.getOwnProfile(
      context.chatJid,
      context.senderUserJid,
    );
    const userPhone = normalizeUserJid(context.senderUserJid).split("@")[0] ?? context.senderUserJid;
    const label = `@${userPhone}`;
    await context.reply(formatProfileView(view, label));
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
        const view = await service.getOwnProfile(
          context.chatJid,
          context.senderUserJid,
        );
        await context.reply(
          [
            "Saldo kamu:",
            "",
            `Poin  : ${view.profile.pointsBalance.toLocaleString("id-ID")}`,
            `Limit : ${String(view.profile.limitBalance)}`,
            `XP    : ${view.profile.experience.toLocaleString("id-ID")}`,
            `Rank  : ${view.rank}`,
          ].join("\n"),
        );
      },
    },
  ];
}

export const profileCommands: CommandDefinition[] = createProfileCommands();

