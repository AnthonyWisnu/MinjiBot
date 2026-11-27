import { MAX_SAFE_ECONOMY_INT } from "../services/member/memberEconomy.service";

export const MAX_SAFE_MONEY_BIGINT = 9_000_000_000_000_000n; // Rp 9 Kuadriliun (aman di PostgreSQL BIGINT)

export function toBigIntSafe(value: bigint | number | null | undefined): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  return 0n;
}

export function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function minBigInt(a: bigint, ...rest: bigint[]): bigint {
  let result = a;
  for (const val of rest) {
    if (val < result) result = val;
  }
  return result;
}

export function maxBigInt(a: bigint, ...rest: bigint[]): bigint {
  let result = a;
  for (const val of rest) {
    if (val > result) result = val;
  }
  return result;
}

export function clampMoneyCredit(currentBalance: bigint, rawAmount: bigint): bigint {
  if (rawAmount <= 0n) {
    return 0n;
  }
  const headroom = MAX_SAFE_MONEY_BIGINT - currentBalance;
  if (headroom <= 0n) {
    return 0n;
  }
  return rawAmount < headroom ? rawAmount : headroom;
}

export function percentOfBigInt(value: bigint, percent: number): bigint {
  const basisPoints = BigInt(Math.max(0, Math.round(percent * 100)));
  return (value * basisPoints) / 10_000n;
}

/**
 * Pengali bonus hadiah uang berdasarkan Level pemain:
 * Lv. 1 = 1.00x, Lv. 2 = 1.15x, Lv. 10 = 2.35x, Lv. 21 = 4.00x, Lv. 41+ = 7.00x (maks).
 */
export function computeLevelMoneyMultiplier(level: number): number {
  const clampedStep = Math.min(Math.max(0, Math.floor(level) - 1), 40);
  return Math.round((1 + clampedStep * 0.15) * 100) / 100;
}

export function scaleMoneyByLevel(baseAmount: bigint, level: number): bigint {
  if (baseAmount <= 0n) {
    return 0n;
  }
  const multBasis = BigInt(Math.round(computeLevelMoneyMultiplier(level) * 100));
  return (baseAmount * multBasis) / 100n;
}

export function formatRupiah(amount: bigint | number): string {
  const val = toBigIntSafe(amount);
  const sign = val < 0n ? "-" : "";
  const absVal = absBigInt(val);
  return `${sign}Rp ${absVal.toLocaleString("id-ID")}`;
}

