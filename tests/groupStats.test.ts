import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";

import { GroupStatsService } from "../src/services/stats/groupStats.service";
import { ActivityTrackerInterceptor } from "../src/bot/pipeline/interceptors/activityTracker.interceptor";
import type { GroupMemberProfileRepository } from "../src/repositories/groupMemberProfile.repository";
import type { CommandContext } from "../src/types/command";

class MockProfileRepository {
  recordedActivities: Array<{ groupJid: string; userJid: string }> = [];
  mockStats = {
    totalMessages: 150,
    activeMembers: 12,
    latestActiveAt: new Date("2026-09-05T01:00:00.000Z"),
  };
  mockTopMembers: GroupMemberProfile[] = [];
  mockActiveJids: string[] = [];
  mockInactiveProfiles: GroupMemberProfile[] = [];

  async recordActivity(groupJid: string, userJid: string): Promise<void> {
    this.recordedActivities.push({ groupJid, userJid });
  }

  async getGroupActivityStats(_groupJid: string) {
    return this.mockStats;
  }

  async listTopByMessageCount(_groupJid: string, limit: number): Promise<GroupMemberProfile[]> {
    return this.mockTopMembers.slice(0, limit);
  }

  async listActiveUserJidsSince(_groupJid: string, _since: Date): Promise<string[]> {
    return this.mockActiveJids;
  }

  async findInactiveMembers(_groupJid: string, _since: Date): Promise<GroupMemberProfile[]> {
    return this.mockInactiveProfiles;
  }
}

function createFakeProfile(userJid: string, messageCount: number, lastActiveAt?: Date): GroupMemberProfile {
  return {
    id: `profile-${userJid}`,
    groupJid: "12345-67890@g.us",
    userJid,
    pointsBalance: 100,
    limitBalance: 10,
    reservedLimit: 0,
    totalLimitsEarned: 10,
    experience: 50,
    dailyStreak: 1,
    lastDailyClaimAt: null,
    messageCount,
    lastActiveAt: lastActiveAt ?? new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createFakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    socket: {
      user: { id: "bot@s.whatsapp.net" },
      groupMetadata: async () => ({
        id: "12345-67890@g.us",
        subject: "Test Group",
        participants: [
          { id: "user1@s.whatsapp.net", admin: null },
          { id: "user2@s.whatsapp.net", admin: null },
          { id: "user3@s.whatsapp.net", admin: null },
          { id: "bot@s.whatsapp.net", admin: null },
        ],
      }),
      sendMessage: async () => ({}),
    } as any,
    message: { key: { remoteJid: "12345-67890@g.us", fromMe: false } } as any,
    chatJid: "12345-67890@g.us",
    senderJid: "admin@s.whatsapp.net",
    senderUserJid: "admin@s.whatsapp.net",
    senderAltJids: ["admin@s.whatsapp.net"],
    isGroup: true,
    commandName: "stats",
    args: [],
    argsText: "",
    text: ".stats",
    mentionedJids: [],
    role: "TENANT_OWNER",
    reply: async () => {},
    ...overrides,
  };
}

void test("GroupStatsService: trackActivity records member activity", async () => {
  const repo = new MockProfileRepository();
  const service = new GroupStatsService(repo as unknown as GroupMemberProfileRepository);

  await service.trackActivity("group@g.us", "user@s.whatsapp.net");
  assert.equal(repo.recordedActivities.length, 1);
  assert.equal(repo.recordedActivities[0]?.groupJid, "group@g.us");
  assert.equal(repo.recordedActivities[0]?.userJid, "user@s.whatsapp.net");
});

void test("GroupStatsService: getStats rejects private chat", async () => {
  const repo = new MockProfileRepository();
  const service = new GroupStatsService(repo as unknown as GroupMemberProfileRepository);
  const context = createFakeContext({ isGroup: false });

  await assert.rejects(async () => {
    await service.getStats(context);
  }, /hanya bisa digunakan di dalam grup/);
});

