import type { CommandContext, CommandDefinition } from "../../types/command";
import { memberProfileViewService } from "../../services/member/memberProfileView.service";
import type { ProfileView } from "../../services/member/memberProfileView.service";
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

async function executeProfile(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const targetJid = context.mentionedJids[0];

  if (targetJid) {
    // View another member's profile (read-only).
    const normalized = normalizeUserJid(targetJid);
    const view = await memberProfileViewService.getTargetProfile(context.chatJid, normalized);
    if (!view) {
      await context.reply("Member tersebut belum memiliki profil di grup ini.");
      return;
    }
    const label = `@${normalized.split("@")[0] ?? normalized}`;
    await context.reply(formatProfileView(view, label));
  } else {
    // View own profile (creates if not exists).
    const view = await memberProfileViewService.getOwnProfile(
      context.chatJid,
      context.senderUserJid,
    );
    const label = `@${normalizeUserJid(context.senderUserJid).split("@")[0] ?? context.senderUserJid}`;
    await context.reply(formatProfileView(view, label));
  }
}

export const profileCommands: CommandDefinition[] = [
  {
    name: "profile",
    execute: executeProfile,
  },
  {
    // .poin as alias — shows own balance concisely.
    name: "poin",
    execute: async (context) => {
      if (!context.isGroup || !context.tenantGroup) {
        await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
        return;
      }
      const view = await memberProfileViewService.getOwnProfile(
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
