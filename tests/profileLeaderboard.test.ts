import { test } from "node:test";
import assert from "node:assert/strict";

import type { GroupMemberProfile } from "@prisma/client";

import { MemberProfileViewService } from "../src/services/member/memberProfileView.service";
import { LeaderboardService } from "../src/services/member/leaderboard.service";

// ---- Helpers ----

function makeProfile(overrides: Partial<GroupMemberProfile> = {}): GroupMemberProfile {
  return {
    id: "p-1",
    groupJid: "g@g.us",
    userJid: "u@s.whatsapp.net",
    pointsBalance: 500,
    limitBalance: 3,
    reservedLimit: 0,
    experience: 2000,
    totalPointsEarned: 500,
    totalLimitsEarned: 3,
    totalGamesPlayed: 10,
    totalGamesWon: 5,
    currentStreak: 3,
    longestStreak: 7,
    lastDailyClaimAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

// ---- MemberProfileViewService ----

void test("MemberProfileViewService.getOwnProfile: creates/reads own profile and returns rank", async () => {
  const profile = makeProfile({ experience: 1500 }); // Elite = 1000+

  const service = new MemberProfileViewService(
    { findOrCreate: (...a) => { void a; return Promise.resolve(profile); }, findByGroupAndUser: (...a) => { void a; return Promise.resolve(profile); } },
    { findOrCreateProfile: (...a) => { void a; return Promise.resolve(profile); } },
  );

  const view = await service.getOwnProfile("g@g.us", "u@s.whatsapp.net");
  assert.equal(view.rank, "Elite");
  assert.ok(typeof view.createdAtWib === "string");
});

void test("MemberProfileViewService.getTargetProfile: returns null if no profile", async () => {
  const service = new MemberProfileViewService(
    { findOrCreate: (...a) => { void a; return Promise.resolve(makeProfile()); }, findByGroupAndUser: (...a) => { void a; return Promise.resolve(null); } },
    { findOrCreateProfile: (...a) => { void a; return Promise.resolve(makeProfile()); } },
  );

  const view = await service.getTargetProfile("g@g.us", "unknown@s.whatsapp.net");
  assert.equal(view, null);
});

void test("MemberProfileViewService.getTargetProfile: does not create profile for target", async () => {
  let createdCalled = false;
  const service = new MemberProfileViewService(
    {
      findOrCreate: (...a) => { void a; createdCalled = true; return Promise.resolve(makeProfile()); },
      findByGroupAndUser: (...a) => { void a; return Promise.resolve(null); },
    },
    { findOrCreateProfile: (...a) => { void a; return Promise.resolve(makeProfile()); } },
  );

  await service.getTargetProfile("g@g.us", "u@s.whatsapp.net");
  assert.equal(createdCalled, false);
});

void test("MemberProfileViewService: same user in different groups is independent", async () => {
  const profileGroupA = makeProfile({ groupJid: "ga@g.us", experience: 1000 });
  const profileGroupB = makeProfile({ groupJid: "gb@g.us", experience: 50000 });

  const service = new MemberProfileViewService(
    {
      findOrCreate: (...a) => { void a; return Promise.resolve(profileGroupA); },
      findByGroupAndUser: (groupJid: string, ...rest: unknown[]) => {
        void rest;
        if (groupJid === "ga@g.us") return Promise.resolve(profileGroupA);
        return Promise.resolve(profileGroupB);
      },
    },
    { findOrCreateProfile: (...a) => { void a; return Promise.resolve(profileGroupA); } },
  );

  const viewA = await service.getTargetProfile("ga@g.us", "u@s.whatsapp.net");
  const viewB = await service.getTargetProfile("gb@g.us", "u@s.whatsapp.net");
  assert.equal(viewA?.rank, "Elite");
  assert.equal(viewB?.rank, "Epic");
});

void test("MemberProfileViewService: rank thresholds displayed correctly", async () => {
  const thresholds = [
    { xp: 0, expected: "Warrior" },
    { xp: 999, expected: "Warrior" },
    { xp: 1000, expected: "Elite" },
    { xp: 5000, expected: "Master" },
    { xp: 15000, expected: "Grandmaster" },
    { xp: 40000, expected: "Epic" },
    { xp: 100000, expected: "Legend" },
    { xp: 250000, expected: "Mythic" },
  ];

  for (const { xp, expected } of thresholds) {
    const profile = makeProfile({ experience: xp });
    const service = new MemberProfileViewService(
      { findOrCreate: (...a) => { void a; return Promise.resolve(profile); }, findByGroupAndUser: (...a) => { void a; return Promise.resolve(profile); } },
      { findOrCreateProfile: (...a) => { void a; return Promise.resolve(profile); } },
    );
    const view = await service.getOwnProfile("g@g.us", "u@s.whatsapp.net");
    assert.equal(view.rank, expected, `XP ${String(xp)} should be ${expected}`);
  }
});

void test("MemberProfileViewService: spending points does not reduce rank", async () => {
  // Rank is XP-based, not points-based. Even if pointsBalance drops, rank stays.
  const highXpProfile = makeProfile({ experience: 100000, pointsBalance: 0 });
  const service = new MemberProfileViewService(
    { findOrCreate: (...a) => { void a; return Promise.resolve(highXpProfile); }, findByGroupAndUser: (...a) => { void a; return Promise.resolve(highXpProfile); } },
    { findOrCreateProfile: (...a) => { void a; return Promise.resolve(highXpProfile); } },
  );
  const view = await service.getOwnProfile("g@g.us", "u@s.whatsapp.net");
  assert.equal(view.rank, "Legend");
});

// ---- LeaderboardService ----

function makeLeaderboardService(opts: {
  topByXp: GroupMemberProfile[];
  topByPoints: GroupMemberProfile[];
  positionByXp: number;
  positionByPoints: number;
}) {
  const repo = {
    listTopByExperience: (...a: unknown[]) => { void a; return Promise.resolve(opts.topByXp); },
    listTopByPoints: (...a: unknown[]) => { void a; return Promise.resolve(opts.topByPoints); },
    getPositionByExperience: (...a: unknown[]) => { void a; return Promise.resolve(opts.positionByXp); },
    getPositionByPoints: (...a: unknown[]) => { void a; return Promise.resolve(opts.positionByPoints); },
  };
  return new LeaderboardService(repo);
}

void test("LeaderboardService.getTopRank: sorts top by XP and returns entries", async () => {
  const top = [
    makeProfile({ userJid: "a@s.whatsapp.net", experience: 5000 }),
    makeProfile({ userJid: "b@s.whatsapp.net", experience: 3000 }),
    makeProfile({ userJid: "c@s.whatsapp.net", experience: 1000 }),
  ];

  const service = makeLeaderboardService({ topByXp: top, topByPoints: [], positionByXp: 0, positionByPoints: 0 });
  const result = await service.getTopRank("g@g.us", "caller@s.whatsapp.net");

  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0]?.position, 1);
  assert.equal(result.entries[1]?.position, 2);
});

