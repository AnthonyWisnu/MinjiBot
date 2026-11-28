import { socialDramaService } from "../../services/fun/socialDrama.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { avatarService } from "../../services/media/avatar.service";
import { photoMemeService } from "../../services/media/photoMeme.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  extractContactCandidateJids,
  getBotCanonicalJids,
  isPhoneUserJid,
  normalizeUserJid,
} from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";
import { executeNpcCompatibilityRoll } from "./npcRomance.command";

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

async function getActiveGroupHumanJids(context: CommandContext): Promise<string[]> {
  const meta = await identityResolverService.getGroupMetadata(context.socket, context.chatJid);
  if (!meta?.participants) {
    return [];
  }
  const botJids = getBotCanonicalJids(context.socket);
  const result = new Set<string>();

  for (const p of meta.participants) {
    const candidates = extractContactCandidateJids(p);
    if (candidates.some((c) => botJids.has(c))) continue;
    const phone = candidates.find((c) => isPhoneUserJid(c));
    const chosen = phone ?? candidates[0];
    if (chosen) {
      result.add(normalizeUserJid(chosen));
    }
  }
  return [...result];
}

async function resolveSingleTarget(context: CommandContext): Promise<string> {
  const raw = context.mentionedJids[0] ?? context.quoted?.participantJid;
  if (raw) {
    return identityResolverService.resolveCanonicalUserJid(context.socket, context.chatJid, raw);
  }
  return resolveSender(context);
}

async function handleSiapa(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .siapa hanya bisa digunakan di grup aktif.");
    return;
  }
  try {
    const prompt = context.argsText.trim();
    if (!prompt) {
      await context.reply("Gunakan: *.siapa <pertanyaan>*\nContoh: *.siapa yang paling sering ghosting?*");
      return;
    }
    const members = await getActiveGroupHumanJids(context);
    const [picked] = socialDramaService.pickRandomMembers(members, 1);
    if (!picked) {
      await context.reply("Gagal membaca anggota grup.");
      return;
    }

    await context.reply(
      [
        "*── [ RADAR GRUP ] ──*",
        `Pertanyaan : Siapa ${prompt}`,
        `Terpilih   : ${tagOf(picked)}`,
      ].join("\n"),
      { mentions: [picked] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memilih anggota grup."));
  }
}

async function handlePaling(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .paling hanya bisa digunakan di grup aktif.");
    return;
  }
  try {
    const trait = context.argsText.trim();
    if (!trait) {
      await context.reply("Gunakan: *.paling <sifat>*\nContoh: *.paling gabut di grup ini*");
      return;
    }
    const members = await getActiveGroupHumanJids(context);
    const top = socialDramaService.pickRandomMembers(members, Math.min(3, members.length));
    const pcts = [99, 86, 73];
    const lines = top.map(
      (jid, i) => `${String(i + 1)}. ${tagOf(jid)} (${String(pcts[i] ?? 70)}%)`,
    );

    await context.reply(
      [
        `*── [ TOP PALING ${trait.toUpperCase().slice(0, 14)} ] ──*`,
        `Kategori: Paling *${trait}*`,
        "",
        ...lines,
      ].join("\n"),
      { mentions: top },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses peringkat acak."));
  }
}

async function handlePick(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .pick hanya bisa digunakan di grup aktif.");
    return;
  }
  try {
    const count = Number.parseInt(context.args[0] ?? "", 10);
    const label = context.args.slice(1).join(" ").trim() || "Peserta Terpilih";
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      await context.reply(
        "Format salah.\nGunakan: *.pick <1-10> <label>*\nContoh: *.pick 3 yang traktir kopi hari ini*",
      );
      return;
    }

    const members = await getActiveGroupHumanJids(context);
    const picked = socialDramaService.pickRandomMembers(members, count);
    const lines = picked.map((jid, i) => `${String(i + 1)}. ${tagOf(jid)}`);

    await context.reply(
      [
        "*── [ UNDIAN ACAK GRUP ] ──*",
        `Label: *${label}*`,
        "",
        ...lines,
      ].join("\n"),
      { mentions: picked },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal melakukan undian anggota."));
  }
}

async function handleJodohGrup(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .jodohgrup hanya bisa digunakan di grup aktif.");
    return;
  }
  try {
    const members = await getActiveGroupHumanJids(context);
    if (members.length < 2) {
      await context.reply("Minimal butuh 2 anggota di grup untuk mencocokkan jodoh.");
      return;
    }
    const [a, b] = socialDramaService.pickRandomMembers(members, 2);
    if (!a || !b) return;
    const compat = socialDramaService.computeCompatibility(a, b);

    await context.reply(
      [
        "*── [ PASANGAN ACAK GRUP ] ──*",
        `Pasangan  : ${tagOf(a)} x ${tagOf(b)}`,
        `Kecocokan : ${compat.bar}`,
        `Komentar  : ${compat.verdict}`,
      ].join("\n"),
      { mentions: [a, b] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencocokkan jodoh grup."));
  }
}

async function resolvePairTargets(context: CommandContext): Promise<[string, string] | null> {
  if (context.mentionedJids.length >= 2 && context.mentionedJids[0] && context.mentionedJids[1]) {
    const a = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      context.mentionedJids[0],
    );
    const b = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      context.mentionedJids[1],
    );
    return [a, b];
  }

  const single = context.mentionedJids[0] ?? context.quoted?.participantJid;
  if (single) {
    const a = await resolveSender(context);
    const b = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      single,
    );
    return [a, b];
  }

  return null;
}

