const TECHNICAL_PATTERNS = [
  ".env",
  "api",
  "cookie",
  "database",
  "dependency",
  "ffmpeg",
  "path",
  "port",
  "prisma",
  "server",
  "ig",
  "instagram",
  "tiktok",
  "token",
  "vps",
  "youtube",
  "yt-dlp",
];

export function isUserSafeErrorMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return !TECHNICAL_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
}

export function formatUserSafeError(error: unknown, fallback: string): string {
  if (error instanceof Error && isUserSafeErrorMessage(error.message)) {
    return error.message;
  }

  return fallback;
}
