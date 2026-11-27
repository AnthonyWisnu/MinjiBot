import { publicInfoService } from "../../services/info/publicInfo.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

async function handleInfoGempa(context: CommandContext): Promise<void> {
  try {
    const info = await publicInfoService.getInfoGempa();
    const caption = [
      "*── [ INFO GEMPA BMKG ] ──*",
      `Tanggal   : ${info.tanggal}`,
      `Waktu     : ${info.jam}`,
      `Magnitudo : *${info.magnitude} SR*`,
      `Kedalaman : ${info.kedalaman}`,
      `Koordinat : ${info.koordinat}`,
      `Wilayah   : ${info.wilayah}`,
      `Potensi   : ${info.potensi}`,
      `Dirasakan : ${info.dirasakan}`,
      "",
      "_Sumber: BMKG Indonesia_",
    ].join("\n");

    if (info.shakemapBuffer) {
      await context.socket.sendMessage(
        context.chatJid,
        { image: info.shakemapBuffer, mimetype: "image/jpeg", caption },
        { quoted: context.message },
      );
      return;
    }

    await context.reply(caption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil info gempa terkini."));
  }
}

async function handleInfoCuaca(context: CommandContext): Promise<void> {
  try {
    const city = context.argsText.trim();
    if (!city) {
      await context.reply("Format salah.\nGunakan: *.infocuaca <kota>*\nContoh: *.infocuaca Jakarta*");
      return;
    }

    const c = await publicInfoService.getInfoCuaca(city);
    await context.reply(
      [
        "*── [ INFO CUACA ] ──*",
        `Lokasi     : *${c.cityName}* (${c.country})`,
        `Kondisi    : ${c.condition}`,
        `Suhu       : *${c.temperatureC.toFixed(1)} °C* (Terasa ${c.feelsLikeC.toFixed(1)} °C)`,
        `Kelembapan : ${String(Math.round(c.humidityPct))}%`,
        `Angin      : ${c.windKmh.toFixed(1)} km/jam`,
        `Zona Waktu : ${c.timezone}`,
        "",
        "_Sumber: Open-Meteo_",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil info cuaca."));
  }
}

async function handleWikipedia(context: CommandContext): Promise<void> {
  try {
    const query = context.argsText.trim();
    if (!query) {
      await context.reply("Format salah.\nGunakan: *.wikipedia <topik>*\nContoh: *.wikipedia Indonesia*");
      return;
    }

    const wiki = await publicInfoService.getWikipediaSummary(query);
    await context.reply(
      [
        `*── [ WIKIPEDIA (${wiki.lang.toUpperCase()}) ] ──*`,
        `*${wiki.title}*`,
        "",
        wiki.extract,
        "",
        `Selengkapnya: ${wiki.pageUrl}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari artikel Wikipedia."));
  }
}

async function handleTranslate(context: CommandContext): Promise<void> {
  try {
    const lang = context.args[0]?.trim() ?? "";
    const argBody = context.args.slice(1).join(" ").trim();
    const body = argBody.length > 0 ? argBody : (context.quoted?.text?.trim() ?? "");
    if (!lang || !body) {
      await context.reply(
        "Format salah.\nGunakan: *.translate <kode_bahasa> <teks>* (atau reply pesan)\nContoh: *.translate en Selamat pagi semua*",
      );
      return;
    }

    const translated = await publicInfoService.translateText(lang, body);
    await context.reply(
      [
        `*── [ TERJEMAHAN (${lang.toUpperCase()}) ] ──*`,
        translated,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menerjemahkan teks."));
  }
}

async function handleKbbi(context: CommandContext): Promise<void> {
  try {
    const word = context.argsText.trim();
    if (!word) {
      await context.reply("Format salah.\nGunakan: *.kbbi <kata>*\nContoh: *.kbbi merdeka*");
      return;
    }

    const def = await publicInfoService.getKbbiDefinition(word);
    await context.reply(
      [
        `*── [ KAMUS: ${word.toUpperCase()} ] ──*`,
        def,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari arti kata."));
  }
}

async function handleJarak(context: CommandContext): Promise<void> {
  try {
    const raw = context.argsText.trim();
    const sep = raw.includes("|") ? "|" : raw.includes("-") ? "-" : "";
    const parts = sep ? raw.split(sep).map((s) => s.trim()).filter(Boolean) : [];
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      await context.reply("Format salah.\nGunakan: *.jarak <kota1> | <kota2>*\nContoh: *.jarak Jakarta | Bali*");
      return;
    }

    const info = await publicInfoService.calculateCityDistance(parts[0], parts[1]);
    await context.reply(
      [
        "*── [ JARAK ANTAR KOTA ] ──*",
        `Dari   : ${info.fromName}`,
        `Tujuan : ${info.toName}`,
        `Jarak  : *${info.distanceKm.toFixed(1)} km* (${info.distanceMiles.toFixed(1)} mil)`,
        `Est. Mobil   : ~${info.estCarHours.toFixed(1)} jam`,
        `Est. Pesawat : ~${info.estFlightHours.toFixed(1)} jam`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal menghitung jarak antar kota."));
  }
}

async function handleGithubStalk(context: CommandContext): Promise<void> {
  try {
    const user = context.args[0]?.trim() ?? "";
    if (!user) {
      await context.reply("Format salah.\nGunakan: *.githubstalk <username>*\nContoh: *.githubstalk torvalds*");
      return;
    }

    const p = await publicInfoService.getGithubProfile(user);
    await context.reply(
      [
        "*── [ PROFIL GITHUB ] ──*",
        `Nama      : *${p.name}* (@${p.login})`,
        `Bio       : ${p.bio}`,
        `Repo      : ${String(p.publicRepos)} publik`,
        `Followers : ${String(p.followers)} | Following: ${String(p.following)}`,
        `Lokasi    : ${p.location}`,
        `Perusahaan: ${p.company}`,
        `Bergabung : ${p.createdAt}`,
        `Profil    : ${p.htmlUrl}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil profil GitHub."));
  }
}

async function handleNpmSearch(context: CommandContext): Promise<void> {
  try {
    const query = context.argsText.trim();
    if (!query) {
      await context.reply("Format salah.\nGunakan: *.npmsearch <nama_paket>*\nContoh: *.npmsearch sharp*");
      return;
    }

    const items = await publicInfoService.searchNpmPackages(query);
    const lines = items.map(
      (pkg, idx) =>
        `${String(idx + 1)}. *${pkg.name}* (v${pkg.version})\n   ${pkg.description}\n   ${pkg.npmUrl}`,
    );
    await context.reply(["*── [ PENCARIAN NPM ] ──*", ...lines].join("\n\n"));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari paket NPM."));
  }
}

async function handleWhois(context: CommandContext): Promise<void> {
  try {
    const domain = context.args[0]?.trim() ?? "";
    if (!domain) {
      await context.reply("Format salah.\nGunakan: *.whois <domain>*\nContoh: *.whois google.com*");
      return;
    }

    const w = await publicInfoService.getWhoisDomain(domain);
    await context.reply(
      [
        "*── [ WHOIS / RDAP DOMAIN ] ──*",
        `Domain     : *${w.domain}*`,
        `Registrar  : ${w.registrar}`,
        `Terdaftar  : ${w.createdAt}`,
        `Diperbarui : ${w.updatedAt}`,
        `Kadaluarsa : ${w.expiresAt}`,
        `Status     : ${w.statuses.length > 0 ? w.statuses.join(", ") : "-"}`,
        `Nameserver : ${w.nameservers.length > 0 ? w.nameservers.join(", ") : "-"}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memeriksa WHOIS domain."));
  }
}

async function handleTinyUrl(context: CommandContext): Promise<void> {
  try {
    const rawUrl = context.args[0]?.trim() ?? "";
    if (!rawUrl) {
      await context.reply("Format salah.\nGunakan: *.tinyurl <link>*\nContoh: *.tinyurl https://example.com*");
      return;
    }

    const short = await publicInfoService.shortenUrl(rawUrl);
    await context.reply(
      [
        "*── [ PERPENDEK LINK ] ──*",
        `Link Pendek: ${short}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memperpendek link."));
  }
}

export const publicInfoCommands: CommandDefinition[] = [
  { name: "infogempa", aliases: ["gempa"], execute: handleInfoGempa },
  { name: "infocuaca", aliases: ["cuaca"], execute: handleInfoCuaca },
  { name: "wikipedia", aliases: ["wiki"], execute: handleWikipedia },
  { name: "translate", aliases: ["tr"], execute: handleTranslate },
  { name: "kbbi", execute: handleKbbi },
  { name: "jarak", execute: handleJarak },
  { name: "githubstalk", aliases: ["ghstalk"], execute: handleGithubStalk },
  { name: "npmsearch", aliases: ["npm"], execute: handleNpmSearch },
  { name: "whois", execute: handleWhois },
  { name: "tinyurl", aliases: ["shortlink"], execute: handleTinyUrl },
];
