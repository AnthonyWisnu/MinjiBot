import { proto } from "@whiskeysockets/baileys";
import { Reader, type Writer } from "protobufjs/minimal";

const AUDIO_STICKER_FIELD_TAG = (134 << 3) | 2;
const FUTURE_PROOF_MESSAGE_FIELD_TAG = (1 << 3) | 2;
const STICKER_AUDIO_FIELD_TAG = (26 << 3) | 2;

const CODEC_INSTALLED_SYM = Symbol.for("minjibot.audioStickerCodecInstalled");

export const SOUND_STICKER_AUDIO_SYM = Symbol("minjibot.soundStickerAudio");
export const AUDIO_STICKER_ENVELOPE_SYM = Symbol("minjibot.audioStickerEnvelope");
export const AUDIO_STICKER_PAYLOAD_SYM = Symbol("minjibot.audioStickerPayload");
export const DECODED_AUDIO_STICKER_SYM = Symbol("minjibot.decodedAudioSticker");

export interface DecodedAudioStickerInfo {
  rawFutureProofFound: boolean;
  stickerMessage?: proto.Message.IStickerMessage;
  audioMessage?: proto.Message.IAudioMessage;
}

function attachNonEnumerableSymbol(target: object, sym: symbol, value: unknown): void {
  Object.defineProperty(target, sym, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function getSymbolValue(target: unknown, sym: symbol): unknown {
  if (typeof target !== "object" || target === null) {
    return undefined;
  }
  return Reflect.get(target, sym);
}

export function attachSoundStickerAudio(
  stickerMessage: proto.Message.IStickerMessage,
  audioMessage: proto.Message.IAudioMessage,
): void {
  attachNonEnumerableSymbol(stickerMessage, SOUND_STICKER_AUDIO_SYM, audioMessage);
}

export function getSoundStickerAudio(
  stickerMessage: proto.Message.IStickerMessage | null | undefined,
): proto.Message.IAudioMessage | undefined {
  return getSymbolValue(stickerMessage, SOUND_STICKER_AUDIO_SYM) as
    | proto.Message.IAudioMessage
    | undefined;
}

export function markAudioStickerEnvelope(message: proto.IMessage): void {
  attachNonEnumerableSymbol(message, AUDIO_STICKER_ENVELOPE_SYM, true);
}

export function hasAudioStickerEnvelope(message: proto.IMessage | null | undefined): boolean {
  return getSymbolValue(message, AUDIO_STICKER_ENVELOPE_SYM) === true;
}

export function getDecodedAudioSticker(
  message: proto.IMessage | null | undefined,
): DecodedAudioStickerInfo | undefined {
  return getSymbolValue(message, DECODED_AUDIO_STICKER_SYM) as
    | DecodedAudioStickerInfo
    | undefined;
}

function extractLengthDelimitedField(slice: Uint8Array, expectedTag: number): Uint8Array | undefined {
  try {
    const reader = Reader.create(slice);
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      if (tag === expectedTag) {
        const length = reader.uint32();
        const end = Math.min(reader.pos + length, reader.len);
        return reader.buf.subarray(reader.pos, end);
      }
      reader.skipType(tag & 7);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function wrapAudioStickerEnvelope(message: proto.IMessage): proto.IMessage {
  if (!message.stickerMessage) {
    return message;
  }

  const innerPayload: proto.IMessage = {
    stickerMessage: message.stickerMessage,
  };

  const envelopeShell: proto.IMessage = message.messageContextInfo
    ? { messageContextInfo: message.messageContextInfo }
    : {};

  attachNonEnumerableSymbol(envelopeShell, AUDIO_STICKER_PAYLOAD_SYM, innerPayload);
  return envelopeShell;
}

/**
 * Callback `patchMessageBeforeSending` untuk `makeWASocket`.
 * Hanya menyentuh pesan yang memiliki marker Symbol Sound Sticker internal;
 * seluruh tipe pesan WhatsApp lain diteruskan apa adanya tanpa mutasi.
 */
export function patchAudioStickerBeforeSending(message: proto.IMessage): proto.IMessage {
  if (hasAudioStickerEnvelope(message)) {
    return wrapAudioStickerEnvelope(message);
  }

  const innerDeviceSent = message.deviceSentMessage?.message;
  if (message.deviceSentMessage && innerDeviceSent && hasAudioStickerEnvelope(innerDeviceSent)) {
    return {
      ...message,
      deviceSentMessage: {
        ...message.deviceSentMessage,
        message: wrapAudioStickerEnvelope(innerDeviceSent),
      },
    };
  }

  return message;
}

/**
 * Memasang hook idempotent pada WAProto encoder/decoder milik `@whiskeysockets/baileys`
 * agar mendukung Sound Sticker WhatsApp (`Message` tag 134 -> `FutureProofMessage` ->
 * `StickerMessage` tag 26 `AudioMessage`) tanpa memodifikasi `node_modules/`.
 */
export function installAudioStickerCodecHooks(): void {
  const messageProto = proto.Message as unknown as Record<symbol, boolean | undefined>;
  if (messageProto[CODEC_INSTALLED_SYM]) {
    return;
  }
  messageProto[CODEC_INSTALLED_SYM] = true;

  const origStickerEncode = proto.Message.StickerMessage.encode.bind(proto.Message.StickerMessage);
  const origAudioEncode = proto.Message.AudioMessage.encode.bind(proto.Message.AudioMessage);
  const origMsgEncode = proto.Message.encode.bind(proto.Message);

  const origStickerDecode = proto.Message.StickerMessage.decode.bind(proto.Message.StickerMessage);
  const origAudioDecode = proto.Message.AudioMessage.decode.bind(proto.Message.AudioMessage);
  const origMsgDecode = proto.Message.decode.bind(proto.Message);

  proto.Message.StickerMessage.encode = function encodeStickerWithAudio(
    message: proto.Message.IStickerMessage,
    writer?: Writer,
  ): Writer {
    const outWriter = origStickerEncode(message, writer);
    const attachedAudio = getSoundStickerAudio(message);
    if (attachedAudio) {
      outWriter.uint32(STICKER_AUDIO_FIELD_TAG).fork();
      origAudioEncode(attachedAudio, outWriter);
      outWriter.ldelim();
    }
    return outWriter;
  };

  proto.Message.StickerMessage.decode = function decodeStickerWithAudio(
    readerOrBytes: Reader | Uint8Array,
    length?: number,
  ): proto.Message.StickerMessage {
    const reader = readerOrBytes instanceof Uint8Array ? Reader.create(readerOrBytes) : readerOrBytes;
    const startPos = reader.pos;
    const decoded = origStickerDecode(reader, length);
    const slice = reader.buf.subarray(startPos, reader.pos);

    const rawAudio = extractLengthDelimitedField(slice, STICKER_AUDIO_FIELD_TAG);
    if (rawAudio) {
      try {
        const audioMessage = origAudioDecode(Reader.create(rawAudio));
        attachSoundStickerAudio(decoded, audioMessage);
      } catch {
        // Abaikan field 26 bila tidak valid sebagai AudioMessage
      }
    }

    return decoded;
  };

  proto.Message.encode = function encodeMessageWithAudioSticker(
    message: proto.IMessage,
    writer?: Writer,
  ): Writer {
    const outWriter = origMsgEncode(message, writer);
    const payload = getSymbolValue(message, AUDIO_STICKER_PAYLOAD_SYM) as proto.IMessage | undefined;
    if (payload) {
      // Field 134 (`audioStickerMessage`: FutureProofMessage) -> Field 1 (`message`: Message)
      outWriter.uint32(AUDIO_STICKER_FIELD_TAG).fork();
      outWriter.uint32(FUTURE_PROOF_MESSAGE_FIELD_TAG).fork();
      origMsgEncode(payload, outWriter);
      outWriter.ldelim();
      outWriter.ldelim();
    }
    return outWriter;
  };

  proto.Message.decode = function decodeMessageWithAudioSticker(
    readerOrBytes: Reader | Uint8Array,
    length?: number,
  ): proto.Message {
    const reader = readerOrBytes instanceof Uint8Array ? Reader.create(readerOrBytes) : readerOrBytes;
    const startPos = reader.pos;
    const decoded = origMsgDecode(reader, length);
    const slice = reader.buf.subarray(startPos, reader.pos);

    const rawFutureProof = extractLengthDelimitedField(slice, AUDIO_STICKER_FIELD_TAG);
    if (rawFutureProof) {
      const info: DecodedAudioStickerInfo = {
        rawFutureProofFound: true,
      };
      const rawInnerMessage = extractLengthDelimitedField(
        rawFutureProof,
        FUTURE_PROOF_MESSAGE_FIELD_TAG,
      );
      if (rawInnerMessage) {
        try {
          const innerMessage = proto.Message.decode(Reader.create(rawInnerMessage));
          if (innerMessage.stickerMessage) {
            info.stickerMessage = innerMessage.stickerMessage;
            info.audioMessage = getSoundStickerAudio(innerMessage.stickerMessage);
          }
        } catch {
          // Pertahankan metadata rawFutureProofFound tanpa mengganggu proses decode normal
        }
      }
      attachNonEnumerableSymbol(decoded, DECODED_AUDIO_STICKER_SYM, info);
    }

    return decoded;
  };
}
