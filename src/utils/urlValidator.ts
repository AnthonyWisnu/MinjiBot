export function isValidHttpUrl(input?: string): boolean {
  if (!input || typeof input !== "string") {
    return false;
  }

  try {
    const parsed = new URL(input.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseHttpUrl(input?: string): URL | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  try {
    const parsed = new URL(input.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
