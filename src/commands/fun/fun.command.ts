import { coupleService } from "../../services/fun/couple.service";
import { kerangAjaibService, type FunCheckType } from "../../services/fun/kerangAjaib.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah } from "../../utils/currency";
import {
  extractContactCandidateJids,
  getBotCanonicalJids,
  isPhoneUserJid,
  normalizeUserJid,
} from "../../utils/jid";
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

async function resolveOptionalTarget(
  context: CommandContext,
): Promise<{ jid: string; label: string; mentions: string[] }> {
  let rawTarget: string | null = null;
  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTarget = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTarget = normalizeUserJid(context.quoted.participantJid);
  }

  if (rawTarget) {
    const canonical = await identityResolverService.resolveCanonicalUserJid(
      context.socket,
      context.chatJid,
      rawTarget,
    );
    const phone = canonical.split("@")[0] ?? canonical;
    return { jid: canonical, label: `@${phone}`, mentions: [canonical] };
  }

  const freeText = context.argsText.trim();
  if (freeText.length > 0 && !freeText.startsWith("@")) {
    return { jid: freeText.toLowerCase(), label: freeText, mentions: [] };
  }

  const senderJid = await resolveCanonicalSender(context);
  const phone = senderJid.split("@")[0] ?? senderJid;
  return { jid: senderJid, label: `@${phone}`, mentions: [senderJid] };
}

async function resolveTaggedOnlyTarget(context: CommandContext): Promise<string | null> {
  let rawTarget: string | null = null;
  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    rawTarget = normalizeUserJid(context.mentionedJids[0]);
  } else if (context.quoted?.participantJid) {
    rawTarget = normalizeUserJid(context.quoted.participantJid);
  } else if (context.args[0]) {
    const cleaned = context.args[0].replace(/^@/, "").trim();
    if (/^\d{8,15}$/.test(cleaned)) {
      rawTarget = normalizeUserJid(`${cleaned}@s.whatsapp.net`);
    }
  }

  if (!rawTarget) {
    return null;
  }

  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    rawTarget,
  );
}

function tag(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

async function handleCheck(context: CommandContext, type: FunCheckType): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const target = await resolveOptionalTarget(context);
  const res = kerangAjaibService.runPercentageCheck(type, target.jid, target.label);
  await context.reply(res.text, { mentions: target.mentions });
}

async function handleKhodam(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  const target = await resolveOptionalTarget(context);
  const res = kerangAjaibService.checkKhodam(target.jid, target.label);
  await context.reply(res.text, { mentions: target.mentions });
}

async function handleApakah(context: CommandContext): Promise<void> {
  const question = context.argsText.trim();
  if (!question) {
    await context.reply("Gunakan: .apakah <pertanyaan>\nContoh: .apakah aku bakal jadi sultan?");
    return;
  }
  await context.reply(kerangAjaibService.answerApakah(question));
}

async function handleKapan(context: CommandContext): Promise<void> {
  const question = context.argsText.trim();
  if (!question) {
    await context.reply("Gunakan: .kapankah <pertanyaan>\nContoh: .kapankah aku ketemu jodoh?");
    return;
  }
  await context.reply(kerangAjaibService.answerKapan(question));
}

async function handleRate(context: CommandContext): Promise<void> {
  const subject = context.argsText.trim();
  if (!subject) {
    await context.reply("Gunakan: .rate <sesuatu>\nContoh: .rate kegantenganku hari ini");
    return;
  }
  const res = kerangAjaibService.rateThing(subject);
  await context.reply(res.text);
}

