import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { safeFetchExternal } from "../../utils/urlValidator";

export interface AnimeRoleplaySpec {
  command: string;
  endpoint: string;
  category?: "action" | "character";
  withTarget: (actor: string, target: string) => string;
  solo: (actor: string) => string;
}

export const ANIME_ROLEPLAY_SPECS: readonly AnimeRoleplaySpec[] = [
  { command: "peluk", endpoint: "hug", withTarget: (a, t) => `${a} memeluk erat ${t}!`, solo: (a) => `${a} lagi butuh pelukan hangat.` },
  { command: "tampar", endpoint: "slap", withTarget: (a, t) => `${a} menampar ${t} sampai sadar!`, solo: (a) => `${a} menampar angin karena kesal.` },
  { command: "pat", endpoint: "pat", withTarget: (a, t) => `${a} mengelus kepala ${t} dengan lembut.`, solo: (a) => `${a} butuh elusan kepala.` },
  { command: "bonk", endpoint: "bonk", withTarget: (a, t) => `${a} nge-BONK kepala ${t}!`, solo: (a) => `${a} melakukan bonk darurat!` },
  { command: "poke", endpoint: "poke", withTarget: (a, t) => `${a} mencolek ${t} biar bangun!`, solo: (a) => `${a} mencolek-colek layar HP.` },
  { command: "pukul", endpoint: "punch", withTarget: (a, t) => `${a} melayangkan pukulan maut ke ${t}!`, solo: (a) => `${a} latihan tinju di udara.` },
  { command: "tendang", endpoint: "kick", withTarget: (a, t) => `${a} menendang ${t} keluar arena!`, solo: (a) => `${a} melakukan tendangan salto.` },
  { command: "gigit", endpoint: "bite", withTarget: (a, t) => `${a} menggigit ${t} karena gemas!`, solo: (a) => `${a} menggigit bantal.` },
  { command: "cuddle", endpoint: "cuddle", withTarget: (a, t) => `${a} bermanja-manja bersama ${t}.`, solo: (a) => `${a} lagi pengen cuddle.` },
  { command: "highfive", endpoint: "highfive", withTarget: (a, t) => `${a} tos high-five mantap sama ${t}!`, solo: (a) => `${a} angkat tangan ngajak tos!` },
  { command: "wink", endpoint: "wink", withTarget: (a, t) => `${a} mengedipkan mata manis ke ${t}.`, solo: (a) => `${a} mengedipkan mata penuh kode.` },
  { command: "wave", endpoint: "wave", withTarget: (a, t) => `${a} melambaikan tangan menyapa ${t}!`, solo: (a) => `${a} melambaikan tangan ke seluruh grup!` },
  { command: "baka", endpoint: "baka", withTarget: (a, t) => `${a} bilang: "${t}, BAKA!!"`, solo: (a) => `${a}: "BAKA!!"` },
  { command: "stare", endpoint: "stare", withTarget: (a, t) => `${a} menatap tajam ${t} tanpa berkedip...`, solo: (a) => `${a} menatap tajam ke arah grup...` },
  { command: "yeet", endpoint: "yeet", withTarget: (a, t) => `${a} melempar ${t} jauh ke angkasa! YEET!`, solo: (a) => `${a} melakukan YEET!` },
  { command: "blush", endpoint: "blush", withTarget: (a, t) => `${a} langsung tersipu malu gara-gara ${t}.`, solo: (a) => `${a} tersipu malu-malu.` },
  { command: "cry", endpoint: "cry", withTarget: (a, t) => `${a} menangis di depan ${t}...`, solo: (a) => `${a} lagi nangis bombay...` },
  { command: "smile", endpoint: "smile", withTarget: (a, t) => `${a} tersenyum lebar ke arah ${t}!`, solo: (a) => `${a} tersenyum ceria hari ini.` },
  { command: "dance", endpoint: "dance", withTarget: (a, t) => `${a} mengajak ${t} joget bareng!`, solo: (a) => `${a} joget asyik sendirian!` },
  { command: "smug", endpoint: "smug", withTarget: (a, t) => `${a} memasang wajah sombong ke ${t}.`, solo: (a) => `${a} memasang wajah penuh percaya diri.` },
  { command: "facepalm", endpoint: "facepalm", withTarget: (a, t) => `${a} tepok jidat melihat kelakuan ${t}.`, solo: (a) => `${a} tepok jidat pasrah.` },
  { command: "shrug", endpoint: "shrug", withTarget: (a, t) => `${a} cuma angkat bahu ke ${t}: "Entahlah."`, solo: (a) => `${a} mengangkat bahu pasrah.` },
  { command: "thumbsup", endpoint: "thumbsup", withTarget: (a, t) => `${a} kasih jempol mantap buat ${t}!`, solo: (a) => `${a} kasih jempol mantap!` },
  // Tahap 16: 11 Aksi Interaksi Tag @user (animasi gifPlayback)
  { command: "gendong", endpoint: "carry", withTarget: (a, t) => `${a} menggendong ${t} biar tidak capek jalan!`, solo: (a) => `${a} siap menggendong satu tim!` },
  { command: "suapin", endpoint: "feed", withTarget: (a, t) => `${a} menyuapi ${t} dengan penuh perhatian! Aaa~`, solo: (a) => `${a} lagi pengen disuapin.` },
  { command: "gandeng", endpoint: "handhold", withTarget: (a, t) => `${a} menggandeng tangan ${t} erat-erat!`, solo: (a) => `${a} lagi cari gandengan tangan.` },
  { command: "salaman", endpoint: "handshake", withTarget: (a, t) => `${a} berjabat tangan resmi dengan ${t}! Deal!`, solo: (a) => `${a} mengulurkan tangan mengajak salaman.` },
  { command: "kabedon", endpoint: "kabedon", withTarget: (a, t) => `${a} melakukan KABEDON ke ${t} di dinding!`, solo: (a) => `${a} latihan kabedon ke tembok.` },
  { command: "cium", endpoint: "kiss", withTarget: (a, t) => `${a} mencium manis ${t}!`, solo: (a) => `${a} mengirimkan ciuman manis.` },
  { command: "kecup", endpoint: "peck", withTarget: (a, t) => `${a} mengecup pipi ${t} sekilas!`, solo: (a) => `${a} kasih kecupan singkat.` },
  { command: "pangku", endpoint: "lappillow", withTarget: (a, t) => `${a} membiarkan ${t} bersandar santai di pangkuan.`, solo: (a) => `${a} lagi butuh bantal pangkuan.` },
  { command: "gelitik", endpoint: "tickle", withTarget: (a, t) => `${a} menggelitik ${t} sampai ketawa ngakak!`, solo: (a) => `${a} siap menggelitik siapa saja!` },
  { command: "tembakdor", endpoint: "shoot", withTarget: (a, t) => `${a} menembak ${t} tepat sasaran! DOR!`, solo: (a) => `${a} beraksi nembak ke udara! DOR!` },
  { command: "ciumanjauh", endpoint: "blowkiss", withTarget: (a, t) => `${a} melayangkan ciuman jauh untuk ${t}!`, solo: (a) => `${a} melayangkan ciuman jauh ke grup!` },
  // Tahap 16: 4 Karakter Anime SFW PNG
  { command: "waifu", endpoint: "waifu", category: "character", withTarget: (_a, t) => `Waifu SFW spesial untuk ${t}!`, solo: () => "Random Anime Waifu (SFW)" },
  { command: "husbando", endpoint: "husbando", category: "character", withTarget: (_a, t) => `Husbando SFW spesial untuk ${t}!`, solo: () => "Random Anime Husbando (SFW)" },
  { command: "neko", endpoint: "neko", category: "character", withTarget: (_a, t) => `Karakter Neko SFW spesial untuk ${t}!`, solo: () => "Random Anime Neko (SFW)" },
  { command: "kitsune", endpoint: "kitsune", category: "character", withTarget: (_a, t) => `Karakter Kitsune SFW spesial untuk ${t}!`, solo: () => "Random Anime Kitsune (SFW)" },
] as const;

