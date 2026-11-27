import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_DOWNLOADER_DOMAINS,
  assertSafeExternalUrl,
  extractFirstHttpUrl,
  isPrivateOrReservedIp,
  isValidHttpUrl,
  matchesAllowedDomain,
  parseAllowedDownloaderUrl,
  parseHttpUrl,
  resolveRedirectUrl,
} from "../src/utils/urlValidator";

void test("isValidHttpUrl: validates valid http and https urls", () => {
  assert.equal(isValidHttpUrl("https://www.tiktok.com/@user/video/123"), true);
  assert.equal(isValidHttpUrl("http://instagram.com/p/abc123"), true);
  assert.equal(isValidHttpUrl("https://youtu.be/xyz"), true);
});

void test("isValidHttpUrl: rejects non-http protocols and malformed strings", () => {
  assert.equal(isValidHttpUrl("ftp://example.com/file"), false);
  assert.equal(isValidHttpUrl("javascript:alert(1)"), false);
  assert.equal(isValidHttpUrl("file:///etc/passwd"), false);
  assert.equal(isValidHttpUrl("--option-injection"), false);
  assert.equal(isValidHttpUrl(""), false);
  assert.equal(isValidHttpUrl(undefined), false);
});

void test("parseHttpUrl: returns URL instance for valid URLs and null for invalid", () => {
  const parsed = parseHttpUrl("https://tiktok.com/@user/video/123");
  assert.notEqual(parsed, null);
  assert.equal(parsed?.hostname, "tiktok.com");

  assert.equal(parseHttpUrl("invalid-url"), null);
  assert.equal(parseHttpUrl("ftp://test.com"), null);
});

void test("matchesAllowedDomain: enforces strict DNS boundary without substring bypass", () => {
  const tiktokDomains = ALLOWED_DOWNLOADER_DOMAINS.tiktok;

  // Valid official domains
  assert.equal(matchesAllowedDomain("tiktok.com", tiktokDomains), true);
  assert.equal(matchesAllowedDomain("www.tiktok.com", tiktokDomains), true);
  assert.equal(matchesAllowedDomain("vt.tiktok.com", tiktokDomains), true);
  assert.equal(matchesAllowedDomain("vm.tiktok.com", tiktokDomains), true);
  assert.equal(matchesAllowedDomain("m.tiktok.com", tiktokDomains), true);

  // Malicious domains attempting substring or suffix spoofing
  assert.equal(matchesAllowedDomain("evil-tiktok.com", tiktokDomains), false);
  assert.equal(matchesAllowedDomain("tiktok.com.evil.org", tiktokDomains), false);
  assert.equal(matchesAllowedDomain("faketiktok.com", tiktokDomains), false);
  assert.equal(
    matchesAllowedDomain("notinstagram.com", ALLOWED_DOWNLOADER_DOMAINS.instagram),
    false,
  );
  assert.equal(
    matchesAllowedDomain("youtube.com.attacker.com", ALLOWED_DOWNLOADER_DOMAINS.youtube),
    false,
  );
});

void test("parseAllowedDownloaderUrl: validates platform URLs and normalizes to https", () => {
  const ttValid = parseAllowedDownloaderUrl("http://vt.tiktok.com/ZS12345/", "tiktok");
  assert.notEqual(ttValid, null);
  assert.equal(ttValid?.protocol, "https:");
  assert.equal(ttValid?.hostname, "vt.tiktok.com");

  const igValid = parseAllowedDownloaderUrl("https://www.instagram.com/reel/C123abc/", "instagram");
  assert.notEqual(igValid, null);
  assert.equal(igValid?.hostname, "www.instagram.com");

  const ytValid = parseAllowedDownloaderUrl("https://youtu.be/dQw4w9WgXcQ", "youtube");
  assert.notEqual(ytValid, null);
  assert.equal(ytValid?.hostname, "youtu.be");

  // Cross-platform rejection
  assert.equal(parseAllowedDownloaderUrl("https://www.instagram.com/p/123", "tiktok"), null);
  assert.equal(parseAllowedDownloaderUrl("https://youtube.com/watch?v=123", "instagram"), null);
});