void test("GroupStatsService: getStats formats group activity summary and mentions top members", async () => {
  const repo = new MockProfileRepository();
  repo.mockTopMembers = [
    createFakeProfile("628111@s.whatsapp.net", 80),
    createFakeProfile("628222@s.whatsapp.net", 45),
  ];

  const service = new GroupStatsService(repo as unknown as GroupMemberProfileRepository);
  const context = createFakeContext();
  const result = await service.getStats(context);

  assert.match(result.text, /STATISTIK AKTIVITAS GRUP/);
  assert.match(result.text, /150/); // total messages
  assert.match(result.text, /12/); // active members
  assert.match(result.text, /628111/);
  assert.match(result.text, /80.*pesan/);
  assert.equal(result.mentions.length, 2);
  assert.ok(result.mentions.includes("628111@s.whatsapp.net"));
});

void test("GroupStatsService: getTopActive returns sorted leaderboard with medals", async () => {
  const repo = new MockProfileRepository();
  repo.mockTopMembers = [
    createFakeProfile("user1@s.whatsapp.net", 100),
    createFakeProfile("user2@s.whatsapp.net", 75),
    createFakeProfile("user3@s.whatsapp.net", 50),
    createFakeProfile("user4@s.whatsapp.net", 25),
  ];

  const service = new GroupStatsService(repo as unknown as GroupMemberProfileRepository);
  const context = createFakeContext();
  const result = await service.getTopActive(context);

  assert.match(result.text, /LEADERBOARD CHAT TERAKTIF/);
  assert.match(result.text, /🥇 @user1 — \*100\* pesan/);
  assert.match(result.text, /🥈 @user2 — \*75\* pesan/);
  assert.match(result.text, /🥉 @user3 — \*50\* pesan/);
  assert.match(result.text, /4\. @user4 — \*25\* pesan/);
  assert.equal(result.mentions.length, 4);
});

void test("GroupStatsService: getSilentMembers blocks regular member", async () => {
  const repo = new MockProfileRepository();
  const service = new GroupStatsService(repo as unknown as GroupMemberProfileRepository);
  const context = createFakeContext({ role: "MEMBER" });

  await assert.rejects(async () => {
    await service.getSilentMembers(context, 7);
  }, /Owner atau Admin Tenant/);
});

void test("GroupStatsService: getSilentMembers finds inactive members and excludes bot & active members", async () => {
  const repo = new MockProfileRepository();
  // user1 is active
  repo.mockActiveJids = ["user1@s.whatsapp.net"];
  // user2 is in DB but inactive (last active 10 days ago)
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  repo.mockInactiveProfiles = [
    createFakeProfile("user2@s.whatsapp.net", 5, tenDaysAgo),
  ];
  // user3 has never chatted (no profile in DB)
  // bot is bot@s.whatsapp.net (must be excluded)

  const service = new GroupStatsService(repo as unknown as GroupMemberProfileRepository);
  const context = createFakeContext({ role: "TENANT_ADMIN" });
  const result = await service.getSilentMembers(context, 7);

  assert.match(result.text, /SIDER \/ MEMBER PASIF HUNTER/);
  assert.match(result.text, /Terdeteksi \*2\* member pasif/);
  assert.match(result.text, /@user2/);
  assert.match(result.text, /@user3/);
  // bot and user1 must NOT be in mentions
  assert.ok(!result.mentions.includes("bot@s.whatsapp.net"));
  assert.ok(!result.mentions.includes("user1@s.whatsapp.net"));
  assert.ok(result.mentions.includes("user2@s.whatsapp.net"));
  assert.ok(result.mentions.includes("user3@s.whatsapp.net"));
});

void test("ActivityTrackerInterceptor: ignores command messages and private chats", async () => {
  const interceptor = new ActivityTrackerInterceptor();

  // Private chat
  const privateResult = await interceptor.intercept({
    socket: {} as any,
    message: { key: { remoteJid: "user@s.whatsapp.net", fromMe: false } } as any,
    remoteJid: "user@s.whatsapp.net",
    isGroup: false,
  });
  assert.equal(privateResult, null);

  // Command message
  const commandResult = await interceptor.intercept({
    socket: {} as any,
    message: {
      key: { remoteJid: "group@g.us", participant: "user@s.whatsapp.net", fromMe: false },
      message: { conversation: ".stats" },
    } as any,
    remoteJid: "group@g.us",
    isGroup: true,
  });
  assert.equal(commandResult, null);
});
