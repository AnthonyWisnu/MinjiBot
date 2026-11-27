import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import { commandRouter } from "../src/commands";
import { AppUserError } from "../src/errors/appUserError";
import { CoupleService } from "../src/services/fun/couple.service";
import { KerangAjaibService } from "../src/services/fun/kerangAjaib.service";
import { GroupStatusService } from "../src/services/media/groupStatus.service";
import { buildMemberProfile } from "./helpers/factories";

void test("GroupStatusService: wraps content in groupStatusMessageV2, relays, and enforces cooldown", async () => {
  const relayed: { jid: string; msg: unknown }[] = [];
  const service = new GroupStatusService({
    buildContent: (content) =>
      Promise.resolve({ extendedTextMessage: { text: (content as { text?: string }).text ?? "" } }),
    buildFromContent: (jid, message) => ({
      key: { remoteJid: jid, fromMe: true, id: "SW-MSG-1" },
      message,
    }),
  });

  const mockSocket = {
    user: { id: "628000@s.whatsapp.net" },
    waUploadToServer: () => Promise.resolve({}),
    relayMessage: (jid: string, msg: unknown) => {
      relayed.push({ jid, msg });
      return Promise.resolve("SW-MSG-1");
    },
    sendMessage: () => Promise.resolve({}),
  } as unknown as WASocket;

  const now = 1_700_000_000_000;
  const id = await service.postGroupStatus(
    {
      socket: mockSocket,
      groupJid: "120@g.us",
      senderUserJid: "628111@s.whatsapp.net",
      content: { text: "Halo grup!" },
    },
    now,
  );

  assert.equal(id, "SW-MSG-1");
  assert.equal(relayed.length, 1);
  const firstRelayed = relayed[0];
  assert.ok(firstRelayed);
  assert.equal(firstRelayed.jid, "120@g.us");
  const wrapped = firstRelayed.msg as { groupStatusMessageV2?: { message?: unknown } };
  assert.ok(wrapped.groupStatusMessageV2?.message);

  // Cooldown active within 30s
  await assert.rejects(
    () =>
      service.postGroupStatus(
        {
          socket: mockSocket,
          groupJid: "120@g.us",
          senderUserJid: "628111@s.whatsapp.net",
          content: { text: "Spam!" },
        },
        now + 5_000,
      ),
    AppUserError,
  );

  // Super owner bypasses cooldown
  const id2 = await service.postGroupStatus(
    {
      socket: mockSocket,
      groupJid: "120@g.us",
      senderUserJid: "628999@s.whatsapp.net",
      content: { text: "Owner status" },
      bypassCooldown: true,
    },
    now + 6_000,
  );
  assert.equal(id2, "SW-MSG-1");
});

void test("KerangAjaibService: deterministic daily checks, khodam, fun transforms, and truth/dare", () => {
  const service = new KerangAjaibService();
  const day = new Date("2026-11-28T05:00:00Z");

  const c1 = service.runPercentageCheck("hoki", "628111@s.whatsapp.net", "@628111", day);
  const c2 = service.runPercentageCheck("hoki", "628111@s.whatsapp.net", "@628111", day);
  assert.equal(c1.percentage, c2.percentage);
  assert.ok(c1.percentage >= 0 && c1.percentage <= 100);

  const k1 = service.checkKhodam("628111@s.whatsapp.net", "@628111", day);
  const k2 = service.checkKhodam("628111@s.whatsapp.net", "@628111", day);
  assert.equal(k1.khodam.name, k2.khodam.name);

  assert.equal(service.replaceVowels("Halo Semua", "i"), "Hili Simii");
  assert.equal(service.toNinjaName("andi"), "Katoteki");
  assert.ok(service.buildReadMore("Atas", "Bawah").length > 4000);
  assert.match(service.toAlay("minjibot"), /[0-9]/);
  assert.match(service.getRandomTruth(), /TRUTH/);
  assert.match(service.getRandomDare(), /DARE/);
  assert.match(service.analyzeName("Minji"), /ARTI NAMA/);
});

void test("CoupleService: propose, accept, checkPartner, breakUp, and pickRandomMatch", async () => {
  const store = new Map<string, GroupMemberProfile>([
    ["120@g.us:628111@s.whatsapp.net", buildMemberProfile({ id: "p1", userJid: "628111@s.whatsapp.net" })],
    ["120@g.us:628222@s.whatsapp.net", buildMemberProfile({ id: "p2", userJid: "628222@s.whatsapp.net" })],
  ]);

  const service = new CoupleService(
    {
      findOrCreate: (g, u) => Promise.resolve({ ...(store.get(`${g}:${u}`) ?? buildMemberProfile({ id: u, userJid: u })) }),
      findByGroupAndUser: (g, u) => {
        const found = store.get(`${g}:${u}`);
        return Promise.resolve(found ? { ...found } : null);
      },
    },
    {
      $transaction: <T>(fn: (tx: never) => Promise<T>) =>
        fn({
          groupMemberProfile: {
            update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
              for (const [k, v] of store.entries()) {
                if (v.id === args.where.id) {
                  const next: GroupMemberProfile = {
                    ...v,
                    partnerJid: "partnerJid" in args.data ? (args.data.partnerJid as string | null) : v.partnerJid,
                    partnerSince:
                      "partnerSince" in args.data ? (args.data.partnerSince as Date | null) : v.partnerSince,
                  };
                  store.set(k, next);
                  return Promise.resolve({ ...next });
                }
              }
              throw new Error("missing profile");
            },
          },
        } as never),
    },
  );

  await service.propose("120@g.us", "628111@s.whatsapp.net", "628222@s.whatsapp.net");
  const accepted = await service.acceptProposal("120@g.us", "628222@s.whatsapp.net");
  assert.equal(accepted.proposerJid, "628111@s.whatsapp.net");
  assert.equal(accepted.bonusMoney, 2_500_000n);

  const status = await service.checkPartner("120@g.us", "628111@s.whatsapp.net");
  assert.equal(status.partnerJid, "628222@s.whatsapp.net");

  const broken = await service.breakUp("120@g.us", "628111@s.whatsapp.net");
  assert.equal(broken.exPartnerJid, "628222@s.whatsapp.net");

  const after = await service.checkPartner("120@g.us", "628222@s.whatsapp.net");
  assert.equal(after.partnerJid, null);

  const match = service.pickRandomMatch(["628111@s.whatsapp.net", "628222@s.whatsapp.net"]);
  assert.notEqual(match.firstJid, match.secondJid);
  assert.ok(match.compatibility >= 50 && match.compatibility <= 100);
});

void test("Phase 3 commands are registered in commandRouter", () => {
  for (const cmd of [
    "sw",
    "swgc",
    "upsw",
    "apakah",
    "kapankah",
    "rate",
    "cekkhodam",
    "cekganteng",
    "cekcantik",
    "cekbucin",
    "cekwibu",
    "cekhoki",
    "ceksultan",
    "tembak",
    "terima",
    "tolak",
    "cekpacar",
    "putus",
    "jodoh",
    "truth",
    "dare",
    "alay",
    "hilih",
    "namaninja",
    "readmore",
    "artinama",
  ]) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }
});