async function handleTembak(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const targetJid = await resolveTaggedOnlyTarget(context);
    if (!targetJid) {
      await context.reply("Tag atau reply orang yang mau kamu tembak!\nContoh: .tembak @user");
      return;
    }

    const botJids = getBotCanonicalJids(context.socket);
    if (botJids.has(targetJid)) {
      await context.reply("Maaf ya, MinjiBot lagi fokus melayani grup dulu!");
      return;
    }

    const senderJid = await resolveCanonicalSender(context);
    const proposal = await coupleService.propose(context.chatJid, senderJid, targetJid);

    await context.reply(
      [
        "*─── [ NEMBAK JADIAN ] ───*",
        "",
        `${tag(proposal.proposerJid)} baru saja menyatakan perasaannya ke ${tag(proposal.targetJid)}!`,
        "",
        `${tag(proposal.targetJid)}, ketik *.terima* untuk jadian (dapat bonus Rp 15.000 & +50 XP masing-masing!) atau *.tolak* untuk menolak.`,
        "_Berlaku selama 10 menit._",
      ].join("\n"),
      { mentions: [proposal.proposerJid, proposal.targetJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengirim lamaran."));
  }
}

async function handleTerima(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const expectedProposer = (await resolveTaggedOnlyTarget(context)) ?? undefined;
    const res = await coupleService.acceptProposal(context.chatJid, senderJid, expectedProposer);

    await context.reply(
      [
        "*─── [ RESMI JADIAN! ] ───*",
        "",
        `Selamat! ${tag(res.proposerJid)} & ${tag(res.targetJid)} sekarang resmi berpasangan di grup ini!`,
        `• Hadiah Jadian : +${formatRupiah(res.bonusMoney)} & +${String(res.bonusXp)} XP masing-masing!`,
        "",
        "_Ketik .cekpacar untuk melihat status pasangan kalian._",
      ].join("\n"),
      { mentions: [res.proposerJid, res.targetJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menerima lamaran."));
  }
}

async function handleTolak(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const expectedProposer = (await resolveTaggedOnlyTarget(context)) ?? undefined;
    const rejected = coupleService.rejectProposal(context.chatJid, senderJid, expectedProposer);

    await context.reply(
      [
        "*─── [ LAMARAN DITOLAK ] ───*",
        "",
        `Yah... ${tag(rejected.targetJid)} menolak cinta dari ${tag(rejected.proposerJid)}.`,
        "Yang sabar ya, masih banyak ikan di kolam grup!",
      ].join("\n"),
      { mentions: [rejected.proposerJid, rejected.targetJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menolak lamaran."));
  }
}

async function handlePutus(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const senderJid = await resolveCanonicalSender(context);
    const res = await coupleService.breakUp(context.chatJid, senderJid);
    await context.reply(
      [
        "*─── [ STATUS PUTUS ] ───*",
        "",
        `${tag(res.userJid)} memutuskan hubungan dengan ${tag(res.exPartnerJid)}.`,
        "Semoga tetap berteman baik di grup ya!",
      ].join("\n"),
      { mentions: [res.userJid, res.exPartnerJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses putus."));
  }
}

async function handleCekPacar(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const tagged = await resolveTaggedOnlyTarget(context);
    const targetJid = tagged ?? (await resolveCanonicalSender(context));
    const status = await coupleService.checkPartner(context.chatJid, targetJid);

    if (!status.partnerJid) {
      await context.reply(
        `${tag(status.userJid)} saat ini masih *Jomblo* di grup ini. Yuk pakai .tembak @user!`,
        { mentions: [status.userJid] },
      );
      return;
    }

    await context.reply(
      [
        "*─── [ STATUS PASANGAN ] ───*",
        "",
        `• Member   : ${tag(status.userJid)}`,
        `• Pasangan : ${tag(status.partnerJid)}`,
        `• Durasi   : ${status.durationText ?? "baru saja"}`,
      ].join("\n"),
      { mentions: [status.userJid, status.partnerJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengecek status pasangan."));
  }
}

async function handleJodoh(context: CommandContext): Promise<void> {
  if (!(await ensureActiveGroup(context))) {
    return;
  }

  try {
    const metadata = await identityResolverService.getGroupMetadata(context.socket, context.chatJid);
    const botJids = getBotCanonicalJids(context.socket);

    const participantJids: string[] = [];
    for (const participant of metadata?.participants ?? []) {
      const candidates = extractContactCandidateJids(participant);
      if (candidates.some((c) => botJids.has(c))) {
        continue;
      }
      const preferred = candidates.find((c) => isPhoneUserJid(c)) ?? candidates[0];
      if (preferred) {
        participantJids.push(preferred);
      }
    }

    const match = coupleService.pickRandomMatch(participantJids);
    await context.reply(
      [
        "*─── [ RAMALAN JODOH GRUP ] ───*",
        "",
        `Pasangan acak hari ini:`,
        `${tag(match.firstJid)}  +  ${tag(match.secondJid)}`,
        "",
        `• Kecocokan : *${String(match.compatibility)}%*`,
        `• Kata Minji: ${match.comment}`,
      ].join("\n"),
      { mentions: [match.firstJid, match.secondJid] },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal meramal jodoh grup."));
  }
}

async function handleTextTransform(
  context: CommandContext,
  usage: string,
  transform: (input: string) => string,
): Promise<void> {
  const input = context.argsText.trim();
  if (!input) {
    await context.reply(usage);
    return;
  }
  await context.reply(transform(input));
}

async function handleReadMore(context: CommandContext): Promise<void> {
  const raw = context.argsText.trim();
  const sep = raw.indexOf("|");
  if (!raw || sep < 0) {
    await context.reply(
      "Format salah.\nGunakan: .readmore <teks atas>|<teks tersembunyi>\nContoh: .readmore Ada rahasia penting|Eh ketipu wkwk!",
    );
    return;
  }
  const top = raw.slice(0, sep).trim();
  const bottom = raw.slice(sep + 1).trim();
  if (!top || !bottom) {
    await context.reply("Kedua bagian teks sebelum dan sesudah '|' tidak boleh kosong.");
    return;
  }
  await context.reply(kerangAjaibService.buildReadMore(top, bottom));
}

export const funCommands: CommandDefinition[] = [
  { name: "apakah", execute: handleApakah },
  { name: "kapan", aliases: ["kapankah"], execute: handleKapan },
  { name: "rate", execute: handleRate },
  { name: "cekkhodam", aliases: ["khodam"], execute: handleKhodam },
  { name: "cekganteng", execute: (ctx) => handleCheck(ctx, "ganteng") },
  { name: "cekcantik", execute: (ctx) => handleCheck(ctx, "cantik") },
  { name: "cekbucin", execute: (ctx) => handleCheck(ctx, "bucin") },
  { name: "cekwibu", execute: (ctx) => handleCheck(ctx, "wibu") },
  { name: "cekpintar", execute: (ctx) => handleCheck(ctx, "pintar") },
  { name: "cekgabut", execute: (ctx) => handleCheck(ctx, "gabut") },
  { name: "cekjones", execute: (ctx) => handleCheck(ctx, "jones") },
  { name: "ceksadboy", execute: (ctx) => handleCheck(ctx, "sadboy") },
  { name: "cekstress", aliases: ["cekstres"], execute: (ctx) => handleCheck(ctx, "stress") },
  { name: "cekhoki", execute: (ctx) => handleCheck(ctx, "hoki") },
  { name: "ceksultan", execute: (ctx) => handleCheck(ctx, "sultan") },
  { name: "tembak", execute: handleTembak },
  { name: "terima", execute: handleTerima },
  { name: "tolak", execute: handleTolak },
  { name: "putus", execute: handlePutus },
  { name: "cekpacar", aliases: ["pacar"], execute: handleCekPacar },
  { name: "jodoh", execute: handleJodoh },
  { name: "truth", execute: (ctx) => ctx.reply(kerangAjaibService.getRandomTruth()) },
  { name: "dare", execute: (ctx) => ctx.reply(kerangAjaibService.getRandomDare()) },
  {
    name: "alay",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .alay <teks>", (t) => kerangAjaibService.toAlay(t)),
  },
  {
    name: "halah",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .halah <teks>", (t) =>
        kerangAjaibService.replaceVowels(t, "a"),
      ),
  },
  {
    name: "hilih",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .hilih <teks>", (t) =>
        kerangAjaibService.replaceVowels(t, "i"),
      ),
  },
  {
    name: "huluh",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .huluh <teks>", (t) =>
        kerangAjaibService.replaceVowels(t, "u"),
      ),
  },
  {
    name: "heleh",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .heleh <teks>", (t) =>
        kerangAjaibService.replaceVowels(t, "e"),
      ),
  },
  {
    name: "holoh",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .holoh <teks>", (t) =>
        kerangAjaibService.replaceVowels(t, "o"),
      ),
  },
  {
    name: "namaninja",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .namaninja <nama>", (t) =>
        kerangAjaibService.toNinjaName(t),
      ),
  },
  { name: "readmore", execute: handleReadMore },
  {
    name: "artinama",
    execute: (ctx) =>
      handleTextTransform(ctx, "Gunakan: .artinama <nama>", (t) =>
        kerangAjaibService.analyzeName(t),
      ),
  },
];
