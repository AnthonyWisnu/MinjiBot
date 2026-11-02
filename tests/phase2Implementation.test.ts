import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMetadata } from "@whiskeysockets/baileys";
import sharp from "sharp";

import { tenantGuard } from "../src/guards/tenantGuard";
import { featureGuard } from "../src/guards/featureGuard";
import { identityResolverService } from "../src/services/identity/identityResolver.service";
import { imageEnhanceService } from "../src/services/media/imageEnhance.service";
import { MAX_SLOT_BET } from "../src/services/game/slotGame.service";
import { DataPrivacyService } from "../src/services/privacy/dataPrivacy.service";
import { AppUserError } from "../src/errors/appUserError";
import type { CommandContext } from "../src/types/command";

process.env.SUPER_OWNER_JIDS = "628000000101@s.whatsapp.net";

void test("IdentityResolverService: resolves canonical phone JID from LID in group metadata", async () => {
  const mockMetadata: GroupMetadata = {
    id: "120363001@g.us",
    subject: "Test Group",
    participants: [
      {
        id: "111111111@lid",
        jid: "6281234567890@s.whatsapp.net",
        lid: "111111111@lid",
        admin: "admin",
      },
      {
        id: "6289876543210@s.whatsapp.net",
        admin: null,
      },
    ],
  } as unknown as GroupMetadata;

  const mockSocket = {
    groupMetadata: async () => mockMetadata,
  };

  const canonical1 = await identityResolverService.resolveCanonicalUserJid(
    mockSocket as never,
    "120363001@g.us",
    "111111111@lid",
  );
  assert.equal(canonical1, "6281234567890@s.whatsapp.net");

  const canonical2 = await identityResolverService.resolveCanonicalUserJid(
    mockSocket as never,
    "120363001@g.us",
    "6289876543210@s.whatsapp.net",
  );
  assert.equal(canonical2, "6289876543210@s.whatsapp.net");

  const isAdmin = await identityResolverService.isGroupAdmin(
    mockSocket as never,
    "120363001@g.us",
    "111111111@lid",
  );
  assert.equal(isAdmin, true);

  const candidateSet = identityResolverService.getCanonicalCandidateSet(
    mockMetadata,
    "111111111@lid",
  );
  assert.ok(candidateSet.has("111111111@lid"));
  assert.ok(candidateSet.has("6281234567890@s.whatsapp.net"));
});

void test("SlotGame: MAX_SLOT_BET cap is exactly 100,000", () => {
  assert.equal(MAX_SLOT_BET, 100_000);
});

void test("ImageEnhanceService: enhances image with bounded CLAHE and autoOrient", async () => {
  // Create a 128x128 solid test image
  const testInput = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 3,
      background: { r: 50, g: 100, b: 150 },
    },
  })
    .jpeg()
    .toBuffer();

  const standardEnhanced = await imageEnhanceService.enhanceImage(testInput, { mode: "standard" });
  assert.ok(Buffer.isBuffer(standardEnhanced.buffer));
  assert.ok(standardEnhanced.buffer.length > 0);

  const metaStandard = await sharp(standardEnhanced.buffer).metadata();
  assert.ok((metaStandard.width ?? 0) >= 128);

  // Document mode defaults to 3x scale for text clarity
  const documentEnhanced = await imageEnhanceService.enhanceImage(testInput, {
    mode: "document",
  });
  const metaDoc = await sharp(documentEnhanced.buffer).metadata();
  assert.equal(metaDoc.width, 384);
  assert.equal(metaDoc.height, 384);
});

void test("TenantGuard: Super Owner bypasses blocked, expired, and pending tenants", async () => {
  const mockRepo = {
    findByGroupJid: async () => ({
      status: "BLOCKED",
      isBlocked: true,
      ownerJid: "628999@s.whatsapp.net",
    }),
  };

  const customGuard = new (tenantGuard.constructor as any)(mockRepo);

  const resultBlocked = await customGuard.checkGroupCommandAccess({
    chatJid: "120363002@g.us",
    senderUserJid: "628000000101@s.whatsapp.net",
    commandName: "profile",
    isGroup: true,
    role: "SUPER_OWNER",
  } as CommandContext);
  assert.equal(resultBlocked.allowed, true);
});

