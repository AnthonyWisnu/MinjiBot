const TECHNICAL_PATTERNS = [
  ".env",
  "api",
  "cobalt",
  "cookie",
  "database",
  "dependency",
  "ffmpeg",
  "path",
  "port",
  "prisma",
  "server",
  "token",
  "vps",
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