void test("isPrivateOrReservedIp: correctly identifies private and reserved IP addresses", () => {
  // Loopback
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("127.255.255.254"), true);
  assert.equal(isPrivateOrReservedIp("::1"), true);

  // RFC1918 Private
  assert.equal(isPrivateOrReservedIp("10.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("172.16.0.1"), true);
  assert.equal(isPrivateOrReservedIp("172.31.255.255"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.1"), true);

  // Link-Local & Cloud Metadata (AWS/GCP/Azure)
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true);
  assert.equal(isPrivateOrReservedIp("169.254.1.1"), true);

  // CGNAT & Multicast / Reserved
  assert.equal(isPrivateOrReservedIp("100.64.0.1"), true);
  assert.equal(isPrivateOrReservedIp("224.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("240.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("0.0.0.0"), true);

  // IPv6 ULA, link-local, IPv4-mapped
  assert.equal(isPrivateOrReservedIp("fc00::1"), true);
  assert.equal(isPrivateOrReservedIp("fe80::1"), true);
  assert.equal(isPrivateOrReservedIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("::ffff:192.168.0.1"), true);

  // Public IPs
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
  assert.equal(isPrivateOrReservedIp("142.250.190.46"), false);
});

void test("assertSafeExternalUrl: rejects SSRF attacks and internal network IPs", async () => {
  // Direct IP attacks
  await assert.rejects(
    () => assertSafeExternalUrl("http://127.0.0.1:3847/admin"),
    /Alamat IP privat atau lokal tidak diizinkan|Link eksternal wajib menggunakan HTTPS/,
  );
  await assert.rejects(
    () => assertSafeExternalUrl("https://169.254.169.254/latest/meta-data/"),
    /Alamat IP privat atau lokal tidak diizinkan/,
  );
  await assert.rejects(
    () => assertSafeExternalUrl("https://localhost/secret"),
    /Alamat tujuan tidak diizinkan/,
  );

  // DNS Rebinding / Internal IP resolution simulation
  const mockInternalDns = async () => [{ address: "10.0.0.5", family: 4 }];
  await assert.rejects(
    () =>
      assertSafeExternalUrl("https://www.tiktok.com/test", {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
        dnsLookup: mockInternalDns,
      }),
    /Alamat tujuan mengarah ke jaringan internal yang diblokir/,
  );

  // Safe public resolution simulation
  const mockPublicDns = async () => [{ address: "104.244.42.1", family: 4 }];
  const safeUrl = await assertSafeExternalUrl("https://www.tiktok.com/@creator/video/123", {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
    dnsLookup: mockPublicDns,
  });
  assert.equal(safeUrl.hostname, "www.tiktok.com");
});

void test("parseAllowedDownloaderUrl: validates twitter and pinterest URLs", () => {
  const xValid = parseAllowedDownloaderUrl("https://x.com/user/status/123456", "twitter");
  assert.notEqual(xValid, null);
  assert.equal(xValid?.hostname, "x.com");

  const twtValid = parseAllowedDownloaderUrl("https://twitter.com/user/status/123456", "twitter");
  assert.notEqual(twtValid, null);
  assert.equal(twtValid?.hostname, "twitter.com");

  const pinValid = parseAllowedDownloaderUrl(
    "https://id.pinterest.com/pin/123456789/",
    "pinterest",
  );
  assert.notEqual(pinValid, null);
  assert.equal(pinValid?.hostname, "id.pinterest.com");

  const pinItValid = parseAllowedDownloaderUrl("https://pin.it/abc1234", "pinterest");
  assert.notEqual(pinItValid, null);
  assert.equal(pinItValid?.hostname, "pin.it");

  // Rejections
  assert.equal(parseAllowedDownloaderUrl("https://x.com.evil.com/status/123", "twitter"), null);
  assert.equal(parseAllowedDownloaderUrl("https://fake-pin.it/test", "pinterest"), null);
});

void test("resolveRedirectUrl: safely resolves short URLs with mocked DNS and fetch", async () => {
  const mockPublicDns = async () => [{ address: "151.101.0.84", family: 4 }];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("pin.it/abc1234")) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.pinterest.com/pin/999888777/" },
        });
      }
      return new Response("OK", { status: 200 });
    };

    const resolved = await resolveRedirectUrl("https://pin.it/abc1234", {
      allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.pinterest,
      dnsLookup: mockPublicDns,
    });
    assert.equal(resolved, "https://www.pinterest.com/pin/999888777/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("extractFirstHttpUrl: extracts embedded URL from mobile share captions", () => {
  assert.equal(
    extractFirstHttpUrl("Lihat video lucu ini! https://vt.tiktok.com/ZSM123456/ keren banget"),
    "https://vt.tiktok.com/ZSM123456/",
  );
  assert.equal(
    extractFirstHttpUrl("Cek pin ini (https://pin.it/abc1234)."),
    "https://pin.it/abc1234",
  );
  assert.equal(
    extractFirstHttpUrl("https://x.com/user/status/999"),
    "https://x.com/user/status/999",
  );
  assert.equal(extractFirstHttpUrl(""), undefined);
  assert.equal(extractFirstHttpUrl(undefined), undefined);
});

void test("parseAllowedDownloaderUrl: supports extended mobile/regional domains safely", () => {
  assert.notEqual(parseAllowedDownloaderUrl("https://lite.tiktok.com/t/ZS123/", "tiktok"), null);
  assert.notEqual(
    parseAllowedDownloaderUrl("https://t.tiktok.com/i18n/share/video/123", "tiktok"),
    null,
  );
  assert.notEqual(parseAllowedDownloaderUrl("https://fxtwitter.com/u/status/123", "twitter"), null);
  assert.notEqual(parseAllowedDownloaderUrl("https://vxtwitter.com/u/status/123", "twitter"), null);
  assert.notEqual(parseAllowedDownloaderUrl("https://t.co/abcd1234", "twitter"), null);
  assert.notEqual(
    parseAllowedDownloaderUrl("https://www.pinterest.jp/pin/12345/", "pinterest"),
    null,
  );
  assert.notEqual(
    parseAllowedDownloaderUrl("https://www.pinterest.co.uk/pin/12345/", "pinterest"),
    null,
  );
});
