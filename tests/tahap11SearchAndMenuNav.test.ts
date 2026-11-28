import assert from "node:assert/strict";
import test from "node:test";
import { TenantStatus } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { featureSearchService } from "../src/services/menu/featureSearch.service";
import { MenuService } from "../src/services/menu/menu.service";
import { buildCommandContext, buildTenantFeatureSetting, buildTenantGroup } from "./helpers/factories";

void test("Tahap 11: .carifitur and aliases are registered and listCommandEntries exposes 430+ unique commands", () => {
  for (const name of ["carifitur", "searchcmd", "cari", "findcmd"]) {
    assert.equal(commandRouter.has(name), true, `Command .${name} harus terdaftar`);
  }

  const entries = commandRouter.listCommandEntries();
  const totalWithAliases = entries.reduce((sum, e) => sum + 1 + e.aliases.length, 0);
  assert.ok(entries.length >= 430, `Expected >= 430 unique commands, got ${String(entries.length)}`);
  assert.ok(
    totalWithAliases >= 600,
    `Expected >= 600 total commands with aliases, got ${String(totalWithAliases)}`,
  );
});

void test("Tahap 11: FeatureSearchService matches exact commands, aliases, and Indonesian synonyms", () => {
  const entries = commandRouter.listCommandEntries();

  // Exact match
  const sahamRes = featureSearchService.search("saham", entries);
  assert.ok(sahamRes.matches.length >= 3);
  assert.equal(sahamRes.matches[0]?.primaryCommand, "saham");

  // Alias match (.bj -> .blackjack, .tldr -> .ringkas)
  const bjRes = featureSearchService.search("bj", entries);
  assert.ok(bjRes.matches.some((m) => m.primaryCommand === "blackjack"));

  const tldrRes = featureSearchService.search("tldr", entries);
  assert.ok(tldrRes.matches.some((m) => m.primaryCommand === "ringkas"));

  // Synonym match ("download" -> .tt/.ig/.yt, "stiker" -> .s/.brat, "islam" -> .alquran/.doaharian)
  const dlRes = featureSearchService.search("download", entries);
  assert.ok(dlRes.matches.some((m) => m.primaryCommand === "tt"));
  assert.ok(dlRes.matches.some((m) => m.primaryCommand === "yt"));

  const stikerRes = featureSearchService.search("stiker", entries);
  assert.ok(stikerRes.matches.some((m) => m.primaryCommand === "s"));
  assert.ok(stikerRes.matches.some((m) => m.primaryCommand === "brat"));

  const islamRes = featureSearchService.search("islam", entries);
  assert.ok(islamRes.matches.some((m) => m.primaryCommand === "alquran"));
  assert.ok(islamRes.matches.some((m) => m.primaryCommand === "doaharian"));

  // Empty & unmatched queries
  const emptyRes = featureSearchService.search("", entries);
  assert.equal(emptyRes.matches.length, 0);
  assert.ok(emptyRes.totalCatalogItems >= 370);

  const nopeRes = featureSearchService.search("xyznotacommand999", entries);
  assert.equal(nopeRes.matches.length, 0);
});

void test("Tahap 11: .carifitur command replies cleanly for empty, matching, and missing queries", async () => {
  const replies: string[] = [];
  const reply = (text: string) => {
    replies.push(text);
    return Promise.resolve();
  };

  await commandRouter.handle(
    buildCommandContext({ commandName: "carifitur", args: [], argsText: "", reply }),
  );
  await commandRouter.handle(
    buildCommandContext({ commandName: "cari", args: ["anime"], argsText: "anime", reply }),
  );
  await commandRouter.handle(
    buildCommandContext({
      commandName: "searchcmd",
      args: ["zzz999"],
      argsText: "zzz999",
      reply,
    }),
  );

  assert.equal(replies.length, 3);
  assert.match(replies[0] ?? "", /CARI FITUR MINJI/);
  assert.match(replies[1] ?? "", /\.anime/);
  assert.match(replies[2] ?? "", /tidak ditemukan/);
});

void test("Tahap 11: all sub-menus including anime, util, bisnis, and all render with headers <= 28 chars", async () => {
  const menu = new MenuService({
    findByGroupJid: () => Promise.resolve(buildTenantFeatureSetting()),
  } as never);
  const tenantGroup = buildTenantGroup({ status: TenantStatus.ACTIVE });

  const subMenus = [
    "ai",
    "rpg",
    "bisnis",
    "game",
    "kasino",
    "sosial",
    "fun",
    "anime",
    "media",
    "util",
    "islami",
    "info",
    "grup",
    "all",
  ];

  for (const sub of subMenus) {
    const out = await menu.buildMenu(
      buildCommandContext({
        isGroup: true,
        tenantGroup,
        commandName: "menu",
        args: [sub],
      }),
    );

    const headerLines = out
      .split("\n")
      .filter((line) => line.startsWith("*── [") && line.endsWith("] ──*"));
    assert.ok(headerLines.length >= 2, `Sub-menu ${sub} harus punya header`);
    for (const hdr of headerLines) {
      assert.ok(
        hdr.length <= 28,
        `Header di sub-menu ${sub} melebihi 28 karakter (${String(hdr.length)}): ${hdr}`,
      );
    }

    if (sub === "anime") {
      assert.match(out, /\.anime <judul>/);
      assert.match(out, /\.peluk \[@user\]/);
    } else if (sub === "util") {
      assert.match(out, /\.kurs <jml>/);
      assert.match(out, /\.color <#hex>/);
    } else if (sub === "bisnis") {
      assert.match(out, /\.saham/);
      assert.match(out, /\.gachakartu/);
    } else if (sub === "all") {
      assert.match(out, /MINJIBOT MENU/);
      assert.match(out, /\.carifitur <kata>/);
    }
  }
});
