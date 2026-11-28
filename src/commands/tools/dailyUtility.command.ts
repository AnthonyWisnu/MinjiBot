import { randomInt } from "node:crypto";

import {
  dailyUtilityService,
  parseDateDmy,
} from "../../services/tools/dailyUtility.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah, parseBigIntAmountOrAll } from "../../utils/currency";
import { formatUserSafeError } from "../../utils/userSafeError";

function resolveTextOrQuoted(context: CommandContext): string {
  const inline = context.argsText.trim();
  if (inline.length > 0) return inline;
  return (context.quoted?.text ?? "").trim();
}

async function handleKurs(context: CommandContext): Promise<void> {
  const rawAmount = context.args[0];
  const from = context.args[1];
  const to = context.args[2];
  if (!rawAmount || !from || !to) {
    await context.reply(
      "Format: .kurs <jumlah> <dari> <ke>\nContoh: .kurs 100 USD IDR atau .kurs 1000 JPY IDR",
    );
    return;
  }
  const amount = Number.parseFloat(rawAmount.replace(/,/g, "."));
  try {
    const res = await dailyUtilityService.convertCurrency(amount, from, to);
    await context.reply(
      [
        "*── [ KONVERSI KURS ] ──*",
        `${res.amount.toLocaleString("id-ID", { maximumFractionDigits: 4 })} *${res.from}* =`,
        `*${res.converted.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${res.to}*`,
        "",
        `Kurs   : 1 ${res.from} = ${res.rate.toLocaleString("id-ID", { maximumFractionDigits: 4 })} ${res.to}`,
        `Sumber : ${res.source} (${res.date})`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil kurs mata uang."));
  }
}

async function handleBerita(context: CommandContext): Promise<void> {
  try {
    const feed = await dailyUtilityService.getNews(context.args[0]);
    const lines = feed.articles.map(
      (a, idx) => `${String(idx + 1)}. *${a.title}*${a.link ? `\n   ${a.link}` : ""}`,
    );
    await context.reply(
      [
        `*── [ BERITA ${feed.category.toUpperCase()} ] ──*`,
        `_Sumber: ${feed.source}_`,
        "",
        ...lines,
        "",
        "Kategori: nasional, ekonomi, teknologi, olahraga, hiburan, internasional, antara",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil berita terkini."));
  }
}

async function handleKamusEn(context: CommandContext): Promise<void> {
  const word = context.args[0]?.trim();
  if (!word) {
    await context.reply("Format: .kamusen <kata_inggris>\nContoh: .kamusen resilience");
    return;
  }
  try {
    const res = await dailyUtilityService.lookupEnglishWord(word);
    const blocks = res.meanings.map((m, idx) => {
      const lines = [`${String(idx + 1)}. *(${m.partOfSpeech})* ${m.definition}`];
      if (m.example) lines.push(`   Contoh: _"${m.example}"_`);
      if (m.synonyms.length > 0) lines.push(`   Sinonim: ${m.synonyms.join(", ")}`);
      return lines.join("\n");
    });

    await context.reply(
      [
        `*── [ KAMUS EN: ${res.word.toUpperCase()} ] ──*`,
        `Fonetik: ${res.phonetic}`,
        "",
        ...blocks,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari arti kata Bahasa Inggris."));
  }
}

async function handleHitungUmur(context: CommandContext): Promise<void> {
  const raw = context.args[0];
  const birth = raw ? parseDateDmy(raw) : null;
  if (!birth) {
    await context.reply("Format: .hitungumur <dd-mm-yyyy>\nContoh: .hitungumur 17-08-2000");
    return;
  }
  try {
    const res = dailyUtilityService.calculateAge(birth);
    await context.reply(
      [
        "*── [ KALKULATOR UMUR ] ──*",
        `Lahir  : ${res.birthWeekday}, ${raw ?? ""}`,
        `Umur   : *${String(res.years)} tahun, ${String(res.months)} bulan, ${String(res.days)} hari*`,
        `Total  : ${res.totalDaysLived.toLocaleString("id-ID")} hari hidup`,
        `Ultah  : ${String(res.daysUntilNextBirthday)} hari lagi`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung umur."));
  }
}

async function handleBmi(context: CommandContext): Promise<void> {
  const w = Number.parseFloat((context.args[0] ?? "").replace(",", "."));
  const h = Number.parseFloat((context.args[1] ?? "").replace(",", "."));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    await context.reply("Format: .bmi <berat_kg> <tinggi_cm>\nContoh: .bmi 65 170");
    return;
  }
  try {
    const res = dailyUtilityService.calculateBmi(w, h);
    await context.reply(
      [
        "*── [ KALKULATOR BMI ] ──*",
        `Berat  : ${String(w)} kg | Tinggi: ${String(h)} cm`,
        `BMI    : *${res.bmi.toFixed(1)}*`,
        `Status : *${res.category}*`,
        `Ideal  : ${res.idealMinKg.toFixed(1)} kg - ${res.idealMaxKg.toFixed(1)} kg`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung BMI."));
  }
}

async function handleDiskon(context: CommandContext): Promise<void> {
  const parsedPrice = parseBigIntAmountOrAll(context.args[0]);
  const pct = Number.parseFloat((context.args[1] ?? "").replace("%", "").replace(",", "."));
  if (!parsedPrice || parsedPrice === "all" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    await context.reply("Format: .diskon <harga> <persen>\nContoh: .diskon 250k 30");
    return;
  }
  const discount = (parsedPrice * BigInt(Math.round(pct * 100))) / 10_000n;
  const finalPrice = parsedPrice - discount;
  await context.reply(
    [
      "*── [ HITUNG DISKON ] ──*",
      `Harga Awal : ${formatRupiah(parsedPrice)}`,
      `Diskon     : ${String(pct)}% (-${formatRupiah(discount)})`,
      `Harga Akhir: *${formatRupiah(finalPrice)}*`,
    ].join("\n"),
  );
}

async function handleSplitBill(context: CommandContext): Promise<void> {
  const total = parseBigIntAmountOrAll(context.args[0]);
  const people = Number.parseInt(context.args[1] ?? "", 10);
  const taxPct = context.args[2]
    ? Number.parseFloat(context.args[2].replace("%", "").replace(",", "."))
    : 0;

  if (
    !total ||
    total === "all" ||
    !Number.isInteger(people) ||
    people < 1 ||
    people > 500 ||
    !Number.isFinite(taxPct) ||
    taxPct < 0 ||
    taxPct > 100
  ) {
    await context.reply(
      "Format: .splitbill <total> <jumlah_orang> [pajak%]\nContoh: .splitbill 350k 5 11",
    );
    return;
  }

  const taxAmount = (total * BigInt(Math.round(taxPct * 100))) / 10_000n;
  const grandTotal = total + taxAmount;
  const perPerson = grandTotal / BigInt(people);
  await context.reply(
    [
      "*── [ SPLIT BILL PATUNGAN ] ──*",
      `Subtotal  : ${formatRupiah(total)}`,
      ...(taxPct > 0 ? [`Pajak/PB1 : ${String(taxPct)}% (+${formatRupiah(taxAmount)})`] : []),
      `GrandTotal: ${formatRupiah(grandTotal)}`,
      `Peserta   : ${String(people)} orang`,
      `Per Orang : *${formatRupiah(perPerson)}*`,
    ].join("\n"),
  );
}

async function handleRandom(context: CommandContext): Promise<void> {
  const a = context.args[0] ? Number.parseInt(context.args[0], 10) : 1;
  const b = context.args[1] ? Number.parseInt(context.args[1], 10) : 100;
  if (!Number.isInteger(a) || !Number.isInteger(b) || Math.abs(b - a) > 1_000_000_000) {
    await context.reply("Format: .random [min] [max]\nContoh: .random 1 100");
    return;
  }
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const picked = min === max ? min : randomInt(min, max + 1);
  await context.reply(
    `*── [ ANGKA ACAK ] ──*\nRentang : ${String(min)} - ${String(max)}\nHasil   : *${String(picked)}*`,
  );
}

async function handlePilih(context: CommandContext): Promise<void> {
  const options = context.argsText
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (options.length < 2) {
    await context.reply("Format: .pilih opsi1 | opsi2 | opsi3\nContoh: .pilih Bakso | Mie Ayam | Sate");
    return;
  }
  const picked = options[randomInt(0, options.length)] ?? options[0] ?? "";
  await context.reply(`*── [ PILIHAN MINJI ] ──*\nDari ${String(options.length)} opsi, pilih:\n\n*${picked}*`);
}

async function handleAcakUrutan(context: CommandContext): Promise<void> {
  const items = context.argsText
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length < 2 || items.length > 50) {
    await context.reply(
      "Format: .acakurutan item1 | item2 | item3 (2-50 item)\nContoh: .acakurutan Andi, Budi, Cici, Doni",
    );
    return;
  }
  const shuffled = dailyUtilityService.shuffleItems(items);
  const lines = shuffled.map((item, idx) => `${String(idx + 1)}. ${item}`);
  await context.reply(["*── [ URUTAN ACAK ] ──*", "", ...lines].join("\n"));
}

async function handleTim(context: CommandContext): Promise<void> {
  const teamCount = Number.parseInt(context.args[0] ?? "", 10);
  const rest = context.args.slice(1).join(" ");
  const members = rest
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 10 || members.length < teamCount) {
    await context.reply(
      "Format: .tim <jumlah_tim> <nama1, nama2, ...>\nContoh: .tim 2 Andi, Budi, Cici, Doni, Eka, Fajar",
    );
    return;
  }

  const shuffled = dailyUtilityService.shuffleItems(members);
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  shuffled.forEach((member, idx) => {
    teams[idx % teamCount]?.push(member);
  });

  const blocks = teams.map(
    (team, idx) => `*Tim ${String(idx + 1)} (${String(team.length)} org):*\n${team.map((m) => `- ${m}`).join("\n")}`,
  );
  await context.reply(["*── [ PEMBAGIAN TIM ACAK ] ──*", "", ...blocks].join("\n\n"));
}

async function handleCountdown(context: CommandContext): Promise<void> {
  const rawDate = context.args[0];
  const target = rawDate ? parseDateDmy(rawDate) : null;
  if (!target) {
    await context.reply(
      "Format: .countdown <dd-mm-yyyy> [nama acara]\nContoh: .countdown 01-01-2027 Tahun Baru",
    );
    return;
  }
  const eventName = context.args.slice(1).join(" ").trim() || "Target Acara";
  const diffMs = target.getTime() - Date.now();
  const absDays = Math.floor(Math.abs(diffMs) / 86_400_000);
  const absHours = Math.floor((Math.abs(diffMs) % 86_400_000) / 3_600_000);
  const statusLine =
    diffMs >= 0
      ? `Sisa Waktu: *${String(absDays)} hari ${String(absHours)} jam lagi*`
      : `Sudah Berlalu: *${String(absDays)} hari ${String(absHours)} jam lalu*`;

  await context.reply(
    ["*── [ COUNTDOWN ACARA ] ──*", `Acara  : *${eventName}*`, `Tanggal: ${rawDate ?? ""}`, statusLine].join("\n"),
  );
}

async function handleJamDunia(context: CommandContext): Promise<void> {
  try {
    const clocks = dailyUtilityService.getWorldClocks(context.argsText);
    const lines = clocks.map((c) => `- *${c.label}*: ${c.timeText}`);
    await context.reply(["*── [ JAM DUNIA LIVE ] ──*", "", ...lines].join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat jam dunia."));
  }
}

async function handleKonversi(context: CommandContext): Promise<void> {
  const val = Number.parseFloat((context.args[0] ?? "").replace(",", "."));
  const from = context.args[1];
  const to = context.args[2];
  if (!Number.isFinite(val) || !from || !to) {
    await context.reply(
      "Format: .konversi <nilai> <unit_asal> <unit_tujuan>\nContoh: .konversi 100 c f | .konversi 5 km m | .konversi 2 gb mb",
    );
    return;
  }
  try {
    const res = dailyUtilityService.convertUnit(val, from, to);
    const formatted = Number.isInteger(res.result)
      ? res.result.toLocaleString("id-ID")
      : res.result.toLocaleString("id-ID", { maximumFractionDigits: 4 });
    await context.reply(
      [
        `*── [ KONVERSI ${res.group.toUpperCase()} ] ──*`,
        `${String(val)} ${from.toLowerCase()} = *${formatted} ${to.toLowerCase()}*`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengonversi satuan."));
  }
}

async function handleHitungKata(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .hitungkata <teks> (atau reply pesan)");
    return;
  }
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s+/g, "").length;
  const lines = text.split(/\r?\n/).length;
  const readSec = Math.max(1, Math.ceil((words / 200) * 60));
  await context.reply(
    [
      "*── [ STATISTIK TEKS ] ──*",
      `- Kata            : ${String(words)}`,
      `- Karakter        : ${String(chars)}`,
      `- Tanpa Spasi     : ${String(charsNoSpace)}`,
      `- Jumlah Baris    : ${String(lines)}`,
      `- Est. Waktu Baca : ~${String(readSec)} detik`,
    ].join("\n"),
  );
}

async function handleBalik(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .balik <teks> (atau reply pesan)");
    return;
  }
  await context.reply(Array.from(text).reverse().join(""));
}

async function handleKapital(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .kapital <teks> (atau reply pesan)");
    return;
  }
  await context.reply(text.toUpperCase());
}

async function handleKecil(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .kecil <teks> (atau reply pesan)");
    return;
  }
  await context.reply(text.toLowerCase());
}

async function handleMock(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .mock <teks> (atau reply pesan)");
    return;
  }
  let toggle = true;
  const mocked = Array.from(text)
    .map((ch) => {
      if (/[a-zA-Z]/.test(ch)) {
        toggle = !toggle;
        return toggle ? ch.toUpperCase() : ch.toLowerCase();
      }
      return ch;
    })
    .join("");
  await context.reply(mocked);
}

async function handleMorse(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .morse <teks>\nContoh: .morse HALO MINJI");
    return;
  }
  await context.reply(`*Morse:*\n${dailyUtilityService.encodeMorse(text)}`);
}

async function handleUnmorse(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .unmorse <kode_morse>\nContoh: .unmorse .... .- .-.. ---");
    return;
  }
  await context.reply(`*Teks:*\n${dailyUtilityService.decodeMorse(text)}`);
}

async function handleBiner(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text || text.length > 200) {
    await context.reply("Format: .biner <teks> (maks 200 karakter)");
    return;
  }
  await context.reply(`*Biner:*\n${dailyUtilityService.encodeBinary(text)}`);
}

async function handleUnbiner(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .unbiner <deretan_8bit>\nContoh: .unbiner 01001000 01101001");
    return;
  }
  try {
    await context.reply(`*Teks:*\n${dailyUtilityService.decodeBinary(text)}`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal decode biner."));
  }
}

async function handleBase64Enc(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .base64enc <teks>");
    return;
  }
  await context.reply(`*Base64:*\n${Buffer.from(text, "utf8").toString("base64")}`);
}

