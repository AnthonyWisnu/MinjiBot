import sharp from "sharp";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import type { CommandContext } from "../../types/command";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { LruCache } from "../../utils/lruCache";
import { safeFetchExternal } from "../../utils/urlValidator";

const NOMINATIM_USER_AGENT =
  "MinjiBot/2.0 (https://github.com/AnthonyWisnu/MinjiBot; non-commercial WhatsApp bot)";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export type PinDurationSeconds = 86400 | 604800 | 2592000;
export type EphemeralDurationSeconds = 0 | 86400 | 604800 | 7776000;

export interface ParsedEventInput {
  title: string;
  startDate: Date;
  endDate: Date;
  locationName?: string;
  description: string;
}

export interface GeocodedLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface VCardPayload {
  displayName: string;
  phoneDigits: string;
  vcard: string;
}

export interface CommandUxProfile {
  autoReact: boolean;
  presence: "composing" | "recording" | null;
}

const AI_PRESENCE_COMMANDS = new Set<string>([
  "ai",
  "tanya",
  "gpt",
  "minji",
  "simi",
  "ringkas",
  "tldr",
  "tanyachat",
  "ocr",
  "baca",
  "jelaskanfoto",
  "roast",
  "puji",
  "pantunai",
  "cerpen",
  "curhat",
  "debat",
  "koding",
  "perbaiki",
  "summarize",
  "ide",
]);

const AUDIO_PRESENCE_COMMANDS = new Set<string>([
  "play",
  "song",
  "tovn",
  "vn",
  "bass",
  "chipmunk",
  "slowed",
  "nightcore",
  "robot",
  "reverse",
  "tomp3",
]);

const HEAVY_MEDIA_COMMANDS = new Set<string>([
  "tt",
  "tiktok",
  "ig",
  "instagram",
  "yt",
  "youtube",
  "x",
  "twt",
  "twitter",
  "pin",
  "pinterest",
  "fb",
  "facebook",
  "threads",
  "gitclone",
  "hd",
  "remini",
  "lirik",
  "lyrics",
  "tovideo",
  "tovid",
  "smeme",
  "sa",
  "setppgrup",
]);

export function classifyCommandUx(commandName: string): CommandUxProfile {
  const lower = commandName.trim().toLowerCase();
  if (AI_PRESENCE_COMMANDS.has(lower)) {
    return { autoReact: true, presence: "composing" };
  }
  if (AUDIO_PRESENCE_COMMANDS.has(lower)) {
    return { autoReact: true, presence: "recording" };
  }
  if (HEAVY_MEDIA_COMMANDS.has(lower)) {
    return { autoReact: true, presence: "composing" };
  }
  return { autoReact: false, presence: null };
}

export function parsePinDurationSeconds(raw?: string): PinDurationSeconds {
  const val = (raw ?? "7h").trim().toLowerCase();
  if (val === "24j" || val === "24h" || val === "1h" || val === "1d" || val === "1hari") {
    return 86400;
  }
  if (val === "7h" || val === "7d" || val === "7hari" || val === "1m") {
    return 604800;
  }
  if (val === "30h" || val === "30d" || val === "30hari" || val === "1b") {
    return 2592000;
  }
  throw new AppUserError(
    "Durasi pin tidak valid. Pilih: *24j* (24 jam), *7h* (7 hari), atau *30h* (30 hari).",
  );
}

export function parseEphemeralDurationSeconds(raw?: string): EphemeralDurationSeconds {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "off" || val === "0" || val === "mati" || val === "nonaktif") {
    return 0;
  }
  if (val === "24j" || val === "24h" || val === "1h" || val === "1d") {
    return 86400;
  }
  if (val === "7h" || val === "7d" || val === "7hari") {
    return 604800;
  }
  if (val === "90h" || val === "90d" || val === "90hari") {
    return 7776000;
  }
  throw new AppUserError(
    "Durasi pesan sementara tidak valid. Pilih: *off*, *24j*, *7h*, atau *90h*.",
  );
}

