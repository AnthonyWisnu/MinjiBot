import type { proto, WAMessage, WAMessageContent, WASocket } from "@whiskeysockets/baileys";

import { env } from "../config/env";
import type { CommandContext, QuotedMessageContext } from "../types/command";
import {
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
    mentionedJids: extractMentionedJids(content),
    role: "MEMBER",
    quoted: extractQuotedMessage(content),
    reply: async (replyText: string) => {
      await socket.sendMessage(
        chatJid,
        { text: replyText },
        {
          quoted: message,
        },
      );
    },
  };
}

function extractMentionedJids(content: WAMessageContent): string[] {
  const contextInfo = getContextInfo(content);

  return getUniqueNormalizedJids(contextInfo?.mentionedJid ?? []);
}

function getMessageSenderAltJids(message: WAMessage): string[] {
  return getUniqueNormalizedJids([
    message.key.remoteJid,
    message.key.participant,
    message.key.senderPn,
    message.key.participantPn,
    message.key.senderLid,
    message.key.participantLid,
  ]);
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

  const viewOnceMessage = content.viewOnceMessage?.message;
  if (viewOnceMessage) {
    return unwrapMessageContent(viewOnceMessage);
  }

  const viewOnceMessageV2 = content.viewOnceMessageV2?.message;
  if (viewOnceMessageV2) {
    return unwrapMessageContent(viewOnceMessageV2);
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
  if (!contextInfo) {
    return undefined;
  }

  const quotedContent = unwrapMessageContent(contextInfo.quotedMessage);

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