async function handleBase64Dec(context: CommandContext): Promise<void> {
  const text = resolveTextOrQuoted(context);
  if (!text) {
    await context.reply("Format: .base64dec <base64>");
    return;
  }
  const decoded = Buffer.from(text.trim(), "base64").toString("utf8");
  await context.reply(`*Decoded:*\n${decoded}`);
}

async function handleHash(context: CommandContext): Promise<void> {
  const algo = context.args[0];
  const rest = context.args.slice(1).join(" ").trim() || (context.quoted?.text ?? "").trim();
  if (!algo || !rest) {
    await context.reply("Format: .hash <md5|sha1|sha256|sha512> <teks>\nContoh: .hash sha256 minjibot");
    return;
  }
  try {
    const res = dailyUtilityService.hashText(algo, rest);
    await context.reply(`*${res.algo}:*\n${res.digest}`);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat hash."));
  }
}

async function handlePassGen(context: CommandContext): Promise<void> {
  const len = context.args[0] ? Number.parseInt(context.args[0], 10) : 16;
  const password = dailyUtilityService.generatePassword(Number.isInteger(len) ? len : 16);
  await context.reply(
    `*── [ PASSWORD GENERATOR ] ──*\nPanjang: ${String(password.length)} karakter\n\n\`${password}\``,
  );
}

