import assert from "node:assert/strict";
import test from "node:test";
import { TenantStatus } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { MenuService } from "../src/services/menu/menu.service";
import { TenantPanelService } from "../src/services/tenant/tenantPanel.service";
import type { CommandContext } from "../src/types/command";
import { buildTenantGroup, buildCommandContext } from "./helpers/factories";

function extractCommandTokens(text: string): string[] {
  const lines = text.split("\n");
  const commands: string[] = [];

  for (const line of lines) {
    // Only parse bullet/guide lines that declare commands
    if (line.includes("• .") || line.startsWith("•") || line.includes("Format: .")) {
      const matches = line.matchAll(/(?:^|[\s/])\.([a-z0-9]+)/gi);
      for (const match of matches) {
        const cmd = match[1]?.toLowerCase();
        if (cmd) {
          commands.push(cmd);
        }
      }
    }
  }

  return [...new Set(commands)];
}

test("menuRegistryConsistency - all commands declared in menuService must exist in commandRouter", async () => {
  const fakeTenantGroup = buildTenantGroup({
    id: "tenant-1",
    groupJid: "12345@g.us",
    tenantCode: "GRP1",
    name: "Test Group",
    status: TenantStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 86400000),
    ownerJid: "628111@s.whatsapp.net",
  });

  const createMockContext = (role: CommandContext["role"], isGroup: boolean): CommandContext =>
    buildCommandContext({
      chatJid: isGroup ? "12345@g.us" : "628111@s.whatsapp.net",
      senderJid: "628111@s.whatsapp.net",
      senderUserJid: "628111@s.whatsapp.net",
      isGroup,
      role,
      tenantGroup: isGroup ? fakeTenantGroup : undefined,
      commandName: "menu",
      args: [],
      mentionedJids: [],
    });

  const mockTenantFeatureRepo: any = {
    ensureForGroup: async () => ({
      antiLinkEnabled: true,
      antiSpamEnabled: true,
      antiDeleteEnabled: true,
      antiRaidEnabled: true,
      welcomeEnabled: true,
      goodbyeEnabled: true,
      gameEnabled: true,
      downloaderEnabled: true,
      hdEnabled: true,
      reminderEnabled: true,
      tagAllEnabled: true,
    }),
    findByGroupJid: async () => ({
      antiLinkEnabled: true,
      antiSpamEnabled: true,
      antiDeleteEnabled: true,
      antiRaidEnabled: true,
      welcomeEnabled: true,
      goodbyeEnabled: true,
      gameEnabled: true,
      downloaderEnabled: true,
      hdEnabled: true,
      reminderEnabled: true,
      tagAllEnabled: true,
    }),
  };

  const menu = new MenuService(mockTenantFeatureRepo);

  const menusToTest: string[] = [
    menu.buildOwnerMenu(),
    menu.buildTenantOwnerMenu(),
    menu.buildFeatureMenu(),
    await menu.buildMenu(createMockContext("SUPER_OWNER", true)),
    await menu.buildMenu(createMockContext("TENANT_OWNER", true)),
    await menu.buildMenu(createMockContext("TENANT_ADMIN", true)),
    await menu.buildMenu(createMockContext("MEMBER", true)),
    await menu.buildMenu(createMockContext("SUPER_OWNER", false)),
    await menu.buildMenu(createMockContext("TENANT_OWNER", false)),
    await menu.buildMenu(createMockContext("MEMBER", false)),
  ];

  // Also test tenant panel quick control lines
  const mockTenantGroupRepo: any = {
    findByGroupJid: async () => fakeTenantGroup,
    findActiveByCode: async () => fakeTenantGroup,
  };
  const mockTenantAdminRepo: any = {
    listByGroupJid: async () => [],
  };
  const mockTenantSettingRepo: any = {
    ensureForGroup: async () => ({
      antiLinkAutoKick: false,
      antiSpamMode: "COOLDOWN",
      antiRaidThreshold: 4,
      warnThreshold: 3,
      warnAction: "KICK",
    }),
  };

  const panelService = new TenantPanelService(
    mockTenantGroupRepo,
    mockTenantAdminRepo,
    mockTenantFeatureRepo,
    mockTenantSettingRepo,
  );

  const panelResult = await panelService.renderPanel(createMockContext("TENANT_OWNER", true));
  menusToTest.push(panelResult.message);

  const missingCommands: { menuIdx: number; command: string }[] = [];

  menusToTest.forEach((menuText, idx) => {
    const commands = extractCommandTokens(menuText);
    for (const cmd of commands) {
      if (!commandRouter.has(cmd)) {
        missingCommands.push({ menuIdx: idx, command: cmd });
      }
    }
  });

  assert.deepEqual(
    missingCommands,
    [],
    `Ditemukan perintah di menu yang tidak terdaftar di commandRouter: ${JSON.stringify(missingCommands)}`,
  );
});
