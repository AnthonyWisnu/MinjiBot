import { createHash, randomInt, randomUUID } from "node:crypto";
import sharp from "sharp";

import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { BoundedTtlCache } from "../../utils/ttlCache";
import { escapeXml } from "../../utils/xml";

const USER_AGENT =
  "MinjiBot/2.0 (https://github.com/AnthonyWisnu/MinjiBot; non-commercial WhatsApp bot)";
const FETCH_TIMEOUT_MS = 10_000;

export interface CurrencyConvertResult {
  amount: number;
  from: string;
  to: string;
  converted: number;
  rate: number;
  source: string;
  date: string;
}

export interface NewsArticle {
  title: string;
  link: string;
  pubDate: string;
}

export interface NewsFeedResult {
  source: string;
  category: string;
  articles: NewsArticle[];
}

export interface EnglishDictResult {
  word: string;
  phonetic: string;
  meanings: {
    partOfSpeech: string;
    definition: string;
    example?: string;
    synonyms: string[];
  }[];
}

export interface AgeResult {
  years: number;
  months: number;
  days: number;
  totalDaysLived: number;
  birthWeekday: string;
  daysUntilNextBirthday: number;
}

export interface BmiResult {
  bmi: number;
  category: string;
  idealMinKg: number;
  idealMaxKg: number;
}

export interface ColorPreviewResult {
  hex: string;
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  pngBuffer: Buffer;
}

const NEWS_RSS_MAP: Record<string, { label: string; url: string }> = {
  nasional: { label: "Nasional", url: "https://www.cnnindonesia.com/nasional/rss" },
  ekonomi: { label: "Ekonomi", url: "https://www.cnnindonesia.com/ekonomi/rss" },
  teknologi: { label: "Teknologi", url: "https://www.cnnindonesia.com/teknologi/rss" },
  olahraga: { label: "Olahraga", url: "https://www.cnnindonesia.com/olahraga/rss" },
  hiburan: { label: "Hiburan", url: "https://www.cnnindonesia.com/hiburan/rss" },
  internasional: { label: "Internasional", url: "https://www.cnnindonesia.com/internasional/rss" },
  antara: { label: "Terkini (Antara)", url: "https://www.antaranews.com/rss/terkini.xml" },
};

const WORLD_CLOCK_ZONES: readonly { key: string; label: string; tz: string }[] = [
  { key: "jakarta", label: "Jakarta (WIB)", tz: "Asia/Jakarta" },
  { key: "makassar", label: "Makassar / Bali (WITA)", tz: "Asia/Makassar" },
  { key: "jayapura", label: "Jayapura (WIT)", tz: "Asia/Jayapura" },
  { key: "singapura", label: "Singapura", tz: "Asia/Singapore" },
  { key: "tokyo", label: "Tokyo", tz: "Asia/Tokyo" },
  { key: "seoul", label: "Seoul", tz: "Asia/Seoul" },
  { key: "mekkah", label: "Mekkah / Riyadh", tz: "Asia/Riyadh" },
  { key: "london", label: "London", tz: "Europe/London" },
  { key: "newyork", label: "New York", tz: "America/New_York" },
  { key: "sydney", label: "Sydney", tz: "Australia/Sydney" },
];

const MORSE_ENCODE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
};

const MORSE_DECODE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_ENCODE).map(([ch, code]) => [code, ch]),
);

const LENGTH_TO_METER: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  inch: 0.0254,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mile: 1609.344,
  mi: 1609.344,
};

const WEIGHT_TO_GRAM: Record<string, number> = {
  mg: 0.001,
  g: 1,
  gr: 1,
  kg: 1000,
  ton: 1_000_000,
  oz: 28.349523125,
  lb: 453.59237,
  lbs: 453.59237,
};

