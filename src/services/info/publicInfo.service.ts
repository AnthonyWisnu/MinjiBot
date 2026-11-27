import { AppUserError } from "../../errors/appUserError";
import { BoundedTtlCache } from "../../utils/ttlCache";
import { assertSafeExternalUrl, safeFetchExternal } from "../../utils/urlValidator";

export interface GempaInfo {
  tanggal: string;
  jam: string;
  magnitude: string;
  kedalaman: string;
  koordinat: string;
  wilayah: string;
  potensi: string;
  dirasakan: string;
  shakemapBuffer: Buffer | null;
}

export interface CuacaInfo {
  cityName: string;
  country: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPct: number;
  windKmh: number;
  condition: string;
  timezone: string;
}

export interface WikipediaSummaryInfo {
  title: string;
  extract: string;
  pageUrl: string;
  lang: "id" | "en";
}

export interface CityDistanceInfo {
  fromName: string;
  toName: string;
  distanceKm: number;
  distanceMiles: number;
  estCarHours: number;
  estFlightHours: number;
}

export interface GithubProfileInfo {
  login: string;
  name: string;
  bio: string;
  publicRepos: number;
  followers: number;
  following: number;
  location: string;
  company: string;
  createdAt: string;
  htmlUrl: string;
  avatarUrl: string | null;
}

export interface NpmPackageItem {
  name: string;
  version: string;
  description: string;
  author: string;
  npmUrl: string;
}

export interface WhoisDomainInfo {
  domain: string;
  registrar: string;
  statuses: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  nameservers: string[];
}

const PUBLIC_INFO_USER_AGENT =
  "MinjiBot/2.0 (https://github.com/AnthonyWisnu/MinjiBot; non-commercial WhatsApp bot)";