void test("LeaderboardService.getTopPoint: sorts top by points and returns entries", async () => {
  const top = [
    makeProfile({ userJid: "a@s.whatsapp.net", pointsBalance: 1000 }),
    makeProfile({ userJid: "b@s.whatsapp.net", pointsBalance: 500 }),
  ];

  const service = makeLeaderboardService({ topByXp: [], topByPoints: top, positionByXp: 0, positionByPoints: 0 });
  const result = await service.getTopPoint("g@g.us", "caller@s.whatsapp.net");

  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.value, 1000);
});

void test("LeaderboardService.getTopRank: shows caller position if outside top 10", async () => {
  // caller not in top list
  const top = [makeProfile({ userJid: "other@s.whatsapp.net", experience: 9000 })];
  const service = makeLeaderboardService({ topByXp: top, topByPoints: [], positionByXp: 25, positionByPoints: 0 });
  const result = await service.getTopRank("g@g.us", "caller@s.whatsapp.net");
  assert.equal(result.callerPosition, 25);
});

void test("LeaderboardService.getTopRank: callerPosition is null when caller has no profile", async () => {
  const top = [makeProfile({ userJid: "other@s.whatsapp.net", experience: 9000 })];
  // getPositionByExperience returns 0 when no profile
  const service = makeLeaderboardService({ topByXp: top, topByPoints: [], positionByXp: 0, positionByPoints: 0 });
  const result = await service.getTopRank("g@g.us", "caller@s.whatsapp.net");
  assert.equal(result.callerPosition, null);
});

