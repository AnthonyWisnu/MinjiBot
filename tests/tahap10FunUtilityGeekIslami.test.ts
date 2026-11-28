import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { commandRouter } from "../src/commands";
import {
  LOCAL_FUN_BANKS,
  localFunBankService,
  type LocalFunCategory,
} from "../src/services/fun/localFunBank.service";
import { GeekNetworkService } from "../src/services/info/geekNetwork.service";
import { islamiLocalService } from "../src/services/islami/islamiLocal.service";
import {
  DailyUtilityService,
  parseDateDmy,
  parseRssItems,
} from "../src/services/tools/dailyUtility.service";

void test("Tahap 10: all 58 new commands and aliases are registered in commandRouter", () => {
  const cmds = [
    // 15 local fun
    "pantun",
    "gombal",
    "jokes",
    "receh",
    "faktaunik",
    "quotes",
    "motivasi",
    "bucin",
    "galau",
    "bijak",
    "sindir",
    "katakata",
    "bacot",
    "darkjokes",
    "tebakreceh",
    "pickup",
    // 6 islami local
    "doaharian",
    "doa",
    "niatshalat",
    "niat",
    "dzikir",
    "zikir",
    "hadits",
    "hadis",
    "kisahnabi",
    "kalenderhijriah",
    "hijriah",
    // 29 daily utilities
    "kurs",
    "berita",
    "news",
    "kamusen",
    "dict",
    "hitungumur",
    "umur",
    "bmi",
    "diskon",
    "splitbill",
    "random",
    "acak",
    "pilih",
    "acakurutan",
    "tim",
    "bagitim",
    "countdown",
    "jamdunia",
    "konversi",
    "hitungkata",
    "balik",
    "kapital",
    "kecil",
    "mock",
    "morse",
    "unmorse",
    "biner",
    "unbiner",
    "base64enc",
    "base64dec",
    "hash",
    "passgen",
    "uuid",
    "color",
    "warna",
    // 8 geek & network
    "anime",
    "manga",
    "karakter",
    "character",
    "pokemon",
    "gamegratis",
    "freegame",
    "anjing",
    "dog",
    "httpcat",
    "cekip",
    "ipinfo",
  ];
  for (const c of cmds) {
    assert.equal(commandRouter.has(c), true, `Command .${c} harus terdaftar`);
  }
});

void test("Tahap 10: all 15 LocalFunBank categories have >= 15 entries and pick cleanly", () => {
  const keys = Object.keys(LOCAL_FUN_BANKS) as LocalFunCategory[];
  assert.equal(keys.length, 15);
  for (const key of keys) {
    assert.ok(LOCAL_FUN_BANKS[key].entries.length >= 15);
    const picked = localFunBankService.pickRandom(key, 0);
    assert.ok(picked.title.length > 0);
    assert.ok(picked.text.length > 5);
  }
});

void test("Tahap 10: IslamiLocalService handles doa, niat, dzikir, hadits, kisah nabi, and Hijriah", () => {
  const doa = islamiLocalService.getDoa("tidur");
  assert.equal(doa.mode, "single");
  assert.match(doa.item?.title ?? "", /Tidur/);

  const niat = islamiLocalService.getNiatShalat("subuh");
  assert.equal(niat.mode, "single");
  assert.equal(niat.item?.rakaat, "2 Rakaat");

  assert.ok(islamiLocalService.getDzikir().length >= 5);
  assert.equal(islamiLocalService.getHadits("1").topic, "Niat");

  const kisah = islamiLocalService.getKisahNabi("yusuf");
  assert.equal(kisah.mode, "single");
  assert.match(kisah.item?.name ?? "", /Yusuf/);

  const hijri = islamiLocalService.getHijriDate(new Date("2026-11-28T05:00:00.000Z"));
  assert.match(hijri.hijriLabel, /H$/);
  assert.ok(hijri.gregorianLabel.includes("2026"));
});

