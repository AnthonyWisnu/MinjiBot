const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const LYRICS_TIMEOUT_MS = 10_000;

export interface LyricsResult {
  title: string;
  artistName: string;
  duration?: number;
  plainLyrics: string;
}

interface LrclibSearchResult {
  title?: unknown;
  artistName?: unknown;
  duration?: unknown;
  plainLyrics?: unknown;
}

interface LrclibLyricsResult extends LrclibSearchResult {
  plainLyrics: string;
}

type FetchFn = typeof fetch;

export class LyricsService {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async searchLyrics(query: string): Promise<LyricsResult | null> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("[ERROR] Judul lagu wajib diisi.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, LYRICS_TIMEOUT_MS);

    try {
      const url = new URL(LRCLIB_SEARCH_URL);
      url.searchParams.set("q", normalizedQuery);

      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("LRCLIB request failed.");
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        return null;
      }

      const result = payload.find(hasPlainLyrics);
      if (!result) {
        return null;
      }

      return {
        title: typeof result.title === "string" ? result.title : normalizedQuery,
        artistName: typeof result.artistName === "string" ? result.artistName : "-",
        duration: typeof result.duration === "number" ? result.duration : undefined,
        plainLyrics: result.plainLyrics.trim(),
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "[ERROR] Judul lagu wajib diisi.") {
        throw error;
      }

      throw new Error("[ERROR] Layanan lirik sedang tidak tersedia. Silakan coba lagi nanti.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function hasPlainLyrics(value: unknown): value is LrclibLyricsResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as LrclibSearchResult;

  return typeof result.plainLyrics === "string" && result.plainLyrics.trim().length > 0;
}

export const lyricsService = new LyricsService();
