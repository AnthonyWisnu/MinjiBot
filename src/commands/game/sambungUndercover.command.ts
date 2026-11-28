import { logger } from "../../config/logger";
import { sambungKataService } from "../../services/game/sambungKata.service";
import {
  UNDERCOVER_MAX_PLAYERS,
  UNDERCOVER_MIN_PLAYERS,
  undercoverService,
  type UndercoverSession,
  type UndercoverVoteResolution,
} from "../../services/game/undercover.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
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

function formatUndercoverRoster(session: UndercoverSession, reveal = false): string {
  return session.players
    .map((p) => {
      const st = p.alive ? "Aktif" : "Tersingkir";
      const extra = reveal ? ` [${p.role.toUpperCase()} - "${p.word}"]` : "";
      return `${String(p.slot)}. ${tagOf(p.userJid)} (${st})${extra}`;
    })
    .join("\n");
}

function formatUndercoverResolution(res: UndercoverVoteResolution): string {
  const lines = ["*── [ HASIL VOTING UNDERCOVER ] ──*"];
  if (res.wasTie) {
    lines.push("Suara seri! Tidak ada pemain yang tersingkir ronde ini.");
  } else if (res.eliminatedPlayer) {
    const roleLabel =
      res.eliminatedPlayer.role === "undercover" ? "PENYUSUP (UNDERCOVER)!" : "Warga Biasa";
    lines.push(
      `Pemain #${String(res.eliminatedPlayer.slot)} (${tagOf(res.eliminatedPlayer.userJid)}) tersingkir -> Peran: *${roleLabel}*`,
    );
  } else {
    lines.push("Belum ada suara masuk.");
  }

  lines.push("");
  if (res.winner) {
    const teamTitle =
      res.winner.winningTeam === "warga"
        ? "*── [ TIM WARGA MENANG! ] ──*"
        : "*── [ UNDERCOVER MENANG! ] ──*";
    lines.push(teamTitle);
    lines.push(`Kata Warga : *${res.session.citizenWord}* | Kata Undercover: *${res.session.undercoverWord}*`);
    lines.push(`Pemenang   : ${res.winner.winners.map((w) => tagOf(w.userJid)).join(", ")}`);
    lines.push(
      `Hadiah     : ${formatRupiah(res.winner.rewardMoneyBase)} (xBonus Lv) + ${String(res.winner.rewardXp)} XP + ${String(res.winner.rewardPoints)} Poin`,
    );
    lines.push("");
    lines.push("*Daftar Peran:*");
    lines.push(formatUndercoverRoster(res.session, true));
  } else {
    lines.push(`*Lanjut Ronde #${String(res.session.roundNumber)}!*`);
    lines.push(formatUndercoverRoster(res.session));
    lines.push("");
    lines.push("Diskusi lalu voting dengan *.uc vote <nomor>* (atau *.uc lanjut* untuk hitung).");
  }

  return lines.join("\n");
}

async function handleSambungKata(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Game .sambungkata hanya bisa dimainkan di grup aktif.");
    return;
  }

  try {
    const arg = context.argsText.trim();
    const lower = arg.toLowerCase();

    if (lower === "stop" || lower === "batal" || lower === "nyerah") {
      sambungKataService.stopGame(context.chatJid);
      await context.reply("Sesi Sambung Kata dihentikan.");
      return;
    }

    const active = sambungKataService.getSession(context.chatJid);
    if (active && arg.length > 0) {
      const sender = await resolveSender(context);
      const res = await sambungKataService.submitWord(context.chatJid, sender, arg);
      if (res.text) {
        const sent = await context.socket.sendMessage(
          context.chatJid,
          { text: res.text, mentions: res.mentions },
          { quoted: context.message },
        );
        if (sent?.key.id && !res.finished) {
          sambungKataService.setMessageId(context.chatJid, sent.key.id);
        }
      }
      return;
    }

    const started = sambungKataService.startGame(context.chatJid);
    const sent = await context.socket.sendMessage(
      context.chatJid,
      { text: started.text },
      { quoted: context.message },
    );
    if (sent?.key.id) {
      sambungKataService.setMessageId(context.chatJid, sent.key.id);
    }
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses Sambung Kata."));
  }
}

