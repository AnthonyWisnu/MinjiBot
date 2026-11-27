import type { WAMessage, WAMessageContent } from "@whiskeysockets/baileys";

import { getDecodedAudioSticker } from "../bot/proto/audioStickerCodec";
import type { CommandContext } from "../types/command";
import { getBotCanonicalJids, normalizeUserJid } from "./jid";

export interface ImageMediaTarget {
  message: WAMessage;
  fileLength?: number;
  mimetype?: string;
}

export type MediaTargetType = "image" | "video" | "sticker" | "audio";

export interface MediaTarget {
  type: MediaTargetType;
  message: WAMessage;
  fileLength?: number;
  mimetype?: string;
  isAnimated?: boolean;
  seconds?: number;
}

export interface SoundStickerMetadataSummary {
  hasAudioStickerTag: true;
  hasStickerMessage: boolean;
  isAnimated?: boolean;
  stickerMimetype?: string;
  hasAudioMessage: boolean;
  audioMimetype?: string;
  ptt?: boolean;
  seconds?: number;
  hasWaveform: boolean;
  waveformLength?: number;
}

/**
 * Mengekstrak metadata protokol Sound Sticker (wire tag 134 + tag 26) secara read-only
 * untuk keperluan diagnostik tanpa memengaruhi resolver media utama maupun AntiDelete.
 */
export function extractSoundStickerMetadata(
  content: WAMessageContent | null | undefined,
): SoundStickerMetadataSummary | null {
  const unwrapped = unwrapMessageContent(content);
  const decoded = getDecodedAudioSticker(unwrapped);
  if (!decoded) {
    return null;
  }

  const waveform = decoded.audioMessage?.waveform;
  return {
    hasAudioStickerTag: true,
    hasStickerMessage: Boolean(decoded.stickerMessage),
    isAnimated: decoded.stickerMessage?.isAnimated ?? undefined,
    stickerMimetype: decoded.stickerMessage?.mimetype ?? undefined,
    hasAudioMessage: Boolean(decoded.audioMessage),
    audioMimetype: decoded.audioMessage?.mimetype ?? undefined,
    ptt: decoded.audioMessage?.ptt ?? undefined,
    seconds: toNumber(decoded.audioMessage?.seconds),
    hasWaveform: Boolean(waveform && waveform.length > 0),
    waveformLength: waveform ? waveform.length : undefined,
  };
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

  const botJids = getBotCanonicalJids(context.socket);
  const quotedParticipant = context.quoted.participantJid
    ? normalizeUserJid(context.quoted.participantJid)
    : null;
  const isFromMe = quotedParticipant !== null && botJids.has(quotedParticipant);

  return {
    message: {
      key: {
        remoteJid: context.chatJid,
        id: context.quoted.id,
        fromMe: isFromMe,
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

  const botJids = getBotCanonicalJids(context.socket);
  const quotedParticipant = context.quoted.participantJid
    ? normalizeUserJid(context.quoted.participantJid)
    : null;
  const isFromMe = quotedParticipant !== null && botJids.has(quotedParticipant);

  return {
    ...quotedMedia,
    message: {
      key: {
        remoteJid: context.chatJid,
        id: context.quoted.id,
        fromMe: isFromMe,
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
  const audioMessage = unwrappedContent?.audioMessage;

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

  if (audioMessage) {
    return {
      type: "audio",
      fileLength: toNumber(audioMessage.fileLength),
      mimetype: audioMessage.mimetype ?? undefined,
      seconds: toNumber(audioMessage.seconds),
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

  // Wajib tolak pesan privasi View-Once secara total (LOG-05)
  if (
    content.viewOnceMessage ||
    content.viewOnceMessageV2 ||
    (content as { viewOnceMessageV2Extension?: unknown }).viewOnceMessageV2Extension
  ) {
    return null;
  }

  return (
    unwrapMessageContent(content.ephemeralMessage?.message) ??
    unwrapMessageContent(content.documentWithCaptionMessage?.message) ??
    unwrapMessageContent(content.associatedChildMessage?.message) ??
    unwrapMessageContent(content.editedMessage?.message) ??
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
