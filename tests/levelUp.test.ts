import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";

import { LevelUpNotifierService, type LevelUpNotification } from "../src/services/member/levelUpNotifier.service";
import { MemberEconomyService } from "../src/services/member/memberEconomy.service";

class MockProfileStore {
  profiles = new Map<string, GroupMemberProfile>();

  async findOrCreate(groupJid: string, userJid: string): Promise<GroupMemberProfile> {
    const key = `${groupJid}_${userJid}`;
    let profile = this.profiles.get(key);
    if (!profile) {
      profile = {
        id: `prof_${key}`,
        groupJid,
        userJid,
        pointsBalance: 100,
        limitBalance: 10,
        reservedLimit: 0,
        totalLimitsEarned: 10,
        experience: 0,
        dailyStreak: 1,
        lastDailyClaimAt: null,
        totalGamesPlayed: 0,
        totalGamesWon: 0,
        messageCount: 0,
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.profiles.set(key, profile);
    }
    return profile;
  }

  async findByGroupAndUser(groupJid: string, userJid: string): Promise<GroupMemberProfile | null> {
    return this.profiles.get(`${groupJid}_${userJid}`) ?? null;
  }

  async findActiveByUser(): Promise<GroupMemberProfile[]> {
    return [];
  }
}

class MockTxStore {
  records: any[] = [];
  async create(data: any) {
    this.records.push(data);
    return data;
  }
  async findByIdempotencyKey() {
    return null;
  }
}

class MockTransactionalDb {
  constructor(private readonly store: MockProfileStore) {}

  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const tx = {
      groupMemberProfile: {
        update: async (args: { where: { id: string }; data: { experience: any } }) => {
          for (const [key, prof] of this.store.profiles.entries()) {
            if (prof.id === args.where.id) {
              const inc = args.data.experience.increment ?? 0;
              const setVal = typeof args.data.experience === "number" ? args.data.experience : prof.experience + inc;
              const updated = { ...prof, experience: setVal };
              this.store.profiles.set(key, updated);
              return updated;
            }
          }
          throw new Error("Profile not found in mock");
        },
      },
    };
    return fn(tx);
  }
}

void test("LevelUp: creditXp triggers level-up notification when crossing rank threshold", async () => {
  const profileStore = new MockProfileStore();
  const txStore = new MockTxStore();
  const db = new MockTransactionalDb(profileStore);

  const notifications: LevelUpNotification[] = [];
  const mockNotifier = {
    notifyLevelUp: async (event: LevelUpNotification) => {
      notifications.push(event);
    },
  };

  const economy = new MemberEconomyService(
    profileStore as any,
    txStore as any,
    db as any,
    mockNotifier,
  );

  // Initial XP: 0 (Warrior). Credit 1,200 XP (threshold Elite is 1,000)
  await economy.creditXp({
    groupJid: "group1@g.us",
    userJid: "user1@s.whatsapp.net",
    amount: 1200,
    type: "GAME_REWARD",
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.oldRank, "Warrior");
  assert.equal(notifications[0]?.newRank, "Elite");
  assert.equal(notifications[0]?.newXp, 1200);
  assert.equal(notifications[0]?.userJid, "user1@s.whatsapp.net");
});

void test("LevelUp: creditXp does not trigger notification when staying in same tier", async () => {
  const profileStore = new MockProfileStore();
  const txStore = new MockTxStore();
  const db = new MockTransactionalDb(profileStore);

  const notifications: LevelUpNotification[] = [];
  const mockNotifier = {
    notifyLevelUp: async (event: LevelUpNotification) => {
      notifications.push(event);
    },
  };

  const economy = new MemberEconomyService(
    profileStore as any,
    txStore as any,
    db as any,
    mockNotifier,
  );

  // Initial XP: 0 (Warrior). Credit 200 XP (still Warrior, < 1,000)
  await economy.creditXp({
    groupJid: "group1@g.us",
    userJid: "user1@s.whatsapp.net",
    amount: 200,
    type: "GAME_REWARD",
  });

  assert.equal(notifications.length, 0);
});

void test("LevelUpNotifierService: sends celebration message to WhatsApp group", async () => {
  const service = new LevelUpNotifierService();
  const sentMessages: any[] = [];

  const mockSocket = {
    sendMessage: async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return {};
    },
  };

  service.setSocket(mockSocket as any);

  await service.notifyLevelUp({
    groupJid: "group123@g.us",
    userJid: "628999@s.whatsapp.net",
    oldRank: "Elite",
    newRank: "Master",
    newXp: 5500,
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.jid, "group123@g.us");
  assert.match(sentMessages[0]?.content.text, /LEVEL UP!/);
  assert.match(sentMessages[0]?.content.text, /MASTER/);
  assert.match(sentMessages[0]?.content.text, /5\.500 XP/);
  assert.deepEqual(sentMessages[0]?.content.mentions, ["628999@s.whatsapp.net"]);
});

void test("LevelUpNotifierService: ignores non-group JID", async () => {
  const service = new LevelUpNotifierService();
  const sentMessages: any[] = [];

  const mockSocket = {
    sendMessage: async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return {};
    },
  };

  service.setSocket(mockSocket as any);

  await service.notifyLevelUp({
    groupJid: "user@s.whatsapp.net",
    userJid: "user@s.whatsapp.net",
    oldRank: "Warrior",
    newRank: "Elite",
    newXp: 1200,
  });

  assert.equal(sentMessages.length, 0);
});
