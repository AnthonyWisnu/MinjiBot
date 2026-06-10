const DURATION_PATTERN = /^(\d+)(d|day|days|hari|w|week|weeks|minggu)$/i;
const REMINDER_DURATION_PATTERN =
  /^(\d+)(s|sec|second|seconds|detik|m|min|minute|minutes|menit|h|hour|hours|jam|d|day|days|hari|w|week|weeks|minggu)$/i;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;

export function addDuration(baseDate: Date, durationText: string): Date {
  const durationMs = parseDurationMs(durationText);

  return new Date(baseDate.getTime() + durationMs);
}

export function addDays(baseDate: Date, days: number): Date {
  return new Date(baseDate.getTime() + days * DAY_MS);
}

export function parseDurationMs(durationText: string): number {
  const match = DURATION_PATTERN.exec(durationText.trim());
  if (!match) {
    throw new Error("Format durasi tidak valid. Gunakan contoh 30d atau 2w.");
  }

  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();

  if (!Number.isInteger(value) || value <= 0 || !unit) {
    throw new Error("Durasi harus berupa angka positif.");
  }

  if (unit === "w" || unit === "week" || unit === "weeks" || unit === "minggu") {
    return value * 7 * DAY_MS;
  }

  return value * DAY_MS;
}

export function parseReminderTime(baseDate: Date, timeText: string): Date {
  const trimmedTimeText = timeText.trim();
  const dateTime = parseDateTime(trimmedTimeText);
  if (dateTime) {
    return dateTime;
  }

  const match = REMINDER_DURATION_PATTERN.exec(trimmedTimeText);
  if (!match) {
    throw new Error("Format waktu tidak valid. Gunakan contoh 10m, 2h, 1d, atau YYYY-MM-DD HH:mm.");
  }

  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (!Number.isInteger(value) || value <= 0 || !unit) {
    throw new Error("Waktu reminder harus berupa angka positif.");
  }

  if (
    unit === "s" ||
    unit === "sec" ||
    unit === "second" ||
    unit === "seconds" ||
    unit === "detik"
  ) {
    return new Date(baseDate.getTime() + value * SECOND_MS);
  }

  if (
    unit === "m" ||
    unit === "min" ||
    unit === "minute" ||
    unit === "minutes" ||
    unit === "menit"
  ) {
    return new Date(baseDate.getTime() + value * MINUTE_MS);
  }

  if (unit === "h" || unit === "hour" || unit === "hours" || unit === "jam") {
    return new Date(baseDate.getTime() + value * HOUR_MS);
  }

  if (unit === "w" || unit === "week" || unit === "weeks" || unit === "minggu") {
    return new Date(baseDate.getTime() + value * 7 * DAY_MS);
  }

  return new Date(baseDate.getTime() + value * DAY_MS);
}

export function parseDateOnly(dateText: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!match) {
    throw new Error("Format tanggal tidak valid. Gunakan YYYY-MM-DD.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Tanggal tidak valid.");
  }

  return date;
}

function parseDateTime(dateTimeText: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(dateTimeText);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    throw new Error("Tanggal atau jam reminder tidak valid.");
  }

  return date;
}
