import { parseClanMembers } from "../../repositories/groupClan.repository";
import {
  AUCTION_MIN_START,
  CLAN_CREATE_PRICE,
  CUSTOM_TITLE_PRICE,
  MARRIAGE_DEFAULT_DOWRY,
  MARRIAGE_XP_BONUS,
  PRESET_TITLES,
  socialEconomyService,
} from "../../services/fun/socialEconomy.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { photoMemeService } from "../../services/media/photoMeme.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatCompactRupiah, formatRupiah, parsePositiveBigIntMoneyInput } from "../../utils/currency";
import { formatDateId } from "../../utils/format";
import { isBotUserJid } from "../../utils/jid";
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

async function ensureGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return false;
  }
  return true;
}

// ======================== GELAR SULTAN ========================

async function handleBeliGelar(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const title = context.argsText.trim();
    if (!title) {
      await context.reply(
        [
          "*── [ TOKO GELAR SULTAN ] ──*",
          `Harga : *${formatRupiah(CUSTOM_TITLE_PRICE)}*`,
          "Format: *.beligelar <nama gelar>*",
          "Contoh: *.beligelar Raja Korupsi*",
          "",
          "Gelar akan tampil langsung di kartu *.profile* kamu!",
        ].join("\n"),
      );
      return;
    }

    const sender = await resolveSender(context);
    const res = await socialEconomyService.buyCustomTitle(context.chatJid, sender, title);
    await context.reply(
      [
        "*── [ GELAR BARU AKTIF! ] ──*",
        `Pemilik : ${tagOf(sender)}`,
        `Gelar   : *${res.title}*`,
        `Sisa Dompet: ${formatRupiah(res.remainingMoney)}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli gelar."));
  }
}

async function handleGelar(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const current = await socialEconomyService.getCurrentTitle(context.chatJid, sender);
    await context.reply(
      [
        "*── [ GELAR SULTAN ] ──*",
        `Gelar Kamu : *${current ?? "Belum punya"}*`,
        `Harga Beli : ${formatRupiah(CUSTOM_TITLE_PRICE)}`,
        "",
        "*Inspirasi Gelar:*",
        ...PRESET_TITLES.map((t, i) => `${String(i + 1)}. ${t}`),
        "",
        "Beli dengan *.beligelar <nama gelar>* atau hapus dengan *.hapusgelar*.",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membaca gelar."));
  }
}

async function handleHapusGelar(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    await socialEconomyService.clearCustomTitle(context.chatJid, sender);
    await context.reply("Gelar custom di profilmu berhasil dihapus.");
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghapus gelar."));
  }
}

// ======================== PERNIKAHAN ========================

async function handleNikah(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
    if (!rawTarget) {
      await context.reply(
        `Tag pasangan yang ingin kamu lamar!\nFormat: *.nikah @user [mahar]*\nContoh: *.nikah @user 100000000* (default ${formatRupiah(MARRIAGE_DEFAULT_DOWRY)})`,
      );
      return;
    }

    const sender = await resolveSender(context);
    const target = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      rawTarget,
    );

    if (isBotUserJid(context.socket, rawTarget, target)) {
      await context.reply("Minji sudah menikah dengan Server VPS! Cari pasangan manusia di grup ini ya.");
      return;
    }

    let dowry = MARRIAGE_DEFAULT_DOWRY;
    const nonTagArgs = context.args.filter((a) => !a.startsWith("@"));
    if (nonTagArgs[0]) {
      const parsed = parsePositiveBigIntMoneyInput(nonTagArgs[0]);
      if (parsed === null) {
        await context.reply("Nominal mahar tidak valid. Contoh: *.nikah @user 50000000*");
        return;
      }
      dowry = parsed;
    }

    const proposal = await socialEconomyService.proposeMarriage(
      context.chatJid,
      sender,
      target,
      dowry,
    );
    await context.reply(
      [
        "*── [ LAMARAN PERNIKAHAN ] ──*",
        `${tagOf(proposal.proposerJid)} melamar ${tagOf(proposal.targetJid)}!`,
        `Mahar : *${formatRupiah(proposal.dowry)}*`,
        "",
        `${tagOf(proposal.targetJid)}, ketik *.terimanikah* untuk menerima atau *.tolaknikah* untuk menolak (berlaku 10 menit).`,
      ].join("\n"),
      { mentions: [proposal.proposerJid, proposal.targetJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengirim lamaran nikah."));
  }
}

async function handleTerimaNikah(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const rec = await socialEconomyService.acceptMarriage(context.chatJid, sender);

    const [avatarA, avatarB] = await Promise.all([
      avatarService.getAvatarWithFallback(context.socket, rec.userJid),
      avatarService.getAvatarWithFallback(context.socket, rec.spouseJid),
    ]);

    const card = await photoMemeService.renderMarriageCard({
      avatarA,
      avatarB,
      nameA: tagOf(rec.userJid),
      nameB: tagOf(rec.spouseJid),
      dowryLabel: formatRupiah(rec.dowryAmount),
      dateLabel: formatDateId(new Date(rec.marriedAt)),
    });

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: card,
        mimetype: "image/png",
        caption: [
          "*── [ SAH! RESMI MENIKAH ] ──*",
          `Selamat menempuh hidup baru ${tagOf(rec.userJid)} & ${tagOf(rec.spouseJid)}!`,
          `Mahar : ${formatRupiah(rec.dowryAmount)}`,
          `Bonus : +${String(MARRIAGE_XP_BONUS)} XP untuk kedua mempelai!`,
        ].join("\n"),
        mentions: [rec.userJid, rec.spouseJid],
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menerima lamaran nikah."));
  }
}

async function handleTolakNikah(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const prop = socialEconomyService.declineMarriage(context.chatJid, sender);
    await context.reply(
      `${tagOf(sender)} menolak lamaran nikah dari ${tagOf(prop.proposerJid)}. Yang sabar ya!`,
      { mentions: [sender, prop.proposerJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menolak lamaran nikah."));
  }
}

async function handleBukuNikah(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
    const target = rawTarget
      ? await identityResolverService.resolveCanonicalUserJid(context.socket, context.chatJid, rawTarget)
      : await resolveSender(context);

    const rec = await socialEconomyService.getMarriageRecord(context.chatJid, target);
    if (!rec) {
      await context.reply(`${tagOf(target)} belum menikah di grup ini. Lamar dulu dengan *.nikah @user*!`, {
        mentions: [target],
      });
      return;
    }

    const [avatarA, avatarB] = await Promise.all([
      avatarService.getAvatarWithFallback(context.socket, rec.userJid),
      avatarService.getAvatarWithFallback(context.socket, rec.spouseJid),
    ]);
    const card = await photoMemeService.renderMarriageCard({
      avatarA,
      avatarB,
      nameA: tagOf(rec.userJid),
      nameB: tagOf(rec.spouseJid),
      dowryLabel: formatRupiah(rec.dowryAmount),
      dateLabel: formatDateId(new Date(rec.marriedAt)),
    });

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: card,
        mimetype: "image/png",
        caption: `*BUKU NIKAH:* ${tagOf(rec.userJid)} & ${tagOf(rec.spouseJid)}`,
        mentions: [rec.userJid, rec.spouseJid],
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencetak Buku Nikah."));
  }
}

async function handleCerai(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const { formerSpouseJid } = await socialEconomyService.divorce(context.chatJid, sender);
    await context.reply(
      `${tagOf(sender)} dan ${tagOf(formerSpouseJid)} kini resmi berpisah. Semoga menemukan jalan masing-masing.`,
      { mentions: [sender, formerSpouseJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses perceraian."));
  }
}

// ======================== GENG / KLAN ========================

async function handleGeng(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sub = (context.args[0] ?? "").trim().toLowerCase();
    const rest = context.args.slice(1).join(" ").trim();
    const sender = await resolveSender(context);

    if (!sub || sub === "help") {
      await context.reply(
        [
          "*── [ GENG / KLAN GRUP ] ──*",
          `Biaya Buat: ${formatRupiah(CLAN_CREATE_PRICE)}`,
          "",
          "• *.geng buat <nama>*   : Dirikan geng baru",
          "• *.geng join <nama>*   : Gabung ke geng",
          "• *.geng keluar*        : Keluar dari geng",
          "• *.geng info [nama]*   : Info & anggota geng",
          "• *.geng donasi <uang>* : Isi kas geng",
          "• *.geng top*           : Top geng terkaya",
          "• *.geng kick @user*    : Keluarkan anggota (Ketua)",
        ].join("\n"),
      );
      return;
    }

    if (sub === "buat" || sub === "create") {
      const clan = await socialEconomyService.createClan(context.chatJid, sender, rest);
      await context.reply(
        [
          "*── [ GENG BARU BERDIRI! ] ──*",
          `Nama  : *${clan.name}*`,
          `Ketua : ${tagOf(clan.leaderJid)}`,
          "",
          `Ajak teman bergabung dengan *.geng join ${clan.name}*!`,
        ].join("\n"),
        { mentions: [clan.leaderJid] },
      );
      return;
    }

    if (sub === "join" || sub === "gabung") {
      const clan = await socialEconomyService.joinClan(context.chatJid, sender, rest);
      await context.reply(
        `${tagOf(sender)} resmi bergabung ke geng *${clan.name}*!`,
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "keluar" || sub === "leave") {
      const res = await socialEconomyService.leaveClan(context.chatJid, sender);
      if (res.dissolved) {
        await context.reply(`Kamu keluar sebagai anggota terakhir. Geng *${res.clanName}* resmi dibubarkan.`);
        return;
      }
      const leaderNote = res.newLeaderJid
        ? ` Kepemimpinan diserahkan ke ${tagOf(res.newLeaderJid)}.`
        : "";
      await context.reply(`Kamu keluar dari geng *${res.clanName}*.${leaderNote}`, {
        mentions: res.newLeaderJid ? [res.newLeaderJid] : [],
      });
      return;
    }

    if (sub === "donasi" || sub === "donate") {
      const amount = parsePositiveBigIntMoneyInput(context.args[1] ?? "");
      if (amount === null) {
        await context.reply("Nominal donasi tidak valid. Contoh: *.geng donasi 5000000*");
        return;
      }
      const res = await socialEconomyService.donateToClan(context.chatJid, sender, amount);
      await context.reply(
        [
          "*── [ DONASI KAS GENG ] ──*",
          `Donatur  : ${tagOf(sender)}`,
          `Geng     : *${res.clanName}*`,
          `Donasi   : ${formatRupiah(amount)}`,
          `Total Kas: *${formatRupiah(res.newTreasury)}*`,
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    if (sub === "kick") {
      const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
      if (!rawTarget) {
        await context.reply("Tag anggota yang ingin dikeluarkan. Contoh: *.geng kick @user*");
        return;
      }
      const target = await identityResolverService.resolveCanonicalUserJid(
        context.socket,
        context.chatJid,
        rawTarget,
      );
      const res = await socialEconomyService.kickClanMember(context.chatJid, sender, target);
      await context.reply(`${tagOf(res.kickedJid)} telah dikeluarkan dari geng *${res.clanName}*.`, {
        mentions: [res.kickedJid],
      });
      return;
    }

    if (sub === "top" || sub === "list") {
      const clans = await socialEconomyService.listTopClans(context.chatJid);
      if (clans.length === 0) {
        await context.reply("Belum ada geng di grup ini. Buat yang pertama dengan *.geng buat <nama>*!");
        return;
      }
      const lines = clans.slice(0, 10).map((c, idx) => {
        const count = parseClanMembers(c.memberJids).length;
        return `${String(idx + 1)}. *${c.name}* Lv.${String(c.level)} (${String(count)} org | ${String(c.warWins)}x War) - Kas ${formatCompactRupiah(c.treasuryBalance)}`;
      });
      await context.reply(["*── [ TOP GENG GRUP ] ──*", ...lines].join("\n"));
      return;
    }

    // info
    const clan = await socialEconomyService.getClanInfo(
      context.chatJid,
      sender,
      sub === "info" ? rest : context.argsText,
    );
    if (!clan) {
      await context.reply("Geng tidak ditemukan atau kamu belum bergabung di geng mana pun.");
      return;
    }
    const members = parseClanMembers(clan.memberJids);
    await context.reply(
      [
        `*── [ GENG: ${clan.name.toUpperCase()} ] ──*`,
        `Ketua   : ${tagOf(clan.leaderJid)}`,
        `Level   : *Lv.${String(clan.level)}* (${String(clan.warWins)}x Menang War)`,
        `Kas     : *${formatRupiah(clan.treasuryBalance)}*`,
        `Anggota : ${String(members.length)} orang`,
        members.map((m, i) => `${String(i + 1)}. ${tagOf(m)}`).join("\n"),
      ].join("\n"),
      { mentions: members },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses perintah geng."));
  }
}

// ======================== LELANG GRUP ========================

async function handleLelang(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sub = (context.args[0] ?? "").trim().toLowerCase();
    const sender = await resolveSender(context);

    if (!sub || sub === "help") {
      await context.reply(
        [
          "*── [ BALAI LELANG GRUP ] ──*",
          `Harga Awal Min: ${formatRupiah(AUCTION_MIN_START)}`,
          "",
          "• *.lelang buka <barang> | <harga>* : Buka lelang",
          "• *.bid <nominal>*                  : Ajukan tawaran",
          "• *.lelang info*                    : Cek lelang aktif",
          "• *.lelang tutup*                   : Selesaikan & bayar",
          "• *.lelang batal*                   : Batalkan lelang",
        ].join("\n"),
      );
      return;
    }

    if (sub === "buka" || sub === "open") {
      const rest = context.args.slice(1).join(" ").trim();
      let itemName = "";
      let priceStr = "";
      if (rest.includes("|")) {
        const [left, right] = rest.split("|");
        itemName = (left ?? "").trim();
        priceStr = (right ?? "").trim();
      } else {
        const parts = rest.split(/\s+/);
        priceStr = parts.pop() ?? "";
        itemName = parts.join(" ").trim();
      }
      const startPrice = parsePositiveBigIntMoneyInput(priceStr);
      if (!itemName || startPrice === null) {
        await context.reply(
          "Format salah.\nContoh: *.lelang buka Gelar VIP | 5000000* atau *.lelang buka Naga 5000000*",
        );
        return;
      }

      const session = socialEconomyService.openAuction(
        context.chatJid,
        sender,
        itemName,
        startPrice,
      );
      await context.reply(
        [
          "*── [ LELANG DIBUKA! ] ──*",
          `Barang     : *${session.itemName}*`,
          `Penjual    : ${tagOf(session.sellerJid)}`,
          `Harga Awal : *${formatRupiah(session.startPrice)}*`,
          "",
          "Ajukan tawaran dengan *.bid <nominal>*!",
        ].join("\n"),
        { mentions: [session.sellerJid] },
      );
      return;
    }

    if (sub === "info" || sub === "status") {
      const session = socialEconomyService.getAuction(context.chatJid);
      if (!session) {
        await context.reply("Belum ada lelang aktif di grup ini.");
        return;
      }
      const bidderLine = session.highestBidderJid
        ? `Penawar Tertinggi: ${tagOf(session.highestBidderJid)}`
        : "Penawar Tertinggi: Belum ada";
      await context.reply(
        [
          "*── [ INFO LELANG AKTIF ] ──*",
          `Barang  : *${session.itemName}*`,
          `Penjual : ${tagOf(session.sellerJid)}`,
          `Harga   : *${formatRupiah(session.currentBid)}*`,
          bidderLine,
        ].join("\n"),
        {
          mentions: [
            session.sellerJid,
            ...(session.highestBidderJid ? [session.highestBidderJid] : []),
          ],
        },
      );
      return;
    }

    if (sub === "tutup" || sub === "close" || sub === "selesai") {
      const admin = await isAdminOrOwner(context);
      const { session, settled } = await socialEconomyService.closeAuction(
        context.chatJid,
        sender,
        admin,
      );
      if (!settled || !session.highestBidderJid) {
        await context.reply(`Lelang *${session.itemName}* ditutup tanpa ada penawar.`);
        return;
      }

      await context.reply(
        [
          "*── [ LELANG TERJUAL! ] ──*",
          `Barang   : *${session.itemName}*`,
          `Pemenang : ${tagOf(session.highestBidderJid)}`,
          `Penjual  : ${tagOf(session.sellerJid)}`,
          `Harga    : *${formatRupiah(session.currentBid)}* (lunas otomatis!)`,
        ].join("\n"),
        { mentions: [session.highestBidderJid, session.sellerJid] },
      );
      return;
    }

    if (sub === "batal" || sub === "cancel") {
      const admin = await isAdminOrOwner(context);
      const session = socialEconomyService.cancelAuction(context.chatJid, sender, admin);
      await context.reply(`Lelang *${session.itemName}* berhasil dibatalkan.`);
      return;
    }

    await context.reply("Sub-perintah tidak dikenal. Ketik *.lelang* untuk melihat panduan.");
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses lelang."));
  }
}

async function handleBid(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const amount = parsePositiveBigIntMoneyInput(context.args[0] ?? "");
    if (amount === null) {
      await context.reply("Masukkan nominal tawaran yang valid. Contoh: *.bid 10000000*");
      return;
    }

    const sender = await resolveSender(context);
    const session = await socialEconomyService.placeBid(context.chatJid, sender, amount);
    await context.reply(
      [
        "*── [ TAWARAN BARU! ] ──*",
        `Barang  : *${session.itemName}*`,
        `Penawar : ${tagOf(sender)}`,
        `Nominal : *${formatRupiah(session.currentBid)}*`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengajukan tawaran lelang."));
  }
}

export const socialEconomyCommands: CommandDefinition[] = [
  { name: "beligelar", execute: handleBeliGelar },
  { name: "gelar", execute: handleGelar },
  { name: "hapusgelar", execute: handleHapusGelar },
  { name: "nikah", execute: handleNikah },
  { name: "terimanikah", execute: handleTerimaNikah },
  { name: "tolaknikah", execute: handleTolakNikah },
  { name: "bukunikah", execute: handleBukuNikah },
  { name: "cerai", execute: handleCerai },
  { name: "geng", aliases: ["clan"], execute: handleGeng },
  { name: "lelang", execute: handleLelang },
  { name: "bid", execute: handleBid },
];
