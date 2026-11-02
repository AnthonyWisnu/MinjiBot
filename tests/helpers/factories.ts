import {
  AntiSpamMode,
  TenantStatus,
  type GroupMemberProfile,
  type TenantFeatureSetting,
  type TenantGroup,
  type TenantGroupSetting,
} from "@prisma/client";
import type { WASocket, proto } from "@whiskeysockets/baileys";
import type { CommandContext } from "../../src/types/command";

export function buildTenantGroup(overrides: Partial<TenantGroup> = {}): TenantGroup {
  return {
    id: "tenant-group-id",
    groupJid: "120363000000000000@g.us",
    tenantCode: "MINJI1",
    name: "Minji Test Group",
    status: TenantStatus.ACTIVE,
    ownerJid: "628111111111@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildTenantFeatureSetting(
  overrides: Partial<TenantFeatureSetting> = {},
): TenantFeatureSetting {
  return {
    id: "tenant-feature-id",
    groupJid: "120363000000000000@g.us",
    downloaderEnabled: true,
    hdEnabled: true,
    gameEnabled: true,
    welcomeEnabled: true,
    goodbyeEnabled: true,
    antiLinkEnabled: true,
    antiSpamEnabled: true,
    antiDeleteEnabled: true,
    antiRaidEnabled: true,
    reminderEnabled: true,
    tagAllEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildTenantGroupSetting(
  overrides: Partial<TenantGroupSetting> = {},
): TenantGroupSetting {
  return {
    id: "tenant-setting-id",
    groupJid: "120363000000000000@g.us",
    welcomeMessage: null,
    goodbyeMessage: null,
    antiLinkAutoKick: false,
    antiSpamMode: AntiSpamMode.NORMAL,
    tagAllCooldownSec: 600,
    remindAllCooldownSec: 600,
    warnThreshold: 3,
    warnAction: "KICK",
    antiRaidThreshold: 4,
    antiRaidWindowSec: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildMemberProfile(
  overrides: Partial<GroupMemberProfile> = {},
): GroupMemberProfile {
  return {
    id: "profile-id",
    groupJid: "120363000000000000@g.us",
    userJid: "628222222222@s.whatsapp.net",
    pointsBalance: 100,
    totalPointsEarned: 100,
    limitBalance: 10,
    reservedLimit: 0,
    totalLimitsEarned: 10,
    experience: 0,
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastDailyClaimAt: null,
    messageCount: 0,
    lastActiveAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface MockSocketReturn {
  socket: WASocket;
  sentMessages: Array<{ jid: string; content: unknown; options?: unknown }>;
  groupUpdates: Array<{ jid: string; mode: string }>;
}

export function buildMockSocket(overrides: Partial<WASocket> = {}): MockSocketReturn {
  const sentMessages: Array<{ jid: string; content: unknown; options?: unknown }> = [];
  const groupUpdates: Array<{ jid: string; mode: string }> = [];

  const socket = {
    sendMessage: async (jid: string, content: unknown, options?: unknown) => {
      sentMessages.push({ jid, content, options });
      return { key: { id: "msg-id", remoteJid: jid } } as proto.WebMessageInfo;
    },
    groupSettingUpdate: async (
      jid: string,
      mode: "announcement" | "not_announcement" | "locked" | "unlocked",
    ) => {
      groupUpdates.push({ jid, mode });
    },
    groupRevokeInvite: async (_jid: string) => "new-code",
    groupMetadata: async (jid: string) => ({
      id: jid,
      subject: "Test Group",
      participants: [
        { id: "628111111111@s.whatsapp.net", admin: "superadmin" },
        { id: "628999999999@s.whatsapp.net", admin: "admin" },
      ],
    }),
    groupParticipantsUpdate: async (_jid: string, _participants: string[], _action: string) => {},
    ...overrides,
  } as unknown as WASocket;

  return { socket, sentMessages, groupUpdates };
}

export function buildCommandContext(
  overrides: Partial<CommandContext> = {},
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  const defaultTenantGroup = buildTenantGroup();

  const context: CommandContext = {
    chatJid: defaultTenantGroup.groupJid,
    senderJid: "628222222222@s.whatsapp.net",
    senderUserJid: "628222222222@s.whatsapp.net",
    senderAltJids: ["628222222222@s.whatsapp.net"],
    isGroup: true,
    role: "MEMBER",
    tenantGroup: defaultTenantGroup,
    commandName: "test",
    args: [],
    argsText: "",
    text: ".test",
    mentionedJids: [],
    reply: async (text: string) => {
      replies.push(text);
    },
    socket: buildMockSocket().socket,
    message: {} as proto.IWebMessageInfo,
    ...overrides,
  };

  return Object.assign(context, { replies });
}
