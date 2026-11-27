import assert from "node:assert/strict";
import test from "node:test";
import { TenantStatus, type GroupMemberProfile, type GroupStickerCommand } from "@prisma/client";
import type { WAMessage } from "@whiskeysockets/baileys";

import { parseSyntheticCommandMessage } from "../src/bot/messageParser";
import { commandRouter } from "../src/commands";
import { MenfessService, MENFESS_COOLDOWN_MS } from "../src/services/fun/menfess.service";
import {
  TeamWarService,
  WAR_VICTORY_BONUS_PER_WINNER,
} from "../src/services/game/teamWar.service";
import {
  assignWerewolfRoles,
  WEREWOLF_TTL_MS,
  WEREWOLF_WIN_MONEY,
  WerewolfService,
} from "../src/services/game/werewolf.service";
import {
  CustomStickerCommandService,
  extractStickerFileSha256,
  MAX_STICKER_COMMANDS_PER_GROUP,
} from "../src/services/group/customStickerCommand.service";
import { buildMemberProfile, buildMockSocket, buildTenantGroup } from "./helpers/factories";

test("Tahap 3 - all new commands are registered in commandRouter", () => {
  const expected = [
    "werewolf",
    "ww",
    "war",
    "attack",
    "menfess",
    "confess",
    "setcmd",
    "delcmd",
    "listcmd",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});

test("WerewolfService - full lifecycle night actions, guardian save, day vote, and warga win", async () => {
  const moneyCredits: { userJid: string; amount: bigint }[] = [];
  const xpCredits: { userJid: string; amount: number }[] = [];
  const pointCredits: { userJid: string; amount: number }[] = [];

  const mockEconomy = {
    creditMoney: async (input: { userJid: string; amount: bigint }) => {
      moneyCredits.push({ userJid: input.userJid, amount: input.amount });
      return Promise.resolve();
    },
    creditPoints: async (input: { userJid: string; amount: number }) => {
      pointCredits.push({ userJid: input.userJid, amount: input.amount });
      return Promise.resolve();
    },
    creditXp: async (input: { userJid: string; amount: number }) => {
      xpCredits.push({ userJid: input.userJid, amount: input.amount });
      return Promise.resolve();
    },
  };

  // Identity shuffle: slot 1 = werewolf, slot 2 = seer, slot 3 = guardian, slot 4 = warga
  const svc = new WerewolfService(mockEconomy, (arr) => [...arr]);
  const groupJid = "120363000001@g.us";
  const p1 = "628100000001@s.whatsapp.net";
  const p2 = "628100000002@s.whatsapp.net";
  const p3 = "628100000003@s.whatsapp.net";
  const p4 = "628100000004@s.whatsapp.net";

  const now = 1_700_000_000_000;
  svc.createLobby(groupJid, p1, now);
  svc.joinLobby(groupJid, p2, now);
  svc.joinLobby(groupJid, p3, now);

  assert.throws(() => svc.startGame(groupJid, p1, now), /Minimal butuh 4 pemain/);

  svc.joinLobby(groupJid, p4, now);
  const started = svc.startGame(groupJid, p1, now);
  assert.equal(started.session.phase, "night");
  assert.equal(started.dmPayloads.length, 4);
  assert.equal(started.session.players[0]?.role, "werewolf");
  assert.equal(started.session.players[1]?.role, "seer");
  assert.equal(started.session.players[2]?.role, "guardian");
  assert.equal(started.session.players[3]?.role, "warga");

  // Night 1: Werewolf targets #4, Guardian protects #4, Seer checks #1 (wolf)
  const wolfAct = await svc.performNightAction([p1], "bunuh", 4, now + 1000);
  assert.equal(wolfAct.autoResolvedDay, null);

  const guardAct = await svc.performNightAction([p3], "lindungi", 4, now + 2000);
  assert.equal(guardAct.autoResolvedDay, null);

  const seerAct = await svc.performNightAction([p2], "terawang", 1, now + 3000);
  assert.match(seerAct.dmReply, /WEREWOLF/i);
  assert.ok(seerAct.autoResolvedDay !== null);
  assert.equal(seerAct.autoResolvedDay.savedByGuardian, true);
  assert.equal(seerAct.autoResolvedDay.killedPlayer, null);
  assert.equal(seerAct.autoResolvedDay.winner, null);

  // Day 1: Everyone votes out #1 (werewolf)
  await svc.castDayVote(groupJid, p2, 1, now + 4000);
  await svc.castDayVote(groupJid, p3, 1, now + 5000);
  await svc.castDayVote(groupJid, p4, 1, now + 6000);
  const finalVote = await svc.castDayVote(groupJid, p1, 2, now + 7000);

  assert.ok(finalVote.autoResolved !== null);
  assert.equal(finalVote.autoResolved.eliminatedPlayer?.slot, 1);
  assert.equal(finalVote.autoResolved.winner?.winningTeam, "warga");
  assert.equal(finalVote.autoResolved.winner.winners.length, 3);
  assert.equal(svc.getSession(groupJid, now + 8000), null);

  // Sultan reward credits for 3 winning villagers
  assert.equal(moneyCredits.length, 3);
  assert.equal(moneyCredits[0]?.amount, WEREWOLF_WIN_MONEY);
  assert.equal(pointCredits.length, 3);
  assert.equal(xpCredits.length, 4); // 3 winners + 1 loser participation XP
});

test("WerewolfService - role scaling & 20m TTL expiry", () => {
  assert.equal(assignWerewolfRoles(4).filter((r) => r === "werewolf").length, 1);
  assert.equal(assignWerewolfRoles(6).filter((r) => r === "werewolf").length, 2);
  assert.equal(assignWerewolfRoles(9).filter((r) => r === "werewolf").length, 3);

  const svc = new WerewolfService();
  const t0 = 1_700_000_000_000;
  svc.createLobby("group-ttl@g.us", "628111@s.whatsapp.net", t0);
  assert.ok(svc.getSession("group-ttl@g.us", t0 + WEREWOLF_TTL_MS - 1) !== null);
  assert.equal(svc.getSession("group-ttl@g.us", t0 + WEREWOLF_TTL_MS), null);
});

test("TeamWarService - lobby, team join, attack cooldown, and atomic victory settlement", async () => {
  const groupJid = "120363000002@g.us";
  const a1 = "628200000001@s.whatsapp.net";
  const b1 = "628200000002@s.whatsapp.net";

  const profiles = new Map<string, GroupMemberProfile>([
    [
      a1,
      buildMemberProfile({
        id: "prof-a1",
        groupJid,
        userJid: a1,
        moneyBalance: 5_000_000n,
        rpgState: {
          tools: { sword: { level: 3, durability: 100 }, armor: { level: 1, durability: 100 } },
        } as unknown as GroupMemberProfile["rpgState"],
      }),
    ],
    [
      b1,
      buildMemberProfile({
        id: "prof-b1",
        groupJid,
        userJid: b1,
        moneyBalance: 5_000_000n,
      }),
    ],
  ]);

  const createdTxs: { userJid: string; amount: number | bigint; note?: string }[] = [];

  const mockProfileRepo = {
    findOrCreate: async (_g: string, userJid: string) => {
      const p = profiles.get(userJid);
      assert.ok(p, `Profile not found for ${userJid}`);
      return Promise.resolve(p);
    },
  };

  const mockTxRepo = {
    create: async (data: { userJid: string; amount: number | bigint; note?: string }) => {
      createdTxs.push({ userJid: data.userJid, amount: data.amount, note: data.note });
      return Promise.resolve();
    },
  };

  const mockDb = {
    $transaction: async <T>(
      fn: (tx: {
        groupMemberProfile: {
          update(args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }): Promise<GroupMemberProfile>;
        };
      }) => Promise<T>,
    ): Promise<T> => {
      return fn({
        groupMemberProfile: {
          update: async ({ where, data }) => {
            const prof = [...profiles.values()].find((p) => p.id === where.id);
            assert.ok(prof);
            const moneyOp = data.moneyBalance as { increment?: bigint; decrement?: bigint } | undefined;
            if (moneyOp?.increment) {
              prof.moneyBalance += moneyOp.increment;
            }
            if (moneyOp?.decrement) {
              prof.moneyBalance -= moneyOp.decrement;
            }
            return Promise.resolve(prof);
          },
        },
      });
    },
  };

  const fixedRandom = {
    intBetween: (_min: number, max: number) => max, // always 42 -> 42 + 3*4 = 54 dmg
    nextFloat: () => 0.5,
  };

  const war = new TeamWarService(mockProfileRepo, mockTxRepo, fixedRandom, mockDb);
  const t0 = 1_700_000_000_000;

  await war.createLobby(groupJid, a1, 2_000_000n, t0);
  assert.throws(() => war.startWar(groupJid, a1, t0), /Tim B/);

  await war.joinTeam(groupJid, b1, "b", t0 + 100);
  war.startWar(groupJid, a1, t0 + 200);

  // First attack deals 54 dmg (100 -> 46 HP)
  const hit1 = await war.attackEnemy(groupJid, a1, b1, t0 + 1_000);
  assert.equal(hit1.damage, 54);
  assert.equal(hit1.targetHpAfter, 46);
  assert.equal(hit1.winningTeam, null);

  // Cooldown 5s enforced
  await assert.rejects(
    () => war.attackEnemy(groupJid, a1, b1, t0 + 3_000),
    /Tunggu \*3 detik\*/,
  );

  // Second attack finishes b1 -> Team A wins!
  const hit2 = await war.attackEnemy(groupJid, a1, b1, t0 + 6_500);
  assert.equal(hit2.targetEliminated, true);
  assert.equal(hit2.winningTeam, "a");
  assert.equal(hit2.rewardPerWinner, 2_000_000n + WAR_VICTORY_BONUS_PER_WINNER);
  assert.equal(war.getSession(groupJid, t0 + 7_000), null);

  // Balances updated atomically
  assert.equal(profiles.get(b1)?.moneyBalance, 3_000_000n);
  assert.equal(profiles.get(a1)?.moneyBalance, 5_000_000n + 2_000_000n + WAR_VICTORY_BONUS_PER_WINNER);
  assert.equal(createdTxs.length, 2);
});

