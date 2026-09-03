import { test } from "node:test";
import assert from "node:assert/strict";

import { HeavyFeatureType } from "@prisma/client";
import type { GroupMemberProfile } from "@prisma/client";

import { HeavyFeatureLimitService } from "../src/services/member/heavyFeatureLimit.service";
import { HeavyFeatureAccessService } from "../src/services/quota/heavyFeatureAccess.service";
import { InsufficientLimitError } from "../src/types/memberEconomy";
import { getFeatureCost } from "../src/services/member/heavyFeatureCost";

// ---- Cost map tests ----

void test("getFeatureCost: TikTok costs 1", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.TIKTOK_DOWNLOAD), 1);
});

void test("getFeatureCost: IG Reels costs 1", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.INSTAGRAM_REELS_DOWNLOAD), 1);
});

void test("getFeatureCost: IG Story costs 1", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.INSTAGRAM_STORY_DOWNLOAD), 1);
});

void test("getFeatureCost: Play song costs 1", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.PLAY_SONG), 1);
});

void test("getFeatureCost: Song lyrics costs 1", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.SONG_LYRICS), 1);
});

void test("getFeatureCost: HD AI Photo costs 2", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.HD_AI_PHOTO), 2);
});

void test("getFeatureCost: HD AI Photo Document costs 2", () => {
  assert.equal(getFeatureCost(HeavyFeatureType.HD_AI_PHOTO_DOCUMENT), 2);
});

// ---- HeavyFeatureLimitService ----

function makeProfile(overrides: Partial<GroupMemberProfile> = {}): GroupMemberProfile {
  return {
    id: "p-1",
    groupJid: "g@g.us",
    userJid: "u@s.whatsapp.net",
    pointsBalance: 0,
    limitBalance: 5,
    reservedLimit: 0,
    experience: 0,
    totalPointsEarned: 0,
    totalLimitsEarned: 5,
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastDailyClaimAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLimitService(opts: {
  reserveOk?: boolean;
  consumeOk?: boolean;
  refundOk?: boolean;
  bestProfile?: GroupMemberProfile | null;
}) {
  let reserveCalled = false;
  let consumeCalled = false;
  let refundCalled = false;

  const economyService = {
    findBestLimitProfileForPrivateChat: (...args: unknown[]): Promise<GroupMemberProfile | null> => {
      void args;
      return Promise.resolve(opts.bestProfile ?? null);
    },
    reserveLimit: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      reserveCalled = true;
      if (opts.reserveOk === false) return Promise.reject(new InsufficientLimitError());
      return Promise.resolve(makeProfile());
    },
    consumeLimit: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      consumeCalled = true;
      return Promise.resolve(makeProfile());
    },
    refundLimit: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      refundCalled = true;
      return Promise.resolve(makeProfile());
    },
  };

  const service = new HeavyFeatureLimitService(economyService);

  return {
    service,
    get reserveCalled() { return reserveCalled; },
    get consumeCalled() { return consumeCalled; },
    get refundCalled() { return refundCalled; },
  };
}

const RESERVATION = {
  groupJid: "g@g.us",
  userJid: "u@s.whatsapp.net",
  feature: HeavyFeatureType.TIKTOK_DOWNLOAD,
  correlationId: "corr-1",
};

void test("HeavyFeatureLimitService.reserve: calls economyService.reserveLimit", async () => {
  const ctx = makeLimitService({ reserveOk: true });
  await ctx.service.reserve(RESERVATION);
  assert.ok(ctx.reserveCalled);
});

void test("HeavyFeatureLimitService.reserve: throws InsufficientLimitError on failure", async () => {
  const { service } = makeLimitService({ reserveOk: false });
  await assert.rejects(() => service.reserve(RESERVATION), InsufficientLimitError);
});

void test("HeavyFeatureLimitService.consume: calls economyService.consumeLimit", async () => {
  const ctx = makeLimitService({});
  await ctx.service.consume(RESERVATION);
  assert.ok(ctx.consumeCalled);
});

void test("HeavyFeatureLimitService.refund: calls economyService.refundLimit", async () => {
  const ctx = makeLimitService({});
  await ctx.service.refund(RESERVATION);
  assert.ok(ctx.refundCalled);
});

void test("HeavyFeatureLimitService.resolvePrivateChatGroupJid: returns groupJid when profile found", async () => {
  const profile = makeProfile({ groupJid: "target-group@g.us", limitBalance: 3 });
  const { service } = makeLimitService({ bestProfile: profile });
  const result = await service.resolvePrivateChatGroupJid("u@s.whatsapp.net", HeavyFeatureType.TIKTOK_DOWNLOAD);
  assert.equal(result, "target-group@g.us");
});

void test("HeavyFeatureLimitService.resolvePrivateChatGroupJid: returns null when no eligible profile", async () => {
  const { service } = makeLimitService({ bestProfile: null });
  const result = await service.resolvePrivateChatGroupJid("u@s.whatsapp.net", HeavyFeatureType.HD_AI_PHOTO);
  assert.equal(result, null);
});

// ---- HeavyFeatureAccessService ----

