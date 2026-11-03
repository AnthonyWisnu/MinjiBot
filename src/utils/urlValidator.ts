import dns from "node:dns";
import net from "node:net";

import { AppUserError } from "../errors/appUserError";

export type DownloaderPlatform = "tiktok" | "instagram" | "youtube" | "twitter" | "pinterest";

export const ALLOWED_DOWNLOADER_DOMAINS: Record<DownloaderPlatform, readonly string[]> = {
  tiktok: ["tiktok.com", "vt.tiktok.com", "vm.tiktok.com", "m.tiktok.com"],
  instagram: ["instagram.com", "instagr.am"],
  youtube: ["youtube.com", "youtu.be", "music.youtube.com"],
  twitter: ["twitter.com", "x.com", "mobile.twitter.com", "m.twitter.com"],
  pinterest: ["pinterest.com", "www.pinterest.com", "pin.it", "id.pinterest.com"],
};

export interface DnsAddressRecord {
  address: string;
  family: number;
}

export type DnsLookupAllFn = (hostname: string) => Promise<readonly DnsAddressRecord[]>;

const defaultDnsLookupAll: DnsLookupAllFn = (hostname: string) =>
  dns.promises.lookup(hostname, { all: true, order: "verbatim" });

export function isValidHttpUrl(input?: string): boolean {
  return parseHttpUrl(input) !== null;
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
    if (parsed.username !== "" || parsed.password !== "") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHostname(rawHostname: string): string {
  const unbracketed =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  return unbracketed.toLowerCase().replace(/\.+$/, "");
}

export function matchesAllowedDomain(
  hostnameInput: string,
  allowedDomains: readonly string[],
): boolean {
  const host = normalizeHostname(hostnameInput);
  if (!host || net.isIP(host) !== 0) {
    return false;
  }

  return allowedDomains.some((rawDomain) => {
    const domain = rawDomain.toLowerCase().replace(/^\.+|\.+$/g, "");
    return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
  });
}

export function isAllowedDomainUrl(
  rawUrl: string | undefined,
  allowedDomains: readonly string[],
): URL | null {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) {
    return null;
  }

  if (parsed.port !== "" && parsed.port !== "443" && parsed.port !== "80") {
    return null;
  }

  if (!matchesAllowedDomain(parsed.hostname, allowedDomains)) {
    return null;
  }

  if (parsed.protocol === "http:") {
    parsed.protocol = "https:";
  }
  if (parsed.port === "80" || parsed.port === "443") {
    parsed.port = "";
  }

  return parsed;
}

export function parseAllowedDownloaderUrl(
  rawUrl: string | undefined,
  platform: DownloaderPlatform,
): URL | null {
  return isAllowedDomainUrl(rawUrl, ALLOWED_DOWNLOADER_DOMAINS[platform]);
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }

  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0];
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) {
    return true;
  }

  const [a, b, c] = octets;

  // 0.0.0.0/8 (current network / unspecified)
  if (a === 0) return true;
  // 10.0.0.0/8 (RFC1918 private)
  if (a === 10) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local & cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (RFC1918 private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF protocol assignments) & 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  // 192.88.99.0/24 (6to4 relay anycast)
  if (a === 192 && b === 88 && c === 99) return true;
  // 192.168.0.0/16 (RFC1918 private)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved / broadcast)
  if (a >= 224) return true;

  return false;
}

function extractMappedIpv4FromIpv6(normalizedIpv6: string): string | null {
  // Dotted IPv4-mapped or IPv4-compatible form: ::ffff:127.0.0.1 or ::127.0.0.1
  const dottedMatch = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/i.exec(normalizedIpv6);
  if (dottedMatch?.[1]) {
    return dottedMatch[1];
  }

  // Hex IPv4-mapped form produced by WHATWG URL parser: ::ffff:7f00:1
  const hexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(normalizedIpv6);
  if (hexMatch?.[1] && hexMatch[2]) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return `${String(a)}.${String(b)}.${String(c)}.${String(d)}`;
  }

  return null;
}

