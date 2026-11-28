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

/**
 * Returns milliseconds remaining until the next 00:00:00 WIB (+07:00) reset boundary.
 */
export function msUntilNextWibMidnight(date: Date = new Date()): number {
  const wibKey = toWibDateKey(date);
  const startOfTodayWibMs = new Date(`${wibKey}T00:00:00+07:00`).getTime();
  const nextMidnightWibMs = startOfTodayWibMs + 24 * 60 * 60 * 1_000;
  return Math.max(0, nextMidnightWibMs - date.getTime());
}
