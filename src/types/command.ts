import type { WAMessage, WAMessageContent, WASocket } from "@whiskeysockets/baileys";
import type { TenantGroup } from "@prisma/client";

import type { Role } from "./role";

export interface QuotedMessageContext {
  id?: string;
  participantJid?: string;
  text?: string;
  message?: WAMessageContent;
}

export interface ReplyOptions {
  mentions?: string[];
}

export interface CommandContext {
  socket: WASocket;
  message: WAMessage;
  chatJid: string;
  senderJid: string;
  senderUserJid: string;
  senderAltJids: string[];
  isGroup: boolean;
  commandName: string;
  args: string[];
  argsText: string;
  text: string;
  mentionedJids: string[];
  role: Role;
  tenantGroup?: TenantGroup;
  quoted?: QuotedMessageContext;
  reply: (text: string, options?: ReplyOptions) => Promise<void>;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  execute: (context: CommandContext) => Promise<void>;
}