void test("Tahap 10: DailyUtilityService pure calculators, encoders, RSS parser, and Sharp color preview", async () => {
  const svc = new DailyUtilityService();

  // Date & Age
  const birth = parseDateDmy("17-08-2000");
  assert.ok(birth);
  const age = svc.calculateAge(birth, new Date("2026-11-28T05:00:00.000Z"));
  assert.equal(age.years, 26);
  assert.equal(age.months, 3);

  // BMI
  const bmi = svc.calculateBmi(65, 170);
  assert.equal(bmi.category, "Normal (Ideal)");

  // Unit conversion
  assert.equal(Math.round(svc.convertUnit(100, "c", "f").result), 212);
  assert.equal(svc.convertUnit(2, "km", "m").result, 2000);
  assert.equal(svc.convertUnit(2, "gb", "mb").result, 2048);

  // Morse & Binary
  const morse = svc.encodeMorse("SOS");
  assert.equal(morse, "... --- ...");
  assert.equal(svc.decodeMorse(morse), "SOS");

  const bin = svc.encodeBinary("Hi");
  assert.equal(bin, "01001000 01101001");
  assert.equal(svc.decodeBinary(bin), "Hi");

  // Hash, Password, UUID
  assert.equal(svc.hashText("sha256", "minji").digest.length, 64);
  assert.equal(svc.generatePassword(20).length, 20);
  assert.match(svc.generateUuid(), /^[0-9a-f-]{36}$/i);

  // RSS parser
  const articles = parseRssItems(
    `<rss><channel><item><title><![CDATA[Berita Uji Minji]]></title><link>https://example.com/1</link><pubDate>Sat, 28 Nov 2026</pubDate></item></channel></rss>`,
  );
  assert.equal(articles.length, 1);
  assert.equal(articles[0]?.title, "Berita Uji Minji");

  // Sharp Color Preview PNG
  const color = await svc.renderColorPreview("#38BDF8");
  assert.equal(color.hex, "#38BDF8");
  assert.equal(color.r, 56);
  const meta = await sharp(color.pngBuffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 320);
});

void test("Tahap 10: DailyUtilityService currency & dict mocked APIs + GeekNetworkService SSRF guard", async () => {
  const mockUtilFetch = (async (url: string) => {
    if (url.includes("frankfurter")) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ date: "2026-11-28", rates: { IDR: 16000 } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            word: "serendipity",
            phonetic: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/",
            meanings: [
              {
                partOfSpeech: "noun",
                definitions: [{ definition: "A fortunate accidental discovery." }],
                synonyms: ["luck"],
              },
            ],
          },
        ]),
    };
  }) as unknown as typeof fetch;

  const util = new DailyUtilityService(mockUtilFetch);
  const kurs = await util.convertCurrency(10, "USD", "IDR");
  assert.equal(kurs.converted, 160_000);

  const dict = await util.lookupEnglishWord("serendipity");
  assert.equal(dict.word, "serendipity");
  assert.equal(dict.meanings[0]?.partOfSpeech, "noun");

  // GeekNetworkService SSRF & public IP lookup test
  const mockGeekFetch = (async () => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success: true,
        ip: "8.8.8.8",
        country: "United States",
        region: "California",
        city: "Mountain View",
        connection: { asn: 15169, org: "Google LLC", isp: "Google LLC" },
        timezone: { id: "America/Los_Angeles", utc: "-08:00" },
      }),
  })) as unknown as typeof fetch;

  const geek = new GeekNetworkService(mockGeekFetch, async (host) =>
    Promise.resolve({ address: host === "internal.local" ? "127.0.0.1" : "8.8.8.8" }),
  );

  await assert.rejects(() => geek.lookupIpInfo("127.0.0.1"), /privat\/lokal/);
  await assert.rejects(() => geek.lookupIpInfo("192.168.1.1"), /privat\/lokal/);
  await assert.rejects(() => geek.lookupIpInfo("internal.local"), /lokal\/privat/);

  const ipRes = await geek.lookupIpInfo("8.8.8.8");
  assert.equal(ipRes.ip, "8.8.8.8");
  assert.equal(ipRes.isp, "Google LLC");
});
