import { islamiLocalService } from "../../services/islami/islamiLocal.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

async function handleDoaHarian(context: CommandContext): Promise<void> {
  try {
    const res = islamiLocalService.getDoa(context.argsText);
    if (res.mode === "list" && res.list) {
      const lines = res.list.map((d, idx) => `${String(idx + 1)}. *${d.id}* - ${d.title}`);
      await context.reply(
        [
          "*── [ DAFTAR DOA HARIAN ] ──*",
          "",
          ...lines,
          "",
          "Baca doa: .doaharian <kode> (contoh: .doaharian tidur)",
        ].join("\n"),
      );
      return;
    }

    const item = res.item;
    if (!item) return;
    await context.reply(
      [
        `*── [ ${item.title.toUpperCase()} ] ──*`,
        "",
        item.arabic,
        "",
        `_${item.latin}_`,
        "",
        `Artinya: "${item.meaning}"`,
        "",
        "_Ketik .doaharian list untuk melihat semua doa._",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil doa harian."));
  }
}

async function handleNiatShalat(context: CommandContext): Promise<void> {
  try {
    const res = islamiLocalService.getNiatShalat(context.argsText);
    if (res.mode === "list" && res.list) {
      const lines = res.list.map(
        (n, idx) => `${String(idx + 1)}. *${n.id}* - ${n.title} (${n.rakaat})`,
      );
      await context.reply(
        [
          "*── [ NIAT SHALAT ] ──*",
          "",
          ...lines,
          "",
          "Baca lengkap: .niatshalat <waktu> (contoh: .niatshalat subuh)",
        ].join("\n"),
      );
      return;
    }

    const item = res.item;
    if (!item) return;
    await context.reply(
      [
        `*── [ ${item.title.toUpperCase()} ] ──*`,
        `Jumlah: ${item.rakaat}`,
        "",
        item.arabic,
        "",
        `_${item.latin}_`,
        "",
        `Artinya: "${item.meaning}"`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil niat shalat."));
  }
}

async function handleDzikir(context: CommandContext): Promise<void> {
  const list = islamiLocalService.getDzikir();
  const blocks = list.map((d, idx) =>
    [
      `${String(idx + 1)}. *${d.title}* (${d.count})`,
      d.arabic,
      `_${d.latin}_`,
      `Arti: ${d.meaning}`,
    ].join("\n"),
  );

  await context.reply(
    ["*── [ PANDUAN DZIKIR ] ──*", "", ...blocks.flatMap((b) => [b, ""])].join("\n").trim(),
  );
}

async function handleHadits(context: CommandContext): Promise<void> {
  try {
    const item = islamiLocalService.getHadits(context.argsText);
    await context.reply(
      [
        `*── [ HADITS PILIHAN #${String(item.number)} ] ──*`,
        `Tema   : *${item.topic}*`,
        `Perawi : ${item.narrator}`,
        "",
        `"${item.text}"`,
        "",
        "_Ketik .hadits atau .hadits <1-15> untuk membaca hadits lainnya._",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memuat hadits pilihan."));
  }
}

async function handleKisahNabi(context: CommandContext): Promise<void> {
  try {
    const res = islamiLocalService.getKisahNabi(context.argsText);
    if (res.mode === "list" && res.list) {
      const lines = res.list.map((k, idx) => `${String(idx + 1)}. *${k.id}* - ${k.name}`);
      await context.reply(
        [
          "*── [ KISAH TELADAN NABI ] ──*",
          "",
          ...lines,
          "",
          "Baca kisah: .kisahnabi <nama> (contoh: .kisahnabi yusuf)",
        ].join("\n"),
      );
      return;
    }

    const item = res.item;
    if (!item) return;
    await context.reply(
      [
        `*── [ ${item.name.toUpperCase()} ] ──*`,
        `_${item.title}_`,
        "",
        item.summary,
        "",
        `*Hikmah:* ${item.lesson}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil kisah nabi."));
  }
}

async function handleKalenderHijriah(context: CommandContext): Promise<void> {
  try {
    const rawDate = context.args[0]?.trim();
    let targetDate = new Date();
    if (rawDate) {
      const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(rawDate);
      if (!match) {
        await context.reply(
          "Format tanggal salah.\nGunakan: .kalenderhijriah atau .kalenderhijriah dd-mm-yyyy\nContoh: .kalenderhijriah 17-08-1945",
        );
        return;
      }
      const day = Number.parseInt(match[1] ?? "1", 10);
      const month = Number.parseInt(match[2] ?? "1", 10);
      const year = Number.parseInt(match[3] ?? "2026", 10);
      targetDate = new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
      if (
        Number.isNaN(targetDate.getTime()) ||
        targetDate.getUTCDate() !== day ||
        targetDate.getUTCMonth() !== month - 1
      ) {
        await context.reply("Tanggal yang kamu masukkan tidak valid.");
        return;
      }
    }

    const info = islamiLocalService.getHijriDate(targetDate);
    const lines = [
      "*── [ KALENDER HIJRIAH ] ──*",
      `Masehi  : ${info.gregorianLabel}`,
      `Hijriah : *${info.hijriLabel}*`,
    ];
    if (info.specialNote) {
      lines.push(`Catatan : *${info.specialNote}*`);
    }
    await context.reply(lines.join("\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung kalender Hijriah."));
  }
}

export const islamiLocalCommands: CommandDefinition[] = [
  { name: "doaharian", aliases: ["doa"], execute: handleDoaHarian },
  { name: "niatshalat", aliases: ["niat"], execute: handleNiatShalat },
  { name: "dzikir", aliases: ["zikir"], execute: handleDzikir },
  { name: "hadits", aliases: ["hadis"], execute: handleHadits },
  { name: "kisahnabi", execute: handleKisahNabi },
  { name: "kalenderhijriah", aliases: ["hijriah"], execute: handleKalenderHijriah },
];
