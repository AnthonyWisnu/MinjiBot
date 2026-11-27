import fs from "node:fs";
import path from "node:path";

export type BankQuizType =
  | "kuis"
  | "family100"
  | "tebakkata"
  | "tebakemoji"
  | "katla"
  | "caklontong";

export interface Family100Slot {
  text: string;
  aliases: string[];
}

export interface Question {
  prompt: string;
  answers: string[];
  familySlots?: Family100Slot[];
  reason?: string;
}

export interface Family100InputItem {
  prompt: string;
  answers: (string | { text: string; aliases?: string[] })[];
}

export interface CakLontongInputItem {
  prompt: string;
  answers: string[];
  reason: string;
}

export interface KatlaBankData {
  targets: string[];
  validWords: string[];
}

export interface QuizBankData {
  kuis: Question[];
  family100: Question[];
  tebakkata: Question[];
  tebakemoji: Question[];
  caklontong: Question[];
  katla: KatlaBankData;
}

const MAX_TRACKED_DECKS = 5000;

export function normalizeGameAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveDataFile(fileName: string): string | null {
  const possiblePaths = [
    path.resolve(process.cwd(), "src/data/games", fileName),
    path.resolve(process.cwd(), "dist/data/games", fileName),
    path.resolve(__dirname, "../../data/games", fileName),
    path.resolve(__dirname, "../../../src/data/games", fileName),
  ];

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readJsonArray<T>(fileName: string, fallback: T[]): T[] {
  const resolved = resolveDataFile(fileName);
  if (!resolved) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as T[];
    }
  } catch {
    // Fallback ke bank default jika file corrupt
  }
  return fallback;
}

export function normalizeFamily100Question(input: Family100InputItem | Question): Question {
  const rawAnswers = input.answers;
  if ("familySlots" in input && input.familySlots && input.familySlots.length > 0) {
    return {
      prompt: input.prompt,
      answers: input.familySlots.map((slot) => slot.text),
      familySlots: input.familySlots,
    };
  }

  const familySlots: Family100Slot[] = [];
  const primaryTexts: string[] = [];

  for (const entry of rawAnswers) {
    if (typeof entry === "string") {
      primaryTexts.push(entry);
      familySlots.push({ text: entry, aliases: [entry] });
    } else {
      const mergedAliases = [entry.text, ...(entry.aliases ?? [])];
      const uniqueAliases = [...new Set(mergedAliases.map((a) => a.trim()).filter(Boolean))];
      primaryTexts.push(entry.text);
      familySlots.push({
        text: entry.text,
        aliases: uniqueAliases.length > 0 ? uniqueAliases : [entry.text],
      });
    }
  }

  return {
    prompt: input.prompt,
    answers: primaryTexts,
    familySlots,
  };
}

function loadKatlaBank(fallback: KatlaBankData): KatlaBankData {
  const resolved = resolveDataFile("katla.json");
  if (!resolved) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw) as Partial<KatlaBankData>;
    if (Array.isArray(parsed.targets) && parsed.targets.length > 0) {
      const cleanTargets = parsed.targets
        .map((word) => word.trim().toLowerCase())
        .filter((word) => /^[a-z]{5,7}$/.test(word));
      const validSet = new Set<string>(cleanTargets);
      for (const word of parsed.validWords ?? []) {
        const clean = word.trim().toLowerCase();
        if (/^[a-z]{5,7}$/.test(clean)) {
          validSet.add(clean);
        }
      }
      if (cleanTargets.length > 0) {
        return {
          targets: cleanTargets,
          validWords: [...validSet],
        };
      }
    }
  } catch {
    // Fallback
  }

  return fallback;
}

const FALLBACK_BANK: QuizBankData = {
  kuis: [
    { prompt: "Ibu kota resmi negara Australia adalah kota apa?", answers: ["canberra"] },
    { prompt: "Planet terbesar di tata surya kita bernama apa?", answers: ["jupiter", "yupiter"] },
  ],
  family100: [
    normalizeFamily100Question({
      prompt: "Benda yang biasanya ada di dapur.",
      answers: ["kompor", "panci", "wajan", "pisau", "sendok", "piring"],
    }),
  ],
  tebakkata: [
    { prompt: "Punya banyak gigi tapi gak pernah menggigit makanan.", answers: ["sisir"] },
    { prompt: "Huruf acak minuman penyemangat pagi pahit hitam: P O I K.", answers: ["kopi"] },
  ],
  tebakemoji: [
    { prompt: "Tebak tempat dari emoji ini:\n🍿 🎬 🎫", answers: ["bioskop"] },
    { prompt: "Tebak benda langit dari emoji ini:\n🌧️ ☀️ 🌈", answers: ["pelangi"] },
  ],
  caklontong: [
    {
      prompt: "Kambing apa yang paling sering dimakan pas malam minggu?",
      answers: ["kambing guling", "sate kambing"],
      reason: "Kambing guling! Jangan makan bantal guling nanti keselek kapas.",
    },
  ],
  katla: {
    targets: [
      "makan",
      "minum",
      "rumah",
      "kunci",
      "pintu",
      "bantal",
      "kasur",
      "kantor",
      "sepatu",
      "santai",
      "jendela",
    ],
    validWords: ["makan", "minum", "rumah", "kunci", "pintu", "bantal", "kantor", "sepatu", "santai", "jendela", "audio"],
  },
};

