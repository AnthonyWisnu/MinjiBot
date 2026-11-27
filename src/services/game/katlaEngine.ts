export type KatlaMark = "G" | "Y" | "B";

export interface KatlaGuessRecord {
  guess: string;
  marks: KatlaMark[];
  byUserJid: string;
}

export interface KatlaState {
  target: string;
  length: number;
  maxAttempts: number;
  guesses: KatlaGuessRecord[];
  revealedIndices: number[];
}

export type KatlaValidationResult =
  | { valid: true; word: string }
  | { valid: false; reason: string };

const VOWEL_REGEX = /[aiueo]/g;
const KEYBOARD_MASH_REGEX = /(?:qwert|asdfg|zxcvb|yuiop|hjkl|poiuy|lkjhg|mnbvc)/;
const FOUR_CONSECUTIVE_VOWELS_REGEX = /[aiueo]{4,}/;
const FIVE_CONSECUTIVE_CONSONANTS_REGEX = /[^aiueo]{5,}/;
const TRIPLE_REPEAT_REGEX = /(.)\1\1/;

export const KATLA_MAX_ATTEMPTS = 6;
export const KATLA_MAX_CLUES = 2;

/**
 * Validasi tebakan `.katla` dengan pendekatan Opsi A (Filter Fonotaktik Pintar):
 * mencegah spam huruf acak seperti "AEIOU" atau "BCDFG", sekaligus tetap menerima
 * kosakata berimbuhan dan bahasa gaul Indonesia yang wajar tanpa penolakan kamus kaku.
 */
export function validateKatlaGuess(
  rawInput: string,
  expectedLength: number,
  knownValidWords: ReadonlySet<string>,
): KatlaValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed || !/^[a-zA-Z]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: `Tebakan .katla harus 1 kata huruf A-Z saja tanpa spasi atau angka (butuh ${String(expectedLength)} huruf).`,
    };
  }

  const word = trimmed.toLowerCase();
  if (word.length !== expectedLength) {
    return {
      valid: false,
      reason: `Panjang kata harus tepat ${String(expectedLength)} huruf ya (kesempatan grup tidak berkurang).`,
    };
  }

  if (knownValidWords.has(word)) {
    return { valid: true, word };
  }

  const vowelMatches = word.match(VOWEL_REGEX);
  const vowelCount = vowelMatches ? vowelMatches.length : 0;
  const consonantCount = word.length - vowelCount;

  if (vowelCount < 1 || consonantCount < 2) {
    return {
      valid: false,
      reason:
        "Tebakan harus berbentuk kata wajar dengan minimal vokal dan konsonan (kesempatan tidak berkurang).",
    };
  }

  if (
    FOUR_CONSECUTIVE_VOWELS_REGEX.test(word) ||
    FIVE_CONSECUTIVE_CONSONANTS_REGEX.test(word) ||
    TRIPLE_REPEAT_REGEX.test(word) ||
    KEYBOARD_MASH_REGEX.test(word)
  ) {
    return {
      valid: false,
      reason:
        "Tebakan terdeteksi seperti susunan huruf acak/spam. Gunakan kata Indonesia yang wajar ya (kesempatan tidak berkurang).",
    };
  }

  return { valid: true, word };
}

/**
 * Evaluasi Wordle 2-pass yang menangani huruf kembar secara akurat:
 * Pass 1 tandai cocok posisi ('G'), Pass 2 cocok huruf tersisa ('Y'), sisanya ('B').
 */
export function evaluateKatlaGuess(guess: string, target: string): KatlaMark[] {
  const lowerGuess = guess.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const marks: KatlaMark[] = Array.from({ length: lowerTarget.length }, () => "B");
  const remainingTargetCounts = new Map<string, number>();

  for (let i = 0; i < lowerTarget.length; i++) {
    const tChar = lowerTarget[i];
    const gChar = lowerGuess[i];
    if (!tChar || !gChar) continue;

    if (gChar === tChar) {
      marks[i] = "G";
    } else {
      remainingTargetCounts.set(tChar, (remainingTargetCounts.get(tChar) ?? 0) + 1);
    }
  }

  for (let i = 0; i < lowerGuess.length; i++) {
    if (marks[i] === "G") continue;
    const gChar = lowerGuess[i];
    if (!gChar) continue;

    const available = remainingTargetCounts.get(gChar) ?? 0;
    if (available > 0) {
      marks[i] = "Y";
      remainingTargetCounts.set(gChar, available - 1);
    }
  }

  return marks;
}

export function revealNextKatlaClueIndex(state: KatlaState): number | null {
  if (state.revealedIndices.length >= KATLA_MAX_CLUES) {
    return null;
  }

  const greenPositions = new Set<number>();
  for (const record of state.guesses) {
    record.marks.forEach((mark, idx) => {
      if (mark === "G") {
        greenPositions.add(idx);
      }
    });
  }

  const unrevealed = Array.from({ length: state.length }, (_, idx) => idx).filter(
    (idx) => !state.revealedIndices.includes(idx) && !greenPositions.has(idx),
  );

  // Sisakan minimal 1 huruf tersembunyi agar tidak otomatis membocorkan kata utuh
  if (unrevealed.length <= 1) {
    return null;
  }

  const picked = unrevealed[Math.floor(Math.random() * unrevealed.length)];
  if (picked === undefined) {
    return null;
  }

  state.revealedIndices.push(picked);
  return picked;
}

export function formatKatlaPatternHint(state: KatlaState): string {
  const knownGreen = new Set<number>(state.revealedIndices);
  for (const record of state.guesses) {
    record.marks.forEach((mark, idx) => {
      if (mark === "G") {
        knownGreen.add(idx);
      }
    });
  }

  return Array.from({ length: state.length }, (_, idx) =>
    knownGreen.has(idx) ? (state.target[idx] ?? "_").toUpperCase() : "_",
  ).join(" ");
}

export function formatKatlaBoard(state: KatlaState): string {
  if (state.guesses.length === 0) {
    return formatKatlaPatternHint(state);
  }

  const rows = state.guesses.map((entry, rowIdx) => {
    const tiles = entry.marks
      .map((mark) => (mark === "G" ? "🟩" : mark === "Y" ? "🟨" : "⬛"))
      .join("");
    return `${String(rowIdx + 1)}. ${tiles}  *${entry.guess.toUpperCase()}*`;
  });

  return rows.join("\n");
}