const DATA_TO_BYTE: Record<string, number> = {
  b: 1,
  byte: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRssItems(xml: string, limit = 7): NewsArticle[] {
  const items: NewsArticle[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null = itemRegex.exec(xml);
  while (match && items.length < limit) {
    const block = match[1] ?? "";
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    const linkMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
    const pubMatch = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block);
    const title = decodeHtmlEntities(titleMatch?.[1] ?? "");
    const link = decodeHtmlEntities(linkMatch?.[1] ?? "");
    const pubDate = decodeHtmlEntities(pubMatch?.[1] ?? "");
    if (title.length > 0) {
      items.push({ title, link, pubDate });
    }
    match = itemRegex.exec(xml);
  }
  return items;
}

export function parseDateDmy(raw: string): Date | null {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const day = Number.parseInt(m[1] ?? "0", 10);
  const month = Number.parseInt(m[2] ?? "0", 10);
  const year = Number.parseInt(m[3] ?? "0", 10);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

type FetchFn = typeof fetch;

export class DailyUtilityService {
  private readonly rateCache = new BoundedTtlCache<Record<string, number>>(40, 15 * 60 * 1000);
  private readonly newsCache = new BoundedTtlCache<NewsFeedResult>(20, 5 * 60 * 1000);
  private readonly dictCache = new BoundedTtlCache<EnglishDictResult>(60, 30 * 60 * 1000);

  constructor(private readonly fetchFn: FetchFn = fetch) {}

  private async fetchWithTimeout(url: string, accept = "application/json"): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      return await this.fetchFn(url, {
        headers: { Accept: accept, "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async convertCurrency(
    amount: number,
    rawFrom: string,
    rawTo: string,
  ): Promise<CurrencyConvertResult> {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
      throw new AppUserError("Nominal kurs harus angka positif yang valid.");
    }
    const from = rawFrom.trim().toUpperCase();
    const to = rawTo.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      throw new AppUserError(
        "Kode mata uang harus 3 huruf (contoh: USD, IDR, EUR, JPY, SGD, MYR, SAR).",
      );
    }
    if (from === to) {
      return {
        amount,
        from,
        to,
        converted: amount,
        rate: 1,
        source: "Exact",
        date: new Date().toISOString().slice(0, 10),
      };
    }

    const cachedRates = this.rateCache.get(from);
    if (cachedRates && typeof cachedRates[to] === "number") {
      const rate = cachedRates[to];
      return {
        amount,
        from,
        to,
        converted: amount * rate,
        rate,
        source: "Open ER-API / Frankfurter (cache)",
        date: new Date().toISOString().slice(0, 10),
      };
    }

    // Try Frankfurter first
    try {
      const ffUrl = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await this.fetchWithTimeout(ffUrl);
      if (res.ok) {
        const data = (await res.json()) as { date?: string; rates?: Record<string, number> };
        const rate = data.rates?.[to];
        if (typeof rate === "number" && Number.isFinite(rate)) {
          return {
            amount,
            from,
            to,
            converted: amount * rate,
            rate,
            source: "Frankfurter ECB",
            date: data.date ?? new Date().toISOString().slice(0, 10),
          };
        }
      }
    } catch {
      // fallback to Open ER-API
    }

    try {
      const erUrl = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
      const res = await this.fetchWithTimeout(erUrl);
      if (!res.ok) {
        throw new AppUserError(`Gagal mengambil kurs untuk ${from} ke ${to}.`);
      }
      const data = (await res.json()) as {
        result?: string;
        time_last_update_utc?: string;
        rates?: Record<string, number>;
      };
      if (data.rates) {
        this.rateCache.set(from, data.rates);
      }
      const rate = data.rates?.[to];
      if (typeof rate !== "number" || !Number.isFinite(rate)) {
        throw new AppUserError(`Kode mata uang "${to}" tidak ditemukan.`);
      }
      return {
        amount,
        from,
        to,
        converted: amount * rate,
        rate,
        source: "Open ER-API",
        date: (data.time_last_update_utc ?? new Date().toISOString()).slice(0, 16),
      };
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Layanan kurs mata uang sedang sibuk. Coba lagi sebentar ya.");
    }
  }

  async getNews(rawCategory?: string): Promise<NewsFeedResult> {
    const key = (rawCategory ?? "nasional").trim().toLowerCase();
    const selected = NEWS_RSS_MAP[key];
    if (!selected) {
      const list = Object.keys(NEWS_RSS_MAP).join(", ");
      throw new AppUserError(`Kategori berita "${key}" tidak tersedia.\nPilihan: ${list}`);
    }

    const cached = this.newsCache.get(key);
    if (cached) return cached;

    try {
      const res = await this.fetchWithTimeout(selected.url, "application/rss+xml, text/xml");
      if (!res.ok) {
        throw new Error(`HTTP ${String(res.status)}`);
      }
      const xml = await res.text();
      const articles = parseRssItems(xml, 7);
      if (articles.length > 0) {
        const result: NewsFeedResult = {
          source: key === "antara" ? "Antara News" : "CNN Indonesia",
          category: selected.label,
          articles,
        };
        this.newsCache.set(key, result);
        return result;
      }
    } catch {
      // Fallback to Antara RSS
    }

    try {
      const fallbackUrl = "https://www.antaranews.com/rss/terkini.xml";
      const res = await this.fetchWithTimeout(fallbackUrl, "application/rss+xml, text/xml");
      if (!res.ok) {
        throw new AppUserError("Gagal mengambil berita terkini saat ini.");
      }
      const xml = await res.text();
      const articles = parseRssItems(xml, 7);
      if (articles.length === 0) {
        throw new AppUserError("Berita belum tersedia saat ini.");
      }
      const result: NewsFeedResult = {
        source: "Antara News",
        category: "Terkini",
        articles,
      };
      this.newsCache.set(key, result);
      return result;
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Server berita sedang lambat. Coba lagi beberapa saat ya.");
    }
  }

  async lookupEnglishWord(rawWord: string): Promise<EnglishDictResult> {
    const word = rawWord.trim().toLowerCase();
    if (!/^[a-z-]{1,40}$/.test(word)) {
      throw new AppUserError("Masukkan satu kata Bahasa Inggris yang valid. Contoh: .kamusen serendipity");
    }

    const cached = this.dictCache.get(word);
    if (cached) return cached;

    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const res = await this.fetchWithTimeout(url);
      if (res.status === 404) {
        throw new AppUserError(`Kata "${word}" tidak ditemukan di kamus Bahasa Inggris.`);
      }
      if (!res.ok) {
        throw new AppUserError("Gagal menghubungi layanan kamus Bahasa Inggris.");
      }

      const payload = (await res.json()) as {
        word?: string;
        phonetic?: string;
        phonetics?: { text?: string }[];
        meanings?: {
          partOfSpeech?: string;
          synonyms?: string[];
          definitions?: { definition?: string; example?: string }[];
        }[];
      }[];

      const entry = payload[0];
      if (!entry) {
        throw new AppUserError(`Definisi untuk "${word}" tidak ditemukan.`);
      }

      const phonetic =
        entry.phonetic ?? entry.phonetics?.find((p) => p.text && p.text.length > 0)?.text ?? "-";

      const meanings = (entry.meanings ?? []).slice(0, 3).map((m) => {
        const firstDef = m.definitions?.[0];
        return {
          partOfSpeech: m.partOfSpeech ?? "word",
          definition: firstDef?.definition ?? "-",
          example: firstDef?.example,
          synonyms: (m.synonyms ?? []).slice(0, 5),
        };
      });

      const result: EnglishDictResult = {
        word: entry.word ?? word,
        phonetic,
        meanings,
      };
      this.dictCache.set(word, result);
      return result;
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Koneksi kamus Bahasa Inggris sedang sibuk. Coba lagi ya.");
    }
  }

  calculateAge(birthDate: Date, now: Date = new Date()): AgeResult {
    if (birthDate.getTime() > now.getTime()) {
      throw new AppUserError("Tanggal lahir tidak boleh di masa depan.");
    }

    let years = now.getUTCFullYear() - birthDate.getUTCFullYear();
    let months = now.getUTCMonth() - birthDate.getUTCMonth();
    let days = now.getUTCDate() - birthDate.getUTCDate();

    if (days < 0) {
      const prevMonthLastDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
      ).getUTCDate();
      days += prevMonthLastDay;
      months -= 1;
    }
    if (months < 0) {
      months += 12;
      years -= 1;
    }

    const totalDaysLived = Math.floor((now.getTime() - birthDate.getTime()) / 86_400_000);
    const birthWeekday = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
    }).format(birthDate);

    let nextBday = new Date(
      Date.UTC(now.getUTCFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate(), 5, 0, 0),
    );
    if (nextBday.getTime() < now.getTime() - 43_200_000) {
      nextBday = new Date(
        Date.UTC(now.getUTCFullYear() + 1, birthDate.getUTCMonth(), birthDate.getUTCDate(), 5, 0, 0),
      );
    }
    const daysUntilNextBirthday = Math.max(
      0,
      Math.ceil((nextBday.getTime() - now.getTime()) / 86_400_000),
    );

    return {
      years,
      months,
      days,
      totalDaysLived,
      birthWeekday,
      daysUntilNextBirthday,
    };
  }

  calculateBmi(weightKg: number, heightCm: number): BmiResult {
    if (
      !Number.isFinite(weightKg) ||
      !Number.isFinite(heightCm) ||
      weightKg < 10 ||
      weightKg > 500 ||
      heightCm < 50 ||
      heightCm > 280
    ) {
      throw new AppUserError("Masukkan berat (10-500 kg) dan tinggi (50-280 cm) yang masuk akal.");
    }
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    let category: string;
    if (bmi < 18.5) {
      category = "Kurus (Underweight)";
    } else if (bmi < 25) {
      category = "Normal (Ideal)";
    } else if (bmi < 30) {
      category = "Kelebihan Berat (Overweight)";
    } else {
      category = "Obesitas";
    }
    return {
      bmi: Math.round(bmi * 10) / 10,
      category,
      idealMinKg: Math.round(18.5 * heightM * heightM * 10) / 10,
      idealMaxKg: Math.round(24.9 * heightM * heightM * 10) / 10,
    };
  }

  getWorldClocks(query?: string, now: Date = new Date()): { label: string; timeText: string }[] {
    const q = (query ?? "").trim().toLowerCase();
    const selected = q
      ? WORLD_CLOCK_ZONES.filter(
          (z) => z.key.includes(q) || z.label.toLowerCase().includes(q) || z.tz.toLowerCase().includes(q),
        )
      : WORLD_CLOCK_ZONES;

    if (selected.length === 0) {
      const list = WORLD_CLOCK_ZONES.map((z) => z.key).join(", ");
      throw new AppUserError(`Kota "${query ?? ""}" tidak tersedia.\nPilihan: ${list}`);
    }

    return selected.map((z) => ({
      label: z.label,
      timeText: new Intl.DateTimeFormat("id-ID", {
        timeZone: z.tz,
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now),
    }));
  }

  convertUnit(value: number, rawFrom: string, rawTo: string): { result: number; group: string } {
    if (!Number.isFinite(value)) {
      throw new AppUserError("Nilai konversi harus berupa angka.");
    }
    const from = rawFrom.trim().toLowerCase();
    const to = rawTo.trim().toLowerCase();

    // Temperature
    const tempUnits = new Set(["c", "f", "k"]);
    if (tempUnits.has(from) && tempUnits.has(to)) {
      let celsius = value;
      if (from === "f") celsius = ((value - 32) * 5) / 9;
      if (from === "k") celsius = value - 273.15;

      let out = celsius;
      if (to === "f") out = (celsius * 9) / 5 + 32;
      if (to === "k") out = celsius + 273.15;
      return { result: out, group: "Suhu" };
    }

    if (from in LENGTH_TO_METER && to in LENGTH_TO_METER) {
      const meters = value * (LENGTH_TO_METER[from] ?? 1);
      return { result: meters / (LENGTH_TO_METER[to] ?? 1), group: "Panjang" };
    }

    if (from in WEIGHT_TO_GRAM && to in WEIGHT_TO_GRAM) {
      const grams = value * (WEIGHT_TO_GRAM[from] ?? 1);
      return { result: grams / (WEIGHT_TO_GRAM[to] ?? 1), group: "Berat" };
    }

    if (from in DATA_TO_BYTE && to in DATA_TO_BYTE) {
      const bytes = value * (DATA_TO_BYTE[from] ?? 1);
      return { result: bytes / (DATA_TO_BYTE[to] ?? 1), group: "Data Digital" };
    }

    throw new AppUserError(
      "Satuan tidak cocok atau tidak didukung.\nSuhu: c, f, k\nPanjang: mm, cm, m, km, inch, ft, mile\nBerat: mg, g, kg, ton, oz, lb\nData: b, kb, mb, gb, tb",
    );
  }

  encodeMorse(text: string): string {
    return text
      .toUpperCase()
      .split(/\s+/)
      .map((word) =>
        word
          .split("")
          .map((ch) => MORSE_ENCODE[ch] ?? "")
          .filter((c) => c.length > 0)
          .join(" "),
      )
      .filter((w) => w.length > 0)
      .join(" / ");
  }

  decodeMorse(morse: string): string {
    return morse
      .trim()
      .split(/\s*\/\s*/)
      .map((word) =>
        word
          .trim()
          .split(/\s+/)
          .map((code) => MORSE_DECODE[code] ?? "?")
          .join(""),
      )
      .join(" ");
  }

  encodeBinary(text: string): string {
    const bytes = Buffer.from(text, "utf8");
    return Array.from(bytes)
      .map((b) => b.toString(2).padStart(8, "0"))
      .join(" ");
  }

  decodeBinary(binary: string): string {
    const tokens = binary.trim().split(/\s+/);
    if (tokens.length === 0 || tokens.some((t) => !/^[01]{8}$/.test(t))) {
      throw new AppUserError("Format biner harus deretan 8-bit (0 dan 1) dipisahkan spasi.");
    }
    const bytes = tokens.map((t) => Number.parseInt(t, 2));
    return Buffer.from(bytes).toString("utf8");
  }

  hashText(rawAlgo: string, text: string): { algo: string; digest: string } {
    const algo = rawAlgo.trim().toLowerCase();
    const allowed = new Set(["md5", "sha1", "sha256", "sha512"]);
    if (!allowed.has(algo)) {
      throw new AppUserError("Algoritma hash didukung: md5, sha1, sha256, sha512.");
    }
    return {
      algo: algo.toUpperCase(),
      digest: createHash(algo).update(text, "utf8").digest("hex"),
    };
  }

  generatePassword(length = 16): string {
    const clamped = Math.max(8, Math.min(64, Math.floor(length)));
    const charset =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*_-+=";
    let out = "";
    for (let i = 0; i < clamped; i += 1) {
      out += charset[randomInt(0, charset.length)] ?? "A";
    }
    return out;
  }

  generateUuid(): string {
    return randomUUID();
  }

  shuffleItems<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomInt(0, i + 1);
      const tmp = copy[i];
      const swapVal = copy[j];
      if (tmp !== undefined && swapVal !== undefined) {
        copy[i] = swapVal;
        copy[j] = tmp;
      }
    }
    return copy;
  }

  async renderColorPreview(rawHex: string): Promise<ColorPreviewResult> {
    const cleaned = rawHex.trim().replace(/^#/, "").toUpperCase();
    let fullHex = cleaned;
    if (/^[0-9A-F]{3}$/.test(cleaned)) {
      fullHex = cleaned
        .split("")
        .map((c) => `${c}${c}`)
        .join("");
    }
    if (!/^[0-9A-F]{6}$/.test(fullHex)) {
      throw new AppUserError("Masukkan kode warna HEX valid. Contoh: .color #38BDF8 atau .color FF5733");
    }

    const r = Number.parseInt(fullHex.slice(0, 2), 16);
    const g = Number.parseInt(fullHex.slice(2, 4), 16);
    const b = Number.parseInt(fullHex.slice(4, 6), 16);

    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rNorm) {
        h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) * 60;
      } else if (max === gNorm) {
        h = ((bNorm - rNorm) / d + 2) * 60;
      } else {
        h = ((rNorm - gNorm) / d + 4) * 60;
      }
    }

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const fg = luminance > 0.58 ? "#0F172A" : "#F8FAFC";
    const hexLabel = `#${fullHex}`;
    const rgbLabel = `RGB(${String(r)}, ${String(g)}, ${String(b)})`;
    const hslLabel = `HSL(${String(Math.round(h))}, ${String(Math.round(s * 100))}%, ${String(Math.round(l * 100))}%)`;

    const svg = Buffer.from(
      [
        `<svg width="480" height="320" xmlns="http://www.w3.org/2000/svg">`,
        `  <rect width="480" height="320" rx="24" fill="${hexLabel}"/>`,
        `  <rect x="20" y="20" width="440" height="280" rx="18" fill="none" stroke="${fg}" stroke-opacity="0.28" stroke-width="2"/>`,
        `  <text x="240" y="138" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="56" font-weight="bold" fill="${fg}">${escapeXml(hexLabel)}</text>`,
        `  <text x="240" y="188" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="${fg}">${escapeXml(rgbLabel)}</text>`,
        `  <text x="240" y="224" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" fill="${fg}" opacity="0.9">${escapeXml(hslLabel)}</text>`,
        `  <text x="240" y="276" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" fill="${fg}" opacity="0.7">MinjiBot Color Studio</text>`,
        `</svg>`,
      ].join("\n"),
    );

    const pngBuffer = await mediaQueueService.imageComputeQueue.run(async () =>
      sharp(svg, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).png().toBuffer(),
    );

    return {
      hex: hexLabel,
      r,
      g,
      b,
      h: Math.round(h),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
      pngBuffer,
    };
  }
}

export const dailyUtilityService = new DailyUtilityService();