export function loadDefaultQuizBank(): QuizBankData {
  const kuis = readJsonArray<Question>("kuis.json", FALLBACK_BANK.kuis);
  const rawFamily = readJsonArray<Family100InputItem>("family100.json", []);
  const family100 =
    rawFamily.length > 0
      ? rawFamily.map((item) => normalizeFamily100Question(item))
      : FALLBACK_BANK.family100;
  const tebakkata = readJsonArray<Question>("tebakkata.json", FALLBACK_BANK.tebakkata);
  const tebakemoji = readJsonArray<Question>("tebakemoji.json", FALLBACK_BANK.tebakemoji);
  const rawCak = readJsonArray<CakLontongInputItem>("caklontong.json", []);
  const caklontong: Question[] =
    rawCak.length > 0
      ? rawCak.map((item) => ({
          prompt: item.prompt,
          answers: item.answers,
          reason: item.reason,
        }))
      : FALLBACK_BANK.caklontong;
  const katla = loadKatlaBank(FALLBACK_BANK.katla);

  return {
    kuis,
    family100,
    tebakkata,
    tebakemoji,
    caklontong,
    katla,
  };
}

/**
 * Mengatur giliran soal per `(groupJid, gameType)` memakai Fisher-Yates shuffle
 * sehingga soal tidak berulang sebelum seluruh dek soal pada grup itu habis terpakai.
 */
export class ShuffleDeckManager {
  private readonly decks = new Map<string, { length: number; queue: number[]; lastIndex?: number }>();

  draw<T>(deckKey: string, items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Data game belum tersedia.");
    }

    let deck = this.decks.get(deckKey);
    if (deck?.length !== items.length || deck.queue.length === 0) {
      const indices = Array.from({ length: items.length }, (_, idx) => idx);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const current = indices[i];
        const swapWith = indices[j];
        if (current !== undefined && swapWith !== undefined) {
          indices[i] = swapWith;
          indices[j] = current;
        }
      }

      // Cegah item terakhir di siklus sebelumnya langsung muncul lagi sebagai item pertama siklus baru
      if (indices.length > 1 && deck?.lastIndex !== undefined && indices[indices.length - 1] === deck.lastIndex) {
        const lastIdx = indices.length - 1;
        const tmp = indices[0];
        const endVal = indices[lastIdx];
        if (tmp !== undefined && endVal !== undefined) {
          indices[0] = endVal;
          indices[lastIdx] = tmp;
        }
      }

      if (this.decks.size >= MAX_TRACKED_DECKS && !this.decks.has(deckKey)) {
        const oldestKey = this.decks.keys().next().value;
        if (oldestKey !== undefined) {
          this.decks.delete(oldestKey);
        }
      }

      deck = { length: items.length, queue: indices, lastIndex: deck?.lastIndex };
      this.decks.set(deckKey, deck);
    }

    const pickedIndex = deck.queue.pop() ?? 0;
    deck.lastIndex = pickedIndex;
    const item = items[pickedIndex];
    if (!item) {
      throw new Error("Data game tidak ditemukan pada indeks dek.");
    }
    return item;
  }
}

export function generateMixedMtkQuestion(): Question {
  const modeRoll = Math.random();

  if (modeRoll < 0.22) {
    // Penjumlahan 2-3 digit
    const a = Math.floor(Math.random() * 140) + 15;
    const b = Math.floor(Math.random() * 90) + 12;
    return {
      prompt: `Berapa hasil dari: ${String(a)} + ${String(b)} ?`,
      answers: [String(a + b)],
    };
  }

  if (modeRoll < 0.44) {
    // Pengurangan positif bersih
    const a = Math.floor(Math.random() * 160) + 45;
    const b = Math.floor(Math.random() * (a - 12)) + 10;
    return {
      prompt: `Berapa hasil dari: ${String(a)} - ${String(b)} ?`,
      answers: [String(a - b)],
    };
  }

  if (modeRoll < 0.68) {
    // Perkalian bervariasi
    const a = Math.floor(Math.random() * 17) + 3;
    const b = Math.floor(Math.random() * 14) + 2;
    return {
      prompt: `Berapa hasil dari: ${String(a)} x ${String(b)} ?`,
      answers: [String(a * b)],
    };
  }

  if (modeRoll < 0.85) {
    // Pembagian bulat sempurna (tanpa desimal)
    const divisor = Math.floor(Math.random() * 14) + 2;
    const quotient = Math.floor(Math.random() * 18) + 3;
    const dividend = divisor * quotient;
    return {
      prompt: `Berapa hasil dari: ${String(dividend)} : ${String(divisor)} ?`,
      answers: [String(quotient)],
    };
  }

  // Operasi 2 langkah bervariasi
  const a = Math.floor(Math.random() * 11) + 2;
  const b = Math.floor(Math.random() * 9) + 2;
  const product = a * b;
  const addMode = Math.random() < 0.55;
  if (addMode) {
    const c = Math.floor(Math.random() * 35) + 5;
    return {
      prompt: `Berapa hasil dari: (${String(a)} x ${String(b)}) + ${String(c)} ?`,
      answers: [String(product + c)],
    };
  }

  const c = Math.floor(Math.random() * Math.max(2, product - 3)) + 2;
  return {
    prompt: `Berapa hasil dari: (${String(a)} x ${String(b)}) - ${String(c)} ?`,
    answers: [String(product - c)],
  };
}