async function handleCekCocok(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .cekcocok hanya bisa digunakan di grup aktif.");
    return;
  }
  try {
    const pair = await resolvePairTargets(context);
    if (!pair) {
      if (context.argsText.trim().length > 0) {
        await executeNpcCompatibilityRoll(context);
        return;
      }
      await context.reply(
        "Tag member atau ketik nama karakter anime/game!\n• Member: *.cekcocok @user1 @user2*\n• NPC: *.cekcocok Frieren* atau *.cocoknpc Raiden Shogun*",
      );
      return;
    }
    const [a, b] = pair;
    const compat = socialDramaService.computeCompatibility(a, b);
    await context.reply(
      [
        "*── [ TES KECOCOKAN ] ──*",
        `Pasangan  : ${tagOf(a)} & ${tagOf(b)}`,
        `Skor      : ${compat.bar}`,
        `Hasil     : ${compat.verdict}`,
      ].join("\n"),
      { mentions: [a, b] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung kecocokan."));
  }
}

async function handleShip(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .ship hanya bisa digunakan di grup aktif.");
    return;
  }
  try {
    const pair = await resolvePairTargets(context);
    if (!pair) {
      if (context.argsText.trim().length > 0) {
        await executeNpcCompatibilityRoll(context);
        return;
      }
      await context.reply(
        "Tag member atau ketik nama karakter anime/game!\n• Member: *.ship @user1 @user2*\n• NPC: *.ship Frieren* atau *.cocoknpc Kafka*",
      );
      return;
    }
    const [a, b] = pair;
    const compat = socialDramaService.computeCompatibility(a, b);
    const [avatarA, avatarB] = await Promise.all([
      avatarService.getAvatarWithFallback(context.socket, a),
      avatarService.getAvatarWithFallback(context.socket, b),
    ]);

    const card = await photoMemeService.renderShipCard({
      avatarA,
      avatarB,
      nameA: tagOf(a),
      nameB: tagOf(b),
      percentage: compat.percentage,
      verdict: compat.verdict,
    });

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: card,
        mimetype: "image/png",
        caption: `*SHIP:* ${tagOf(a)} x ${tagOf(b)} (*${String(compat.percentage)}%*)`,
        mentions: [a, b],
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat kartu Ship."));
  }
}

async function handleFaktaMember(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah .fakta hanya bisa digunakan di grup aktif.");
    return;
  }
  const target = await resolveSingleTarget(context);
  const fact = socialDramaService.getMemberFact(target);
  await context.reply(
    ["*── [ FAKTA MEMBER ] ──*", `Target: ${tagOf(target)}`, "", `"${fact}"`].join("\n"),
    { mentions: [target] },
  );
}

async function handleRamalan(context: CommandContext): Promise<void> {
  const target = context.isGroup ? await resolveSingleTarget(context) : context.senderUserJid;
  const r = socialDramaService.getDailyRamalan(target);
  await context.reply(
    [
      "*── [ RAMALAN HARIAN ] ──*",
      `Untuk      : ${tagOf(target)}`,
      `Rezeki     : ${r.rezeki}`,
      `Asmara     : ${r.asmara}`,
      `Karier     : ${r.karier}`,
      `Angka Hoki : *${String(r.angkaHoki)}*`,
      `Warna Hoki : *${r.warnaHoki}*`,
    ].join("\n"),
    { mentions: [target] },
  );
}

async function handleZodiak(context: CommandContext): Promise<void> {
  try {
    const z = socialDramaService.getZodiak(context.args[0] ?? "");
    await context.reply(
      [
        `*── [ ZODIAK: ${z.name.toUpperCase()} ] ──*`,
        `Tanggal : ${z.dateRange}`,
        `Elemen  : ${z.element}`,
        `Sifat   : ${z.traits}`,
        `Cocok   : ${z.compatibleWith}`,
        `Warna   : ${z.luckyColor}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membaca info zodiak."));
  }
}

async function handleShio(context: CommandContext): Promise<void> {
  try {
    const year = Number.parseInt(context.args[0] ?? "", 10);
    const s = socialDramaService.getShio(year);
    await context.reply(
      [
        `*── [ SHIO TAHUN ${String(s.year)} ] ──*`,
        `Shio    : *${s.shio}*`,
        `Elemen  : ${s.element}`,
        `Karakter: ${s.traits}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung shio."));
  }
}

async function handleWeton(context: CommandContext): Promise<void> {
  try {
    const w = socialDramaService.calculateWeton(context.args[0] ?? "");
    await context.reply(
      [
        "*── [ KALKULATOR WETON ] ──*",
        `Tanggal : ${w.dateLabel}`,
        `Weton   : *${w.wetonLabel}*`,
        `Neptu   : ${String(w.dayNeptu)} (${w.dayName}) + ${String(w.pasaranNeptu)} (${w.pasaran}) = *${String(w.totalNeptu)}*`,
        `Watak   : ${w.watak}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung weton Jawa."));
  }
}

export const socialDramaCommands: CommandDefinition[] = [
  { name: "siapa", execute: handleSiapa },
  { name: "paling", execute: handlePaling },
  { name: "pick", execute: handlePick },
  { name: "jodohgrup", execute: handleJodohGrup },
  { name: "cekcocok", execute: handleCekCocok },
  { name: "ship", execute: handleShip },
  { name: "fakta", execute: handleFaktaMember },
  { name: "ramalan", execute: handleRamalan },
  { name: "zodiak", execute: handleZodiak },
  { name: "shio", execute: handleShio },
  { name: "weton", execute: handleWeton },
];
