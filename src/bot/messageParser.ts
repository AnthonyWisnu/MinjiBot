import type { proto, WAMessage, WAMessageContent, WASocket } from "@whiskeysockets/baileys";

import { env } from "../config/env";
import type { CommandContext, QuotedMessageContext } from "../types/command";
import {
  extractMessageKeyAltJids,
  getMessageSenderJid,
  getPreferredUserJid,
  getUniqueNormalizedJids,
  isGroupJid,
  isStatusBroadcastJid,
} from "../utils/jid";
import { extractTextFromMessageContent } from "../utils/messageText";

export function parseCommandMessage(socket: WASocket, message: WAMessage): CommandContext | null {
  if (message.key.fromMe) {
    return null;
  }

  const chatJid = message.key.remoteJid;
  if (!chatJid || isStatusBroadcastJid(chatJid)) {
    return null;
  }

  const content = unwrapMessageContent(message.message);
  if (!content) {
    return null;
  }

  const text = extractMessageText(content).trim();
  if (!text.startsWith(env.COMMAND_PREFIX)) {
    return null;
  }

  const commandText = text.slice(env.COMMAND_PREFIX.length).trim();
  if (commandText.length === 0) {
    return null;
  }

  const [commandName, ...args] = commandText.split(/\s+/);
  if (!commandName) {
    return null;
  }

  const argsText = commandText.slice(commandName.length).trim();
  const senderJid = getMessageSenderJid(chatJid, message.key.participant);
  const senderAltJids = getMessageSenderAltJids(message);
  const senderUserJid = getPreferredUserJid(
    senderAltJids.includes(senderJid) ? senderAltJids : [senderJid, ...senderAltJids],
  );

  const mentionedJids = extractMentionedJids(content);
  const knownJids = [...new Set([...mentionedJids, ...senderAltJids, senderJid, senderUserJid])];

  return {
    socket,
    message,
    chatJid,
    senderJid,
    senderUserJid,
    senderAltJids,
    isGroup: isGroupJid(chatJid),
    commandName: commandName.toLowerCase(),
    args,
    argsText,
    text,
    mentionedJids,
    role: "MEMBER",
    quoted: extractQuotedMessage(content),
    reply: async (replyText: string, options?: { mentions?: string[] }) => {
      await socket.sendMessage(
        chatJid,
        {
          text: replyText,
          mentions: resolveReplyMentions(replyText, options?.mentions, knownJids),
        },
        {
          quoted: message,
        },
      );
    },
  };
}

export function parseSyntheticCommandMessage(
  socket: WASocket,
  message: WAMessage,
  syntheticText: string,
): CommandContext | null {
  if (message.key.fromMe) {
    return null;
  }

  const chatJid = message.key.remoteJid;
  if (!chatJid || isStatusBroadcastJid(chatJid)) {
    return null;
  }

  const content = unwrapMessageContent(message.message);
  if (!content) {
    return null;
  }

  const text = syntheticText.trim();
  if (!text.startsWith(env.COMMAND_PREFIX)) {
    return null;
  }

  const commandText = text.slice(env.COMMAND_PREFIX.length).trim();
  if (commandText.length === 0) {
    return null;
  }

  const [commandName, ...args] = commandText.split(/\s+/);
  if (!commandName) {
    return null;
  }

  const argsText = commandText.slice(commandName.length).trim();
  const senderJid = getMessageSenderJid(chatJid, message.key.participant);
  const senderAltJids = getMessageSenderAltJids(message);
  const senderUserJid = getPreferredUserJid(
    senderAltJids.includes(senderJid) ? senderAltJids : [senderJid, ...senderAltJids],
  );

  const mentionedJids = extractMentionedJids(content);
  const knownJids = [...new Set([...mentionedJids, ...senderAltJids, senderJid, senderUserJid])];

  return {
    socket,
    message,
    chatJid,
    senderJid,
    senderUserJid,
    senderAltJids,
    isGroup: isGroupJid(chatJid),
    commandName: commandName.toLowerCase(),
    args,
    argsText,
    text,
    mentionedJids,
    role: "MEMBER",
    quoted: extractQuotedMessage(content),
    reply: async (replyText: string, options?: { mentions?: string[] }) => {
      await socket.sendMessage(
        chatJid,
        {
          text: replyText,
          mentions: resolveReplyMentions(replyText, options?.mentions, knownJids),
        },
        {
          quoted: message,
        },
      );
    },
  };
}

