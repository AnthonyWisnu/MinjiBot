import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { commandRouter } from "../src/commands";
import { env } from "../src/config/env";
import {
  describeWmoCode,
  haversineKm,
  PublicInfoService,
} from "../src/services/info/publicInfo.service";
import { IslamiService, resolveSurahNumber } from "../src/services/islami/islami.service";
import { ASMAUL_HUSNA, AYAT_KURSI, SURAH_NAMES } from "../src/services/islami/islamiData";
import {
  executeGitCloneDownload,
  parseGithubRepoUrl,
} from "../src/services/media/downloaders/extra.downloader";
import {
  emojiToKitchenCode,
  generateStyledFonts,
  LightMakerService,
  parseEmojiMixPair,
} from "../src/services/media/lightMaker.service";
import { BoundedTtlCache } from "../src/utils/ttlCache";
import { parseAllowedDownloaderUrl } from "../src/utils/urlValidator";

test("Tahap 4 - all Maker, Islami, Info, and Extra Downloader commands exist in commandRouter", () => {
  const expected = [
    "emojimix",
    "tahta",
    "carbon",
    "wm",
    "style",
    "cekreso",
    "resize",
    "getfoto",
    "alquran",
    "jadwalshalat",
    "asmaulhusna",
    "ayatkursi",
    "infogempa",
    "infocuaca",
    "wikipedia",
    "translate",
    "kbbi",
    "jarak",
    "githubstalk",
    "npmsearch",
    "whois",
    "tinyurl",
    "facebook",
    "fb",
    "threads",
    "gitclone",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});

test("BoundedTtlCache - enforces TTL expiration and maxEntries LRU eviction", () => {
  const cache = new BoundedTtlCache<string>(2, 1_000);
  cache.set("a", "1", 1_000, 100);
  cache.set("b", "2", 1_000, 100);
  assert.equal(cache.get("a", 500), "1"); // refreshes "a" recency
  cache.set("c", "3", 1_000, 500); // evicts "b"
  assert.equal(cache.get("b", 600), undefined);
  assert.equal(cache.get("a", 600), "1");
  assert.equal(cache.get("c", 600), "3");
  assert.equal(cache.get("a", 1_200), undefined); // expired
});

test("LightMakerService - tahta, carbon, resize, cekreso, style, and emojimix", async () => {
  const tinyPng = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 180, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();

  let fetchCalls = 0;
  const mockFetch = async (_url: string, init?: { method?: string }) => {
    fetchCalls += 1;
    if (init?.method === "HEAD") {
      return new Response(null, { status: 200 });
    }
    return new Response(new Uint8Array(tinyPng), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };

  const maker = new LightMakerService(mockFetch as never);

  const tahtaBuf = await maker.renderTahtaImage("Minji");
  const tahtaMeta = await sharp(tahtaBuf).metadata();
  assert.equal(tahtaMeta.format, "png");
  assert.equal(tahtaMeta.width, 800);
  assert.equal(tahtaMeta.height, 800);

  const carbonBuf = await maker.renderCarbonImage("const x = 1;\nconsole.log(x);");
  const carbonMeta = await sharp(carbonBuf).metadata();
  assert.equal(carbonMeta.format, "png");
  assert.equal(carbonMeta.width, 800);

  const resized = await maker.resizeImageBuffer(tinyPng, 128, 96);
  const resizedMeta = await sharp(resized).metadata();
  assert.equal(resizedMeta.width, 128);
  assert.equal(resizedMeta.height, 96);

  await assert.rejects(() => maker.resizeImageBuffer(tinyPng, 4000, 100), /antara 16 sampai 2048/);

  const reso = await maker.inspectMediaResolution(resized, "image");
  assert.equal(reso.width, 128);
  assert.equal(reso.height, 96);
  assert.equal(reso.format, "PNG");

  const styles = generateStyledFonts("MinjiBot 123");
  assert.ok(styles.length >= 10);
  assert.notEqual(styles[0]?.text, "MinjiBot 123");

  assert.deepEqual(parseEmojiMixPair("😂+🔥"), ["😂", "🔥"]);
  assert.equal(emojiToKitchenCode("🔥"), "u1f525");

  const mixWebp = await maker.createEmojiMixSticker("😂", "🔥");
  const mixMeta = await sharp(mixWebp).metadata();
  assert.equal(mixMeta.format, "webp");
  assert.equal(mixMeta.width, 512);
  assert.ok(fetchCalls >= 2);

  const wmWebp = await maker.rewatermarkSticker(mixWebp, "Pack Test", "MinjiBot");
  assert.ok(wmWebp.byteLength > 100);
});

test("IslamiService - static 99 Asmaul Husna, Ayat Kursi, surah index, and mocked APIs", async () => {
  assert.equal(ASMAUL_HUSNA.length, 99);
  assert.equal(SURAH_NAMES.length, 114);
  assert.equal(AYAT_KURSI.ayatNumber, 255);

  assert.equal(resolveSurahNumber("1"), 1);
  assert.equal(resolveSurahNumber("yasin"), 36);
  assert.equal(resolveSurahNumber("al-kahfi"), 18);
  assert.equal(resolveSurahNumber("999"), null);

  let apiHits = 0;
  const mockFetch = async (url: string) => {
    apiHits += 1;
    if (url.includes("equran.id/api/v2/surat/112")) {
      return Response.json({
        data: {
          nomor: 112,
          nama: "الإخلاص",
          namaLatin: "Al-Ikhlas",
          jumlahAyat: 4,
          tempatTurun: "Mekah",
          arti: "Ikhlas",
          ayat: [
            { nomorAyat: 1, teksArab: "قُلْ هُوَ اللّٰهُ اَحَدٌ", teksLatin: "Qul huwallahu ahad", teksIndonesia: "Katakanlah: Dialah Allah Yang Maha Esa." },
            { nomorAyat: 2, teksArab: "اللّٰهُ الصَّمَدُ", teksLatin: "Allahus shamad", teksIndonesia: "Allah tempat meminta segala sesuatu." },
          ],
        },
      });
    }
    if (url.includes("api.myquran.com/v2/sholat/kota/cari")) {
      return Response.json({ status: true, data: [{ id: "1301", lokasi: "KOTA JAKARTA" }] });
    }
    if (url.includes("api.myquran.com/v2/sholat/jadwal/1301")) {
      return Response.json({
        status: true,
        data: {
          lokasi: "KOTA JAKARTA",
          daerah: "DKI JAKARTA",
          jadwal: {
            tanggal: "Sabtu, 28/11/2026",
            imsak: "04:01",
            subuh: "04:11",
            terbit: "05:28",
            dhuha: "05:56",
            dzuhur: "11:46",
            ashar: "15:09",
            maghrib: "17:58",
            isya: "19:12",
          },
        },
      });
    }
    return new Response("Not Found", { status: 404 });
  };

  const svc = new IslamiService(mockFetch as never);
  const quran = await svc.getAlQuran("al-ikhlas", "1-2");
  assert.equal(quran.surahNumber, 112);
  assert.equal(quran.ayatList.length, 2);

  // Cached second call doesn't hit API again
  const hitsAfterQuran = apiHits;
  await svc.getAlQuran("112", "1");
  assert.equal(apiHits, hitsAfterQuran);

  const jadwal = await svc.getJadwalShalat("jakarta", new Date("2026-11-28T05:00:00Z"));
  assert.equal(jadwal.lokasi, "KOTA JAKARTA");
  assert.equal(jadwal.maghrib, "17:58");

  assert.equal(svc.getAsmaulHusnaByNumber(1).latin, "Ar-Rahman");
  assert.equal(svc.getAsmaulHusnaPage(1).items.length, 33);
});

test("PublicInfoService - Haversine, BMKG, Open-Meteo, Wikipedia, Translate, KBBI, GitHub, NPM, WHOIS, TinyURL", async () => {
  const jktSbyKm = haversineKm(-6.2088, 106.8456, -7.2575, 112.7521);
  assert.ok(jktSbyKm > 640 && jktSbyKm < 690);
  assert.equal(describeWmoCode(95), "Badai Petir");

  const mockFetch = async (url: string) => {
    if (url.includes("data.bmkg.go.id/DataMKG/TEWS/autogempa.json")) {
      return Response.json({
        Infogempa: {
          gempa: {
            Tanggal: "28 Nov 2026",
            Jam: "06:30:00 WIB",
            Magnitude: "5.2",
            Kedalaman: "10 km",
            Coordinates: "-7.5,107.2",
            Wilayah: "Garut, Jawa Barat",
            Potensi: "Tidak berpotensi tsunami",
            Dirasakan: "III Garut",
          },
        },
      });
    }
    if (url.includes("geocoding-api.open-meteo.com")) {
      if (url.includes("Surabaya")) {
        return Response.json({
          results: [{ name: "Surabaya", country: "Indonesia", latitude: -7.2575, longitude: 112.7521 }],
        });
      }
      return Response.json({
        results: [{ name: "Jakarta", country: "Indonesia", latitude: -6.2088, longitude: 106.8456 }],
      });
    }
    if (url.includes("api.open-meteo.com")) {
      return Response.json({
        timezone: "Asia/Jakarta",
        current: {
          temperature_2m: 31.2,
          apparent_temperature: 34.5,
          relative_humidity_2m: 72,
          wind_speed_10m: 11.4,
          weather_code: 2,
        },
      });
    }
    if (url.includes("id.wikipedia.org/w/api.php")) {
      return Response.json(["majapahit", ["Majapahit"]]);
    }
    if (url.includes("id.wikipedia.org/api/rest_v1/page/summary")) {
      return Response.json({
        title: "Majapahit",
        extract: "Majapahit adalah sebuah kemaharajaan maritim di Asia Tenggara.",
        content_urls: { desktop: { page: "https://id.wikipedia.org/wiki/Majapahit" } },
      });
    }
    if (url.includes("translate.googleapis.com")) {
      return Response.json([[["Hello world", "Halo dunia"]]]);
    }
    if (url.includes("id.wiktionary.org")) {
      return Response.json({
        query: { pages: { "1": { extract: "merdeka: bebas dari penjajahan." } } },
      });
    }
    if (url.includes("api.github.com/users/torvalds")) {
      return Response.json({
        login: "torvalds",
        name: "Linus Torvalds",
        bio: "Linux creator",
        public_repos: 10,
        followers: 200000,
        following: 0,
        location: "Portland, OR",
        company: "Linux Foundation",
        created_at: "2011-09-03T15:26:22Z",
        html_url: "https://github.com/torvalds",
      });
    }
    if (url.includes("registry.npmjs.org")) {
      return Response.json({
        objects: [
          {
            package: {
              name: "sharp",
              version: "0.35.5",
              description: "High performance Node.js image processing",
              publisher: { username: "lovell" },
              links: { npm: "https://www.npmjs.com/package/sharp" },
            },
          },
        ],
      });
    }
    if (url.includes("rdap.org/domain/example.com")) {
      return Response.json({
        ldhName: "EXAMPLE.COM",
        status: ["client delete prohibited"],
        events: [
          { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
          { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
        ],
        nameservers: [{ ldhName: "A.IANA-SERVERS.NET" }],
      });
    }
    if (url.includes("tinyurl.com/api-create.php")) {
      return new Response("https://tinyurl.com/minjitest", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  };

  const svc = new PublicInfoService(mockFetch as never);

  const gempa = await svc.getInfoGempa();
  assert.equal(gempa.magnitude, "5.2");

  const cuaca = await svc.getInfoCuaca("Jakarta");
  assert.equal(cuaca.condition, "Berawan Sebagian");
  assert.equal(cuaca.temperatureC, 31.2);

  const dist = await svc.calculateCityDistance("Jakarta", "Surabaya");
  assert.ok(dist.distanceKm > 640 && dist.distanceKm < 690);

  const wiki = await svc.getWikipediaSummary("majapahit");
  assert.equal(wiki.title, "Majapahit");

  const tr = await svc.translateText("en", "Halo dunia");
  assert.equal(tr, "Hello world");

  const kbbi = await svc.getKbbiDefinition("merdeka");
  assert.match(kbbi, /bebas dari penjajahan/);

  const gh = await svc.getGithubProfile("torvalds");
  assert.equal(gh.name, "Linus Torvalds");

  const npm = await svc.searchNpmPackages("sharp");
  assert.equal(npm[0]?.name, "sharp");

  const whois = await svc.getWhoisDomain("example.com");
  assert.equal(whois.domain, "EXAMPLE.COM");
  assert.equal(whois.createdAt, "1995-08-14");

  // SSRF protection on tinyurl
  await assert.rejects(() => svc.shortenUrl("http://127.0.0.1:8080/secret"), /tidak diizinkan|privat/i);

  // Nominatim fallback when Open-Meteo geocoding times out
  const fallbackSvc = new PublicInfoService((async (url: string) => {
    if (url.includes("geocoding-api.open-meteo.com")) {
      throw new Error("ETIMEDOUT");
    }
    if (url.includes("nominatim.openstreetmap.org")) {
      return Response.json([
        { display_name: "Bandung, Jawa Barat, Indonesia", lat: "-6.9175", lon: "107.6191" },
      ]);
    }
    if (url.includes("api.open-meteo.com")) {
      return Response.json({
        timezone: "Asia/Jakarta",
        current: { temperature_2m: 24.5, apparent_temperature: 25, relative_humidity_2m: 80, wind_speed_10m: 8, weather_code: 1 },
      });
    }
    return new Response("Not Found", { status: 404 });
  }) as never);
  const bdgCuaca = await fallbackSvc.getInfoCuaca("Bandung");
  assert.equal(bdgCuaca.temperatureC, 24.5);
  assert.match(bdgCuaca.cityName, /Bandung/);
});

test("Extra Downloaders - domain allowlist, GitHub repo parser, and 300 MB friendly cap", async () => {
  assert.ok(parseAllowedDownloaderUrl("https://fb.watch/abc123/", "facebook") !== null);
  assert.ok(parseAllowedDownloaderUrl("https://www.threads.net/@user/post/xyz", "threads") !== null);
  assert.ok(parseAllowedDownloaderUrl("https://github.com/octocat/Hello-World", "github") !== null);
  assert.equal(parseAllowedDownloaderUrl("https://evil-facebook.com/x", "facebook"), null);

  assert.deepEqual(parseGithubRepoUrl("https://github.com/octocat/Hello-World.git"), {
    owner: "octocat",
    repo: "Hello-World",
    branch: undefined,
  });
  assert.deepEqual(parseGithubRepoUrl("https://github.com/octocat/Hello-World/tree/dev"), {
    owner: "octocat",
    repo: "Hello-World",
    branch: "dev",
  });

  // Repo over MAX_DOWNLOAD_FILE_MB rejected with natural non-technical message before zipball download
  const oversizedFetch = async (url: string) => {
    if (url.includes("api.github.com/repos/big/repo")) {
      return Response.json({
        full_name: "big/repo",
        default_branch: "main",
        size: (env.MAX_DOWNLOAD_FILE_MB + 50) * 1024,
      });
    }
    throw new Error("Should not attempt zip download");
  };

  await assert.rejects(
    () => executeGitCloneDownload("https://github.com/big/repo", oversizedFetch as never),
    new RegExp(`terlalu besar \\(lebih dari ${String(env.MAX_DOWNLOAD_FILE_MB)} MB\\)`),
  );

  // Small repo succeeds
  const smallZipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const okFetch = async (url: string) => {
    if (url.endsWith("/repos/octocat/Hello-World")) {
      return Response.json({ full_name: "octocat/Hello-World", default_branch: "main", size: 50 });
    }
    return new Response(smallZipBytes, {
      status: 200,
      headers: { "content-length": String(smallZipBytes.byteLength) },
    });
  };

  const cloned = await executeGitCloneDownload("https://github.com/octocat/Hello-World", okFetch as never);
  assert.equal(cloned.repoFullName, "octocat/Hello-World");
  assert.equal(cloned.fileName, "octocat-Hello-World-main.zip");
  assert.equal(cloned.buffer.byteLength, 8);
});
