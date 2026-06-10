import type { WAMessage, WAMessageContent } from "@whiskeysockets/baileys";

import type { CommandContext } from "../types/command";

export interface ImageMediaTarget {
  message: WAMessage;
  fileLength?: number;
  mimetype?: string;
}

export function resolveImageMediaTarget(context: CommandContext): ImageMediaTarget | null {
  const currentImage = extractImageInfo(context.message.message);
  if (currentImage) {
    return {
      message: context.message,
      fileLength: currentImage.fileLength,
      mimetype: currentImage.mimetype,
    };
  }

  if (!context.quoted?.message || !context.quoted.id) {
    return null;
  }

  const quotedImage = extractImageInfo(context.quoted.message);
  if (!quotedImage) {
    return null;
  }

  return {
    message: {
      key: {
        remoteJid: context.chatJid,
        id: context.quoted.id,
        fromMe: false,
        participant: context.quoted.participantJid,
      },
      message: context.quoted.message,
    },
    fileLength: quotedImage.fileLength,
    mimetype: quotedImage.mimetype,
  };
}

function extractImageInfo(
  content: WAMessageContent | null | undefined,
): { fileLength?: number; mimetype?: string } | null {
  const unwrappedContent = unwrapMessageContent(content);
  const imageMessage = unwrappedContent?.imageMessage;

  if (!imageMessage) {
    return null;
  }

  return {
    fileLength: toNumber(imageMessage.fileLength),
    mimetype: imageMessage.mimetype ?? undefined,
  };
}

function unwrapMessageContent(
  content: WAMessageContent | null | undefined,
): WAMessageContent | null {
  if (!content) {
    return null;
  }

  return (
    unwrapMessageContent(content.ephemeralMessage?.message) ??
    unwrapMessageContent(content.viewOnceMessage?.message) ??
    unwrapMessageContent(content.viewOnceMessageV2?.message) ??
    unwrapMessageContent(content.documentWithCaptionMessage?.message) ??
    content
  );
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (value && typeof value === "object" && "toNumber" in value) {
    const maybeLong = value as { toNumber: () => number };
    return maybeLong.toNumber();
  }

  return undefined;
}