export function parseRawMessageContext(
  socket: WASocket,
  message: WAMessage,
): CommandContext | null {
  if (message.key.fromMe) {
    return null;
  }

  const chatJid = message.key.remoteJid;
  if (!chatJid || isStatusBroadcastJid(chatJid)) {
    return null;
  }

  const content = unwrapMessageContent(message.message);
  if (!content) {
    return null;
  }

  const text = extractMessageText(content).trim();
  const senderJid = getMessageSenderJid(chatJid, message.key.participant);
  const senderAltJids = getMessageSenderAltJids(message);
  const senderUserJid = getPreferredUserJid(
    senderAltJids.includes(senderJid) ? senderAltJids : [senderJid, ...senderAltJids],
  );
  const mentionedJids = extractMentionedJids(content);
  const knownJids = [...new Set([...mentionedJids, ...senderAltJids, senderJid, senderUserJid])];

  return {
    socket,
    message,
    chatJid,
    senderJid,
    senderUserJid,
    senderAltJids,
    isGroup: isGroupJid(chatJid),
    commandName: "",
    args: text.length > 0 ? text.split(/\s+/) : [],
    argsText: text,
    text,
    mentionedJids,
    role: "MEMBER",
    quoted: extractQuotedMessage(content),
    reply: async (replyText: string, options?: { mentions?: string[] }) => {
      await socket.sendMessage(
        chatJid,
        {
          text: replyText,
          mentions: resolveReplyMentions(replyText, options?.mentions, knownJids),
        },
        {
          quoted: message,
        },
      );
    },
  };
}

function resolveReplyMentions(
  replyText: string,
  explicitMentions: string[] | undefined,
  knownJids: readonly string[],
): string[] | undefined {
  if (explicitMentions && explicitMentions.length > 0) {
    return explicitMentions;
  }

  const matches = replyText.match(/@(\d{5,25})/g);
  if (!matches) {
    return undefined;
  }

  return matches.map((token) => {
    const digits = token.slice(1);
    const knownPhone = knownJids.find((jid) => jid === `${digits}@s.whatsapp.net`);
    if (knownPhone) {
      return knownPhone;
    }
    const knownLid = knownJids.find((jid) => jid === `${digits}@lid`);
    return knownLid ?? `${digits}@s.whatsapp.net`;
  });
}

function extractMentionedJids(content: WAMessageContent): string[] {
  const contextInfo = getContextInfo(content);

  return getUniqueNormalizedJids(contextInfo?.mentionedJid ?? []);
}

function getMessageSenderAltJids(message: WAMessage): string[] {
  return extractMessageKeyAltJids(message.key);
}

function unwrapMessageContent(
  content: WAMessageContent | null | undefined,
): WAMessageContent | null {
  if (!content) {
    return null;
  }

  const ephemeralMessage = content.ephemeralMessage?.message;
  if (ephemeralMessage) {
    return unwrapMessageContent(ephemeralMessage);
  }

  const documentWithCaptionMessage = content.documentWithCaptionMessage?.message;
  if (documentWithCaptionMessage) {
    return unwrapMessageContent(documentWithCaptionMessage);
  }

  return content;
}

function extractMessageText(content: WAMessageContent): string {
  return extractTextFromMessageContent(content);
}

function extractQuotedMessage(content: WAMessageContent): QuotedMessageContext | undefined {
  const contextInfo = getContextInfo(content);
  if (!contextInfo?.quotedMessage) {
    return undefined;
  }

  const rawQuoted = contextInfo.quotedMessage;
  if (
    rawQuoted.viewOnceMessage ||
    rawQuoted.viewOnceMessageV2 ||
    (rawQuoted as { viewOnceMessageV2Extension?: unknown }).viewOnceMessageV2Extension
  ) {
    return undefined;
  }

  const quotedContent = unwrapMessageContent(rawQuoted);

  return {
    id: contextInfo.stanzaId ?? undefined,
    participantJid: contextInfo.participant ?? undefined,
    text: quotedContent ? extractMessageText(quotedContent) : undefined,
    message: quotedContent ?? undefined,
  };
}

function getContextInfo(content: WAMessageContent): proto.IContextInfo | null | undefined {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.stickerMessage?.contextInfo
  );
}