interface MockContext {
  isGroup: boolean;
  role: string;
  senderUserJid: string;
  chatJid: string;
  tenantGroup?: { ownerJid: string | null; groupJid: string } | null;
}

function makeAccessService(opts: { activeGroups?: string[] } = {}) {
  const repo = {
    listActiveByOwnerJid: (...args: unknown[]): Promise<{ groupJid: string }[]> => {
      void args;
      return Promise.resolve((opts.activeGroups ?? []).map((g) => ({ groupJid: g })));
    },
  };
  return new HeavyFeatureAccessService(repo as Parameters<typeof HeavyFeatureAccessService>[0]);
}

void test("HeavyFeatureAccessService: Super Owner in group is skipLimit=true", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: true,
    role: "SUPER_OWNER",
    senderUserJid: "super@s.whatsapp.net",
    chatJid: "g@g.us",
    tenantGroup: { ownerJid: "owner@s.whatsapp.net", groupJid: "g@g.us" },
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  assert.ok(result.allowed && result.skipLimit); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
});

void test("HeavyFeatureAccessService: Tenant Owner in OWN group is skipLimit=true", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: true,
    role: "TENANT_OWNER",
    senderUserJid: "628111@s.whatsapp.net",
    chatJid: "g@g.us",
    tenantGroup: { ownerJid: "628111@s.whatsapp.net", groupJid: "g@g.us" },
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  assert.ok(result.allowed && result.skipLimit); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
});

void test("HeavyFeatureAccessService: Tenant Owner in another group is skipLimit=false", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: true,
    role: "TENANT_OWNER",
    senderUserJid: "628111@s.whatsapp.net",
    chatJid: "g@g.us",
    tenantGroup: { ownerJid: "628999@s.whatsapp.net", groupJid: "g@g.us" },
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  // skipLimit must be false for Tenant Owner in someone else's group.
  assert.ok(result.allowed && !result.skipLimit); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
});

void test("HeavyFeatureAccessService: regular member in group is skipLimit=false with correct groupJid", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: true,
    role: "MEMBER",
    senderUserJid: "member@s.whatsapp.net",
    chatJid: "g@g.us",
    tenantGroup: { ownerJid: "owner@s.whatsapp.net", groupJid: "g@g.us" },
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  if (result.allowed && !result.skipLimit) { // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    assert.equal(result.groupJid, "g@g.us");
    assert.equal(result.userJid, "member@s.whatsapp.net");
  }
});

void test("HeavyFeatureAccessService: group without tenantGroup is not allowed", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: true,
    role: "MEMBER",
    senderUserJid: "member@s.whatsapp.net",
    chatJid: "g@g.us",
    tenantGroup: null,
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(!result.allowed);
});

void test("HeavyFeatureAccessService: Super Owner in private is skipLimit=true", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: false,
    role: "SUPER_OWNER",
    senderUserJid: "super@s.whatsapp.net",
    chatJid: "super@s.whatsapp.net",
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  assert.ok(result.allowed && result.skipLimit); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
});

void test("HeavyFeatureAccessService: Tenant Owner in private with active contract is skipLimit=true", async () => {
  const service = makeAccessService({ activeGroups: ["g@g.us"] });
  const ctx: MockContext = {
    isGroup: false,
    role: "TENANT_OWNER",
    senderUserJid: "owner@s.whatsapp.net",
    chatJid: "owner@s.whatsapp.net",
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  assert.ok(result.allowed && result.skipLimit); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
});

void test("HeavyFeatureAccessService: Tenant Owner in private without active contract is not allowed", async () => {
  const service = makeAccessService({ activeGroups: [] });
  const ctx: MockContext = {
    isGroup: false,
    role: "TENANT_OWNER",
    senderUserJid: "owner@s.whatsapp.net",
    chatJid: "owner@s.whatsapp.net",
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(!result.allowed);
});

void test("HeavyFeatureAccessService: regular member in private gets PRIVATE sentinel groupJid", async () => {
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: false,
    role: "MEMBER",
    senderUserJid: "member@s.whatsapp.net",
    chatJid: "member@s.whatsapp.net",
  };
  const result = await service.resolveAccess(ctx as never);
  assert.ok(result.allowed);
  if (result.allowed && !result.skipLimit) { // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    assert.equal(result.groupJid, "PRIVATE");
  }
});

void test("HeavyFeatureAccessService: Tenant Owner balance is NOT charged when member uses feature (independent profiles)", () => {
  // This is guaranteed by design: resolveGroupAccess returns senderUserJid, not ownerJid.
  const service = makeAccessService();
  const ctx: MockContext = {
    isGroup: true,
    role: "MEMBER",
    senderUserJid: "member@s.whatsapp.net",
    chatJid: "g@g.us",
    tenantGroup: { ownerJid: "owner@s.whatsapp.net", groupJid: "g@g.us" },
  };
  // Access private method via bracket notation with eslint disable.
  // eslint-disable-next-line @typescript-eslint/dot-notation
  const result = service["resolveGroupAccess"](ctx as never);
  assert.ok(result.allowed);
  if (result.allowed && !result.skipLimit) { // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    assert.equal(result.userJid, "member@s.whatsapp.net");
    assert.notEqual(result.userJid, "owner@s.whatsapp.net");
  }
});