function getWibComponents(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function buildDateFromWib(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - WIB_OFFSET_MS;
  const candidate = new Date(utcMs);
  const check = getWibComponents(candidate);
  if (check.year !== year || check.month !== month || check.day !== day) {
    return null;
  }
  return candidate;
}

export function parseEventDateTimeWib(raw: string, now: Date = new Date()): Date | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  // Relative format: +2j / +30m / +1h
  const relMatch = /^\+(\d{1,3})\s*(m|mnt|menit|j|jam|h|hari|d)$/.exec(text);
  if (relMatch) {
    const qty = Number.parseInt(relMatch[1] ?? "0", 10);
    const unit = relMatch[2] ?? "";
    if (qty <= 0) return null;
    if (unit === "m" || unit === "mnt" || unit === "menit") {
      return new Date(now.getTime() + qty * 60 * 1000);
    }
    if (unit === "j" || unit === "jam") {
      return new Date(now.getTime() + qty * 60 * 60 * 1000);
    }
    return new Date(now.getTime() + qty * 24 * 60 * 60 * 1000);
  }

  // Natural WIB: "hari ini 20:00" / "besok 19.30"
  const natMatch = /^(hari ini|besok|lusa)\s+(\d{1,2})[:.](\d{2})$/.exec(text);
  if (natMatch) {
    const keyword = natMatch[1] ?? "";
    const hour = Number.parseInt(natMatch[2] ?? "0", 10);
    const minute = Number.parseInt(natMatch[3] ?? "0", 10);
    const addDays = keyword === "besok" ? 1 : keyword === "lusa" ? 2 : 0;
    const base = getWibComponents(new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000));
    return buildDateFromWib(base.year, base.month, base.day, hour, minute);
  }

  // ISO-like WIB: YYYY-MM-DD HH:mm
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2})[:.](\d{2})$/.exec(text);
  if (isoMatch) {
    return buildDateFromWib(
      Number.parseInt(isoMatch[1] ?? "0", 10),
      Number.parseInt(isoMatch[2] ?? "0", 10),
      Number.parseInt(isoMatch[3] ?? "0", 10),
      Number.parseInt(isoMatch[4] ?? "0", 10),
      Number.parseInt(isoMatch[5] ?? "0", 10),
    );
  }

  // Indonesian DD/MM/YYYY HH:mm or DD-MM-YYYY HH:mm
  const idMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2})[:.](\d{2})$/.exec(text);
  if (idMatch) {
    return buildDateFromWib(
      Number.parseInt(idMatch[3] ?? "0", 10),
      Number.parseInt(idMatch[2] ?? "0", 10),
      Number.parseInt(idMatch[1] ?? "0", 10),
      Number.parseInt(idMatch[4] ?? "0", 10),
      Number.parseInt(idMatch[5] ?? "0", 10),
    );
  }

  return null;
}

export function parseEventCommandInput(argsText: string, now: Date = new Date()): ParsedEventInput {
  const parts = argsText.split("|").map((p) => p.trim());
  const title = (parts[0] ?? "").slice(0, 100);
  const rawTime = parts[1] ?? "";
  const locationName = parts[2] ? parts[2].slice(0, 120) : undefined;
  const customDesc = parts[3] ? parts[3].slice(0, 300) : undefined;

  if (!title || !rawTime) {
    throw new AppUserError(
      [
        "Format: *.buatevent <judul> | <tgl jam WIB> | [lokasi]*",
        "Contoh:",
        "• *.buatevent Mabar Ranked | besok 20:00 | Discord Grup*",
        "• *.buatevent Bukber | 20/03/2027 17:30 | Cafe Pusat*",
        "• *.buatevent Rapat Cepat | +2j | Voice Chat*",
      ].join("\n"),
    );
  }

  const startDate = parseEventDateTimeWib(rawTime, now);
  if (!startDate) {
    throw new AppUserError(
      "Format tanggal/jam tidak dikenali. Gunakan *DD/MM/YYYY HH:mm*, *YYYY-MM-DD HH:mm*, *besok HH:mm*, atau *+2j*.",
    );
  }

  if (startDate.getTime() < now.getTime() - 60_000) {
    throw new AppUserError("Waktu event tidak boleh di masa lalu! Masukkan jadwal mendatang (WIB).");
  }

  const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
  if (startDate.getTime() > now.getTime() + maxFutureMs) {
    throw new AppUserError("Jadwal event maksimal 1 tahun ke depan.");
  }

  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const description = customDesc ?? `Event resmi grup dibuat via MinjiBot${locationName ? ` (${locationName})` : ""}`;

  return { title, startDate, endDate, locationName, description };
}

export function normalizeContactPhone(rawPhone: string): string {
  const digitsOnly = rawPhone.replace(/\D/g, "");
  if (digitsOnly.length < 8 || digitsOnly.length > 15) {
    throw new AppUserError("Nomor telepon harus terdiri dari 8 sampai 15 digit angka.");
  }
  if (digitsOnly.startsWith("0")) {
    return `62${digitsOnly.slice(1)}`;
  }
  return digitsOnly;
}

