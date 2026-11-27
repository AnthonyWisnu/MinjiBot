import {
  teamWarService,
  WAR_DEFAULT_BET,
  WAR_MAX_BET,
  WAR_MIN_BET,
  WAR_WIN_XP,
  type TeamWarSession,
} from "../../services/game/teamWar.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah, parsePositiveBigIntMoneyInput } from "../../utils/currency";
import { formatUserSafeError } from "../../utils/userSafeError";

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

async function resolveSender(context: CommandContext): Promise<string> {
  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

async function isAdminOrOwner(context: CommandContext): Promise<boolean> {
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

function formatWarBoard(session: TeamWarSession): string {
  const teamA = session.fighters.filter((f) => f.team === "a");
  const teamB = session.fighters.filter((f) => f.team === "b");

  const renderTeam = (members: TeamWarSession["fighters"]): string[] => {
    if (members.length === 0) {
      return ["  (Belum ada anggota)"];
    }
    return members.map((f) => {
      const state = f.hp > 0 ? `HP ${String(f.hp)}/100` : "TUMBANG";
      return `  • ${tagOf(f.userJid)} [${state}] (Swd Lv.${String(f.swordLevel)} | Arm Lv.${String(f.armorLevel)})`;
    });
  };

  return [
    "*Tim A:*",
    ...renderTeam(teamA),
    "*Tim B:*",
    ...renderTeam(teamB),
  ].join("\n");
}

function buildWarGuide(): string {
  return [
    "*── [ PERANG TIM (.war) ] ──*",
    `Taruhan : ${formatRupiah(WAR_MIN_BET)} - ${formatRupiah(WAR_MAX_BET)}`,
    "Bonus   : Pot lawan + Bonus Kemenangan Rp 15.000.000/pemain!",
    "",
    "*Perintah:*",
    "• *.war buat [taruhan]* : Buat lobby (default Rp 1.000.000)",
    "• *.war join a*         : Gabung Tim A",
    "• *.war join b*         : Gabung Tim B",
    "• *.war mulai*          : Mulai perang (Host)",
    "• *.attack @lawan*      : Serang anggota tim lawan",
    "• *.war status*         : Cek HP & tim saat ini",
    "• *.war batal*          : Batalkan sesi (Host/Admin)",
  ].join("\n");
}

async function handleWar(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perang Tim (.war) hanya bisa dimainkan di grup aktif.");
    return;
  }

  try {
    const sub = (context.args[0] ?? "").trim().toLowerCase();
    const groupJid = context.chatJid;

    if (!sub || sub === "help" || sub === "bantuan") {
      await context.reply(buildWarGuide());
      return;
    }

    const sender = await resolveSender(context);

    if (sub === "buat" || sub === "create" || sub === "new") {
      let bet = WAR_DEFAULT_BET;
      const rawBet = context.args[1];
      if (rawBet) {
        const parsed = parsePositiveBigIntMoneyInput(rawBet);
        if (parsed === null) {
          await context.reply("Nominal taruhan tidak valid. Contoh: *.war buat 5000000*");
          return;
        }
        bet = parsed;
      }

      const session = await teamWarService.createLobby(groupJid, sender, bet);
      await context.reply(
        [
          "*── [ LOBBY PERANG TIM ] ──*",
          `Host    : ${tagOf(sender)} (Tim A)`,
          `Taruhan : ${formatRupiah(session.betPerPlayer)} / pemain`,
          "",
          formatWarBoard(session),
          "",
          "Ketik *.war join a* atau *.war join b* untuk bergabung!",
          "Host ketik *.war mulai* setelah kedua tim terisi.",
        ].join("\n"),
        { mentions: session.fighters.map((f) => f.userJid) },
      );
      return;
    }

    if (sub === "join" || sub === "gabung" || sub === "a" || sub === "b") {
      const teamArg = sub === "a" || sub === "b" ? sub : (context.args[1] ?? "").trim().toLowerCase();
      if (teamArg !== "a" && teamArg !== "b") {
        await context.reply("Pilih tim dengan benar: *.war join a* atau *.war join b*");
        return;
      }

      const session = await teamWarService.joinTeam(groupJid, sender, teamArg);
      await context.reply(
        [
          `*── [ PESERTA BARU TIM ${teamArg.toUpperCase()} ] ──*`,
          `${tagOf(sender)} bergabung ke *Tim ${teamArg.toUpperCase()}*!`,
          "",
          formatWarBoard(session),
        ].join("\n"),
        { mentions: session.fighters.map((f) => f.userJid) },
      );
      return;
    }

    if (sub === "mulai" || sub === "start") {
      const session = teamWarService.startWar(groupJid, sender);
      await context.reply(
        [
          "*── [ PERANG DIMULAI! ] ──*",
          `Taruhan : ${formatRupiah(session.betPerPlayer)} / pemain`,
          "",
          formatWarBoard(session),
          "",
          "Serang lawan sekarang dengan *.attack @lawan* (atau reply pesan lawan)!",
        ].join("\n"),
        { mentions: session.fighters.map((f) => f.userJid) },
      );
      return;
    }

    if (sub === "status") {
      const session = teamWarService.getSession(groupJid);
      if (!session) {
        await context.reply("Belum ada sesi perang aktif. Ketik *.war buat* untuk memulai!");
        return;
      }

      await context.reply(
        [
          "*── [ STATUS PERANG TIM ] ──*",
          `Fase    : *${session.phase.toUpperCase()}*`,
          `Taruhan : ${formatRupiah(session.betPerPlayer)}`,
          "",
          formatWarBoard(session),
        ].join("\n"),
        { mentions: session.fighters.map((f) => f.userJid) },
      );
      return;
    }

    if (sub === "batal" || sub === "stop" || sub === "cancel") {
      const admin = await isAdminOrOwner(context);
      teamWarService.cancelWar(groupJid, sender, admin);
      await context.reply("Sesi perang tim berhasil dibatalkan.");
      return;
    }

    await context.reply(buildWarGuide());
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses perintah perang tim."));
  }
}

async function handleAttack(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .attack hanya bisa digunakan di grup aktif.");
    return;
  }

  try {
    const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
    if (!rawTarget) {
      await context.reply("Tag atau reply lawan yang ingin diserang! Contoh: *.attack @lawan*");
      return;
    }

    const attackerJid = await resolveSender(context);
    const targetJid = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      rawTarget,
    );

    const outcome = await teamWarService.attackEnemy(context.chatJid, attackerJid, targetJid);

    if (outcome.winningTeam) {
      const winnerMentions = outcome.winnerJids.map(tagOf).join(", ");
      const allMentions = [
        ...new Set([
          outcome.attackerJid,
          outcome.targetJid,
          ...outcome.winnerJids,
          ...outcome.loserJids,
        ]),
      ];

      await context.reply(
        [
          `*── [ TIM ${outcome.winningTeam.toUpperCase()} MENANG PERANG! ] ──*`,
          `${tagOf(outcome.attackerJid)} melancarkan serangan penghabisan (-${String(outcome.damage)} HP) ke ${tagOf(outcome.targetJid)}!`,
          "",
          `Pemenang : ${winnerMentions}`,
          `Hadiah   : ${formatRupiah(outcome.rewardPerWinner)} + ${String(WAR_WIN_XP)} XP / pemain`,
        ].join("\n"),
        { mentions: allMentions },
      );
      return;
    }

    const statusLine = outcome.targetEliminated
      ? `${tagOf(outcome.targetJid)} *TUMBANG* (0/100 HP)!`
      : `Sisa HP ${tagOf(outcome.targetJid)}: *${String(outcome.targetHpAfter)}/100*`;

    await context.reply(
      [
        "*── [ SERANGAN PERANG ] ──*",
        `${tagOf(outcome.attackerJid)} menyerang ${tagOf(outcome.targetJid)} sebesar *-${String(outcome.damage)} HP*!`,
        statusLine,
      ].join("\n"),
      { mentions: [outcome.attackerJid, outcome.targetJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melancarkan serangan."));
  }
}

export const teamWarCommands: CommandDefinition[] = [
  {
    name: "war",
    execute: handleWar,
  },
  {
    name: "attack",
    execute: handleAttack,
  },
];
