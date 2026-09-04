import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { ProfileCardService } from "../src/services/member/profileCard.service";
import type { GroupMemberProfile } from "@prisma/client";

function makeFakeProfile(overrides?: Partial<GroupMemberProfile>): GroupMemberProfile {
  return {
    id: "prof_1",
    groupJid: "12345@g.us",
    userJid: "628123456789@s.whatsapp.net",
    pointsBalance: 12500,
    limitBalance: 10,
    reservedLimit: 0,
    experience: 5400,
    currentStreak: 7,
    lastDailyClaimAt: new Date(),
    totalGamesPlayed: 25,
    totalGamesWon: 18,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

void test("ProfileCardService: generates 800x450 PNG visual card for member", async () => {
  const service = new ProfileCardService();
  const profile = makeFakeProfile();

  const cardBuffer = await service.generateCard({
    view: {
      profile,
      rank: "Master",
      createdAtWib: "2026-09-05",
    },
    label: "Super User",
    phone: "628123456789",
    role: "Tenant Admin",
    isSuperOwner: false,
    avatarBuffer: null,
  });

  assert.ok(cardBuffer instanceof Buffer);
  assert.ok(cardBuffer.length > 0);

  const metadata = await sharp(cardBuffer).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 450);
  assert.equal(metadata.format, "png");
});

void test("ProfileCardService: generates card with custom avatar buffer", async () => {
  const service = new ProfileCardService();
  const profile = makeFakeProfile({ experience: 160000 }); // Legend

  // Generate a simple test 100x100 avatar
  const testAvatar = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 50, g: 150, b: 250, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const cardBuffer = await service.generateCard({
    view: {
      profile,
      rank: "Legend",
      createdAtWib: "2026-09-05",
    },
    label: "Legendary Gamer",
    phone: "628999888777",
    role: "Member",
    isSuperOwner: false,
    avatarBuffer: testAvatar,
  });

  assert.ok(cardBuffer instanceof Buffer);
  const metadata = await sharp(cardBuffer).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 450);
});

void test("ProfileCardService: generates card for Super Owner", async () => {
  const service = new ProfileCardService();
  const profile = makeFakeProfile({ experience: 999999 });

  const cardBuffer = await service.generateCard({
    view: {
      profile,
      rank: "Immortal [MAX]",
      createdAtWib: "2026-09-05",
    },
    label: "The Creator",
    phone: "628111111111",
    role: "Super Owner (Master)",
    isSuperOwner: true,
    avatarBuffer: null,
  });

  assert.ok(cardBuffer instanceof Buffer);
  const metadata = await sharp(cardBuffer).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 450);
});