test("MenfessService - validates group membership, anti-link, cooldown, and hides sender", async () => {
  const activeGroup = buildTenantGroup({
    groupJid: "120363000003@g.us",
    tenantCode: "MINJI9",
    status: TenantStatus.ACTIVE,
    isBlocked: false,
  });
  const blockedGroup = buildTenantGroup({
    groupJid: "120363000004@g.us",
    tenantCode: "BLOKIR",
    status: TenantStatus.BLOCKED,
    isBlocked: true,
  });

  const svc = new MenfessService(
    {
      findByTenantCode: async (code) => {
        if (code === "MINJI9") return Promise.resolve(activeGroup);
        if (code === "BLOKIR") return Promise.resolve(blockedGroup);
        return Promise.resolve(null);
      },
    },
    {
      findByGroupAndUser: async () => Promise.resolve(null),
    },
  );

  const memberJid = "628300000001@s.whatsapp.net";
  const outsiderJid = "628399999999@s.whatsapp.net";
  const now = new Date(1_700_000_000_000);

  // Outsider blocked
  await assert.rejects(
    () =>
      svc.prepareGroupMenfess({
        senderCandidateJids: [outsiderJid],
        isSuperOwner: false,
        tenantCode: "MINJI9",
        rawMessage: "Halo semua!",
        resolveGroupParticipants: async () => Promise.resolve([memberJid]),
        now,
      }),
    /harus menjadi anggota aktif/,
  );

  // Links blocked
  await assert.rejects(
    () =>
      svc.prepareGroupMenfess({
        senderCandidateJids: [memberJid],
        isSuperOwner: false,
        tenantCode: "MINJI9",
        rawMessage: "Cek https://phishing.example.com guys",
        resolveGroupParticipants: async () => Promise.resolve([memberJid]),
        now,
      }),
    /dilarang mengandung tautan/i,
  );

  // Blocked tenant rejected
  await assert.rejects(
    () =>
      svc.prepareGroupMenfess({
        senderCandidateJids: [memberJid],
        isSuperOwner: false,
        tenantCode: "BLOKIR",
        rawMessage: "Tes menfess",
        resolveGroupParticipants: async () => Promise.resolve([memberJid]),
        now,
      }),
    /tidak aktif/i,
  );

  // Valid menfess succeeds with target mention and zero sender leak
  const plan = await svc.prepareGroupMenfess({
    senderCandidateJids: [memberJid],
    isSuperOwner: false,
    tenantCode: "minji9",
    rawMessage: "Semangat ujiannya ya!",
    targetPhoneDigits: "628555555555",
    resolveGroupParticipants: async () => Promise.resolve([memberJid]),
    now,
  });

  assert.equal(plan.tenantGroup.groupJid, activeGroup.groupJid);
  assert.deepEqual(plan.mentions, ["628555555555@s.whatsapp.net"]);
  assert.match(plan.formattedGroupCard, /Semangat ujiannya ya!/);
  assert.equal(plan.formattedGroupCard.includes("628300000001"), false);

  // Cooldown 5 minutes enforced
  svc.recordSent(memberJid, now.getTime());
  await assert.rejects(
    () =>
      svc.prepareGroupMenfess({
        senderCandidateJids: [memberJid],
        isSuperOwner: false,
        tenantCode: "MINJI9",
        rawMessage: "Kirim lagi ah",
        resolveGroupParticipants: async () => Promise.resolve([memberJid]),
        now: new Date(now.getTime() + MENFESS_COOLDOWN_MS - 10_000),
      }),
    /Tunggu/,
  );
});

