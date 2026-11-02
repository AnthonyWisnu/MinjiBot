import assert from "node:assert/strict";
import test from "node:test";
import { HeavyFeatureType } from "@prisma/client";

import {
  consumeFeatureLimit,
  refundFeatureLimit,
  reserveFeatureLimit,
  resolveFeatureAccess,
  type LimitReservation,
} from "../src/commands/media/heavyFeatureHelper";
import { heavyFeatureLimitService } from "../src/services/member/heavyFeatureLimit.service";
import { heavyFeatureAccessService } from "../src/services/quota/heavyFeatureAccess.service";
import type { CommandContext } from "../src/types/command";

test("heavyFeatureHelper: resolveFeatureAccess returns skip: true when user is exempt", async () => {
  const origResolve = heavyFeatureAccessService.resolveAccess;
  try {
    heavyFeatureAccessService.resolveAccess = async () => ({
      allowed: true,
      skipLimit: true,
      groupJid: "123@g.us",
      userJid: "owner@s.whatsapp.net",
    });

    const mockContext = {} as CommandContext;
    const res = await resolveFeatureAccess(mockContext, HeavyFeatureType.TIKTOK_DOWNLOAD);
    assert.deepEqual(res, { skip: true });
  } finally {
    heavyFeatureAccessService.resolveAccess = origResolve;
  }
});

test("heavyFeatureHelper: resolveFeatureAccess returns reservation for standard member", async () => {
  const origResolve = heavyFeatureAccessService.resolveAccess;
  try {
    heavyFeatureAccessService.resolveAccess = async () => ({
      allowed: true,
      skipLimit: false,
      groupJid: "123@g.us",
      userJid: "member@s.whatsapp.net",
    });

    const mockContext = {} as CommandContext;
    const res = await resolveFeatureAccess(mockContext, HeavyFeatureType.TIKTOK_DOWNLOAD);
    assert.ok(res !== null && !res.skip);
    assert.equal(res.reservation.groupJid, "123@g.us");
    assert.equal(res.reservation.userJid, "member@s.whatsapp.net");
    assert.equal(res.reservation.feature, HeavyFeatureType.TIKTOK_DOWNLOAD);
    assert.ok(res.reservation.correlationId.length > 0);
  } finally {
    heavyFeatureAccessService.resolveAccess = origResolve;
  }
});

test("heavyFeatureHelper: reserveFeatureLimit succeeds when limit is available", async () => {
  const origReserve = heavyFeatureLimitService.reserve;
  try {
    let reserved = false;
    heavyFeatureLimitService.reserve = async () => {
      reserved = true;
    };

    const reservation: LimitReservation = {
      groupJid: "123@g.us",
      userJid: "member@s.whatsapp.net",
      feature: HeavyFeatureType.YOUTUBE_VIDEO_DOWNLOAD,
      correlationId: "corr-1",
    };

    const mockContext = { reply: async () => {} } as unknown as CommandContext;
    const success = await reserveFeatureLimit(mockContext, reservation);
    assert.equal(success, true);
    assert.equal(reserved, true);
  } finally {
    heavyFeatureLimitService.reserve = origReserve;
  }
});

test("heavyFeatureHelper: consumeFeatureLimit retries and succeeds", async () => {
  const origConsume = heavyFeatureLimitService.consume;
  try {
    let callCount = 0;
    heavyFeatureLimitService.consume = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Temporary DB lock");
      }
    };

    const reservation: LimitReservation = {
      groupJid: "123@g.us",
      userJid: "member@s.whatsapp.net",
      feature: HeavyFeatureType.HD_AI_PHOTO,
      correlationId: "corr-2",
    };

    await consumeFeatureLimit(reservation);
    assert.equal(callCount, 2);
  } finally {
    heavyFeatureLimitService.consume = origConsume;
  }
});

test("heavyFeatureHelper: refundFeatureLimit retries and succeeds", async () => {
  const origRefund = heavyFeatureLimitService.refund;
  try {
    let callCount = 0;
    heavyFeatureLimitService.refund = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Temporary DB lock");
      }
    };

    const reservation: LimitReservation = {
      groupJid: "123@g.us",
      userJid: "member@s.whatsapp.net",
      feature: HeavyFeatureType.PLAY_SONG,
      correlationId: "corr-3",
    };

    await refundFeatureLimit(reservation);
    assert.equal(callCount, 2);
  } finally {
    heavyFeatureLimitService.refund = origRefund;
  }
});
