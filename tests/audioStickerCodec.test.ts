import assert from "node:assert/strict";
import test from "node:test";
import {
  generateWAMessageFromContent,
  normalizeMessageContent,
  proto,
} from "@whiskeysockets/baileys";
import { Reader } from "protobufjs/minimal";

import {
  attachSoundStickerAudio,
  getDecodedAudioSticker,
  getSoundStickerAudio,
  installAudioStickerCodecHooks,
  markAudioStickerEnvelope,
  patchAudioStickerBeforeSending,
} from "../src/bot/proto/audioStickerCodec";
import { extractSoundStickerMetadata } from "../src/utils/mediaTarget";

function readTopLevelWireFieldNumbers(bytes: Uint8Array): number[] {
  const reader = Reader.create(bytes);
  const fields: number[] = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    fields.push(tag >>> 3);
    reader.skipType(tag & 7);
  }
  return fields;
}

void test("AudioStickerCodec: standard messages remain completely untouched by hooks and patcher", () => {
  installAudioStickerCodecHooks();
  installAudioStickerCodecHooks();

  const samples: proto.IMessage[] = [
    { conversation: "Halo minji" },
    {
      imageMessage: {
        url: "https://mmg.whatsapp.net/img.enc",
        mimetype: "image/jpeg",
        fileLength: 1024,
      },
    },
    {
      videoMessage: {
        url: "https://mmg.whatsapp.net/vid.enc",
        mimetype: "video/mp4",
        seconds: 4,
      },
    },
    {
      ptvMessage: {
        url: "https://mmg.whatsapp.net/ptv.enc",
        mimetype: "video/mp4",
        seconds: 3,
      },
    },
    {
      stickerMessage: {
        url: "https://mmg.whatsapp.net/stk.enc",
        mimetype: "image/webp",
        isAnimated: true,
        width: 512,
        height: 512,
      },
    },
    {
      deviceSentMessage: {
        destinationJid: "628123456789@s.whatsapp.net",
        message: { conversation: "Self sync message" },
      },
    },
  ];

  for (const sample of samples) {
    const patched = patchAudioStickerBeforeSending(sample);
    assert.equal(patched, sample, "Standard message reference must be returned untouched");

    const encoded = proto.Message.encode(patched).finish();
    const fieldNums = readTopLevelWireFieldNumbers(encoded);
    assert.ok(!fieldNums.includes(134), "Standard message must not emit wire tag 134");

    const decoded = proto.Message.decode(encoded);
    assert.equal(getDecodedAudioSticker(decoded), undefined);
    assert.equal(getSoundStickerAudio(decoded.stickerMessage), undefined);
    assert.equal(extractSoundStickerMetadata(decoded), null);
  }
});

void test("AudioStickerCodec: Symbol markers are non-enumerable and ignored by JSON/normalizeMessageContent", () => {
  installAudioStickerCodecHooks();

  const msg: proto.IMessage = {
    stickerMessage: proto.Message.StickerMessage.create({
      mimetype: "image/webp",
      isAnimated: true,
    }),
  };

  if (!msg.stickerMessage) {
    throw new Error("Expected stickerMessage");
  }

  attachSoundStickerAudio(msg.stickerMessage, {
    mimetype: "audio/ogg; codecs=opus",
    seconds: 2,
    ptt: false,
  });
  markAudioStickerEnvelope(msg);

  assert.deepEqual(Object.keys(msg.stickerMessage), ["mimetype", "isAnimated"]);
  assert.deepEqual(Object.keys(msg), ["stickerMessage"]);
  assert.doesNotThrow(() => JSON.stringify(msg));

  const normalized = normalizeMessageContent(msg);
  assert.ok(normalized?.stickerMessage);
  assert.equal(normalized.stickerMessage.mimetype, "image/webp");
});

