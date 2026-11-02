import { logger } from "../config/logger";
import { AppUserError } from "../errors/appUserError";

export { AppUserError };

const MAX_SAFE_MESSAGE_LENGTH = 400;

const TECHNICAL_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s"'`(])\.env(?=$|[\s"'`).,:;])/i,
  /\b(?:api|cookie|cookies|database|dependency|ffmpeg|gallery-dl|ig|instagram|librsvg|libvips|path|port|postgres|postgresql|prisma|server|sharp|sql|tiktok|token|vps|youtube|yt-dlp)\b/i,
  /\b(?:enoent|eacces|eperm|eexist|eisdir|enotdir|emfile|enospc|econnrefused|econnreset|etimedout|ehostunreach|enotfound|epipe|esrch)\b/i,
  /\b(?:typeerror|referenceerror|syntaxerror|rangeerror|urierror|prisma\w*error)\b/i,
  /\bp[12]\d{3}\b/i,
  /\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0|169\.254\.169\.254)\b/i,
  /\/(?:home|var|tmp|etc|usr|opt|root|proc)\//i,
  /\b[a-z]:\\/i,
  /\n\s+at\s+/,
];

const USER_SAFE_DOMAIN_ERROR_NAMES = new Set([
  "AppUserError",
  "InsufficientBalanceError",
  "InvalidAmountError",
]);

export function isUserSafeErrorMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_MESSAGE_LENGTH) {
    return false;
  }

  return !TECHNICAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function formatUserSafeError(error: unknown, fallback: string): string {
  if (error instanceof AppUserError) {
    return error.message;
  }

  if (error instanceof Error) {
    const maybeFlagged = error as Error & { isUserSafe?: unknown };
    if (maybeFlagged.isUserSafe === true || USER_SAFE_DOMAIN_ERROR_NAMES.has(error.name)) {
      return error.message;
    }

    if (isUserSafeErrorMessage(error.message)) {
      return error.message;
    }

    logger.warn({ err: error }, "Pesan error internal disanitasi oleh formatUserSafeError");
  }

  return fallback;
}
