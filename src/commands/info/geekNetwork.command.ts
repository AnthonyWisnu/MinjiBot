import { geekNetworkService } from "../../services/info/geekNetwork.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

async function sendMediaOrText(
  context: CommandContext,
  imageBuffer: Buffer | null,
  caption: string,
): Promise<void> {
  if (imageBuffer) {
    await context.socket.sendMessage(
      context.chatJid,
      { image: imageBuffer, caption },
      { quoted: context.message },
    );
    return;
  }
  await context.reply(caption);
}

async function handleAnime(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Format: .anime <judul>\nContoh: .anime Frieren");
    return;
  }
  try {
    const res = await geekNetworkService.searchAniListMedia(query, "ANIME");
    const caption = [
      `*── [ ANIME: ${res.titleRomaji} ] ──*`,
      ...(res.titleEnglish && res.titleEnglish !== res.titleRomaji
        ? [`English : ${res.titleEnglish}`]
        : []),
      `Format  : ${res.format} | ${res.episodesOrChapters}`,
      `Status  : ${res.status} | Skor: ${res.score}`,
      `Genre   : ${res.genres.join(", ") || "-"}`,
      "",
      res.description,
      ...(res.siteUrl ? ["", res.siteUrl] : []),
    ].join("\n");
    await sendMediaOrText(context, res.imageBuffer, caption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari anime."));
  }
}

async function handleManga(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Format: .manga <judul>\nContoh: .manga One Piece");
    return;
  }
  try {
    const res = await geekNetworkService.searchAniListMedia(query, "MANGA");
    const caption = [
      `*── [ MANGA: ${res.titleRomaji} ] ──*`,
      ...(res.titleEnglish && res.titleEnglish !== res.titleRomaji
        ? [`English : ${res.titleEnglish}`]
        : []),
      `Format  : ${res.format} | ${res.episodesOrChapters}`,
      `Status  : ${res.status} | Skor: ${res.score}`,
      `Genre   : ${res.genres.join(", ") || "-"}`,
      "",
      res.description,
      ...(res.siteUrl ? ["", res.siteUrl] : []),
    ].join("\n");
    await sendMediaOrText(context, res.imageBuffer, caption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari manga."));
  }
}

async function handleKarakter(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Format: .karakter <nama>\nContoh: .karakter Gojo Satoru");
    return;
  }
  try {
    const res = await geekNetworkService.searchAniListCharacter(query);
    const caption = [
      `*── [ KARAKTER ANIME ] ──*`,
      `Nama    : *${res.nameFull}*${res.nameNative ? ` (${res.nameNative})` : ""}`,
      `Favorit : ${res.favourites.toLocaleString("id-ID")}`,
      ...(res.appearances.length > 0 ? [`Seri    : ${res.appearances.join(", ")}`] : []),
      "",
      res.description,
      ...(res.siteUrl ? ["", res.siteUrl] : []),
    ].join("\n");
    await sendMediaOrText(context, res.imageBuffer, caption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mencari karakter anime."));
  }
}

async function handlePokemon(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  if (!query) {
    await context.reply("Format: .pokemon <nama/id>\nContoh: .pokemon pikachu atau .pokemon 6");
    return;
  }
  try {
    const res = await geekNetworkService.lookupPokemon(query);
    const statLines = res.stats.map((s) => `- ${s.name.toUpperCase()}: ${String(s.value)}`);
    const caption = [
      `*── [ POKEDEX #${String(res.id)} ] ──*`,
      `Nama    : *${res.name.toUpperCase()}*`,
      `Tipe    : ${res.types.join(", ") || "-"}`,
      `Tinggi  : ${res.heightM.toFixed(1)} m | Berat: ${res.weightKg.toFixed(1)} kg`,
      `Ability : ${res.abilities.join(", ") || "-"}`,
      "",
      "*Base Stats:*",
      ...statLines,
    ].join("\n");
    await sendMediaOrText(context, res.imageBuffer, caption);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil data Pokemon."));
  }
}

async function handleGameGratis(context: CommandContext): Promise<void> {
  try {
    const res = await geekNetworkService.listFreeGames(context.args[0]);
    const lines = res.games.map(
      (g, idx) =>
        `${String(idx + 1)}. *${g.title}* (${g.genre})\n   Platform: ${g.platform} | ${g.publisher}\n   ${g.url}`,
    );
    await context.reply(
      [
        `*── [ GAME GRATIS (${res.platform.toUpperCase()}) ] ──*`,
        "_Sumber: FreeToGame (Populer)_",
        "",
        ...lines,
        "",
        "Filter: .gamegratis pc | .gamegratis browser",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil daftar game gratis."));
  }
}

async function handleAnjing(context: CommandContext): Promise<void> {
  try {
    const res = await geekNetworkService.getRandomDog();
    await sendMediaOrText(
      context,
      res.imageBuffer,
      `*── [ RANDOM DOGGO ] ──*\nRas: *${res.breed}*`,
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil foto anjing."));
  }
}

async function handleHttpCat(context: CommandContext): Promise<void> {
  const code = context.args[0]?.trim();
  if (!code) {
    await context.reply("Format: .httpcat <kode_http>\nContoh: .httpcat 404 atau .httpcat 418");
    return;
  }
  try {
    const res = await geekNetworkService.getHttpCat(code);
    await sendMediaOrText(
      context,
      res.imageBuffer,
      `*── [ HTTP CAT ${String(res.code)} ] ──*\n${res.meaning}`,
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengambil gambar HTTP Cat."));
  }
}

async function handleCekIp(context: CommandContext): Promise<void> {
  const target = context.args[0]?.trim();
  if (!target) {
    await context.reply("Format: .cekip <ip_publik/domain>\nContoh: .cekip 8.8.8.8");
    return;
  }
  try {
    const res = await geekNetworkService.lookupIpInfo(target);
    await context.reply(
      [
        "*── [ CEK INFO IP PUBLIK ] ──*",
        `IP       : *${res.ip}*`,
        `Lokasi   : ${res.city}, ${res.region}, ${res.country}`,
        `ISP      : ${res.isp}`,
        `Org/ASN  : ${res.org} (${res.asn})`,
        `Timezone : ${res.timezone}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memeriksa info IP."));
  }
}

export const geekNetworkCommands: CommandDefinition[] = [
  { name: "anime", execute: handleAnime },
  { name: "manga", execute: handleManga },
  { name: "karakter", aliases: ["character"], execute: handleKarakter },
  { name: "pokemon", execute: handlePokemon },
  { name: "gamegratis", aliases: ["freegame"], execute: handleGameGratis },
  { name: "anjing", aliases: ["dog"], execute: handleAnjing },
  { name: "httpcat", execute: handleHttpCat },
  { name: "cekip", aliases: ["ipinfo"], execute: handleCekIp },
];
