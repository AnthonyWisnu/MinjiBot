import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { AppUserError } from "../../errors/appUserError";
import { BoundedTtlCache } from "../../utils/ttlCache";
import { isPrivateOrReservedIp } from "../../utils/urlValidator";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const USER_AGENT =
  "MinjiBot/2.0 (https://github.com/AnthonyWisnu/MinjiBot; non-commercial WhatsApp bot)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface AniListMediaResult {
  type: "ANIME" | "MANGA";
  titleRomaji: string;
  titleEnglish: string | null;
  status: string;
  format: string;
  episodesOrChapters: string;
  score: string;
  genres: string[];
  description: string;
  siteUrl: string;
  imageBuffer: Buffer | null;
}

export interface AniListCharacterResult {
  nameFull: string;
  nameNative: string | null;
  favourites: number;
  appearances: string[];
  description: string;
  siteUrl: string;
  imageBuffer: Buffer | null;
}

export interface PokemonResult {
  id: number;
  name: string;
  types: string[];
  heightM: number;
  weightKg: number;
  abilities: string[];
  stats: { name: string; value: number }[];
  imageBuffer: Buffer | null;
}

export interface FreeGameEntry {
  title: string;
  genre: string;
  platform: string;
  publisher: string;
  url: string;
}

export interface DogImageResult {
  breed: string;
  imageBuffer: Buffer;
}

export interface HttpCatResult {
  code: number;
  meaning: string;
  imageBuffer: Buffer;
}

export interface IpLookupResult {
  ip: string;
  country: string;
  region: string;
  city: string;
  isp: string;
  org: string;
  asn: string;
  timezone: string;
}

const HTTP_STATUS_MEANINGS: Record<number, string> = {
  200: "OK - Permintaan berhasil diproses",
  201: "Created - Resource baru berhasil dibuat",
  204: "No Content - Berhasil tanpa isi respons",
  301: "Moved Permanently - Dialihkan permanen",
  302: "Found - Dialihkan sementara",
  304: "Not Modified - Gunakan versi cache",
  400: "Bad Request - Format permintaan tidak valid",
  401: "Unauthorized - Membutuhkan autentikasi",
  403: "Forbidden - Akses ditolak oleh server",
  404: "Not Found - Halaman atau resource tidak ditemukan",
  405: "Method Not Allowed - Metode HTTP tidak diizinkan",
  408: "Request Timeout - Waktu permintaan habis",
  418: "I'm a Teapot - Easter egg RFC 2324",
  429: "Too Many Requests - Terlalu banyak permintaan (rate limit)",
  500: "Internal Server Error - Terjadi kesalahan di server",
  502: "Bad Gateway - Respons upstream tidak valid",
  503: "Service Unavailable - Layanan sedang tidak tersedia",
  504: "Gateway Timeout - Server upstream terlalu lama merespons",
};