async function handleUndercover(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Game Undercover hanya bisa dimainkan di grup aktif.");
    return;
  }

  try {
    const sub = (context.args[0] ?? "").trim().toLowerCase();
    const groupJid = context.chatJid;

    if (!sub || sub === "help") {
      await context.reply(
        [
          "*── [ UNDERCOVER GRUP ] ──*",
          `Pemain: ${String(UNDERCOVER_MIN_PLAYERS)}-${String(UNDERCOVER_MAX_PLAYERS)} orang (Kata rahasia lewat DM)`,
          "",
          "• *.uc buat*      : Buka lobby baru",
          "• *.uc join*      : Gabung ke lobby",
          "• *.uc keluar*    : Keluar dari lobby",
          "• *.uc mulai*     : Bagikan kata rahasia & mulai (Host)",
          "• *.uc vote <n>*  : Voting siapa penyusupnya",
          "• *.uc lanjut*    : Hitung suara paksa (Host/Admin)",
          "• *.uc status*    : Cek pemain aktif",
          "• *.uc stop*      : Hentikan sesi (Host/Admin)",
        ].join("\n"),
      );
      return;
    }

    const sender = await resolveSender(context);

    if (sub === "buat" || sub === "create") {
      undercoverService.createLobby(groupJid, sender);
      await context.reply(
        [
          "*── [ LOBBY UNDERCOVER DIBUKA ] ──*",
          `Host   : ${tagOf(sender)}`,
          `Peserta: 1/${String(UNDERCOVER_MAX_PLAYERS)} (Min ${String(UNDERCOVER_MIN_PLAYERS)})`,
          "",
          "Ketik *.uc join* untuk ikut bermain!",
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "join" || sub === "gabung") {
      const session = undercoverService.joinLobby(groupJid, sender);
      await context.reply(
        [
          "*── [ LOBBY UNDERCOVER ] ──*",
          `${tagOf(sender)} bergabung! (${String(session.players.length)}/${String(UNDERCOVER_MAX_PLAYERS)})`,
          "",
          formatUndercoverRoster(session),
        ].join("\n"),
        { mentions: session.players.map((p) => p.userJid) },
      );
      return;
    }

    if (sub === "keluar" || sub === "leave") {
      const res = undercoverService.leaveLobby(groupJid, sender);
      await context.reply(
        res.cancelled
          ? "Semua pemain keluar. Lobby Undercover dibubarkan."
          : `${tagOf(sender)} keluar dari lobby Undercover.`,
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "mulai" || sub === "start") {
      const started = undercoverService.startGame(groupJid, sender);
      const failedDms: string[] = [];
      for (const dm of started.dmPayloads) {
        try {
          await context.socket.sendMessage(dm.userJid, { text: dm.text });
        } catch (err: unknown) {
          logger.warn({ err, targetJid: dm.userJid }, "Gagal mengirim DM kata Undercover");
          failedDms.push(dm.userJid);
        }
      }

      const warnLine =
        failedDms.length > 0
          ? `\n_Catatan: Gagal kirim DM ke ${failedDms.map(tagOf).join(", ")}._`
          : "";

      await context.reply(
        [
          "*── [ UNDERCOVER DIMULAI! ] ──*",
          "Kata rahasia sudah dikirim ke DM masing-masing pemain!",
          "Setiap pemain silakan beri 1 petunjuk di grup, lalu voting tersangka dengan *.uc vote <nomor>*.",
          "",
          formatUndercoverRoster(started.session),
          warnLine,
        ]
          .filter(Boolean)
          .join("\n"),
        { mentions: started.session.players.map((p) => p.userJid) },
      );
      return;
    }

    if (sub === "vote") {
      const session = undercoverService.getSession(groupJid);
      if (!session) {
        await context.reply("Tidak ada sesi Undercover aktif di grup ini.");
        return;
      }

      let slot = Number.parseInt((context.args[1] ?? "").replace(/^#/, ""), 10);
      if (Number.isNaN(slot)) {
        const raw = context.mentionedJids[0] ?? context.quoted?.participantJid;
        if (raw) {
          const canon = await identityResolverService.resolveCanonicalUserJid(
            context.socket,
            groupJid,
            raw,
          );
          const found = session.players.find((p) => p.userJid === normalizeUserJid(canon));
          if (found) slot = found.slot;
        }
      }

      if (!Number.isInteger(slot) || slot < 1) {
        await context.reply("Format: *.uc vote <nomor>* atau *.uc vote @user*");
        return;
      }

      const res = await undercoverService.castVote(groupJid, sender, slot);
      if (res.autoResolved) {
        await context.reply(formatUndercoverResolution(res.autoResolved), {
          mentions: res.autoResolved.session.players.map((p) => p.userJid),
        });
        return;
      }

      await context.reply(
        `${tagOf(sender)} memilih pemain #${String(res.targetSlot)} (${String(res.votedCount)}/${String(res.aliveCount)} suara).`,
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "lanjut" || sub === "hitung") {
      const session = undercoverService.getSession(groupJid);
      if (!session) {
        await context.reply("Tidak ada sesi Undercover aktif.");
        return;
      }
      const admin = await isAdminOrOwner(context);
      if (!admin && session.hostJid !== normalizeUserJid(sender)) {
        await context.reply("Hanya Host atau Admin yang bisa memaksa hitung suara.");
        return;
      }
      const res = await undercoverService.resolveVotes(groupJid);
      await context.reply(formatUndercoverResolution(res), {
        mentions: res.session.players.map((p) => p.userJid),
      });
      return;
    }

    if (sub === "status") {
      const session = undercoverService.getSession(groupJid);
      if (!session) {
        await context.reply("Belum ada sesi Undercover aktif. Ketik *.uc buat*!");
        return;
      }
      await context.reply(
        [
          `*── [ STATUS UNDERCOVER (RONDE ${String(session.roundNumber)}) ] ──*`,
          `Fase : ${session.phase.toUpperCase()}`,
          "",
          formatUndercoverRoster(session),
        ].join("\n"),
        { mentions: session.players.map((p) => p.userJid) },
      );
      return;
    }

    if (sub === "stop" || sub === "batal") {
      const admin = await isAdminOrOwner(context);
      undercoverService.stopSession(groupJid, sender, admin);
      await context.reply("Sesi Undercover berhasil dihentikan.");
      return;
    }

    await context.reply("Sub-perintah tidak dikenal. Ketik *.uc* untuk panduan.");
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses perintah Undercover."));
  }
}

export const sambungUndercoverCommands: CommandDefinition[] = [
  { name: "sambungkata", execute: handleSambungKata },
  { name: "undercover", aliases: ["uc"], execute: handleUndercover },
];
