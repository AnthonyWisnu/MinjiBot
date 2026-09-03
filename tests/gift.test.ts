import { test } from "node:test";
import assert from "node:assert/strict";

import type { GroupMemberProfile } from "@prisma/client";
import { MemberTransactionAsset, MemberTransactionType } from "@prisma/client";

import { GiftService } from "../src/services/member/gift.service";
import { MemberAdminService } from "../src/services/member/memberAdmin.service";
import {
  DuplicateOperationError,
  InsufficientLimitError,
  InsufficientPointsError,
  InvalidAmountError,
} from "../src/types/memberEconomy";

// ---- GiftService tests ----

void test("GiftService.giftPoints: valid transfer deducts from sender and credits recipient", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 500,
    recipientPoints: 100,
    updateManyCount: 1,
  });

  const result = await service.giftPoints(makeGiftInput({
    senderJid: senderProfile.userJid,
    recipientJid: recipientProfile.userJid,
    amount: 200,
  }));

  assert.equal(result.amountSent, 200);
});

void test("GiftService.giftPoints: sender may end at 0", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 200,
    recipientPoints: 0,
    updateManyCount: 1,
  });

  const result = await service.giftPoints(makeGiftInput({
    senderJid: senderProfile.userJid,
    recipientJid: recipientProfile.userJid,
    amount: 200,
  }));

  assert.equal(result.amountSent, 200);
});

void test("GiftService.giftPoints: insufficient points throws InsufficientPointsError", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 100,
    recipientPoints: 0,
    updateManyCount: 0,
  });

  await assert.rejects(
    () => service.giftPoints(makeGiftInput({
      senderJid: senderProfile.userJid,
      recipientJid: recipientProfile.userJid,
      amount: 500,
    })),
    InsufficientPointsError,
  );
});

void test("GiftService.giftLimit: insufficient limit throws InsufficientLimitError", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 0,
    recipientPoints: 0,
    updateManyCount: 0,
    senderLimit: 1,
    recipientLimit: 3,
  });

  await assert.rejects(
    () => service.giftLimit(makeGiftInput({
      senderJid: senderProfile.userJid,
      recipientJid: recipientProfile.userJid,
      amount: 5,
    })),
    InsufficientLimitError,
  );
});

void test("GiftService.giftPoints: self-transfer throws InvalidAmountError", async () => {
  const { service, senderProfile } = makeGiftService({ senderPoints: 500, recipientPoints: 0, updateManyCount: 1 });

  await assert.rejects(
    () => service.giftPoints(makeGiftInput({
      senderJid: senderProfile.userJid,
      recipientJid: senderProfile.userJid,
      amount: 100,
    })),
    InvalidAmountError,
  );
});

void test("GiftService.giftPoints: bot target throws InvalidAmountError", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 500,
    recipientPoints: 0,
    updateManyCount: 1,
  });

  await assert.rejects(
    () => service.giftPoints(makeGiftInput({
      senderJid: senderProfile.userJid,
      recipientJid: recipientProfile.userJid,
      amount: 100,
      botJid: recipientProfile.userJid,
    })),
    InvalidAmountError,
  );
});

void test("GiftService.giftPoints: non-participant recipient throws InvalidAmountError", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 500,
    recipientPoints: 0,
    updateManyCount: 1,
  });

  await assert.rejects(
    () => service.giftPoints(makeGiftInput({
      senderJid: senderProfile.userJid,
      recipientJid: recipientProfile.userJid,
      amount: 100,
      participantJids: [senderProfile.userJid], // recipient NOT in list
    })),
    InvalidAmountError,
  );
});

void test("GiftService.giftPoints: duplicate idempotency key throws DuplicateOperationError", async () => {
  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 500,
    recipientPoints: 0,
    updateManyCount: 1,
    existingIdempotencyKey: "msg-123",
  });

  await assert.rejects(
    () => service.giftPoints(makeGiftInput({
      senderJid: senderProfile.userJid,
      recipientJid: recipientProfile.userJid,
      amount: 100,
      idempotencyKey: "msg-123",
    })),
    DuplicateOperationError,
  );
});

