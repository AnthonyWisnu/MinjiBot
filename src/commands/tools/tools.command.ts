import { groupToolsService } from "../../services/group/groupTools.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import {
  createTtpSticker,
  evaluateSafeMathExpression,
  generateQrCodePng,
} from "../../services/media/localTools.service";
import { rpgEconomyService } from "../../services/rpg/rpgEconomy.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah } from "../../utils/currency";
import { isMediaCommandAllowed } from "../../utils/dmAccess";
import { extractContactCandidateJids, isPhoneUserJid, normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

async function ensureActiveGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return false;
  }
  return true;
}

async function resolveCanonicalSender(context: CommandContext): Promise<string> {
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

function tag(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

// ---- Absen ----

async function handleStartAttendance(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const senderJid = await resolveCanonicalSender(context);
    const session = await groupToolsService.startAttendancePersisted(
      context.chatJid,
      senderJid,
      context.argsText,
    );
    await context.reply(
      [
        "*─── [ ABSEN GRUP DIBUKA ] ───*",
        "",
        `• Judul  : *${session.title}*`,
        `• Dibuka : ${tag(session.createdBy)}`,
        "",
        "Ketik *.absen* untuk hadir, *.cekabsen* untuk daftar hadir, *.hapusabsen* untuk menutup.",
      ].join("\n"),
      { mentions: [session.createdBy] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memulai sesi absen."));
  }
}

async function handleMarkAttendance(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const senderJid = await resolveCanonicalSender(context);
    const { session, alreadyPresent } = await groupToolsService.markAttendancePersisted(
      context.chatJid,
      senderJid,
    );
    if (alreadyPresent) {
      await context.reply(`${tag(senderJid)}, kamu sudah tercatat hadir di absen "${session.title}".`, {
        mentions: [senderJid],
      });
      return;
    }

    const mentions = session.entries.map((e) => e.userJid);
    const listLines = session.entries.map(
      (e, idx) => `${String(idx + 1)}. ${tag(e.userJid)} (${e.timeWib})`,
    );
    await context.reply(
      [
        `*─── [ ABSEN: ${session.title} ] ───*`,
        "",
        ...listLines,
        "",
        `Total hadir: *${String(session.entries.length)}* orang.`,
      ].join("\n"),
      { mentions },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencatat kehadiran."));
  }
}

async function handleCheckAttendance(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const session = await groupToolsService.getAttendancePersisted(context.chatJid);
    const mentions = session.entries.map((e) => e.userJid);
    const listLines =
      session.entries.length > 0
        ? session.entries.map((e, idx) => `${String(idx + 1)}. ${tag(e.userJid)} (${e.timeWib})`)
        : ["Belum ada yang absen. Ketik *.absen* untuk mengisi daftar hadir."];

    await context.reply(
      [
        `*─── [ DAFTAR ABSEN: ${session.title} ] ───*`,
        "",
        ...listLines,
        "",
        `Total hadir: *${String(session.entries.length)}* orang.`,
      ].join("\n"),
      { mentions },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil daftar absen."));
  }
}

async function handleDeleteAttendance(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const senderJid = await resolveCanonicalSender(context);
    const privileged = await isAdminOrOwner(context);
    const closed = await groupToolsService.deleteAttendancePersisted(
      context.chatJid,
      senderJid,
      privileged,
    );
    await context.reply(
      `Sesi absen *"${closed.title}"* telah ditutup dengan total *${String(closed.entries.length)}* peserta hadir.`,
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghapus sesi absen."));
  }
}

// ---- Voting & Native Poll ----

function renderVoteSummary(topic: string, upvoters: Set<string>, downvoters: Set<string>): {
  text: string;
  mentions: string[];
} {
  const upList = [...upvoters];
  const downList = [...downvoters];
  const total = upList.length + downList.length;
  const upPct = total > 0 ? Math.round((upList.length / total) * 100) : 0;
  const downPct = total > 0 ? 100 - upPct : 0;

  return {
    text: [
      "*─── [ VOTING GRUP ] ───*",
      "",
      `Topik: *${topic}*`,
      "",
      `• SETUJU (.upvote)       : *${String(upList.length)}* (${String(upPct)}%)`,
      `• TIDAK SETUJU (.devote) : *${String(downList.length)}* (${String(downPct)}%)`,
      `• Total Suara            : ${String(total)}`,
    ].join("\n"),
    mentions: [...upList, ...downList],
  };
}

async function handleStartVote(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const senderJid = await resolveCanonicalSender(context);
    const session = await groupToolsService.startVotePersisted(
      context.chatJid,
      senderJid,
      context.argsText,
    );
    await context.reply(
      [
        "*─── [ VOTING DIBUKA ] ───*",
        "",
        `Topik : *${session.topic}*`,
        `Oleh  : ${tag(session.createdBy)}`,
        "",
        "Ketik *.upvote* (Setuju) atau *.devote* (Tidak Setuju).",
        "Cek hasil: *.cekvote* | Tutup: *.hapusvote*",
      ].join("\n"),
      { mentions: [session.createdBy] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memulai voting."));
  }
}

async function handleCastVote(context: CommandContext, choice: "up" | "down"): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const senderJid = await resolveCanonicalSender(context);
    const session = await groupToolsService.castVotePersisted(context.chatJid, senderJid, choice);
    const summary = renderVoteSummary(session.topic, session.upvoters, session.downvoters);
    await context.reply(summary.text);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencatat suara voting."));
  }
}

async function handleCheckVote(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const session = await groupToolsService.getVotePersisted(context.chatJid);
    const summary = renderVoteSummary(session.topic, session.upvoters, session.downvoters);
    await context.reply(summary.text);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengecek hasil voting."));
  }
}

async function handleDeleteVote(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const senderJid = await resolveCanonicalSender(context);
    const privileged = await isAdminOrOwner(context);
    const closed = await groupToolsService.deleteVotePersisted(
      context.chatJid,
      senderJid,
      privileged,
    );
    const summary = renderVoteSummary(closed.topic, closed.upvoters, closed.downvoters);
    await context.reply(`${summary.text}\n\n_Sesi voting telah ditutup._`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menutup voting."));
  }
}

async function handleNativePoll(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;

  const parts = context.argsText
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length < 3 || parts.length > 11) {
    await context.reply(
      "Format salah.\nGunakan: .poll <pertanyaan>|<opsi 1>|<opsi 2>|[opsi 3...]\nMinimal 2 opsi, maksimal 10 opsi.\nContoh: .poll Makan siang apa?|Nasi Goreng|Bakso|Mie Ayam",
    );
    return;
  }

  const question = parts[0] ?? "Polling Grup";
  const options = parts.slice(1);

  try {
    await context.socket.sendMessage(
      context.chatJid,
      {
        poll: {
          name: question,
          values: options,
          selectableCount: 1,
        },
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat polling WhatsApp."));
  }
}

// ---- Persistent Group Notes ----

async function handleSaveNote(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const raw = context.argsText.trim();
  const sep = raw.indexOf("|");
  if (!raw || sep < 0) {
    await context.reply(
      "Format salah.\nGunakan: .buatcatatan <judul>|<isi catatan>\nContoh: .buatcatatan aturan|Dilarang spam dan tetap santai!",
    );
    return;
  }

  const title = raw.slice(0, sep);
  const content = raw.slice(sep + 1);

  try {
    const senderJid = await resolveCanonicalSender(context);
    const saved = await groupToolsService.saveNote(context.chatJid, title, content, senderJid);
    await context.reply(
      `Catatan grup *"${saved.title}"* berhasil disimpan.\nKetik *.lihatcatatan ${saved.title}* untuk membacanya.`,
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menyimpan catatan grup."));
  }
}

async function handleGetNote(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const title = context.argsText.trim();
  if (!title) {
    await context.reply("Gunakan: .lihatcatatan <judul>\nLihat semua catatan: .listcatatan");
    return;
  }

  try {
    const note = await groupToolsService.getNote(context.chatJid, title);
    await context.reply(
      [`*─── [ CATATAN: ${note.title.toUpperCase()} ] ───*`, "", note.content].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuka catatan."));
  }
}

async function handleListNotes(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const notes = await groupToolsService.listNotes(context.chatJid);
    if (notes.length === 0) {
      await context.reply(
        "Belum ada catatan di grup ini.\nBuat catatan baru dengan: .buatcatatan <judul>|<isi>",
      );
      return;
    }

    const lines = [
      "*─── [ DAFTAR CATATAN GRUP ] ───*",
      "",
      ...notes.map((n, idx) => `${String(idx + 1)}. ${n.title}`),
      "",
      "_Ketik .lihatcatatan <judul> untuk membaca._",
    ];
    await context.reply(lines.join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil daftar catatan."));
  }
}

async function handleDeleteNote(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const title = context.argsText.trim();
  if (!title) {
    await context.reply("Gunakan: .hapuscatatan <judul>");
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const privileged = await isAdminOrOwner(context);
    await groupToolsService.deleteNote(context.chatJid, title, senderJid, privileged);
    await context.reply(`Catatan *"${title.toLowerCase()}"* berhasil dihapus.`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghapus catatan."));
  }
}

// ---- Group Info & Utilities ----

async function handleGroupInfo(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const metadata = await identityResolverService.getGroupMetadata(context.socket, context.chatJid);
    const treasury = await rpgEconomyService.getGroupTreasury(context.chatJid);
    const totalMembers = metadata?.participants.length ?? 0;
    const totalAdmins = metadata?.participants.filter((p) => Boolean(p.admin)).length ?? 0;
    const desc = metadata?.desc?.trim() ? metadata.desc.trim().slice(0, 300) : "-";

    await context.reply(
      [
        "*─── [ INFO GRUP ] ───*",
        "",
        `• Nama Grup   : ${metadata?.subject ?? context.tenantGroup?.name ?? "-"}`,
        `• Kode Tenant : ${context.tenantGroup?.tenantCode ?? "-"}`,
        `• Total Member: ${String(totalMembers)} orang`,
        `• Jumlah Admin: ${String(totalAdmins)} orang`,
        `• Kas Negara  : ${formatRupiah(treasury)}`,
        `• Deskripsi   :\n${desc}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil informasi grup."));
  }
}

async function handleListAdmin(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const metadata = await identityResolverService.getGroupMetadata(context.socket, context.chatJid);
    const admins = (metadata?.participants ?? []).filter((p) => Boolean(p.admin));
    if (admins.length === 0) {
      await context.reply("Tidak ada daftar admin yang ditemukan.");
      return;
    }

    const adminJids: string[] = [];
    const lines = ["*─── [ DAFTAR ADMIN GRUP ] ───*", ""];
    admins.forEach((p, idx) => {
      const candidates = extractContactCandidateJids(p);
      const preferred = candidates.find((c) => isPhoneUserJid(c)) ?? candidates[0] ?? p.id;
      adminJids.push(preferred);
      const badge = p.admin === "superadmin" ? " (Pembuat Grup)" : "";
      lines.push(`${String(idx + 1)}. ${tag(preferred)}${badge}`);
    });

    await context.reply(lines.join("\n"), { mentions: adminJids });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil daftar admin grup."));
  }
}

async function handleTagMe(context: CommandContext): Promise<void> {
  const senderJid = await resolveCanonicalSender(context);
  await context.reply(`${tag(senderJid)} hadir!`, { mentions: [senderJid] });
}

async function handleGroupLink(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const allowed = await isAdminOrOwner(context);
    if (!allowed) {
      await context.reply("Perintah .link hanya dapat digunakan oleh Admin Grup atau Owner.");
      return;
    }

    const botAdmin = await identityResolverService.isBotGroupAdmin(context.socket, context.chatJid);
    if (!botAdmin) {
      await context.reply("Bot harus menjadi admin grup terlebih dahulu untuk mengambil link grup.");
      return;
    }

    const code = await context.socket.groupInviteCode(context.chatJid);
    if (!code) {
      await context.reply("Gagal mengambil kode undangan grup.");
      return;
    }

    await context.reply(`*Link Undangan Grup:*\nhttps://chat.whatsapp.com/${code}`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil link undangan grup."));
  }
}

async function handleGetProfilePicture(context: CommandContext): Promise<void> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply("Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.");
    return;
  }

  let rawTarget: string | null = null;
  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTarget = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTarget = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args[0]) {
    const rawNum = context.args[0].replace(/^@/, "").trim();
    if (/^\d{8,15}$/.test(rawNum)) {
      rawTarget = normalizeUserJid(`${rawNum}@s.whatsapp.net`);
    }
  }

  const targetJid = rawTarget
    ? await identityResolverService.resolveCanonicalUserJid(context.socket, context.chatJid, rawTarget)
    : await resolveCanonicalSender(context);
  const altJids = rawTarget ? [rawTarget] : context.senderAltJids;

  const avatar = await avatarService.getAvatarWithFallback(context.socket, targetJid, altJids);
  await context.socket.sendMessage(
    context.chatJid,
    {
      image: avatar,
      caption: `Foto profil ${tag(targetJid)}`,
      mentions: [targetJid],
    },
    { quoted: context.message },
  );
}

// ---- Local Creative Tools ----

async function handleQrCode(context: CommandContext): Promise<void> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply("Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.");
    return;
  }

  const text = context.argsText.trim();
  if (!text) {
    await context.reply("Format salah.\nGunakan: .qr <teks atau link>\nContoh: .qr https://example.com");
    return;
  }

  try {
    const png = await generateQrCodePng(text);
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: png,
        caption: `QR Code untuk:\n${text.slice(0, 120)}`,
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat QR Code."));
  }
}

async function handleCalculator(context: CommandContext): Promise<void> {
  const expr = context.argsText.trim();
  if (!expr) {
    await context.reply("Gunakan: .calc <ekspresi>\nContoh: .calc (25 + 15) * 3 / 2");
    return;
  }

  try {
    const result = evaluateSafeMathExpression(expr);
    await context.reply(
      [
        "*─── [ KALKULATOR ] ───*",
        "",
        `• Soal  : ${expr}`,
        `• Hasil : *${result.toLocaleString("id-ID", { maximumFractionDigits: 8 })}*`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung ekspresi matematika."));
  }
}

async function handleTtpSticker(context: CommandContext): Promise<void> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply("Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.");
    return;
  }

  const text = context.argsText.trim();
  if (!text) {
    await context.reply("Format salah.\nGunakan: .ttp <teks>\nContoh: .ttp Gas Mabar!");
    return;
  }

  try {
    const stickerBuffer = await createTtpSticker(text);
    await context.socket.sendMessage(
      context.chatJid,
      { sticker: stickerBuffer },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat stiker .ttp."));
  }
}

export const groupToolCommands: CommandDefinition[] = [
  { name: "mulaiabsen", execute: handleStartAttendance },
  { name: "absen", execute: handleMarkAttendance },
  { name: "cekabsen", execute: handleCheckAttendance },
  { name: "hapusabsen", execute: handleDeleteAttendance },
  { name: "mulaivote", execute: handleStartVote },
  { name: "upvote", execute: (ctx) => handleCastVote(ctx, "up") },
  { name: "devote", execute: (ctx) => handleCastVote(ctx, "down") },
  { name: "cekvote", execute: handleCheckVote },
  { name: "hapusvote", execute: handleDeleteVote },
  { name: "poll", execute: handleNativePoll },
  { name: "buatcatatan", aliases: ["setnote", "addnote"], execute: handleSaveNote },
  { name: "lihatcatatan", aliases: ["note", "catatan"], execute: handleGetNote },
  { name: "listcatatan", aliases: ["listnote"], execute: handleListNotes },
  { name: "hapuscatatan", aliases: ["delnote"], execute: handleDeleteNote },
  { name: "infogrup", aliases: ["infogroup"], execute: handleGroupInfo },
  { name: "listadmin", execute: handleListAdmin },
  { name: "tagme", execute: handleTagMe },
  { name: "link", aliases: ["linkgrup"], execute: handleGroupLink },
  { name: "getpp", aliases: ["getprofile"], execute: handleGetProfilePicture },
  { name: "qr", aliases: ["qrcode"], execute: handleQrCode },
  { name: "calc", aliases: ["kalkulator"], execute: handleCalculator },
  { name: "ttp", execute: handleTtpSticker },
];