export interface AnimeRoleplayMedia {
  kind: "gifVideo" | "image";
  buffer: Buffer;
  mimetype: "video/mp4" | "image/png";
  animeName: string;
  artistName?: string;
}

const MAX_GIF_BYTES = 4 * 1024 * 1024;
const USER_AGENT =
  "MinjiBot/2.0 (https://github.com/AnthonyWisnu/MinjiBot; non-commercial WhatsApp bot)";

export class AnimeRoleplayService {
  constructor(private readonly fetchFn: typeof safeFetchExternal = safeFetchExternal) {}

  async fetchReactionMedia(endpoint: string): Promise<AnimeRoleplayMedia> {
    const resp = await this.fetchFn(`https://nekos.best/api/v2/${encodeURIComponent(endpoint)}`, {
      allowedDomains: ["nekos.best"],
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) {
      throw new AppUserError("Layanan reaksi anime sedang sibuk. Coba lagi sebentar ya.");
    }

    const json = (await resp.json()) as {
      results?: { url?: string; anime_name?: string; artist_name?: string }[];
    };
    const item = json.results?.[0];
    if (!item?.url) {
      throw new AppUserError("Animasi reaksi anime tidak ditemukan.");
    }

    const mediaResp = await this.fetchFn(item.url, {
      allowedDomains: ["nekos.best"],
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!mediaResp.ok) {
      throw new AppUserError("Gagal mengunduh reaksi anime.");
    }

    const rawBuffer = Buffer.from(await mediaResp.arrayBuffer());
    const animeName = item.anime_name ?? "Anime";
    const trimmedArtist = item.artist_name?.trim() ?? "";
    const artistName = trimmedArtist.length > 0 ? trimmedArtist : undefined;

    if (item.url.toLowerCase().endsWith(".gif") && rawBuffer.byteLength <= MAX_GIF_BYTES) {
      try {
        const mp4 = await this.convertGifToMp4(rawBuffer);
        return { kind: "gifVideo", buffer: mp4, mimetype: "video/mp4", animeName, artistName };
      } catch {
        // Fallback aman ke frame PNG tunggal bila FFmpeg gagal
      }
    }

    const pngBuffer = await mediaQueueService.imageComputeQueue.run(async () =>
      sharp(rawBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .resize(768, 768, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer(),
    );

    return { kind: "image", buffer: pngBuffer, mimetype: "image/png", animeName, artistName };
  }

  private async convertGifToMp4(gifBuffer: Buffer): Promise<Buffer> {
    return mediaQueueService.imageComputeQueue.run(async () => {
      const tempDir = await createTempDir("anime-rp");
      const inPath = path.join(tempDir, `${randomUUID()}.gif`);
      const outPath = path.join(tempDir, "out.mp4");
      try {
        await writeFile(inPath, gifBuffer);
        const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
        await runExternalProcess(
          ffmpegPath,
          [
            "-y",
            "-threads",
            "1",
            "-i",
            inPath,
            "-an",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            outPath,
          ],
          { timeoutMs: 12_000 },
        );
        return await readFile(outPath);
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }
}

export const animeRoleplayService = new AnimeRoleplayService();