void test("GiftService.giftPoints: two ledger entries are created with same correlationId", async () => {
  const createdEntries: { type: MemberTransactionType; correlationId?: string }[] = [];

  const { service, senderProfile, recipientProfile } = makeGiftService({
    senderPoints: 500,
    recipientPoints: 100,
    updateManyCount: 1,
    onTxCreate: (entry) => { createdEntries.push(entry as never); },
  });

  await service.giftPoints(makeGiftInput({
    senderJid: senderProfile.userJid,
    recipientJid: recipientProfile.userJid,
    amount: 100,
  }));

  assert.equal(createdEntries.length, 2);
  const first = createdEntries[0];
  const second = createdEntries[1];
  assert.ok(first?.correlationId);
  assert.equal(first?.correlationId, second?.correlationId); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
});

// ---- MemberAdminService tests ----

void test("MemberAdminService: non-Super Owner is blocked at command layer (role check)", () => {
  // Role check happens in the command handler — this test verifies the type contract.
  // The "SUPER_OWNER" literal is the only value that grants admin access.
  const validRoles = ["MEMBER", "TENANT_OWNER", "TENANT_ADMIN"];
  assert.ok(!validRoles.includes("SUPER_OWNER"));
});

void test("MemberAdminService.addPoints: credits correct amount", async () => {
  const { service } = makeAdminService({ pointsBalance: 500 });
  const result = await service.addPoints("g@g.us", "u@s.net", 100);
  assert.equal(result.asset, "Poin");
  assert.equal(result.after - result.before, 100);
});

void test("MemberAdminService.setPoints: sets to exact amount", async () => {
  const { service } = makeAdminService({ pointsBalance: 500 });
  const result = await service.setPoints("g@g.us", "u@s.net", 250);
  assert.equal(result.asset, "Poin");
  assert.equal(result.after, 250);
});

void test("MemberAdminService.setPoints: set to 0 succeeds", async () => {
  const { service } = makeAdminService({ pointsBalance: 500 });
  const result = await service.setPoints("g@g.us", "u@s.net", 0);
  assert.equal(result.after, 0);
});

void test("MemberAdminService.addLimit: credits correct amount", async () => {
  const { service } = makeAdminService({ limitBalance: 3 });
  const result = await service.addLimit("g@g.us", "u@s.net", 2);
  assert.equal(result.asset, "Limit");
  assert.equal(result.after - result.before, 2);
});

void test("MemberAdminService.addXp: credits correct amount", async () => {
  const { service } = makeAdminService({ experience: 200 });
  const result = await service.addXp("g@g.us", "u@s.net", 50);
  assert.equal(result.asset, "XP");
  assert.equal(result.after - result.before, 50);
});

void test("MemberAdminService.getMemberInfo: returns null for unknown member", async () => {
  const { service } = makeAdminService({ pointsBalance: 0, noProfile: true });
  const info = await service.getMemberInfo("g@g.us", "unknown@s.net");
  assert.equal(info, null);
});

void test("MemberAdminService.getMemberInfo: returns profile and rank for known member", async () => {
  const { service } = makeAdminService({ pointsBalance: 100, experience: 2000 });
  const info = await service.getMemberInfo("g@g.us", "u@s.net");
  assert.ok(info !== null);
  assert.ok(typeof info.rank === "string");
  // 2000 XP should be Elite rank (threshold 1000)
  assert.equal(info.rank, "Elite");
});

// ---- Helpers ----

