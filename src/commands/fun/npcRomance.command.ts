import { CURATED_GAME_CHARACTERS } from "../../services/fun/npcCharacterCatalog";
import {
  formatNpcRelationLabel,
  NPC_COMPAT_THRESHOLD,
  NPC_DATE_COST,
  NPC_MARRY_COST,
  NPC_MARRY_MIN_AFFECTION_LEVEL,
  NPC_PROPOSE_COST,
  NPC_SLOT_UPGRADE_COSTS,
  npcRomanceService,
} from "../../services/fun/npcRomance.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { photoMemeService } from "../../services/media/photoMeme.service";
import { MAX_NPC_PARTNER_SLOTS } from "../../services/rpg/rpgState";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatCompactRupiah, formatRemainingDuration } from "../../utils/currency";
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

async function ensureActiveGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return false;
  }
  return true;
}

export async function executeNpcCompatibilityRoll(
  context: CommandContext,
  overrideQuery?: string,
): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  const query = (overrideQuery ?? context.argsText).trim();
  if (!query) {
    await context.reply(
      [
        "╭─〔 KECOCOKAN KARAKTER NPC 〕─╮",
        "│ Cek chemistry-mu dengan karakter",
        "│ Anime, Manga, atau Game favorit!",
        "╰──────────────────────────────╯",
        "",
        "*Contoh:*",
        "• `.cocoknpc Frieren`",
        "• `.cocoknpc Raiden Shogun`",
        "• `.cocoknpc Gojo Satoru`",
        "• `.cocoknpc Kafka`",
        "",
        `_Skor >= ${String(NPC_COMPAT_THRESHOLD)}% bisa langsung ditembak lewat .tembaknpc!_`,
        "_Lihat karakter game kurasi: .kataloggame_",
      ].join("\n"),
    );
    return;
  }

  try {
    const sender = await resolveSender(context);
    const res = await npcRomanceService.rollCompatibility(context.chatJid, sender, query);
    const mentions = [sender];
    if (res.claimedByOtherJid) mentions.push(res.claimedByOtherJid);

    const statusLines: string[] = [];
    if (res.claimedByOtherJid) {
      const rel = formatNpcRelationLabel(res.claimedByOtherRelation ?? "pacar");
      statusLines.push(
        `Status : *Sudah dimiliki* (${rel} ${tagOf(res.claimedByOtherJid)})`,
      );
    } else if (res.alreadyOwnedBySelf) {
      statusLines.push("Status : *Pasanganmu sendiri!* (Ajak `.kencan`)");
    } else if (res.lockedByMemberPartner) {
      statusLines.push("Status : Terkunci (kamu sudah punya pasangan member asli)");
    } else if (res.canPropose) {
      statusLines.push(
        `Status : *COCOK >=${String(NPC_COMPAT_THRESHOLD)}%! SIAP DITEMBAK!*`,
        `Aksi   : Ketik *.tembaknpc* dalam 15 menit (${formatCompactRupiah(NPC_PROPOSE_COST)})`,
      );
    } else {
      statusLines.push("Status : Belum tembus 90% (cooldown roll 5 menit)");
    }

    const caption = [
      "╭─〔 KECOCOKAN KARAKTER NPC 〕─╮",
      `│ Pemain   : ${tagOf(sender)}`,
      `│ Karakter : *${res.character.name}*`,
      `│ Asal     : ${res.character.sourceTitle}`,
      `│ Skor     : *${String(res.score)}%*`,
      "╰──────────────────────────────╯",
      "",
      `_${res.verdict}_`,
      ...statusLines,
    ].join("\n");

    const rawSocket = ((context as { socket?: unknown }).socket ?? {}) as {
      sendMessage?: (
        chatJid: string,
        content: { image: Buffer; caption: string; mentions?: string[] },
        options?: { quoted?: unknown },
      ) => Promise<unknown>;
    };

    if (typeof rawSocket.sendMessage === "function") {
      try {
        const avatarA = await avatarService.getAvatarWithFallback(
          context.socket,
          sender,
          context.senderAltJids,
        );
        const pushName = context.message.pushName?.trim();
        const nameA = pushName && pushName.length > 0 ? pushName : (sender.split("@")[0] ?? "Kamu");
        const card = await photoMemeService.renderShipCard({
          avatarA,
          avatarB: res.character.imageBuffer,
          nameA,
          nameB: res.character.name,
          percentage: res.score,
          verdict: res.verdict,
        });
        await rawSocket.sendMessage(
          context.chatJid,
          { image: card, caption, mentions },
          { quoted: context.message },
        );
        return;
      } catch {
        // Fallback ke balasan teks jika rendering kartu gagal
      }
    }

    await context.reply(caption, { mentions });
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari kecocokan karakter NPC."));
  }
}