void test("TenantGuard: Expired tenant allows expired whitelist commands and blocks normal commands", async () => {
  const expiredTenant = {
    id: "t-exp",
    groupJid: "120363003@g.us",
    tenantCode: "EXP01",
    name: "Expired Group",
    status: "EXPIRED" as any,
    ownerJid: "628999@s.whatsapp.net",
    expiresAt: new Date(Date.now() - 3600000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepo = {
    findByGroupJid: async () => expiredTenant,
  };

  const customGuard = new (tenantGuard.constructor as any)(mockRepo);

  // Allowed info commands
  const resPanel = await customGuard.checkGroupCommandAccess({
    chatJid: "120363003@g.us",
    senderUserJid: "628999@s.whatsapp.net",
    commandName: "panel",
    isGroup: true,
    role: "TENANT_OWNER",
  } as CommandContext);
  assert.equal(resPanel.allowed, true);

  const resSewa = await customGuard.checkGroupCommandAccess({
    chatJid: "120363003@g.us",
    senderUserJid: "628999@s.whatsapp.net",
    commandName: "sewa",
    isGroup: true,
    role: "TENANT_OWNER",
  } as CommandContext);
  assert.equal(resSewa.allowed, true);

  // Blocked feature command
  const resGame = await customGuard.checkGroupCommandAccess({
    chatJid: "120363003@g.us",
    senderUserJid: "628999@s.whatsapp.net",
    commandName: "slot",
    isGroup: true,
    role: "TENANT_OWNER",
  } as CommandContext);
  assert.equal(resGame.allowed, false);
  assert.match(resGame.message ?? "", /Masa aktif grup ini sudah habis/);
});

void test("FeatureGuard: correctly maps commands to feature switches", async () => {
  const mockFeatureLookup = {
    isFeatureEnabled: async () => false,
  };

  const customFeatureGuard = new (featureGuard.constructor as any)(mockFeatureLookup);

  const mockContext = {
    chatJid: "120363004@g.us",
    tenantGroup: { groupJid: "120363004@g.us" },
    senderUserJid: "628777@s.whatsapp.net",
    isGroup: true,
    role: "MEMBER",
  };

  const ytCheck = await customFeatureGuard.checkCommandFeature({
    ...mockContext,
    commandName: "yt",
  } as CommandContext);
  assert.equal(ytCheck.allowed, false);

  const slotCheck = await customFeatureGuard.checkCommandFeature({
    ...mockContext,
    commandName: "slot",
  } as CommandContext);
  assert.equal(slotCheck.allowed, false);

  const hidetagCheck = await customFeatureGuard.checkCommandFeature({
    ...mockContext,
    commandName: "hidetag",
  } as CommandContext);
  assert.equal(hidetagCheck.allowed, false);
});

void test("DataPrivacyService: purgeTenant only allows REMOVED or EXPIRED tenants", async () => {
  const activeTenant = {
    tenantCode: "ACT01",
    groupJid: "120363005@g.us",
    status: "ACTIVE" as any,
  };

  const mockTenantRepo = {
    findByTenantCode: async (code: string) => {
      if (code === "ACT01") return activeTenant;
      return null;
    },
  };

  const service = new DataPrivacyService(mockTenantRepo as any, {} as any, {} as any);

  await assert.rejects(
    async () => {
      await service.purgeTenant("ACT01", "628000000101@s.whatsapp.net");
    },
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.match(err.message, /Hanya tenant dengan status REMOVED atau EXPIRED/);
      return true;
    },
  );
});

void test("DataPrivacyService: deleteMyData requires confirmation and blocks users with active warnings", async () => {
  const mockWarnRepo = {
    countActiveWarnings: async () => 2, // Has 2 active warnings
  };

  const service = new DataPrivacyService({} as any, mockWarnRepo as any, {} as any);

  const mockContext = {
    senderUserJid: "628777@s.whatsapp.net",
    senderAltJids: ["628777@s.whatsapp.net"],
    chatJid: "120363006@g.us",
    isGroup: true,
  };

  // 1. Without confirmation
  const unconfirmed = await service.deleteMyData(mockContext as any, false);
  assert.match(unconfirmed, /KONFIRMASI PENGHAPUSAN DATA/);

  // 2. With confirmation but with active warnings
  await assert.rejects(
    async () => {
      await service.deleteMyData(mockContext as any, true);
    },
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.match(
        err.message,
        /Tidak dapat menghapus data di grup ini karena kamu memiliki catatan peringatan/,
      );
      return true;
    },
  );
});