test("CustomStickerCommandService + extractStickerFileSha256 + parseSyntheticCommandMessage", async () => {
  const rows = new Map<string, GroupStickerCommand>();
  const keyOf = (g: string, h: string) => `${g}::${h}`;
  let listCalls = 0;

  const svc = new CustomStickerCommandService({
    findByGroupAndHash: async (g, h) => Promise.resolve(rows.get(keyOf(g, h)) ?? null),
    listByGroup: async (g) => {
      listCalls += 1;
      return Promise.resolve([...rows.values()].filter((r) => r.groupJid === g));
    },
    countByGroup: async (g) =>
      Promise.resolve([...rows.values()].filter((r) => r.groupJid === g).length),
    upsert: async (groupJid, stickerHash, commandText, createdBy) => {
      const row: GroupStickerCommand = {
        id: `row-${String(rows.size + 1)}`,
        groupJid,
        stickerHash,
        commandText,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(keyOf(groupJid, stickerHash), row);
      return Promise.resolve(row);
    },
    deleteByGroupAndHash: async (g, h) => Promise.resolve(rows.delete(keyOf(g, h))),
  });

  const groupJid = "120363000005@g.us";
  const rawHashBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const extracted = extractStickerFileSha256({
    stickerMessage: { fileSha256: rawHashBytes },
  });
  assert.equal(extracted, Buffer.from(rawHashBytes).toString("base64"));
  assert.ok(extracted !== null);

  // Forbidden commands rejected
  await assert.rejects(
    () =>
      svc.setCommand({
        groupJid,
        stickerHash: extracted,
        rawCommandText: ".setcmd .menu",
        createdBy: "628111@s.whatsapp.net",
        isCommandRegistered: () => true,
      }),
    /tidak diizinkan/i,
  );

  // Unregistered commands rejected
  await assert.rejects(
    () =>
      svc.setCommand({
        groupJid,
        stickerHash: extracted,
        rawCommandText: ".tidakada",
        createdBy: "628111@s.whatsapp.net",
        isCommandRegistered: () => false,
      }),
    /tidak terdaftar/i,
  );

  // Valid command saved (auto-prefixed) and cached on lookup
  const saved = await svc.setCommand({
    groupJid,
    stickerHash: extracted,
    rawCommandText: "menu game",
    createdBy: "628111@s.whatsapp.net",
    isCommandRegistered: (c) => c === "menu",
  });
  assert.equal(saved.commandText, ".menu game");

  const resolved1 = await svc.resolveMappedCommand(groupJid, extracted, 1_000);
  const resolved2 = await svc.resolveMappedCommand(groupJid, extracted, 2_000);
  assert.equal(resolved1, ".menu game");
  assert.equal(resolved2, ".menu game");
  assert.equal(listCalls, 1, "Lookup kedua harus memakai cache grup");

  // Delete invalidates cache
  assert.equal(await svc.deleteCommand(groupJid, extracted), true);
  assert.equal(await svc.resolveMappedCommand(groupJid, extracted, 3_000), null);
  assert.equal(listCalls, 2);

  // Cap of MAX_STICKER_COMMANDS_PER_GROUP enforced
  for (let i = 0; i < MAX_STICKER_COMMANDS_PER_GROUP; i += 1) {
    await svc.setCommand({
      groupJid,
      stickerHash: `hash-${String(i)}`,
      rawCommandText: ".daily",
      createdBy: "628111@s.whatsapp.net",
      isCommandRegistered: () => true,
    });
  }
  await assert.rejects(
    () =>
      svc.setCommand({
        groupJid,
        stickerHash: "hash-overflow",
        rawCommandText: ".daily",
        createdBy: "628111@s.whatsapp.net",
        isCommandRegistered: () => true,
      }),
    /Batas maksimal/i,
  );

  // Synthetic message parser produces full CommandContext
  const { socket } = buildMockSocket();
  const stickerMsg = {
    key: {
      remoteJid: groupJid,
      participant: "628222222222@s.whatsapp.net",
      id: "stkr-1",
      fromMe: false,
    },
    message: {
      stickerMessage: { fileSha256: rawHashBytes },
    },
  } as unknown as WAMessage;

  const synthetic = parseSyntheticCommandMessage(socket, stickerMsg, ".menu game");
  assert.ok(synthetic !== null);
  assert.equal(synthetic.commandName, "menu");
  assert.deepEqual(synthetic.args, ["game"]);
  assert.equal(synthetic.argsText, "game");
  assert.equal(synthetic.isGroup, true);

  const fromMeMsg = {
    ...stickerMsg,
    key: { ...stickerMsg.key, fromMe: true },
  } as unknown as WAMessage;
  assert.equal(parseSyntheticCommandMessage(socket, fromMeMsg, ".menu"), null);
});