async function handleUuid(context: CommandContext): Promise<void> {
  await context.reply(`*UUID v4:*\n${dailyUtilityService.generateUuid()}`);
}

async function handleColor(context: CommandContext): Promise<void> {
  const hex = context.args[0];
  if (!hex) {
    await context.reply("Format: .color <#hex>\nContoh: .color #38BDF8");
    return;
  }
  try {
    const res = await dailyUtilityService.renderColorPreview(hex);
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: res.pngBuffer,
        caption: [
          "*── [ COLOR PREVIEW ] ──*",
          `HEX : ${res.hex}`,
          `RGB : rgb(${String(res.r)}, ${String(res.g)}, ${String(res.b)})`,
          `HSL : hsl(${String(res.h)}, ${String(res.s)}%, ${String(res.l)}%)`,
        ].join("\n"),
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat preview warna."));
  }
}

export const dailyUtilityCommands: CommandDefinition[] = [
  { name: "kurs", execute: handleKurs },
  { name: "berita", aliases: ["news"], execute: handleBerita },
  { name: "kamusen", aliases: ["dict"], execute: handleKamusEn },
  { name: "hitungumur", aliases: ["umur"], execute: handleHitungUmur },
  { name: "bmi", execute: handleBmi },
  { name: "diskon", execute: handleDiskon },
  { name: "splitbill", execute: handleSplitBill },
  { name: "random", aliases: ["acak"], execute: handleRandom },
  { name: "pilih", execute: handlePilih },
  { name: "acakurutan", execute: handleAcakUrutan },
  { name: "tim", aliases: ["bagitim"], execute: handleTim },
  { name: "countdown", execute: handleCountdown },
  { name: "jamdunia", execute: handleJamDunia },
  { name: "konversi", execute: handleKonversi },
  { name: "hitungkata", execute: handleHitungKata },
  { name: "balik", execute: handleBalik },
  { name: "kapital", execute: handleKapital },
  { name: "kecil", execute: handleKecil },
  { name: "mock", execute: handleMock },
  { name: "morse", execute: handleMorse },
  { name: "unmorse", execute: handleUnmorse },
  { name: "biner", execute: handleBiner },
  { name: "unbiner", execute: handleUnbiner },
  { name: "base64enc", execute: handleBase64Enc },
  { name: "base64dec", execute: handleBase64Dec },
  { name: "hash", execute: handleHash },
  { name: "passgen", execute: handlePassGen },
  { name: "uuid", execute: handleUuid },
  { name: "color", aliases: ["warna"], execute: handleColor },
];