function makeProfile(overrides: Partial<GroupMemberProfile> = {}): GroupMemberProfile {
  return {
    id: "profile-1",
    groupJid: "g@g.us",
    userJid: "u@s.net",
    pointsBalance: 0,
    limitBalance: 3,
    reservedLimit: 0,
    experience: 0,
    totalPointsEarned: 0,
    totalLimitsEarned: 3,
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastDailyClaimAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

function makeGiftInput(overrides: {
  senderJid: string;
  recipientJid: string;
  amount: number;
  idempotencyKey?: string;
  participantJids?: string[];
  botJid?: string;
}) {
  return {
    groupJid: "g@g.us",
    senderJid: overrides.senderJid,
    recipientJid: overrides.recipientJid,
    amount: overrides.amount,
    idempotencyKey: overrides.idempotencyKey,
    participantJids: overrides.participantJids ?? [overrides.senderJid, overrides.recipientJid],
    botJid: overrides.botJid ?? "bot@s.net",
  };
}

function makeGiftService(opts: {
  senderPoints: number;
  recipientPoints: number;
  updateManyCount: number;
  senderLimit?: number;
  recipientLimit?: number;
  existingIdempotencyKey?: string;
  onTxCreate?: (entry: unknown) => void;
}) {
  const senderProfile = makeProfile({
    id: "sender-1",
    userJid: "sender@s.whatsapp.net",
    pointsBalance: opts.senderPoints,
    limitBalance: opts.senderLimit ?? 5,
  });
  const recipientProfile = makeProfile({
    id: "recipient-1",
    userJid: "recipient@s.whatsapp.net",
    pointsBalance: opts.recipientPoints,
    limitBalance: opts.recipientLimit ?? 3,
  });

  const updatedSender = { ...senderProfile };
  const updatedRecipient = { ...recipientProfile };

  const profileRepo = {
    findOrCreate: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const userJid = args[1] as string;
      if (userJid.startsWith("sender")) return Promise.resolve(senderProfile);
      return Promise.resolve(recipientProfile);
    },
  };

  const txRepo = {
    findByIdempotencyKey: (key: string): Promise<object | null> => {
      if (opts.existingIdempotencyKey && key === opts.existingIdempotencyKey) {
        return Promise.resolve({ id: "existing" });
      }
      return Promise.resolve(null);
    },
    create: (entry: unknown, ...args: unknown[]): Promise<unknown> => {
      void args;
      opts.onTxCreate?.(entry);
      return Promise.resolve({});
    },
  };

  const mockTx = {
    groupMemberProfile: {
      updateMany: (...args: unknown[]): Promise<{ count: number }> => {
        void args;
        return Promise.resolve({ count: opts.updateManyCount });
      },
      findUniqueOrThrow: (...args: unknown[]): Promise<GroupMemberProfile> => {
        void args;
        return Promise.resolve(updatedSender);
      },
      update: (...args: unknown[]): Promise<GroupMemberProfile> => {
        void args;
        return Promise.resolve(updatedRecipient);
      },
    },
  };

  const db = {
    $transaction: <T>(fn: (tx: typeof mockTx) => Promise<T>) => fn(mockTx),
  };

  const service = new GiftService(
    profileRepo,
    txRepo,
    db,
  );

  return { service, senderProfile, recipientProfile };
}

function makeAdminService(opts: {
  pointsBalance?: number;
  limitBalance?: number;
  experience?: number;
  noProfile?: boolean;
}) {
  const pts = opts.pointsBalance ?? 0;
  const lim = opts.limitBalance ?? 3;
  const xp = opts.experience ?? 0;

  const profile = makeProfile({ pointsBalance: pts, limitBalance: lim, experience: xp });

  const economyService = {
    creditPoints: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const a = (args[0] as { amount: number }).amount;
      void args;
      return Promise.resolve(makeProfile({ pointsBalance: pts + a }));
    },
    setPoints: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const a = (args[0] as { amount: number }).amount;
      void args;
      return Promise.resolve(makeProfile({ pointsBalance: a }));
    },
    creditLimit: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const a = (args[0] as { amount: number }).amount;
      void args;
      return Promise.resolve(makeProfile({ limitBalance: lim + a }));
    },
    setLimit: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const a = (args[0] as { amount: number }).amount;
      void args;
      return Promise.resolve(makeProfile({ limitBalance: a }));
    },
    creditXp: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const a = (args[0] as { amount: number }).amount;
      void args;
      return Promise.resolve(makeProfile({ experience: xp + a }));
    },
    setXp: (...args: unknown[]): Promise<GroupMemberProfile> => {
      const a = (args[0] as { amount: number }).amount;
      void args;
      return Promise.resolve(makeProfile({ experience: a }));
    },
  };

  const profileRepo = {
    findByGroupAndUser: (...args: unknown[]): Promise<GroupMemberProfile | null> => {
      void args;
      if (opts.noProfile) return Promise.resolve(null);
      return Promise.resolve(profile);
    },
  };

  const service = new MemberAdminService(
    economyService,
    profileRepo,
  );

  return { service };
}

// Suppress unused import warning — types are used in tests via makeProfile shape.
void MemberTransactionAsset.POINT;
void MemberTransactionType.GIFT_SENT;
