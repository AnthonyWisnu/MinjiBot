const WIB_TIMEZONE = "Asia/Jakarta";

/**
 * Returns the WIB (Asia/Jakarta) calendar date key for the given instant.
 * Format: YYYY-MM-DD
 * Does not depend on the server timezone.
 */
export function toWibDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns the WIB date key for the day before the given instant.
 * Indonesia (WIB = UTC+7) has no DST so subtracting 24 hours is safe.
 */
export function toYesterdayWibDateKey(date: Date = new Date()): string {
  const yesterday = new Date(date.getTime() - 24 * 60 * 60 * 1_000);
  return toWibDateKey(yesterday);
}

/**
 * Returns true if prevDate and nextDate fall on consecutive WIB calendar days
 * (prevDate is the WIB day immediately before nextDate).
 */
export function isConsecutiveWibDay(prevDate: Date, nextDate: Date): boolean {
  return toWibDateKey(prevDate) === toYesterdayWibDateKey(nextDate);
}