const WMO_WEATHER_ID: Record<number, string> = {
  0: "Cerah",
  1: "Cerah Berawan",
  2: "Berawan Sebagian",
  3: "Mendung",
  45: "Berkabut",
  48: "Kabut Tebal",
  51: "Gerimis Ringan",
  53: "Gerimis Sedang",
  55: "Gerimis Lebat",
  61: "Hujan Ringan",
  63: "Hujan Sedang",
  65: "Hujan Lebat",
  71: "Salju Ringan",
  80: "Hujan Lokal Ringan",
  81: "Hujan Lokal Sedang",
  82: "Hujan Lokal Lebat",
  95: "Badai Petir",
  96: "Badai Petir & Hujan Es",
  99: "Badai Petir Ekstrem",
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function describeWmoCode(code: number): string {
  return WMO_WEATHER_ID[code] ?? `Kode Cuaca (${String(code)})`;
}

export class PublicInfoService {
  private readonly gempaCache = new BoundedTtlCache<GempaInfo>(4, 5 * 60 * 1000);
  private readonly cuacaCache = new BoundedTtlCache<CuacaInfo>(100, 15 * 60 * 1000);
  private readonly wikiCache = new BoundedTtlCache<WikipediaSummaryInfo>(100, 30 * 60 * 1000);
  private readonly kbbiCache = new BoundedTtlCache<string>(100, 30 * 60 * 1000);
  private readonly translateCache = new BoundedTtlCache<string>(150, 15 * 60 * 1000);
  private readonly githubCache = new BoundedTtlCache<GithubProfileInfo>(80, 15 * 60 * 1000);
  private readonly npmCache = new BoundedTtlCache<NpmPackageItem[]>(80, 15 * 60 * 1000);
  private readonly whoisCache = new BoundedTtlCache<WhoisDomainInfo>(80, 30 * 60 * 1000);

  constructor(private readonly fetchFn: typeof safeFetchExternal = safeFetchExternal) {}

  async getInfoGempa(): Promise<GempaInfo> {
    const cached = this.gempaCache.get("latest");
    if (cached) return cached;

    const resp = await this.fetchFn("https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json", {
      allowedDomains: ["data.bmkg.go.id"],
      headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      throw new AppUserError("Gagal mengambil data gempa terkini dari BMKG.");
    }

    const json = (await resp.json()) as {
      Infogempa?: {
        gempa?: {
          Tanggal?: string;
          Jam?: string;
          Magnitude?: string;
          Kedalaman?: string;
          Coordinates?: string;
          Wilayah?: string;
          Potensi?: string;
          Dirasakan?: string;
          Shakemap?: string;
        };
      };
    };

    const g = json.Infogempa?.gempa;
    if (!g) {
      throw new AppUserError("Data gempa BMKG tidak tersedia saat ini.");
    }

    let shakemapBuffer: Buffer | null = null;
    if (g.Shakemap && /^[A-Za-z0-9._-]+$/.test(g.Shakemap)) {
      try {
        const imgResp = await this.fetchFn(
          `https://data.bmkg.go.id/DataMKG/TEWS/${g.Shakemap}`,
          {
            allowedDomains: ["data.bmkg.go.id"],
            headers: { "User-Agent": PUBLIC_INFO_USER_AGENT },
            signal: AbortSignal.timeout(8_000),
          },
        );
        if (imgResp.ok) {
          shakemapBuffer = Buffer.from(await imgResp.arrayBuffer());
        }
      } catch {
        shakemapBuffer = null;
      }
    }

    const info: GempaInfo = {
      tanggal: g.Tanggal ?? "-",
      jam: g.Jam ?? "-",
      magnitude: g.Magnitude ?? "-",
      kedalaman: g.Kedalaman ?? "-",
      koordinat: g.Coordinates ?? "-",
      wilayah: g.Wilayah ?? "-",
      potensi: g.Potensi ?? "-",
      dirasakan: g.Dirasakan ?? "-",
      shakemapBuffer,
    };

    this.gempaCache.set("latest", info);
    return info;
  }

  private async geocodeCity(city: string): Promise<{
    name: string;
    country: string;
    latitude: number;
    longitude: number;
  }> {
    try {
      const resp = await this.fetchFn(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=id&format=json`,
        {
          allowedDomains: ["geocoding-api.open-meteo.com"],
          headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
          signal: AbortSignal.timeout(4_000),
        },
      );
      if (resp.ok) {
        const json = (await resp.json()) as {
          results?: {
            name: string;
            country?: string;
            admin1?: string;
            latitude: number;
            longitude: number;
          }[];
        };
        const first = json.results?.[0];
        if (first) {
          return {
            name: first.admin1 ? `${first.name}, ${first.admin1}` : first.name,
            country: first.country ?? "-",
            latitude: first.latitude,
            longitude: first.longitude,
          };
        }
      }
    } catch {
      // Lanjut fallback Nominatim OpenStreetMap jika Open-Meteo geocoding tidak terjangkau dari VPS
    }

    const nomResp = await this.fetchFn(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&accept-language=id`,
      {
        allowedDomains: ["nominatim.openstreetmap.org"],
        headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!nomResp.ok) {
      throw new AppUserError("Layanan peta/cuaca sedang sibuk. Coba lagi sebentar ya.");
    }

    const nomResults = (await nomResp.json()) as {
      display_name?: string;
      name?: string;
      lat?: string;
      lon?: string;
    }[];
    const hit = nomResults[0];
    const lat = hit?.lat ? Number.parseFloat(hit.lat) : Number.NaN;
    const lon = hit?.lon ? Number.parseFloat(hit.lon) : Number.NaN;
    if (!hit || Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new AppUserError(`Lokasi *${city}* tidak ditemukan.`);
    }

    const parts = (hit.display_name ?? city)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const joined = parts.slice(0, 2).join(", ");
    const shortName = joined.length > 0 ? joined : (hit.name ?? city);
    const country = parts[parts.length - 1] ?? "-";

    return {
      name: shortName,
      country,
      latitude: lat,
      longitude: lon,
    };
  }

  async getInfoCuaca(rawCity: string): Promise<CuacaInfo> {
    const city = rawCity.trim();
    if (city.length < 2 || city.length > 60) {
      throw new AppUserError("Masukkan nama kota yang valid. Contoh: *.infocuaca Surabaya*");
    }

    const cacheKey = city.toLowerCase();
    const cached = this.cuacaCache.get(cacheKey);
    if (cached) return cached;

    const loc = await this.geocodeCity(city);
    const resp = await this.fetchFn(
      `https://api.open-meteo.com/v1/forecast?latitude=${String(loc.latitude)}&longitude=${String(loc.longitude)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`,
      {
        allowedDomains: ["api.open-meteo.com"],
        headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!resp.ok) {
      throw new AppUserError("Gagal mengambil data cuaca terkini.");
    }

    const json = (await resp.json()) as {
      timezone?: string;
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        weather_code?: number;
      };
    };

    const cur = json.current;
    if (!cur) {
      throw new AppUserError("Data cuaca untuk kota tersebut tidak tersedia.");
    }

    const result: CuacaInfo = {
      cityName: loc.name,
      country: loc.country,
      temperatureC: cur.temperature_2m ?? 0,
      feelsLikeC: cur.apparent_temperature ?? cur.temperature_2m ?? 0,
      humidityPct: cur.relative_humidity_2m ?? 0,
      windKmh: cur.wind_speed_10m ?? 0,
      condition: describeWmoCode(cur.weather_code ?? 0),
      timezone: json.timezone ?? "Asia/Jakarta",
    };

    this.cuacaCache.set(cacheKey, result);
    return result;
  }

  async calculateCityDistance(rawCity1: string, rawCity2: string): Promise<CityDistanceInfo> {
    const c1 = rawCity1.trim();
    const c2 = rawCity2.trim();
    if (!c1 || !c2) {
      throw new AppUserError("Format salah. Gunakan: *.jarak Jakarta | Surabaya*");
    }

    const [loc1, loc2] = await Promise.all([this.geocodeCity(c1), this.geocodeCity(c2)]);
    const km = haversineKm(loc1.latitude, loc1.longitude, loc2.latitude, loc2.longitude);
    const miles = km * 0.621371;

    return {
      fromName: `${loc1.name} (${loc1.country})`,
      toName: `${loc2.name} (${loc2.country})`,
      distanceKm: km,
      distanceMiles: miles,
      estCarHours: km / 65,
      estFlightHours: km / 780 + 0.5,
    };
  }

  async getWikipediaSummary(rawQuery: string): Promise<WikipediaSummaryInfo> {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100) {
      throw new AppUserError("Masukkan kata kunci Wikipedia. Contoh: *.wikipedia Majapahit*");
    }

    const cacheKey = query.toLowerCase();
    const cached = this.wikiCache.get(cacheKey);
    if (cached) return cached;

    for (const lang of ["id", "en"] as const) {
      const domain = `${lang}.wikipedia.org`;
      const searchResp = await this.fetchFn(
        `https://${domain}/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json`,
        {
          allowedDomains: [domain],
          headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!searchResp.ok) continue;

      const searchData = (await searchResp.json()) as [string?, string[]?];
      const topTitle = searchData[1]?.[0];
      if (!topTitle) continue;

      const summaryResp = await this.fetchFn(
        `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(topTitle.replace(/\s+/g, "_"))}`,
        {
          allowedDomains: [domain],
          headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!summaryResp.ok) continue;

      const sumJson = (await summaryResp.json()) as {
        title?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
      };
      if (!sumJson.extract) continue;

      const result: WikipediaSummaryInfo = {
        title: sumJson.title ?? topTitle,
        extract: sumJson.extract.slice(0, 1200),
        pageUrl:
          sumJson.content_urls?.desktop?.page ??
          `https://${domain}/wiki/${encodeURIComponent(topTitle.replace(/\s+/g, "_"))}`,
        lang,
      };
      this.wikiCache.set(cacheKey, result);
      return result;
    }

    throw new AppUserError(`Artikel Wikipedia untuk *${query}* tidak ditemukan.`);
  }

  async translateText(targetLangRaw: string, rawText: string): Promise<string> {
    const lang = targetLangRaw.trim().toLowerCase();
    const text = rawText.trim();
    if (!/^[a-z]{2,5}(?:-[a-z]{2,4})?$/.test(lang)) {
      throw new AppUserError(
        "Kode bahasa tidak valid (contoh: id, en, ja, ko, ar, fr).\nFormat: *.translate en Halo dunia*",
      );
    }
    if (!text) {
      throw new AppUserError("Masukkan teks yang ingin diterjemahkan.");
    }
    if (text.length > 1000) {
      throw new AppUserError("Teks terjemahan maksimal 1000 karakter.");
    }

    const cacheKey = `${lang}:${text}`;
    const cached = this.translateCache.get(cacheKey);
    if (cached) return cached;

    try {
      const resp = await this.fetchFn(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(text)}`,
        {
          allowedDomains: ["translate.googleapis.com"],
          headers: { "User-Agent": PUBLIC_INFO_USER_AGENT },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (resp.ok) {
        const data = (await resp.json()) as [unknown[][]?];
        const segments = data[0];
        if (Array.isArray(segments)) {
          const translated = segments
            .map((seg) => (typeof seg[0] === "string" ? seg[0] : ""))
            .join("")
            .trim();
          if (translated) {
            this.translateCache.set(cacheKey, translated);
            return translated;
          }
        }
      }
    } catch {
      // Lanjut fallback MyMemory
    }

    const mmResp = await this.fetchFn(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${encodeURIComponent(lang)}`,
      {
        allowedDomains: ["api.mymemory.translated.net"],
        headers: { "User-Agent": PUBLIC_INFO_USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (mmResp.ok) {
      const mmJson = (await mmResp.json()) as {
        responseData?: { translatedText?: string };
      };
      const out = mmJson.responseData?.translatedText?.trim();
      if (out) {
        this.translateCache.set(cacheKey, out);
        return out;
      }
    }

    throw new AppUserError("Layanan terjemahan sedang sibuk. Silakan coba lagi sebentar.");
  }

  async getKbbiDefinition(rawWord: string): Promise<string> {
    const word = rawWord.trim().toLowerCase();
    if (!word || word.length > 40 || !/^[a-z0-9\s-]+$/i.test(word)) {
      throw new AppUserError("Masukkan 1 kata Bahasa Indonesia yang valid. Contoh: *.kbbi merdeka*");
    }

    const cached = this.kbbiCache.get(word);
    if (cached) return cached;

    const resp = await this.fetchFn(
      `https://id.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(word)}&format=json`,
      {
        allowedDomains: ["id.wiktionary.org"],
        headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resp.ok) {
      throw new AppUserError("Gagal menghubungi kamus KBBI/Wiktionary.");
    }

    const json = (await resp.json()) as {
      query?: { pages?: Record<string, { missing?: string; extract?: string }> };
    };
    const pages = json.query?.pages ? Object.values(json.query.pages) : [];
    const extract = pages[0]?.extract?.trim();
    if (!extract || pages[0]?.missing !== undefined) {
      throw new AppUserError(`Kata *${word}* tidak ditemukan di kamus Bahasa Indonesia.`);
    }

    const cleaned = extract
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 1200)
      .trim();

    this.kbbiCache.set(word, cleaned);
    return cleaned;
  }

  async getGithubProfile(rawUsername: string): Promise<GithubProfileInfo> {
    const username = rawUsername.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(username)) {
      throw new AppUserError("Username GitHub tidak valid. Contoh: *.githubstalk torvalds*");
    }

    const key = username.toLowerCase();
    const cached = this.githubCache.get(key);
    if (cached) return cached;

    const resp = await this.fetchFn(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      allowedDomains: ["api.github.com"],
      headers: { Accept: "application/vnd.github+json", "User-Agent": PUBLIC_INFO_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });

    if (resp.status === 404) {
      throw new AppUserError(`Akun GitHub *@${username}* tidak ditemukan.`);
    }
    if (!resp.ok) {
      throw new AppUserError("Gagal mengambil profil GitHub. Coba lagi sebentar ya.");
    }

    const d = (await resp.json()) as {
      login: string;
      name?: string | null;
      bio?: string | null;
      public_repos?: number;
      followers?: number;
      following?: number;
      location?: string | null;
      company?: string | null;
      created_at?: string;
      html_url?: string;
      avatar_url?: string | null;
    };

    const info: GithubProfileInfo = {
      login: d.login,
      name: d.name ?? d.login,
      bio: d.bio ?? "-",
      publicRepos: d.public_repos ?? 0,
      followers: d.followers ?? 0,
      following: d.following ?? 0,
      location: d.location ?? "-",
      company: d.company ?? "-",
      createdAt: d.created_at ? d.created_at.slice(0, 10) : "-",
      htmlUrl: d.html_url ?? `https://github.com/${d.login}`,
      avatarUrl: d.avatar_url ?? null,
    };

    this.githubCache.set(key, info);
    return info;
  }

  async searchNpmPackages(rawQuery: string): Promise<NpmPackageItem[]> {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 60) {
      throw new AppUserError("Masukkan nama paket NPM. Contoh: *.npmsearch sharp*");
    }

    const key = query.toLowerCase();
    const cached = this.npmCache.get(key);
    if (cached) return cached;

    const resp = await this.fetchFn(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`,
      {
        allowedDomains: ["registry.npmjs.org"],
        headers: { Accept: "application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resp.ok) {
      throw new AppUserError("Gagal mencari paket di NPM Registry.");
    }

    const json = (await resp.json()) as {
      objects?: {
        package?: {
          name?: string;
          version?: string;
          description?: string;
          publisher?: { username?: string };
          links?: { npm?: string };
        };
      }[];
    };

    const items: NpmPackageItem[] = (json.objects ?? [])
      .map((obj) => obj.package)
      .filter((pkg): pkg is NonNullable<typeof pkg> => Boolean(pkg?.name))
      .map((pkg) => ({
        name: pkg.name ?? "-",
        version: pkg.version ?? "-",
        description: (pkg.description ?? "-").slice(0, 110),
        author: pkg.publisher?.username ?? "-",
        npmUrl: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name ?? ""}`,
      }));

    if (items.length === 0) {
      throw new AppUserError(`Paket NPM untuk *${query}* tidak ditemukan.`);
    }

    this.npmCache.set(key, items);
    return items;
  }

  async getWhoisDomain(rawDomain: string): Promise<WhoisDomainInfo> {
    const domain = rawDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");

    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain) || domain.length > 100) {
      throw new AppUserError("Domain tidak valid. Contoh: *.whois google.com* atau *.whois kompas.com*");
    }

    const cached = this.whoisCache.get(domain);
    if (cached) return cached;

    const resp = await this.fetchFn(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      allowedDomains: ["rdap.org"],
      maxRedirects: 4,
      headers: { Accept: "application/rdap+json, application/json", "User-Agent": PUBLIC_INFO_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status === 404) {
      throw new AppUserError(`Domain *${domain}* tidak terdaftar atau belum didukung RDAP.`);
    }
    if (!resp.ok) {
      throw new AppUserError("Gagal mengambil data WHOIS/RDAP untuk domain tersebut.");
    }

    const json = (await resp.json()) as {
      ldhName?: string;
      status?: string[];
      events?: { eventAction?: string; eventDate?: string }[];
      nameservers?: { ldhName?: string }[];
      entities?: {
        roles?: string[];
        vcardArray?: [string, [string, unknown, string, unknown][]];
      }[];
    };

    let registrar = "-";
    const regEntity = json.entities?.find((e) => e.roles?.includes("registrar"));
    const fnRow = regEntity?.vcardArray?.[1]?.find((row) => row[0] === "fn");
    if (fnRow && typeof fnRow[3] === "string") {
      registrar = fnRow[3];
    }

    const findEvent = (action: string): string => {
      const ev = json.events?.find((e) => e.eventAction?.toLowerCase().includes(action));
      return ev?.eventDate ? ev.eventDate.slice(0, 10) : "-";
    };

    const info: WhoisDomainInfo = {
      domain: json.ldhName ?? domain,
      registrar,
      statuses: (json.status ?? []).slice(0, 4),
      createdAt: findEvent("registration"),
      updatedAt: findEvent("last changed"),
      expiresAt: findEvent("expiration"),
      nameservers: (json.nameservers ?? [])
        .map((ns) => ns.ldhName ?? "")
        .filter(Boolean)
        .slice(0, 4),
    };

    this.whoisCache.set(domain, info);
    return info;
  }

  async shortenUrl(rawUrl: string): Promise<string> {
    const validated = await assertSafeExternalUrl(rawUrl.trim(), { requireHttps: false });
    const targetUrl = validated.toString();

    try {
      const resp = await this.fetchFn(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(targetUrl)}`,
        {
          allowedDomains: ["tinyurl.com"],
          headers: { "User-Agent": PUBLIC_INFO_USER_AGENT },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (resp.ok) {
        const short = (await resp.text()).trim();
        if (short.startsWith("https://") || short.startsWith("http://")) {
          return short;
        }
      }
    } catch {
      // Fallback is.gd
    }

    const fallback = await this.fetchFn(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(targetUrl)}`,
      {
        allowedDomains: ["is.gd"],
        headers: { "User-Agent": PUBLIC_INFO_USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (fallback.ok) {
      const short = (await fallback.text()).trim();
      if (short.startsWith("https://") || short.startsWith("http://")) {
        return short;
      }
    }

    throw new AppUserError("Gagal memperpendek tautan. Coba lagi beberapa saat lagi.");
  }
}

export const publicInfoService = new PublicInfoService();