function formatScaledUnit(absVal: bigint, divisor: bigint, unit: string): string {
  // Hitung 2 angka di belakang koma memakai aritmetika BigInt murni (tanpa kehilangan presisi)
  const scaledHundredths = (absVal * 100n) / divisor;
  const whole = scaledHundredths / 100n;
  const frac = Number(scaledHundredths % 100n);
  if (frac === 0) {
    return `${whole.toLocaleString("id-ID")} ${unit}`;
  }
  const fracStr = String(frac).padStart(2, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("id-ID")},${fracStr} ${unit}`;
}

/**
 * Format Rupiah ringkas untuk leaderboard dan layar HP:
 * < 1 Jt -> Rp 500.000
 * >= 1 Jt -> Rp 12,5 Jt
 * >= 1 M  -> Rp 1,25 M
 * >= 1 T  -> Rp 2,4 T
 * >= 1 Q  -> Rp 1,5 Q
 */
export function formatCompactRupiah(amount: bigint | number): string {
  const val = toBigIntSafe(amount);
  const sign = val < 0n ? "-" : "";
  const absVal = absBigInt(val);

  if (absVal >= 1_000_000_000_000_000n) {
    return `${sign}Rp ${formatScaledUnit(absVal, 1_000_000_000_000_000n, "Q")}`;
  }
  if (absVal >= 1_000_000_000_000n) {
    return `${sign}Rp ${formatScaledUnit(absVal, 1_000_000_000_000n, "T")}`;
  }
  if (absVal >= 1_000_000_000n) {
    return `${sign}Rp ${formatScaledUnit(absVal, 1_000_000_000n, "M")}`;
  }
  if (absVal >= 1_000_000n) {
    return `${sign}Rp ${formatScaledUnit(absVal, 1_000_000n, "Jt")}`;
  }
  return `${sign}Rp ${absVal.toLocaleString("id-ID")}`;
}

function parseSuffixMultiplier(suffix: string): bigint | null {
  switch (suffix) {
    case "k":
    case "rb":
    case "ribu":
      return 1_000n;
    case "jt":
    case "juta":
    case "m":
      return 1_000_000n;
    case "b":
    case "miliar":
    case "milyar":
      return 1_000_000_000n;
    case "t":
    case "triliun":
      return 1_000_000_000_000n;
    default:
      return null;
  }
}

/**
 * Mem-parsing input nominal Rupiah BigInt seperti "50000", "50.000", "25k", "1.5jt",
 * "2m", "5b", "2.5miliar", "1t", atau "all".
 */
export function parseBigIntAmountOrAll(raw: string | undefined): bigint | "all" | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "all" || normalized === "semua" || normalized === "max") {
    return "all";
  }

  return parsePositiveBigIntMoneyInput(normalized);
}

export function parsePositiveBigIntMoneyInput(raw: string | undefined): bigint | null {
  if (!raw) {
    return null;
  }

  const cleaned = raw.trim().toLowerCase().replace(/^rp\s*/i, "");
  if (!cleaned) {
    return null;
  }

  const suffixMatch = /^(\d+)(?:[.,](\d{1,6}))?(k|rb|ribu|jt|juta|m|b|miliar|milyar|t|triliun)$/i.exec(
    cleaned,
  );
  if (suffixMatch) {
    const intPartStr = suffixMatch[1] ?? "";
    const fracPartStr = suffixMatch[2] ?? "";
    const suffix = (suffixMatch[3] ?? "").toLowerCase();
    const multiplier = parseSuffixMultiplier(suffix);
    if (!multiplier || !/^\d+$/.test(intPartStr)) {
      return null;
    }

    const intPart = BigInt(intPartStr) * multiplier;
    let fracValue = 0n;
    if (fracPartStr.length > 0) {
      const denom = 10n ** BigInt(fracPartStr.length);
      fracValue = (BigInt(fracPartStr) * multiplier) / denom;
    }

    const value = intPart + fracValue;
    if (value <= 0n || value > MAX_SAFE_MONEY_BIGINT) {
      return null;
    }
    return value;
  }

  const digitsOnly = cleaned.replace(/[.,_]/g, "");
  if (!/^\d+$/.test(digitsOnly)) {
    return null;
  }

  try {
    const parsed = BigInt(digitsOnly);
    if (parsed <= 0n || parsed > MAX_SAFE_MONEY_BIGINT) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Mem-parsing input nominal bilangan bulat biasa (poin, jumlah unit) seperti "50000", "25k", "1.5jt", atau "all".
 */
export function parseAmountOrAll(raw: string | undefined): number | "all" | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "all" || normalized === "semua" || normalized === "max") {
    return "all";
  }

  return parsePositiveMoneyInput(normalized);
}

export function parsePositiveMoneyInput(raw: string | undefined): number | null {
  const parsed = parsePositiveBigIntMoneyInput(raw);
  if (parsed === null || parsed > BigInt(MAX_SAFE_ECONOMY_INT)) {
    return null;
  }
  return Number(parsed);
}

export function formatRemainingDuration(ms: number): string {
  const clamped = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(clamped / 86400);
  const hours = Math.floor((clamped % 86400) / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)} hari`);
  if (hours > 0) parts.push(`${String(hours)} jam`);
  if (minutes > 0 && days === 0) parts.push(`${String(minutes)} menit`);
  if (seconds > 0 && days === 0 && hours === 0) parts.push(`${String(seconds)} detik`);

  return parts.length > 0 ? parts.join(" ") : "beberapa detik";
}
