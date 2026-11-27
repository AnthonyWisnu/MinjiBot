import {
  encryptedStream,
  generateMessageIDV2,
  generateWAMessageFromContent,
  getAudioDuration,
  getAudioWaveform,
  proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { unlink } from "node:fs/promises";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  attachSoundStickerAudio,
  installAudioStickerCodecHooks,
  markAudioStickerEnvelope,
} from "../../bot/proto/audioStickerCodec";

const STICKER_PIXEL_SIZE = 512;

export interface SendSoundStickerParams {
  socket: WASocket;
  chatJid: string;
  webpBuffer: Buffer;
  audioBuffer: Buffer;
  fallbackDurationSeconds: number;
  quoted?: WAMessage;
}

export interface SoundStickerSenderDeps {
  encryptStream: typeof encryptedStream;
  getDuration: typeof getAudioDuration;
  getWaveform: typeof getAudioWaveform;
  generateMessageId: typeof generateMessageIDV2;
  buildMessageFromContent: typeof generateWAMessageFromContent;
  removeTempFile: (filePath: string) => Promise<void>;
}

interface UploadedMediaMeta {
  mediaKey: Uint8Array;
  fileEncSha256: Uint8Array;
  fileSha256: Uint8Array;
  fileLength: number;
  mediaUrl: string;
  directPath: string;
}

const DEFAULT_DEPS: SoundStickerSenderDeps = {
  encryptStream: encryptedStream,
  getDuration: getAudioDuration,
  getWaveform: getAudioWaveform,
  generateMessageId: generateMessageIDV2,
  buildMessageFromContent: generateWAMessageFromContent,
  removeTempFile: safeUnlink,
};

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Abaikan apabila file sementara sudah dihapus sebelumnya
  }
}

export class SoundStickerSenderService {
  private readonly senderLogger = logger.child({ module: "sound-sticker-sender" });

  constructor(private readonly deps: SoundStickerSenderDeps = DEFAULT_DEPS) {}

  async sendSoundSticker(params: SendSoundStickerParams): Promise<string> {
    installAudioStickerCodecHooks();

    const { socket, chatJid, webpBuffer, audioBuffer, fallbackDurationSeconds, quoted } = params;
    const userJid = socket.user?.id;
    if (!userJid) {
      throw new Error("Identitas JID bot belum tersedia untuk mengirim Sound Sticker.");
    }

    if (typeof socket.waUploadToServer !== "function" || typeof socket.relayMessage !== "function") {
      throw new Error("Socket Baileys belum mendukung upload/relay media Sound Sticker.");
    }

    const [uploadedSticker, uploadedAudio, detectedDuration, waveform] = await Promise.all([
      this.encryptAndUploadMedia(socket, webpBuffer, "sticker"),
      this.encryptAndUploadMedia(socket, audioBuffer, "audio"),
      this.deps.getDuration(audioBuffer).catch(() => undefined),
      this.deps.getWaveform(audioBuffer, this.senderLogger).catch(() => undefined),
    ]);

    const mediaKeyTimestamp = Math.floor(Date.now() / 1000);
    const seconds = Math.max(1, Math.round(detectedDuration ?? fallbackDurationSeconds));

    const stickerProto = proto.Message.StickerMessage.fromObject({
      url: uploadedSticker.mediaUrl,
      directPath: uploadedSticker.directPath,
      mediaKey: uploadedSticker.mediaKey,
      fileEncSha256: uploadedSticker.fileEncSha256,
      fileSha256: uploadedSticker.fileSha256,
      fileLength: uploadedSticker.fileLength,
      mediaKeyTimestamp,
      mimetype: "image/webp",
      isAnimated: true,
      width: STICKER_PIXEL_SIZE,
      height: STICKER_PIXEL_SIZE,
      stickerSentTs: Date.now(),
    });

    const audioProto = proto.Message.AudioMessage.fromObject({
      url: uploadedAudio.mediaUrl,
      directPath: uploadedAudio.directPath,
      mediaKey: uploadedAudio.mediaKey,
      fileEncSha256: uploadedAudio.fileEncSha256,
      fileSha256: uploadedAudio.fileSha256,
      fileLength: uploadedAudio.fileLength,
      mediaKeyTimestamp,
      mimetype: "audio/ogg; codecs=opus",
      seconds,
      ptt: false,
      ...(waveform ? { waveform } : {}),
    });

    const messageId = this.deps.generateMessageId(userJid);
    // Bangun quoted context via WAProto.Message.create lebih dulu sebelum menempelkan Symbol,
    // karena WAProto.Message.create membuang properti Symbol.
    const fullMsg = this.deps.buildMessageFromContent(
      chatJid,
      { stickerMessage: stickerProto },
      {
        userJid,
        quoted,
        messageId,
      },
    );

    const outMessage = fullMsg.message;
    if (!outMessage?.stickerMessage) {
      throw new Error("Payload StickerMessage kosong setelah build context pesan.");
    }

    attachSoundStickerAudio(outMessage.stickerMessage, audioProto);
    markAudioStickerEnvelope(outMessage);

    return socket.relayMessage(chatJid, outMessage, {
      messageId: fullMsg.key.id ?? messageId,
    });
  }

  private async encryptAndUploadMedia(
    socket: WASocket,
    buffer: Buffer,
    mediaType: "sticker" | "audio",
  ): Promise<UploadedMediaMeta> {
    const encrypted = await this.deps.encryptStream(buffer, mediaType, {
      logger: this.senderLogger,
      saveOriginalFileIfRequired: false,
    });

    try {
      const uploadResult = await socket.waUploadToServer(encrypted.encFilePath, {
        fileEncSha256B64: encrypted.fileEncSha256.toString("base64"),
        mediaType,
        timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
      });

      return {
        mediaKey: encrypted.mediaKey,
        fileEncSha256: encrypted.fileEncSha256,
        fileSha256: encrypted.fileSha256,
        fileLength: encrypted.fileLength,
        mediaUrl: uploadResult.mediaUrl,
        directPath: uploadResult.directPath,
      };
    } finally {
      await this.deps.removeTempFile(encrypted.encFilePath);
      if (encrypted.originalFilePath) {
        await this.deps.removeTempFile(encrypted.originalFilePath);
      }
    }
  }
}

export const soundStickerSenderService = new SoundStickerSenderService();