function stripHtml(raw: string | null | undefined, maxLen = 420): string {
  if (!raw) return "-";
  const cleaned = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}...`;
}

type FetchFn = typeof fetch;
type DnsLookupFn = (host: string) => Promise<{ address: string }>;

export class GeekNetworkService {
  private readonly gamesCache = new BoundedTtlCache<FreeGameEntry[]>(10, 15 * 60 * 1000);
  private readonly ipCache = new BoundedTtlCache<IpLookupResult>(60, 15 * 60 * 1000);

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly lookupFn: DnsLookupFn = (host) => dnsLookup(host),
  ) {}

  private async fetchWithTimeout(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      return await this.fetchFn(url, {
        method: options.method,
        body: options.body,
        headers: {
          "User-Agent": USER_AGENT,
          ...(options.headers ?? {}),
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async downloadImageSafe(url: string | null | undefined): Promise<Buffer | null> {
    if (!url || !/^https:\/\//i.test(url)) return null;
    try {
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) return null;
      const contentLen = Number.parseInt(res.headers.get("content-length") ?? "0", 10);
      if (contentLen > MAX_IMAGE_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
      return buf;
    } catch {
      return null;
    }
  }

  async searchAniListMedia(
    queryText: string,
    type: "ANIME" | "MANGA",
  ): Promise<AniListMediaResult> {
    const search = queryText.trim();
    if (!search) {
      throw new AppUserError(`Masukkan judul ${type.toLowerCase()} yang ingin dicari.`);
    }

    const gql = `
      query ($search: String, $type: MediaType) {
        Media(search: $search, type: $type, isAdult: false) {
          title { romaji english }
          status
          format
          episodes
          chapters
          volumes
          averageScore
          genres
          description(asHtml: false)
          siteUrl
          coverImage { large }
        }
      }
    `;

    try {
      const res = await this.fetchWithTimeout(ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: gql, variables: { search, type } }),
      });

      if (res.status === 404) {
        throw new AppUserError(`${type} "${search}" tidak ditemukan di AniList.`);
      }
      if (!res.ok) {
        throw new AppUserError(`Gagal mencari ${type.toLowerCase()} di AniList.`);
      }

      const json = (await res.json()) as {
        data?: {
          Media?: {
            title?: { romaji?: string; english?: string | null };
            status?: string;
            format?: string;
            episodes?: number | null;
            chapters?: number | null;
            volumes?: number | null;
            averageScore?: number | null;
            genres?: string[];
            description?: string | null;
            siteUrl?: string;
            coverImage?: { large?: string | null };
          } | null;
        };
      };

      const media = json.data?.Media;
      if (!media) {
        throw new AppUserError(`${type} "${search}" tidak ditemukan di AniList.`);
      }

      const episodesOrChapters =
        type === "ANIME"
          ? `${media.episodes ? String(media.episodes) : "?"} Episode`
          : `${media.chapters ? String(media.chapters) : "?"} Ch / ${media.volumes ? String(media.volumes) : "?"} Vol`;

      const imageBuffer = await this.downloadImageSafe(media.coverImage?.large);

      return {
        type,
        titleRomaji: media.title?.romaji ?? search,
        titleEnglish: media.title?.english ?? null,
        status: media.status ?? "-",
        format: media.format ?? type,
        episodesOrChapters,
        score: media.averageScore ? `${String(media.averageScore)}/100` : "-",
        genres: (media.genres ?? []).slice(0, 5),
        description: stripHtml(media.description, 420),
        siteUrl: media.siteUrl ?? "",
        imageBuffer,
      };
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Server AniList sedang sibuk. Coba lagi sebentar ya.");
    }
  }

  async searchAniListCharacter(queryText: string): Promise<AniListCharacterResult> {
    const search = queryText.trim();
    if (!search) {
      throw new AppUserError("Masukkan nama karakter anime/manga. Contoh: .karakter Frieren");
    }

    const gql = `
      query ($search: String) {
        Character(search: $search) {
          name { full native }
          favourites
          description(asHtml: false)
          siteUrl
          image { large }
          media(perPage: 3, sort: POPULARITY_DESC) {
            nodes { title { romaji } }
          }
        }
      }
    `;

    try {
      const res = await this.fetchWithTimeout(ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: gql, variables: { search } }),
      });

      if (res.status === 404) {
        throw new AppUserError(`Karakter "${search}" tidak ditemukan di AniList.`);
      }
      if (!res.ok) {
        throw new AppUserError("Gagal mencari karakter di AniList.");
      }

      const json = (await res.json()) as {
        data?: {
          Character?: {
            name?: { full?: string; native?: string | null };
            favourites?: number;
            description?: string | null;
            siteUrl?: string;
            image?: { large?: string | null };
            media?: { nodes?: { title?: { romaji?: string } }[] };
          } | null;
        };
      };

      const char = json.data?.Character;
      if (!char) {
        throw new AppUserError(`Karakter "${search}" tidak ditemukan.`);
      }

      const appearances = (char.media?.nodes ?? [])
        .map((n) => n.title?.romaji ?? "")
        .filter((s) => s.length > 0);
      const imageBuffer = await this.downloadImageSafe(char.image?.large);

      return {
        nameFull: char.name?.full ?? search,
        nameNative: char.name?.native ?? null,
        favourites: char.favourites ?? 0,
        appearances,
        description: stripHtml(char.description, 380),
        siteUrl: char.siteUrl ?? "",
        imageBuffer,
      };
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Server AniList sedang sibuk. Coba lagi sebentar ya.");
    }
  }

  async lookupPokemon(rawQuery: string): Promise<PokemonResult> {
    const q = rawQuery.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!q) {
      throw new AppUserError("Masukkan nama atau nomor Pokedex. Contoh: .pokemon pikachu atau .pokemon 25");
    }

    try {
      const res = await this.fetchWithTimeout(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(q)}`);
      if (res.status === 404) {
        throw new AppUserError(`Pokemon "${rawQuery}" tidak ditemukan di PokeAPI.`);
      }
      if (!res.ok) {
        throw new AppUserError("Gagal menghubungi PokeAPI saat ini.");
      }

      const data = (await res.json()) as {
        id?: number;
        name?: string;
        height?: number;
        weight?: number;
        types?: { type?: { name?: string } }[];
        abilities?: { ability?: { name?: string } }[];
        stats?: { base_stat?: number; stat?: { name?: string } }[];
        sprites?: {
          front_default?: string | null;
          other?: { "official-artwork"?: { front_default?: string | null } };
        };
      };

      const spriteUrl =
        data.sprites?.other?.["official-artwork"]?.front_default ?? data.sprites?.front_default;
      const imageBuffer = await this.downloadImageSafe(spriteUrl);

      return {
        id: data.id ?? 0,
        name: data.name ?? q,
        types: (data.types ?? []).map((t) => t.type?.name ?? "").filter((s) => s.length > 0),
        heightM: (data.height ?? 0) / 10,
        weightKg: (data.weight ?? 0) / 10,
        abilities: (data.abilities ?? [])
          .map((a) => a.ability?.name ?? "")
          .filter((s) => s.length > 0),
        stats: (data.stats ?? []).map((s) => ({
          name: s.stat?.name ?? "stat",
          value: s.base_stat ?? 0,
        })),
        imageBuffer,
      };
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Server PokeAPI sedang sibuk. Coba lagi sebentar ya.");
    }
  }

  async listFreeGames(rawPlatform?: string): Promise<{ platform: string; games: FreeGameEntry[] }> {
    const plat = (rawPlatform ?? "all").trim().toLowerCase();
    const normalized = plat === "pc" || plat === "browser" ? plat : "all";
    const cached = this.gamesCache.get(normalized);
    if (cached) {
      return { platform: normalized, games: cached };
    }

    try {
      const url =
        normalized === "all"
          ? "https://www.freetogame.com/api/games?sort-by=popularity"
          : `https://www.freetogame.com/api/games?platform=${normalized}&sort-by=popularity`;
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) {
        throw new AppUserError("Gagal mengambil daftar game gratis dari FreeToGame.");
      }

      const data = (await res.json()) as {
        title?: string;
        genre?: string;
        platform?: string;
        publisher?: string;
        game_url?: string;
      }[];

      const games: FreeGameEntry[] = data.slice(0, 8).map((g) => ({
        title: g.title ?? "Unknown",
        genre: g.genre ?? "-",
        platform: g.platform ?? normalized,
        publisher: g.publisher ?? "-",
        url: g.game_url ?? "",
      }));

      this.gamesCache.set(normalized, games);
      return { platform: normalized, games };
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Server FreeToGame sedang sibuk. Coba lagi sebentar ya.");
    }
  }

  async getRandomDog(): Promise<DogImageResult> {
    try {
      const res = await this.fetchWithTimeout("https://dog.ceo/api/breeds/image/random");
      if (!res.ok) {
        throw new AppUserError("Gagal mengambil foto anjing lucu saat ini.");
      }
      const data = (await res.json()) as { message?: string; status?: string };
      const imageUrl = data.message ?? "";
      const imageBuffer = await this.downloadImageSafe(imageUrl);
      if (!imageBuffer) {
        throw new AppUserError("Gagal mengunduh gambar anjing dari server.");
      }
      const breedMatch = /\/breeds\/([^/]+)\//.exec(imageUrl);
      const breed = (breedMatch?.[1] ?? "Random Dog")
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return { breed, imageBuffer };
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Server foto anjing sedang lambat. Coba lagi ya.");
    }
  }

  async getHttpCat(rawCode: string): Promise<HttpCatResult> {
    const code = Number.parseInt(rawCode.trim(), 10);
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new AppUserError("Masukkan kode status HTTP 3 digit (100-599). Contoh: .httpcat 404");
    }

    const imageBuffer = await this.downloadImageSafe(`https://http.cat/${String(code)}.jpg`);
    if (!imageBuffer) {
      throw new AppUserError(`Kode HTTP ${String(code)} tidak memiliki kartu HTTP Cat. Coba: 200, 301, 400, 403, 404, 418, 429, 500, 503.`);
    }

    return {
      code,
      meaning: HTTP_STATUS_MEANINGS[code] ?? `HTTP Status ${String(code)}`,
      imageBuffer,
    };
  }

  async lookupIpInfo(rawTarget: string): Promise<IpLookupResult> {
    const cleaned = rawTarget
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .toLowerCase();

    if (!cleaned) {
      throw new AppUserError("Masukkan IP publik atau domain. Contoh: .cekip 8.8.8.8 atau .cekip github.com");
    }

    let resolvedIp = cleaned;
    if (isIP(cleaned) !== 0) {
      if (isPrivateOrReservedIp(cleaned)) {
        throw new AppUserError("Alamat IP privat/lokal tidak diperbolehkan untuk dicek.");
      }
    } else {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned) || cleaned === "localhost") {
        throw new AppUserError("Format IP atau domain tidak valid.");
      }
      try {
        const lookup = await this.lookupFn(cleaned);
        resolvedIp = lookup.address;
      } catch {
        throw new AppUserError(`Domain "${cleaned}" tidak dapat di-resolve ke alamat IP.`);
      }
      if (isPrivateOrReservedIp(resolvedIp)) {
        throw new AppUserError("Domain tersebut mengarah ke jaringan lokal/privat dan ditolak demi keamanan.");
      }
    }

    const cached = this.ipCache.get(resolvedIp);
    if (cached) return cached;

    try {
      const res = await this.fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(resolvedIp)}`);
      if (!res.ok) {
        throw new AppUserError("Gagal mengambil info IP dari ipwho.is.");
      }
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        ip?: string;
        country?: string;
        region?: string;
        city?: string;
        connection?: { asn?: number; org?: string; isp?: string };
        timezone?: { id?: string; utc?: string };
      };

      if (data.success === false) {
        throw new AppUserError(`Gagal cek IP: ${data.message ?? "IP tidak valid"}`);
      }

      const result: IpLookupResult = {
        ip: data.ip ?? resolvedIp,
        country: data.country ?? "-",
        region: data.region ?? "-",
        city: data.city ?? "-",
        isp: data.connection?.isp ?? "-",
        org: data.connection?.org ?? "-",
        asn: data.connection?.asn ? `AS${String(data.connection.asn)}` : "-",
        timezone: data.timezone?.id
          ? `${data.timezone.id} (${data.timezone.utc ?? ""})`
          : "-",
      };
      this.ipCache.set(resolvedIp, result);
      return result;
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw new AppUserError("Layanan cek IP sedang sibuk. Coba lagi sebentar ya.");
    }
  }
}

export const geekNetworkService = new GeekNetworkService();