async function handleTembakNpc(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await npcRomanceService.proposeToNpc(
      context.chatJid,
      sender,
      context.argsText.trim() || undefined,
    );

    if (res.accepted) {
      await context.reply(
        [
          "╭─〔 RESMI JADIAN (NPC)! 〕─╮",
          `│ Pemain   : ${tagOf(sender)}`,
          `│ Pasangan : *${res.characterName}*`,
          `│ Asal     : ${res.sourceTitle}`,
          `│ Status   : *Pacar Resmi* (Cinta Lv.1)`,
          `│ Slot     : ${String(res.partnerCount)} / ${String(res.maxSlots)}`,
          "╰───────────────────────────╯",
          "",
          `• Biaya Kencan : -${formatCompactRupiah(res.costPaid)}`,
          `• Bonus XP     : +${String(res.xpGained)} XP`,
          `• Sisa Dompet  : ${formatCompactRupiah(res.currentMoney)}`,
          "",
          `*${res.characterName}* kini eksklusif milikmu di grup ini!`,
          `_Ajak .kencan hingga Cinta Lv.${String(NPC_MARRY_MIN_AFFECTION_LEVEL)} lalu lamar nikah lewat .nikahnpc!_`,
        ].join("\n"),
        { mentions: [sender] },
      );
      return;
    }

    await context.reply(
      [
        "╭─〔 DITOLAK TSUNDERE! 〕─╮",
        `│ Pemain   : ${tagOf(sender)}`,
        `│ Target   : *${res.characterName}* (${String(res.score)}%)`,
        "╰─────────────────────────╯",
        "",
        `*"B-bukan berarti aku tidak suka, tapi aku belum siap..."*`,
        `• Biaya Bunga : -${formatCompactRupiah(res.costPaid)}`,
        `• Hiburan XP  : +${String(res.xpGained)} XP`,
        `• Sisa Dompet : ${formatCompactRupiah(res.currentMoney)}`,
        "",
        "_Tips: Skor 95%+ dijamin 100% langsung diterima! Coba roll lagi nanti._",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menembak karakter NPC."));
  }
}

async function handleKencanNpc(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await npcRomanceService.dateNpcPartner(
      context.chatJid,
      sender,
      context.argsText.trim() || undefined,
    );
    const lvText =
      res.newAffectionLevel > res.oldAffectionLevel
        ? `Lv.${String(res.oldAffectionLevel)} -> *Lv.${String(res.newAffectionLevel)}* (NAIK!)`
        : `Lv.${String(res.newAffectionLevel)}`;
    const marryHint = res.readyToMarry
      ? `\n*SIAP NIKAH!* Ketik \`.nikahnpc ${res.partner.name}\` (${formatCompactRupiah(NPC_MARRY_COST)}) untuk meresmikan jadi Istri/Suami Sah!`
      : "";

    await context.reply(
      [
        "╭─〔 KENCAN ROMANTIS NPC 〕─╮",
        `│ Pemain   : ${tagOf(sender)}`,
        `│ Pasangan : *${res.partner.name}*`,
        `│ Status   : ${formatNpcRelationLabel(res.partner.relation)}`,
        `│ Cinta    : ${lvText}`,
        "╰──────────────────────────╯",
        "",
        `Kalian ${res.story}.`,
        "",
        `• Biaya  : -${formatCompactRupiah(res.costPaid)}`,
        `• Bonus  : +${String(res.xpGained)} XP`,
        `• Dompet : ${formatCompactRupiah(res.currentMoney)}${marryHint}`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal berkencan dengan pasangan NPC."));
  }
}

async function handleNikahNpc(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const args = context.args.map((a) => a.trim()).filter(Boolean);
    const last = args[args.length - 1]?.toLowerCase();
    let requestedRelation: string | undefined;
    let queryParts = args;
    if (last && ["istri", "suami", "waifu", "husbando", "wife", "husband"].includes(last)) {
      requestedRelation = last;
      queryParts = args.slice(0, -1);
    }

    const res = await npcRomanceService.marryNpcPartner(
      context.chatJid,
      sender,
      queryParts.join(" ") || undefined,
      requestedRelation,
    );
    const relLabel = formatNpcRelationLabel(res.partner.relation);

    await context.reply(
      [
        "╭─〔 SAH MENIKAH (NPC)! 〕─╮",
        `│ Mempelai : ${tagOf(sender)}`,
        `│ Pasangan : *${res.partner.name}*`,
        `│ Asal     : ${res.partner.sourceTitle}`,
        `│ Status   : *${relLabel}*`,
        "╰─────────────────────────╯",
        "",
        `• Mahar Cincin : -${formatCompactRupiah(res.costPaid)}`,
        `• Bonus XP     : +${String(res.xpGained)} XP`,
        `• Sisa Dompet  : ${formatCompactRupiah(res.currentMoney)}`,
        "",
        `Selamat menempuh hidup baru! Status *${relLabel}* kini tampil di *.profile* & *.waifuku*!`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menikahi karakter NPC."));
  }
}

async function handleWaifuku(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const sub = (context.args[0] ?? "").trim().toLowerCase();

    if (sub === "utama" || sub === "primary" || sub === "set") {
      const targetQuery = context.args.slice(1).join(" ").trim();
      if (!targetQuery) {
        await context.reply("Format: `.waifuku utama <nomor/nama>`\nContoh: `.waifuku utama 2`");
        return;
      }
      const primary = await npcRomanceService.setPrimaryPartner(
        context.chatJid,
        sender,
        targetQuery,
      );
      await context.reply(
        `*${primary.name}* (${formatNpcRelationLabel(primary.relation)}) kini dijadikan *Pasangan Utama* dan tampil di *.profile*!`,
      );
      return;
    }

    if (sub === "belislot" || sub === "slot") {
      await handleWaifuSlot(context);
      return;
    }

    const ov = await npcRomanceService.getOverview(context.chatJid, sender);
    if (ov.partners.length === 0) {
      const lockNote = ov.lockedByMemberJid
        ? `\n_Catatan: Kamu sedang berpasangan dengan ${tagOf(ov.lockedByMemberJid)} (sistem saling mengunci aktif)._`
        : "";
      await context.reply(
        [
          "╭─〔 DAFTAR PASANGAN NPC 〕─╮",
          `│ Pemilik : ${tagOf(sender)}`,
          `│ Slot    : 0 / ${String(ov.maxSlots)}`,
          "╰──────────────────────────╯",
          "",
          "Kamu belum punya pacar/istri/suami karakter anime atau game.",
          "",
          "*Cara Mulai:*",
          "1. `.cocoknpc <nama>` (roll kecocokan)",
          `2. Tembus *>=${String(NPC_COMPAT_THRESHOLD)}%* -> ketik \`.tembaknpc\` (${formatCompactRupiah(NPC_PROPOSE_COST)})`,
          `3. Ajak \`.kencan\` (${formatCompactRupiah(NPC_DATE_COST)}) -> \`.nikahnpc\` (${formatCompactRupiah(NPC_MARRY_COST)})`,
          lockNote,
        ]
          .filter(Boolean)
          .join("\n"),
        { mentions: ov.lockedByMemberJid ? [sender, ov.lockedByMemberJid] : [sender] },
      );
      return;
    }

    const nowMs = Date.now();
    const listLines = ov.partners.map((p, idx) => {
      const isPrimary = ov.primary?.characterKey === p.characterKey ? " [UTAMA]" : "";
      const rel = formatNpcRelationLabel(p.relation);
      const sinceText =
        p.startedAt > 0 ? formatRemainingDuration(Math.max(1000, nowMs - p.startedAt)) : "baru saja";
      return [
        `*${String(idx + 1)}. ${p.name}*${isPrimary}`,
        `  ├ Asal   : ${p.sourceTitle}`,
        `  ├ Status : *${rel}* | Cinta Lv.${String(p.affectionLevel)}`,
        `  └ Bersama: ${sinceText}`,
      ].join("\n");
    });

    const slotLine = ov.nextSlotCost
      ? `• \`.waifuslot\` — Tambah slot ke-${String(ov.maxSlots + 1)} (${formatCompactRupiah(ov.nextSlotCost)})`
      : `• Slot Harem sudah maksimal (${String(MAX_NPC_PARTNER_SLOTS)}/${String(MAX_NPC_PARTNER_SLOTS)})`;

    await context.reply(
      [
        "╭─〔 DAFTAR PASANGAN NPC 〕─╮",
        `│ Pemilik : ${tagOf(sender)}`,
        `│ Slot    : ${String(ov.partners.length)} / ${String(ov.maxSlots)}`,
        "╰──────────────────────────╯",
        "",
        ...listLines,
        "",
        "*Perintah Cepat:*",
        "• `.kencan [no/nama]` — Kencan & naikkan Lv Cinta",
        "• `.nikahnpc [no/nama]` — Lamar jadi Istri/Suami Sah",
        "• `.waifuku utama <no/nama>` — Tampilkan di .profile",
        "• `.putusnpc <no/nama>` — Putus/Cerai",
        slotLine,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat daftar pasangan NPC."));
  }
}

async function handleWaifuSlot(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const arg = (context.args[0] ?? "").trim().toLowerCase();
    if (arg === "info" || arg === "harga") {
      const lines = Object.entries(NPC_SLOT_UPGRADE_COSTS).map(
        ([slot, cost]) => `• Slot ke-${slot} : *${formatCompactRupiah(cost)}*`,
      );
      await context.reply(
        [
          "╭─〔 HARGA SLOT HAREM NPC 〕─╮",
          ...lines,
          "╰───────────────────────────╯",
          "Ketik *.waifuslot* untuk membeli slot berikutnya.",
        ].join("\n"),
      );
      return;
    }

    const res = await npcRomanceService.buyExtraSlot(context.chatJid, sender);
    await context.reply(
      [
        "╭─〔 SLOT HAREM BERTAMBAH! 〕─╮",
        `│ Pemilik : ${tagOf(sender)}`,
        `│ Slot    : ${String(res.oldSlots)} -> *${String(res.newSlots)}* / ${String(MAX_NPC_PARTNER_SLOTS)}`,
        `│ Biaya   : -${formatCompactRupiah(res.costPaid)}`,
        `│ Dompet  : ${formatCompactRupiah(res.currentMoney)}`,
        "╰────────────────────────────╯",
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membeli slot pasangan NPC."));
  }
}

async function handlePutusNpc(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const res = await npcRomanceService.breakupNpcPartner(
      context.chatJid,
      sender,
      context.argsText.trim() || undefined,
    );
    await context.reply(
      [
        "╭─〔 HUBUNGAN NPC BERAKHIR 〕─╮",
        `│ Pemain   : ${tagOf(sender)}`,
        `│ Mantan   : *${res.removed.name}* (${res.removed.sourceTitle})`,
        `│ Sisa Slot: ${String(res.remainingCount)} pasangan aktif`,
        "╰────────────────────────────╯",
        "",
        `_*${res.removed.name}* kini kembali bebas dan bisa dikejar member lain di grup ini._`,
      ].join("\n"),
      { mentions: [sender] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengakhiri hubungan NPC."));
  }
}

async function handleWaifuGrup(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) return;
  try {
    const claims = await npcRomanceService.listGroupClaims(context.chatJid);
    if (claims.length === 0) {
      await context.reply(
        "Belum ada karakter anime/game yang diklaim di grup ini! Jadilah yang pertama lewat *.cocoknpc <nama karakter>*.",
      );
      return;
    }

    const top = claims.slice(0, 20);
    const mentions = Array.from(new Set(top.map((c) => c.ownerJid)));
    const lines = top.map(
      (c, idx) =>
        `${String(idx + 1)}. *${c.name}* (${c.sourceTitle})\n   └ ${formatNpcRelationLabel(c.relation)} ${tagOf(c.ownerJid)}`,
    );

    await context.reply(
      [
        "╭─〔 KLAIM WAIFU/HUSBANDO GRUP 〕─╮",
        `│ Total Klaim: *${String(claims.length)} karakter* (Eksklusif)`,
        "╰────────────────────────────────╯",
        "",
        ...lines,
        ...(claims.length > 20 ? ["", `_...dan ${String(claims.length - 20)} karakter lainnya._`] : []),
      ].join("\n"),
      { mentions },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat daftar klaim karakter grup."));
  }
}

async function handleKatalogGame(context: CommandContext): Promise<void> {
  const byGame = new Map<string, string[]>();
  for (const c of CURATED_GAME_CHARACTERS) {
    const arr = byGame.get(c.sourceTitle) ?? [];
    arr.push(c.name);
    byGame.set(c.sourceTitle, arr);
  }

  const lines: string[] = [];
  for (const [game, names] of byGame.entries()) {
    lines.push(`*${game}:*\n  ${names.join(", ")}`);
  }

  await context.reply(
    [
      "╭─〔 KATALOG KARAKTER GAME & ANIME 〕─╮",
      `│ ${String(CURATED_GAME_CHARACTERS.length)} Karakter Game + Puluhan Ribu Anime`,
      "╰────────────────────────────────────╯",
      "",
      ...lines,
      "",
      "*Anime & Manga:*",
      "Ketik nama karakter anime apa saja langsung dari database AniList!",
      "Contoh: `.cocoknpc Frieren`, `.cocoknpc Gojo`, `.cocoknpc Rem`",
    ].join("\n"),
  );
}

export const npcRomanceCommands: CommandDefinition[] = [
  {
    name: "cocoknpc",
    aliases: ["shipnpc", "jodohnpc", "cekwaifu"],
    execute: (context) => executeNpcCompatibilityRoll(context),
  },
  {
    name: "tembaknpc",
    aliases: ["proposenpc", "lamarwaifu"],
    execute: handleTembakNpc,
  },
  {
    name: "kencan",
    aliases: ["datenpc"],
    execute: handleKencanNpc,
  },
  {
    name: "nikahnpc",
    aliases: ["lamarnpc", "marrynpc"],
    execute: handleNikahNpc,
  },
  {
    name: "waifuku",
    aliases: ["pasangannpc", "husbandoku", "haremku"],
    execute: handleWaifuku,
  },
  {
    name: "waifuslot",
    aliases: ["belislotwaifu", "tambahslotwaifu"],
    execute: handleWaifuSlot,
  },
  {
    name: "putusnpc",
    aliases: ["cerainpc"],
    execute: handlePutusNpc,
  },
  {
    name: "waifugrup",
    aliases: ["daftarwaifu", "listwaifu"],
    execute: handleWaifuGrup,
  },
  {
    name: "kataloggame",
    aliases: ["listnpc", "daftarnpc"],
    execute: handleKatalogGame,
  },
];