void test("LeaderboardService.getTopRank: callerPosition is null when caller IS in top list", async () => {
  const callerJid = "caller@s.whatsapp.net";
  const top = [makeProfile({ userJid: callerJid, experience: 9000 })];
  const service = makeLeaderboardService({ topByXp: top, topByPoints: [], positionByXp: 1, positionByPoints: 0 });
  const result = await service.getTopRank("g@g.us", callerJid);
  // Caller is in top, so callerPosition should NOT be shown separately
  assert.equal(result.callerPosition, null);
});

void test("LeaderboardService: empty group returns empty entries", async () => {
  const service = makeLeaderboardService({ topByXp: [], topByPoints: [], positionByXp: 0, positionByPoints: 0 });
  const result = await service.getTopRank("g@g.us", "caller@s.whatsapp.net");
  assert.equal(result.entries.length, 0);
  assert.equal(result.callerPosition, null);
});

void test("LeaderboardService: display name falls back to phone number from JID", async () => {
  const top = [makeProfile({ userJid: "628123456789@s.whatsapp.net", experience: 1000 })];
  const service = makeLeaderboardService({ topByXp: top, topByPoints: [], positionByXp: 0, positionByPoints: 0 });
  const result = await service.getTopRank("g@g.us", "caller@s.whatsapp.net");
  assert.equal(result.entries[0]?.displayName, "628123456789");
});

void test("profileCommands: shows tagged member profile when mentionedJids provided", async () => {
  const { createProfileCommands } = await import("../src/commands/member/profile.command");
  const profile = makeProfile({ userJid: "628222@s.whatsapp.net" });
  const mockService = {
    getOwnProfile: (...args: unknown[]) => {
      void args;
      return Promise.resolve({
        profile,
        rank: "Bronze",
        createdAtWib: "2026-09-03",
      });
    },
  };
  const profileCmd = createProfileCommands(mockService).find((c) => c.name === "profile");
  assert.ok(profileCmd);

  let repliedText = "";
  const mockContext = {
    isGroup: true,
    tenantGroup: { groupJid: "120@g.us" },
    chatJid: "120@g.us",
    senderUserJid: "628111@s.whatsapp.net",
    mentionedJids: ["628222@s.whatsapp.net"],
    args: ["@628222"],
    reply: (text: string) => {
      repliedText = text;
      return Promise.resolve();
    },
  };

  await profileCmd.execute(mockContext as never);
  assert.ok(repliedText.includes("PROFIL MEMBER"));
  assert.ok(repliedText.includes("@628222"));
});

void test("profileCommands: shows quoted member profile when quoted message provided", async () => {
  const { createProfileCommands } = await import("../src/commands/member/profile.command");
  const profile = makeProfile({ userJid: "628333@s.whatsapp.net" });
  const mockService = {
    getOwnProfile: (...args: unknown[]) => {
      void args;
      return Promise.resolve({
        profile,
        rank: "Silver",
        createdAtWib: "2026-09-03",
      });
    },
  };
  const profileCmd = createProfileCommands(mockService).find((c) => c.name === "profile");
  assert.ok(profileCmd);

  let repliedText = "";
  const mockContext = {
    isGroup: true,
    tenantGroup: { groupJid: "120@g.us" },
    chatJid: "120@g.us",
    senderUserJid: "628111@s.whatsapp.net",
    mentionedJids: [],
    quoted: { participantJid: "628333@s.whatsapp.net" },
    args: [],
    reply: (text: string) => {
      repliedText = text;
      return Promise.resolve();
    },
  };

  await profileCmd.execute(mockContext as never);
  assert.ok(repliedText.includes("PROFIL MEMBER"));
  assert.ok(repliedText.includes("@628333"));
});
