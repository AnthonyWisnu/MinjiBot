import assert from "node:assert/strict";
import test from "node:test";
import type { GroupNote } from "@prisma/client";
import webp from "node-webpmux";
import sharp from "sharp";

import { commandRouter } from "../src/commands";
import { AppUserError } from "../src/errors/appUserError";
import { GroupToolsService } from "../src/services/group/groupTools.service";
import {
  createTtpSticker,
  evaluateSafeMathExpression,
  generateQrCodePng,
} from "../src/services/media/localTools.service";
import {
  DEFAULT_STICKER_AUTHOR,
  DEFAULT_STICKER_PACK,
} from "../src/services/media/sticker/stickerExif";
import { MenuService } from "../src/services/menu/menu.service";
import { buildCommandContext, buildTenantFeatureSetting, buildTenantGroup } from "./helpers/factories";

void test("GroupToolsService: attendance, voting, and persistent group notes work end-to-end", async () => {
  const noteMap = new Map<string, GroupNote>();
  const tools = new GroupToolsService({
    findByTitle: (g, title) => Promise.resolve(noteMap.get(`${g}:${title.trim().toLowerCase()}`) ?? null),
    listByGroup: (g) =>
      Promise.resolve([...noteMap.values()].filter((n) => n.groupJid === g)),
    countByGroup: (g) =>
      Promise.resolve([...noteMap.values()].filter((n) => n.groupJid === g).length),
    upsert: (groupJid, title, content, createdBy) => {
      const note: GroupNote = {
        id: `note_${title}`,
        groupJid,
        title,
        content,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      noteMap.set(`${groupJid}:${title}`, note);
      return Promise.resolve(note);
    },
    deleteByTitle: (g, title) =>
      Promise.resolve(noteMap.delete(`${g}:${title.trim().toLowerCase()}`)),
  });

  // Attendance
  tools.startAttendance("120@g.us", "628111@s.whatsapp.net", "Rapat Malam");
  const m1 = tools.markAttendance("120@g.us", "628222@s.whatsapp.net");
  assert.equal(m1.alreadyPresent, false);
  const m2 = tools.markAttendance("120@g.us", "628222@s.whatsapp.net");
  assert.equal(m2.alreadyPresent, true);
  assert.equal(tools.getAttendance("120@g.us").entries.length, 1);

  assert.throws(
    () => tools.deleteAttendance("120@g.us", "628333@s.whatsapp.net", false),
    AppUserError,
  );
  tools.deleteAttendance("120@g.us", "628111@s.whatsapp.net", false);

  // Voting
  tools.startVote("120@g.us", "628111@s.whatsapp.net", "Ganti foto grup?");
  tools.castVote("120@g.us", "628222@s.whatsapp.net", "up");
  tools.castVote("120@g.us", "628222@s.whatsapp.net", "down"); // switch vote
  const vote = tools.getVote("120@g.us");
  assert.equal(vote.upvoters.size, 0);
  assert.equal(vote.downvoters.size, 1);
  tools.deleteVote("120@g.us", "628999@s.whatsapp.net", true);

  // Notes
  const saved = await tools.saveNote("120@g.us", "Aturan", "Jangan spam!", "628111@s.whatsapp.net");
  assert.equal(saved.title, "aturan");
  const fetched = await tools.getNote("120@g.us", "ATURAN");
  assert.equal(fetched.content, "Jangan spam!");
  assert.equal((await tools.listNotes("120@g.us")).length, 1);

  await assert.rejects(
    () => tools.deleteNote("120@g.us", "aturan", "628333@s.whatsapp.net", false),
    AppUserError,
  );
  await tools.deleteNote("120@g.us", "aturan", "628111@s.whatsapp.net", false);
  assert.equal((await tools.listNotes("120@g.us")).length, 0);
});

void test("Local creative tools: QR PNG, TTP WebP sticker with EXIF, and safe math parser", async () => {
  const qrPng = await generateQrCodePng("https://github.com/AnthonyWisnu/MinjiBot");
  const qrMeta = await sharp(qrPng).metadata();
  assert.equal(qrMeta.format, "png");
  assert.equal(qrMeta.width, 512);
  assert.equal(qrMeta.height, 512);

  const ttpWebp = await createTtpSticker("MinjiBot Keren Banget");
  const ttpMeta = await sharp(ttpWebp).metadata();
  assert.equal(ttpMeta.format, "webp");
  assert.equal(ttpMeta.width, 512);
  const img = new webp.Image();
  await img.load(ttpWebp);
  assert.ok(img.exif);
  const exifText = img.exif.toString("utf8");
  assert.ok(exifText.includes(DEFAULT_STICKER_PACK));
  assert.ok(exifText.includes(DEFAULT_STICKER_AUTHOR));

  assert.equal(evaluateSafeMathExpression("(10 + 5) * 2 - 4"), 26);
  assert.equal(evaluateSafeMathExpression("sqrt(144) + 2^3"), 20);
  assert.equal(evaluateSafeMathExpression("100 : 4 x 2"), 50);
  assert.throws(() => evaluateSafeMathExpression("10 / 0"), AppUserError);
  assert.throws(() => evaluateSafeMathExpression("process.exit(1)"), AppUserError);
});

void test("MenuService sub-menus (.menu rpg, game, fun, media, grup) render cleanly", async () => {
  const menu = new MenuService({
    findByGroupJid: () => Promise.resolve(buildTenantFeatureSetting()),
  } as never);

  const tenantGroup = buildTenantGroup();
  for (const sub of ["rpg", "game", "fun", "media", "grup"]) {
    const out = await menu.buildMenu(
      buildCommandContext({
        isGroup: true,
        tenantGroup,
        commandName: "menu",
        args: [sub],
      }),
    );
    assert.match(out, /SUB-MENU/);
  }
});

void test("Phase 4 commands and extra audio FX are registered in commandRouter", () => {
  for (const cmd of [
    "mulaiabsen",
    "absen",
    "cekabsen",
    "hapusabsen",
    "mulaivote",
    "upvote",
    "devote",
    "cekvote",
    "hapusvote",
    "poll",
    "buatcatatan",
    "lihatcatatan",
    "listcatatan",
    "hapuscatatan",
    "infogrup",
    "listadmin",
    "tagme",
    "link",
    "getpp",
    "qr",
    "calc",
    "kalkulator",
    "ttp",
    "robot",
    "reverse",
    "fast",
    "deep",
    "earrape",
    "smooth",
    "tomp3",
  ]) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }
});