export function buildVCard(rawName: string, rawPhone: string): VCardPayload {
  const displayName = rawName
    .replace(/[\r\n:;\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!displayName) {
    throw new AppUserError("Nama kontak tidak boleh kosong.");
  }

  const phoneDigits = normalizeContactPhone(rawPhone);
  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${displayName}`,
    `N:;${displayName};;;`,
    `TEL;type=CELL;type=VOICE;waid=${phoneDigits}:+${phoneDigits}`,
    "END:VCARD",
  ].join("\n");

  return { displayName, phoneDigits, vcard };
}

export function buildOwnerVCard(): VCardPayload {
  const primaryOwnerJid = env.SUPER_OWNER_JIDS[0] ?? "";
  const phonePart = primaryOwnerJid.split("@")[0]?.split(":")[0] ?? "";
  if (!/^\d{8,15}$/.test(phonePart)) {
    throw new AppUserError("Nomor kontak Super Owner belum dikonfigurasi dengan format nomor telepon.");
  }
  return buildVCard("Owner MinjiBot", phonePart);
}

function isAutomatedTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.execArgv.some((arg) => arg.includes("test")) ||
    process.argv.some((arg) => arg.includes("--test"))
  );
}

export async function sendLiveEditedText(
  context: CommandContext,
  frames: readonly string[],
  finalText: string,
  delayMs = 550,
  mentions?: string[],
): Promise<void> {
  const rawSocket = (context as { socket?: unknown }).socket as
    | {
        sendMessage?: (
          chatJid: string,
          content: Record<string, unknown>,
          opts?: Record<string, unknown>,
        ) => Promise<{ key?: Record<string, unknown> } | undefined>;
      }
    | undefined;

  if (!rawSocket || typeof rawSocket.sendMessage !== "function" || frames.length === 0 || isAutomatedTestRuntime()) {
    await context.reply(finalText, mentions && mentions.length > 0 ? { mentions } : undefined);
    return;
  }

  try {
    const firstFrame = frames[0] ?? finalText;
    const sent = await rawSocket.sendMessage(
      context.chatJid,
      { text: firstFrame },
      { quoted: context.message },
    );
    const editKey = sent?.key;
    if (!editKey) {
      await context.reply(finalText, mentions && mentions.length > 0 ? { mentions } : undefined);
      return;
    }

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    for (let i = 1; i < frames.length; i += 1) {
      await sleep(delayMs);
      const frame = frames[i];
      if (!frame) continue;
      await rawSocket.sendMessage(context.chatJid, { text: frame, edit: editKey });
    }

    await sleep(delayMs);
    await rawSocket.sendMessage(context.chatJid, {
      text: finalText,
      edit: editKey,
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    });
  } catch {
    await context.reply(finalText, mentions && mentions.length > 0 ? { mentions } : undefined);
  }
}

export class BaileysNativeService {
  private readonly geoCache = new LruCache<string, GeocodedLocation>(100, 60 * 60 * 1000);

  constructor(private readonly fetchFn: typeof safeFetchExternal = safeFetchExternal) {}

  async geocodeLocation(rawQuery: string): Promise<GeocodedLocation> {
    const query = rawQuery.trim();
    if (!query || query.length < 2) {
      throw new AppUserError("Masukkan nama tempat atau kota. Contoh: *.lokasi Monas Jakarta*");
    }

    const cacheKey = query.toLowerCase();
    const cached = this.geoCache.get(cacheKey);
    if (cached) return cached;

    const resp = await this.fetchFn(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=id`,
      {
        allowedDomains: ["nominatim.openstreetmap.org"],
        headers: { Accept: "application/json", "User-Agent": NOMINATIM_USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resp.ok) {
      throw new AppUserError("Layanan peta Nominatim sedang sibuk. Coba lagi sebentar ya.");
    }

    const rows = (await resp.json()) as {
      name?: string;
      display_name?: string;
      lat?: string;
      lon?: string;
    }[];
    const hit = rows[0];
    const lat = hit?.lat ? Number.parseFloat(hit.lat) : Number.NaN;
    const lon = hit?.lon ? Number.parseFloat(hit.lon) : Number.NaN;

    if (!hit || Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new AppUserError(`Lokasi *${query}* tidak ditemukan di peta.`);
    }

    const rawName = hit.name?.trim() ?? "";
    const firstPart = hit.display_name?.split(",")[0]?.trim() ?? "";
    const displayName = rawName.length > 0 ? rawName : firstPart.length > 0 ? firstPart : query;
    const rawAddr = hit.display_name?.trim() ?? "";
    const address = rawAddr.length > 0 ? rawAddr : displayName;
    const result: GeocodedLocation = {
      name: displayName.slice(0, 80),
      address: address.slice(0, 220),
      latitude: lat,
      longitude: lon,
    };
    this.geoCache.set(cacheKey, result);
    return result;
  }

  async normalizeGroupPhotoBuffer(rawBuffer: Buffer): Promise<Buffer> {
    return mediaQueueService.imageComputeQueue.run(async () =>
      sharp(rawBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .rotate()
        .resize(640, 640, { fit: "cover" })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer(),
    );
  }
}

export const baileysNativeService = new BaileysNativeService();
