import { logger } from "../../config/logger";
import {
  formatRosterLines,
  WEREWOLF_MAX_PLAYERS,
  WEREWOLF_MIN_PLAYERS,
  werewolfService,
  type WerewolfDayResolution,
  type WerewolfNightResolution,
  type WerewolfSession,
  type WerewolfWinnerSummary,
} from "../../services/game/werewolf.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

function collectPlayerJids(session: WerewolfSession): string[] {
  return session.players.map((p) => p.userJid);
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

function formatWinnerBlock(winner: WerewolfWinnerSummary, session: WerewolfSession): string {
  const title =
    winner.winningTeam === "warga"
      ? "*── [ WARGA DESA MENANG! ] ──*"
      : "*── [ WEREWOLF MENANG! ] ──*";
  const winnerList = winner.winners.map((w) => tagOf(w.userJid)).join(", ");

  return [
    title,
    `Pemenang : ${winnerList}`,
    `Hadiah   : ${formatRupiah(winner.rewardMoneyBase)} (xBonus Lv) + ${String(winner.rewardXp)} XP + ${String(winner.rewardPoints)} Poin`,
    "",
    "*Identitas Asli Semua Pemain:*",
    formatRosterLines(session.players, true),
  ].join("\n");
}

function formatNightResolutionMessage(res: WerewolfNightResolution): string {
  const lines: string[] = [`*── [ PAGI HARI KE-${String(res.dayNumber)} ] ──*`];

  if (res.killedPlayer) {
    lines.push(
      `Tragedi semalam! Pemain #${String(res.killedPlayer.slot)} (${tagOf(res.killedPlayer.userJid)}) ditemukan gugur diserang Werewolf.`,
    );
  } else if (res.savedByGuardian) {
    lines.push("Semalam Werewolf menyerang, namun *Guardian* berhasil menyelamatkan korbannya!");
  } else {
    lines.push("Malam berlalu dengan tenang. Tidak ada korban jiwa semalam.");
  }

  lines.push("");
  if (res.winner) {
    lines.push(formatWinnerBlock(res.winner, res.session));
  } else {
    lines.push("*Pemain Saat Ini:*");
    lines.push(formatRosterLines(res.session.players));
    lines.push("");
    lines.push("Fase *SIANG* dimulai! Diskusi lalu voting tersangka dengan *.ww vote <nomor>*");
    lines.push("_Host/Admin bisa paksa hitung suara dengan *.ww lanjut* jika ada yang AFK._");
  }

  return lines.join("\n");
}

function formatDayResolutionMessage(res: WerewolfDayResolution): string {
  const lines: string[] = ["*── [ HASIL VOTING SIANG ] ──*"];

  if (res.wasTie) {
    lines.push("Hasil voting seri! Tidak ada warga yang dieksekusi hari ini.");
  } else if (res.eliminatedPlayer) {
    lines.push(
      `Desa sepakat mengeksekusi #${String(res.eliminatedPlayer.slot)} (${tagOf(res.eliminatedPlayer.userJid)}).`,
    );
  } else {
    lines.push("Tidak ada suara masuk. Tidak ada warga yang dieksekusi hari ini.");
  }

  lines.push("");
  if (res.winner) {
    lines.push(formatWinnerBlock(res.winner, res.session));
  } else {
    lines.push(`*── [ MALAM KE-${String(res.session.dayNumber)} TIBA ] ──*`);
    lines.push("Warga desa tertidur... Peran khusus silakan cek DM bot untuk beraksi!");
    lines.push("");
    lines.push(formatRosterLines(res.session.players));
  }

  return lines.join("\n");
}

async function sendDmPayloads(
  context: CommandContext,
  payloads: readonly { userJid: string; text: string }[],
): Promise<string[]> {
  const failedJids: string[] = [];
  for (const item of payloads) {
    try {
      await context.socket.sendMessage(item.userJid, { text: item.text });
    } catch (error: unknown) {
      logger.warn({ err: error, targetJid: item.userJid }, "Gagal mengirim DM peran Werewolf");
      failedJids.push(item.userJid);
    }
  }
  return failedJids;
}

function parseSlotNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^#/, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const num = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

function buildGuideMessage(session: WerewolfSession | null): string {
  const lines = [
    "*── [ WEREWOLF VILLAGE ] ──*",
    `Pemain : ${String(WEREWOLF_MIN_PLAYERS)}-${String(WEREWOLF_MAX_PLAYERS)} orang (Role dikirim via DM)`,
    "",
    "*Perintah di Grup:*",
    "• .ww buat     : Buka lobby baru",
    "• .ww join     : Gabung ke lobby",
    "• .ww keluar   : Keluar dari lobby",
    "• .ww mulai    : Mulai game (Host)",
    "• .ww vote <n> : Voting siang",
    "• .ww lanjut   : Paksa lanjut fase (Host/Admin)",
    "• .ww status   : Cek status permainan",
    "• .ww stop     : Hentikan sesi (Host/Admin)",
    "",
    "*Perintah Rahasia di DM Bot (Saat Malam):*",
    "• .ww bunuh <nomor>    (Werewolf)",
    "• .ww terawang <nomor> (Seer)",
    "• .ww lindungi <nomor> (Guardian)",
  ];

  if (session) {
    lines.push("");
    lines.push(`*Sesi Aktif:* Fase ${session.phase.toUpperCase()} (${String(session.players.length)} pemain)`);
  }

  return lines.join("\n");
}

async function handlePrivateWerewolf(context: CommandContext): Promise<void> {
  const sub = (context.args[0] ?? "").trim().toLowerCase();
  const actionMap: Record<string, "bunuh" | "terawang" | "lindungi"> = {
    bunuh: "bunuh",
    kill: "bunuh",
    terawang: "terawang",
    see: "terawang",
    cek: "terawang",
    lindungi: "lindungi",
    guard: "lindungi",
    jaga: "lindungi",
  };

  const action = actionMap[sub];
  if (!action) {
    await context.reply(
      [
        "*── [ AKSI MALAM WEREWOLF ] ──*",
        "Kirim perintah sesuai peranmu saat fase MALAM:",
        "• *.ww bunuh <nomor>*    (Werewolf)",
        "• *.ww terawang <nomor>* (Seer)",
        "• *.ww lindungi <nomor>* (Guardian)",
      ].join("\n"),
    );
    return;
  }

  const slot = parseSlotNumber(context.args[1]);
  if (!slot) {
    await context.reply(`Masukkan nomor pemain yang valid. Contoh: *.ww ${action} 2*`);
    return;
  }

  const candidateJids = [
    context.senderUserJid,
    context.senderJid,
    ...context.senderAltJids,
  ].filter(Boolean);

  const result = await werewolfService.performNightAction(candidateJids, action, slot);
  await context.reply(result.dmReply);

  if (result.autoResolvedDay) {
    const groupText = formatNightResolutionMessage(result.autoResolvedDay);
    await context.socket.sendMessage(result.autoResolvedDay.groupJid, {
      text: groupText,
      mentions: collectPlayerJids(result.autoResolvedDay.session),
    });
  }
}

async function handleGroupWerewolf(context: CommandContext): Promise<void> {
  if (!context.tenantGroup) {
    await context.reply("Game Werewolf hanya bisa dimainkan di grup aktif.");
    return;
  }

  const sub = (context.args[0] ?? "").trim().toLowerCase();
  const groupJid = context.chatJid;

  if (!sub || sub === "help" || sub === "bantuan") {
    const session = werewolfService.getSession(groupJid);
    await context.reply(buildGuideMessage(session));
    return;
  }

  const sender = await resolveSender(context);

  if (sub === "buat" || sub === "create" || sub === "new") {
    werewolfService.createLobby(groupJid, sender);
    await context.reply(
      [
        "*── [ LOBBY WEREWOLF DIBUKA ] ──*",
        `Host   : ${tagOf(sender)}`,
        `Pemain : 1/${String(WEREWOLF_MAX_PLAYERS)} (Min ${String(WEREWOLF_MIN_PLAYERS)} pemain)`,
        "",
        "Ketik *.ww join* untuk bergabung!",
        "Host ketik *.ww mulai* setelah peserta cukup.",
      ].join("\n"),
      { mentions: [sender] },
    );
    return;
  }

  if (sub === "join" || sub === "gabung") {
    const session = werewolfService.joinLobby(groupJid, sender);
    await context.reply(
      [
        "*── [ LOBBY WEREWOLF ] ──*",
        `${tagOf(sender)} bergabung ke desa! (${String(session.players.length)}/${String(WEREWOLF_MAX_PLAYERS)})`,
        "",
        formatRosterLines(session.players),
        "",
        session.players.length >= WEREWOLF_MIN_PLAYERS
          ? "Pemain sudah cukup! Host bisa ketik *.ww mulai*."
          : `Butuh minimal ${String(WEREWOLF_MIN_PLAYERS - session.players.length)} pemain lagi.`,
      ].join("\n"),
      { mentions: collectPlayerJids(session) },
    );
    return;
  }

  if (sub === "keluar" || sub === "leave") {
    const res = werewolfService.leaveLobby(groupJid, sender);
    if (res.cancelled) {
      await context.reply("Semua pemain keluar. Lobby Werewolf dibubarkan.");
      return;
    }
    await context.reply(
      `${tagOf(sender)} keluar dari lobby. Sisa pemain: ${String(res.session.players.length)}.`,
      { mentions: [sender] },
    );
    return;
  }

  if (sub === "mulai" || sub === "start") {
    const started = werewolfService.startGame(groupJid, sender);
    const failedDms = await sendDmPayloads(context, started.dmPayloads);

    const warningLine =
      failedDms.length > 0
        ? `\n_Catatan: Gagal kirim DM ke ${failedDms.map(tagOf).join(", ")}. Pastikan pernah chat bot terlebih dahulu._`
        : "";

    await context.reply(
      [
        "*── [ WEREWOLF DIMULAI! ] ──*",
        "Peran rahasia sudah dikirim ke DM masing-masing pemain!",
        "",
        "*── [ MALAM KE-1 TIBA ] ──*",
        "Werewolf, Seer, dan Guardian silakan lakukan aksi lewat DM bot sekarang.",
        "",
        "*Daftar Pemain:*",
        formatRosterLines(started.session.players),
        warningLine,
      ]
        .filter(Boolean)
        .join("\n"),
      { mentions: collectPlayerJids(started.session) },
    );
    return;
  }

  if (sub === "vote") {
    const session = werewolfService.getSession(groupJid);
    if (!session) {
      await context.reply("Tidak ada sesi Werewolf aktif di grup ini.");
      return;
    }

    let targetSlot = parseSlotNumber(context.args[1]);
    if (!targetSlot) {
      const mentionedRaw = context.mentionedJids[0] ?? context.quoted?.participantJid;
      if (mentionedRaw) {
        const canonicalTarget = await identityResolverService.resolveCanonicalUserJid(
          context.socket,
          groupJid,
          mentionedRaw,
        );
        const normTarget = normalizeUserJid(canonicalTarget);
        const found = session.players.find((p) => p.userJid === normTarget);
        if (found) {
          targetSlot = found.slot;
        }
      }
    }

    if (!targetSlot) {
      await context.reply("Format: *.ww vote <nomor>* atau *.ww vote @user*");
      return;
    }

    const voteRes = await werewolfService.castDayVote(groupJid, sender, targetSlot);
    if (voteRes.autoResolved) {
      await context.reply(formatDayResolutionMessage(voteRes.autoResolved), {
        mentions: collectPlayerJids(voteRes.autoResolved.session),
      });
      if (voteRes.autoResolved.nextNightDmPrompts.length > 0) {
        await sendDmPayloads(context, voteRes.autoResolved.nextNightDmPrompts);
      }
      return;
    }

    await context.reply(
      `${tagOf(sender)} memilih pemain #${String(voteRes.targetSlot)}. (${String(voteRes.votedCount)}/${String(voteRes.aliveCount)} suara masuk)`,
      { mentions: [sender] },
    );
    return;
  }

  if (sub === "lanjut" || sub === "siang" || sub === "skip" || sub === "next") {
    const session = werewolfService.getSession(groupJid);
    if (!session) {
      await context.reply("Tidak ada sesi Werewolf aktif di grup ini.");
      return;
    }
    const admin = await isAdminOrOwner(context);
    if (!admin && session.hostJid !== normalizeUserJid(sender)) {
      await context.reply("Hanya Host atau Admin grup yang bisa memaksa lanjut fase.");
      return;
    }

    if (session.phase === "night") {
      const nightRes = await werewolfService.resolveNight(groupJid);
      await context.reply(formatNightResolutionMessage(nightRes), {
        mentions: collectPlayerJids(nightRes.session),
      });
      return;
    }

    if (session.phase === "day") {
      const dayRes = await werewolfService.resolveDayVote(groupJid);
      await context.reply(formatDayResolutionMessage(dayRes), {
        mentions: collectPlayerJids(dayRes.session),
      });
      if (dayRes.nextNightDmPrompts.length > 0) {
        await sendDmPayloads(context, dayRes.nextNightDmPrompts);
      }
      return;
    }

    await context.reply("Permainan masih di lobby. Ketik *.ww mulai* untuk memulai.");
    return;
  }

  if (sub === "status") {
    const session = werewolfService.getSession(groupJid);
    if (!session) {
      await context.reply("Belum ada sesi Werewolf di grup ini. Ketik *.ww buat*!");
      return;
    }

    const aliveCount = session.players.filter((p) => p.alive).length;
    const extraLine =
      session.phase === "day"
        ? `Voting : ${String(session.dayVotes.size)}/${String(aliveCount)} suara masuk`
        : session.phase === "night"
          ? `Aksi   : Menunggu peran khusus di DM bot`
          : `Status : Menunggu peserta (*.ww join*)`;

    await context.reply(
      [
        "*── [ STATUS WEREWOLF ] ──*",
        `Fase   : *${session.phase.toUpperCase()}* (Hari ke-${String(session.dayNumber)})`,
        `Host   : ${tagOf(session.hostJid)}`,
        extraLine,
        "",
        "*Daftar Pemain:*",
        formatRosterLines(session.players),
      ].join("\n"),
      { mentions: collectPlayerJids(session) },
    );
    return;
  }

  if (sub === "stop" || sub === "batal" || sub === "cancel") {
    const admin = await isAdminOrOwner(context);
    werewolfService.stopSession(groupJid, sender, admin);
    await context.reply("Sesi Werewolf di grup ini berhasil dihentikan.");
    return;
  }

  await context.reply(buildGuideMessage(werewolfService.getSession(groupJid)));
}

export const werewolfCommands: CommandDefinition[] = [
  {
    name: "werewolf",
    aliases: ["ww"],
    execute: async (context) => {
      try {
        if (!context.isGroup) {
          await handlePrivateWerewolf(context);
          return;
        }
        await handleGroupWerewolf(context);
      } catch (error: unknown) {
        await context.reply(formatUserSafeError(error, "Gagal memproses perintah Werewolf."));
      }
    },
  },
];