void test("AudioStickerCodec: Sound Sticker encodes tag 134 -> tag 26 and decodes round-trip cleanly", () => {
  installAudioStickerCodecHooks();

  const stickerProto = proto.Message.StickerMessage.fromObject({
    url: "https://mmg.whatsapp.net/sticker.enc",
    directPath: "/v/sticker.enc",
    mediaKey: new Uint8Array(32).fill(1),
    fileSha256: new Uint8Array(32).fill(2),
    fileEncSha256: new Uint8Array(32).fill(3),
    fileLength: 12345,
    mimetype: "image/webp",
    isAnimated: true,
    width: 512,
    height: 512,
  });

  const audioProto = proto.Message.AudioMessage.fromObject({
    url: "https://mmg.whatsapp.net/audio.enc",
    directPath: "/v/audio.enc",
    mediaKey: new Uint8Array(32).fill(4),
    fileSha256: new Uint8Array(32).fill(5),
    fileEncSha256: new Uint8Array(32).fill(6),
    fileLength: 2345,
    mimetype: "audio/ogg; codecs=opus",
    seconds: 3,
    ptt: false,
    waveform: new Uint8Array([10, 40, 80, 30]),
  });

  const built = generateWAMessageFromContent(
    "120363000000000000@g.us",
    { stickerMessage: stickerProto },
    {
      userJid: "628111111111@s.whatsapp.net",
      messageId: "3EB01234567890",
    },
  );

  assert.ok(built.message?.stickerMessage);
  attachSoundStickerAudio(built.message.stickerMessage, audioProto);
  markAudioStickerEnvelope(built.message);

  const patched = patchAudioStickerBeforeSending(built.message);
  assert.notEqual(patched, built.message);

  const wireBytes = proto.Message.encode(patched).finish();
  const topFields = readTopLevelWireFieldNumbers(wireBytes);
  assert.ok(topFields.includes(134), "Encoded Sound Sticker must include tag 134");
  assert.ok(!topFields.includes(26), "Root Message must not place stickerMessage at tag 26");

  const decoded = proto.Message.decode(wireBytes);
  const info = getDecodedAudioSticker(decoded);
  assert.ok(info?.rawFutureProofFound);
  assert.ok(info.stickerMessage);
  assert.ok(info.audioMessage);
  assert.equal(info.stickerMessage.mimetype, "image/webp");
  assert.equal(info.stickerMessage.isAnimated, true);
  assert.equal(info.audioMessage.mimetype, "audio/ogg; codecs=opus");
  assert.equal(info.audioMessage.seconds, 3);
  assert.equal(info.audioMessage.ptt, false);
  assert.equal(info.audioMessage.url, "https://mmg.whatsapp.net/audio.enc");

  const metaSummary = extractSoundStickerMetadata(decoded);
  assert.ok(metaSummary);
  assert.equal(metaSummary.hasAudioStickerTag, true);
  assert.equal(metaSummary.hasStickerMessage, true);
  assert.equal(metaSummary.hasAudioMessage, true);
  assert.equal(metaSummary.seconds, 3);
  assert.equal(metaSummary.hasWaveform, true);
  assert.equal(metaSummary.waveformLength, 4);
});

void test("AudioStickerCodec: patchAudioStickerBeforeSending patches deviceSentMessage wrapper for 1:1 DM companion devices", () => {
  installAudioStickerCodecHooks();

  const inner: proto.IMessage = {
    stickerMessage: proto.Message.StickerMessage.create({
      mimetype: "image/webp",
      isAnimated: true,
    }),
  };
  assert.ok(inner.stickerMessage);
  attachSoundStickerAudio(inner.stickerMessage, {
    mimetype: "audio/ogg; codecs=opus",
    seconds: 2,
    ptt: false,
  });
  markAudioStickerEnvelope(inner);

  const dsm: proto.IMessage = {
    deviceSentMessage: {
      destinationJid: "628222222222@s.whatsapp.net",
      message: inner,
    },
  };

  const patched = patchAudioStickerBeforeSending(dsm);
  const wireBytes = proto.Message.encode(patched).finish();
  const decoded = proto.Message.decode(wireBytes);
  const decodedInner = decoded.deviceSentMessage?.message;
  const info = getDecodedAudioSticker(decodedInner);

  assert.ok(info?.rawFutureProofFound);
  assert.equal(info.audioMessage?.seconds, 2);
});
