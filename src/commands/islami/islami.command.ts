import { islamiService } from "../../services/islami/islami.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

async function handleAlQuran(context: CommandContext): Promise<void> {
  try {
    const surahArg = context.args[0]?.trim();
    if (!surahArg) {
      await context.reply(
        [
          "*── [ AL-QURAN DIGITAL ] ──*",
          "Format: *.alquran <surah> [ayat]*",
          "Contoh:",
          "• *.alquran 1* (Al-Fatihah ayat 1-3)",
          "• *.alquran 2 255* (Ayat Kursi)",
          "• *.alquran yasin 1-5* (Maks 5 ayat)",
        ].join("\n"),
      );
      return;
    }

    // Jika surah dua kata seperti "al kahfi 1", gabungkan nama kecuali token terakhir berupa angka/range
    let surahInput = surahArg;
    let ayatSpec = context.args[1];
    if (context.args.length >= 3) {
      const last = context.args[context.args.length - 1] ?? "";
      if (/^\d+(?:-\d+)?$/.test(last)) {
        surahInput = context.args.slice(0, -1).join(" ");
        ayatSpec = last;
      } else {
        surahInput = context.args.join(" ");
        ayatSpec = undefined;
      }
    } else if (context.args.length === 2 && ayatSpec && !/^\d+(?:-\d+)?$/.test(ayatSpec)) {
      surahInput = context.args.join(" ");
      ayatSpec = undefined;
    }

    const res = await islamiService.getAlQuran(surahInput, ayatSpec);
    const blocks = res.ayatList.map((a) =>
      [
        `*Ayat ${String(a.nomorAyat)}:*`,
        a.teksArab,
        `_${a.teksLatin}_`,
        `Artinya: "${a.teksIndonesia}"`,
      ].join("\n"),
    );

    await context.reply(
      [
        `*── [ ${res.surahNameLatin.toUpperCase()} (${String(res.surahNumber)}) ] ──*`,
        `${res.surahNameArabic} | ${res.meaning}`,
        `Turun: ${res.revelation} | Total: ${String(res.totalAyat)} ayat`,
        "",
        ...blocks.flatMap((b) => [b, ""]),
        "_Sumber: Kemenag RI via EQuran.id_",
      ]
        .join("\n")
        .trim(),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil ayat Al-Quran."));
  }
}

async function handleJadwalShalat(context: CommandContext): Promise<void> {
  try {
    const city = context.argsText.trim();
    if (!city) {
      await context.reply("Format salah.\nGunakan: *.jadwalshalat <kota>*\nContoh: *.jadwalshalat bandung*");
      return;
    }

    const jadwal = await islamiService.getJadwalShalat(city);
    await context.reply(
      [
        "*── [ JADWAL SHALAT ] ──*",
        `Kota    : *${jadwal.lokasi}*`,
        `Daerah  : ${jadwal.daerah}`,
        `Tanggal : ${jadwal.tanggal}`,
        "",
        `• Imsak   : ${jadwal.imsak}`,
        `• Subuh   : ${jadwal.subuh}`,
        `• Terbit  : ${jadwal.terbit}`,
        `• Dhuha   : ${jadwal.dhuha}`,
        `• Dzuhur  : ${jadwal.dzuhur}`,
        `• Ashar   : ${jadwal.ashar}`,
        `• Maghrib : ${jadwal.maghrib}`,
        `• Isya    : ${jadwal.isya}`,
        "",
        "_Sumber: Kemenag RI via MyQuran_",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil jadwal shalat."));
  }
}

async function handleAsmaulHusna(context: CommandContext): Promise<void> {
  try {
    const arg0 = (context.args[0] ?? "").trim().toLowerCase();

    if (arg0 === "list" || arg0 === "daftar") {
      const page = Number.parseInt(context.args[1] ?? "1", 10);
      const data = islamiService.getAsmaulHusnaPage(Number.isNaN(page) ? 1 : page);
      const lines = data.items.map(
        (item) => `${String(item.number)}. *${item.latin}* (${item.arabic}) - ${item.meaning}`,
      );
      await context.reply(
        [
          `*── [ ASMAUL HUSNA (${String(data.page)}/${String(data.totalPages)}) ] ──*`,
          ...lines,
          "",
          "_Ketik .asmaulhusna list 2 atau .asmaulhusna <1-99>_",
        ].join("\n"),
      );
      return;
    }

    const item =
      arg0 && /^\d+$/.test(arg0)
        ? islamiService.getAsmaulHusnaByNumber(Number.parseInt(arg0, 10))
        : islamiService.getRandomAsmaulHusna();

    await context.reply(
      [
        "*── [ ASMAUL HUSNA ] ──*",
        `Nomor : #${String(item.number)} / 99`,
        `Arab  : ${item.arabic}`,
        `Latin : *${item.latin}*`,
        `Arti  : ${item.meaning}`,
        "",
        "_Ketik .asmaulhusna <1-99> atau .asmaulhusna list 1_",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menampilkan Asmaul Husna."));
  }
}

async function handleAyatKursi(context: CommandContext): Promise<void> {
  const data = islamiService.getAyatKursi();
  await context.reply(
    [
      "*── [ AYAT KURSI ] ──*",
      `${data.surah} Ayat ${String(data.ayatNumber)}`,
      "",
      data.arabic,
      "",
      `_${data.latin}_`,
      "",
      `*Artinya:*\n"${data.translation}"`,
    ].join("\n"),
  );
}

export const islamiCommands: CommandDefinition[] = [
  { name: "alquran", aliases: ["quran", "surat"], execute: handleAlQuran },
  { name: "jadwalshalat", aliases: ["sholat", "shalat"], execute: handleJadwalShalat },
  { name: "asmaulhusna", aliases: ["asmaul"], execute: handleAsmaulHusna },
  { name: "ayatkursi", execute: handleAyatKursi },
];
