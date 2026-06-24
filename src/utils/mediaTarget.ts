import type { WAMessage, WAMessageContent } from "@whiskeysockets/baileys";

import type { CommandContext } from "../types/command";

export interface ImageMediaTarget {
  message: WAMessage;
  fileLength?: number;
  mimetype?: string;
}

export type MediaTargetType = "image" | "video" | "sticker";

export interface MediaTarget {
  type: MediaTargetType;
  message: WAMessage;
  fileLength?: number;
  mimetype?: string;
  isAnimated?: boolean;
  seconds?: number;
}

export function resolveImageMediaTarget(context: CommandContext): ImageMediaTarget | null {
  const currentImage = extractMediaInfo(context.message.message);
  if (currentImage?.type === "image") {
    return {
      message: context.message,
      fileLength: currentImage.fileLength,
      mimetype: currentImage.mimetype,
    };
  }

  if (!context.quoted?.message || !context.quoted.id) {
    return null;
  }

  const quotedImage = extractMediaInfo(context.quoted.message);
  if (quotedImage?.type !== "image") {
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

export function resolveMediaTarget(
  context: CommandContext,
  allowedTypes: readonly MediaTargetType[],
): MediaTarget | null {
  const currentMedia = extractMediaInfo(context.message.message);
  if (currentMedia && allowedTypes.includes(currentMedia.type)) {
    return {
      ...currentMedia,
      message: context.message,
    };
  }

  if (!context.quoted?.message || !context.quoted.id) {
    return null;
  }

  const quotedMedia = extractMediaInfo(context.quoted.message);
  if (!quotedMedia || !allowedTypes.includes(quotedMedia.type)) {
    return null;
  }

  return {
    ...quotedMedia,
    message: {
      key: {
        remoteJid: context.chatJid,
        id: context.quoted.id,
        fromMe: false,
        participant: context.quoted.participantJid,
      },
      message: context.quoted.message,
    },
  };
}

function extractMediaInfo(
  content: WAMessageContent | null | undefined,
): Omit<MediaTarget, "message"> | null {
  const unwrappedContent = unwrapMessageContent(content);
  const imageMessage = unwrappedContent?.imageMessage;
  const videoMessage = unwrappedContent?.videoMessage;
  const stickerMessage = unwrappedContent?.stickerMessage;

  if (imageMessage) {
    return {
      type: "image",
      fileLength: toNumber(imageMessage.fileLength),
      mimetype: imageMessage.mimetype ?? undefined,
    };
  }

  if (videoMessage) {
    return {
      type: "video",
      fileLength: toNumber(videoMessage.fileLength),
      mimetype: videoMessage.mimetype ?? undefined,
      seconds: toNumber(videoMessage.seconds),
    };
  }

  if (stickerMessage) {
    return {
      type: "sticker",
      fileLength: toNumber(stickerMessage.fileLength),
      mimetype: stickerMessage.mimetype ?? undefined,
      isAnimated: Boolean(stickerMessage.isAnimated),
    };
  }

  return null;
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
