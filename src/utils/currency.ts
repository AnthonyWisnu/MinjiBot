import { MAX_SAFE_ECONOMY_INT } from "../services/member/memberEconomy.service";

export function formatRupiah(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  return `Rp ${safe.toLocaleString("id-ID")}`;
}

/**
 * Mem-parsing input nominal seperti "50000", "50.000", "25k", "1.5jt", "2m", atau "all".
 * Mengembalikan null bila format tidak valid atau <= 0.
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
  if (!raw) {
    return null;
  }

  const cleaned = raw.trim().toLowerCase().replace(/^rp\s*/i, "");
  if (!cleaned) {
    return null;
  }

  const suffixMatch = /^(\d+(?:[.,]\d+)?)(k|rb|ribu|jt|juta|m)$/i.exec(cleaned);
  if (suffixMatch) {
    const baseStr = (suffixMatch[1] ?? "").replace(",", ".");
    const suffix = (suffixMatch[2] ?? "").toLowerCase();
    const baseNum = Number(baseStr);
    if (!Number.isFinite(baseNum) || baseNum <= 0) {
      return null;
    }

    const multiplier = suffix === "k" || suffix === "rb" || suffix === "ribu" ? 1_000 : 1_000_000;
    const value = Math.floor(baseNum * multiplier);
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SAFE_ECONOMY_INT) {
      return null;
    }
    return value;
  }

  const digitsOnly = cleaned.replace(/[.,_]/g, "");
  if (!/^\d+$/.test(digitsOnly)) {
    return null;
  }

  const parsed = Number.parseInt(digitsOnly, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SAFE_ECONOMY_INT) {
    return null;
  }

  return parsed;
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