export function isPrivateOrReservedIp(ipInput: string): boolean {
  const withoutZone = normalizeHostname(ipInput).split("%")[0] ?? "";
  if (!withoutZone) {
    return true;
  }

  const version = net.isIP(withoutZone);
  if (version === 4) {
    return isPrivateOrReservedIpv4(withoutZone);
  }

  if (version !== 6) {
    return true;
  }

  const lower = withoutZone.toLowerCase();
  if (
    lower === "::" ||
    lower === "::1" ||
    lower === "0:0:0:0:0:0:0:0" ||
    lower === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const mappedIpv4 = extractMappedIpv4FromIpv6(lower);
  if (mappedIpv4) {
    return isPrivateOrReservedIpv4(mappedIpv4);
  }

  const firstHextetStr = lower.split(":")[0] ?? "";
  if (firstHextetStr) {
    const firstHextet = parseInt(firstHextetStr, 16);
    if (!Number.isNaN(firstHextet)) {
      // fc00::/7 (Unique Local Addresses)
      if ((firstHextet & 0xfe00) === 0xfc00) return true;
      // fe80::/10 (Link-Local Unicast)
      if ((firstHextet & 0xffc0) === 0xfe80) return true;
      // fec0::/10 (Deprecated Site-Local)
      if ((firstHextet & 0xffc0) === 0xfec0) return true;
      // ff00::/8 (Multicast)
      if ((firstHextet & 0xff00) === 0xff00) return true;
    }
  }

  // 2001:db8::/32 (Documentation) & 64:ff9b::/96 (NAT64 well-known prefix -> conservative block if targeting private)
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) {
    return true;
  }

  return false;
}

export interface SafeExternalUrlOptions {
  allowedDomains?: readonly string[];
  requireHttps?: boolean;
  dnsLookup?: DnsLookupAllFn;
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options?: readonly string[] | SafeExternalUrlOptions,
): Promise<URL> {
  const resolvedOptions: SafeExternalUrlOptions = Array.isArray(options)
    ? { allowedDomains: options }
    : ((options as SafeExternalUrlOptions | undefined) ?? {});

  const requireHttps = resolvedOptions.requireHttps ?? true;
  const dnsLookup = resolvedOptions.dnsLookup ?? defaultDnsLookupAll;
  const allowedDomains = resolvedOptions.allowedDomains;

  let parsed: URL | null;
  if (allowedDomains && allowedDomains.length > 0) {
    parsed = isAllowedDomainUrl(rawUrl, allowedDomains);
    if (!parsed) {
      throw new AppUserError("Link tidak valid atau domain tidak diizinkan.");
    }
  } else {
    parsed = parseHttpUrl(rawUrl);
    if (!parsed) {
      throw new AppUserError("Link tidak valid.");
    }
    if (requireHttps && parsed.protocol !== "https:") {
      throw new AppUserError("Link eksternal wajib menggunakan HTTPS.");
    }
    if (parsed.port !== "" && parsed.port !== "443" && (requireHttps || parsed.port !== "80")) {
      throw new AppUserError("Port link eksternal tidak diizinkan.");
    }
  }

  const host = normalizeHostname(parsed.hostname);
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new AppUserError("Alamat tujuan tidak diizinkan.");
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new AppUserError("Alamat IP privat atau lokal tidak diizinkan.");
    }
    return parsed;
  }

  let records: readonly DnsAddressRecord[];
  try {
    records = await dnsLookup(host);
  } catch {
    throw new AppUserError("Domain link tidak dapat diakses.");
  }

  if (records.length === 0) {
    throw new AppUserError("Domain link tidak ditemukan.");
  }

  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new AppUserError("Alamat tujuan mengarah ke jaringan internal yang diblokir.");
    }
  }

  return parsed;
}

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  allowedDomains?: readonly string[];
  dnsLookup?: DnsLookupAllFn;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function safeFetchExternal(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { maxRedirects = 3, allowedDomains, dnsLookup, ...fetchInit } = options;

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const validatedUrl = await assertSafeExternalUrl(currentUrl, {
      allowedDomains: hop === 0 ? allowedDomains : undefined,
      requireHttps: true,
      dnsLookup,
    });

    const response = await fetch(validatedUrl.toString(), {
      ...fetchInit,
      redirect: "manual",
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    if (hop === maxRedirects) {
      throw new Error("Terlalu banyak pengalihan (redirect) saat mengunduh media.");
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, validatedUrl).toString();
  }

  throw new Error("Gagal mengikuti pengalihan URL.");
}

export async function resolveRedirectUrl(
  rawUrl: string,
  options: {
    maxRedirects?: number;
    allowedDomains?: readonly string[];
    dnsLookup?: DnsLookupAllFn;
  } = {},
): Promise<string> {
  const { maxRedirects = 3, allowedDomains, dnsLookup } = options;
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const validatedUrl = await assertSafeExternalUrl(currentUrl, {
      allowedDomains: hop === 0 ? allowedDomains : undefined,
      requireHttps: true,
      dnsLookup,
    });

    let response: Response;
    try {
      response = await fetch(validatedUrl.toString(), {
        method: "HEAD",
        redirect: "manual",
      });
      if (response.status === 405) {
        response = await fetch(validatedUrl.toString(), {
          method: "GET",
          redirect: "manual",
        });
      }
    } catch {
      return currentUrl;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return currentUrl;
    }

    const location = response.headers.get("location");
    if (!location) {
      return currentUrl;
    }

    currentUrl = new URL(location, validatedUrl).toString();
  }
  return currentUrl;
}
