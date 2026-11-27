import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { proto, type WASocket } from "@whiskeysockets/baileys";
import ffmpegStatic from "ffmpeg-static";
import webp from "node-webpmux";
import sharp from "sharp";

import {
  getDecodedAudioSticker,
  installAudioStickerCodecHooks,
  patchAudioStickerBeforeSending,
} from "../src/bot/proto/audioStickerCodec";
import { commandRouter } from "../src/commands";
import { handleSoundSticker, handleSticker } from "../src/commands/media/sticker.command";
import { env } from "../src/config/env";
import { SoundStickerSenderService } from "../src/services/media/soundStickerSender.service";
import {
  DEFAULT_STICKER_AUTHOR,
  DEFAULT_STICKER_PACK,
  stickerService,
} from "../src/services/media/sticker.service";
import { runExternalProcess } from "../src/utils/processRunner";
import { createTempDir, removeTempDir } from "../src/utils/tempFile";
import { buildCommandContext } from "./helpers/factories";

async function generateSyntheticMp4(withAudio: boolean): Promise<Buffer> {
  const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
  const tempDir = await createTempDir("sound-sticker-test");
  const outPath = path.join(tempDir, withAudio ? "with-audio.mp4" : "silent.mp4");

  try {
    const args = withAudio
      ? [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x8ACE00:s=320x320:d=1.4",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1.4",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          outPath,
        ]
      : [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x3366FF:s=320x320:d=1.2",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          outPath,
        ];

    await runExternalProcess(ffmpegPath, args, { timeoutMs: 30_000 });
    return await readFile(outPath);
  } finally {
    await removeTempDir(tempDir);
  }
}

void test("StickerService.createVideoStickerWithSound: video dengan audio mengekstrak WebP berbranding + OGG Opus", async () => {
  const mp4Buffer = await generateSyntheticMp4(true);
  const result = await stickerService.createVideoStickerWithSound(mp4Buffer);

  assert.equal(result.hasAudio, true);
  assert.equal(result.webpBuffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(result.webpBuffer.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(result.audioBuffer.byteLength > 100);
  assert.equal(result.audioBuffer.subarray(0, 4).toString("ascii"), "OggS");

  const img = new webp.Image();
  await img.load(result.webpBuffer);
  assert.ok(img.exif, "Sticker WebP wajib memiliki EXIF pack MinjiBot");
  const exifText = img.exif.toString("utf8");
  assert.ok(exifText.includes(DEFAULT_STICKER_PACK));
  assert.ok(exifText.includes(DEFAULT_STICKER_AUTHOR));
});

void test("StickerService.createVideoStickerWithSound: video bisu fallback mulus ke hasAudio: false", async () => {
  const silentMp4 = await generateSyntheticMp4(false);
  const result = await stickerService.createVideoStickerWithSound(silentMp4);

  assert.equal(result.hasAudio, false);
  assert.equal(result.webpBuffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(result.webpBuffer.subarray(8, 12).toString("ascii"), "WEBP");
});

void test("StickerService.createSticker: mode gambar tetap menghasilkan stiker statis tanpa regresi", async () => {
  const pngBuffer = await sharp({
    create: {
      width: 240,
      height: 240,
      channels: 4,
      background: { r: 255, g: 128, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const staticWebp = await stickerService.createSticker(pngBuffer, "image");
  const meta = await sharp(staticWebp).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
});

void test("SoundStickerSenderService: mengunggah dua stream terenkripsi, merelay tag 134+26, dan selalu membersihkan file sementara", async () => {
  installAudioStickerCodecHooks();

  const removedFiles: string[] = [];
  const uploadedMediaTypes: string[] = [];
  let relayedMessage: proto.IMessage | null = null;
  let relayedChatJid = "";

  const sender = new SoundStickerSenderService({
    encryptStream: (media, mediaType) => {
      const len = Buffer.isBuffer(media) ? media.byteLength : 100;
      const suffix = mediaType === "sticker" ? "stk" : "aud";
      return Promise.resolve({
        mediaKey: Buffer.alloc(32, 7),
        originalFilePath: `C:/temp/orig-${suffix}`,
        encFilePath: `C:/temp/enc-${suffix}`,
        mac: Buffer.alloc(10, 8),
        fileEncSha256: Buffer.alloc(32, 9),
        fileSha256: Buffer.alloc(32, 10),
        fileLength: len,
      });
    },
    getDuration: () => Promise.resolve(2.4),
    getWaveform: () => Promise.resolve(new Uint8Array([12, 55, 88, 22])),
    generateMessageId: () => "3EB0SOUNDSTICKERTEST",
    buildMessageFromContent: (jid, message, options) => ({
      key: {
        remoteJid: jid,
        fromMe: true,
        id: options.messageId ?? "3EB0SOUNDSTICKERTEST",
      },
      message: proto.Message.create(message),
    }),
    removeTempFile: (filePath) => {
      removedFiles.push(filePath);
      return Promise.resolve();
    },
  });

  const mockSocket = {
    user: { id: "628111111111@s.whatsapp.net" },
    waUploadToServer: (_encPath: string, opts: { mediaType: string }) => {
      uploadedMediaTypes.push(opts.mediaType);
      return Promise.resolve({
        mediaUrl: `https://mmg.whatsapp.net/mock/${opts.mediaType}`,
        directPath: `/v/mock/${opts.mediaType}`,
      });
    },
    relayMessage: (jid: string, message: proto.IMessage) => {
      relayedChatJid = jid;
      relayedMessage = message;
      return Promise.resolve("3EB0SOUNDSTICKERTEST");
    },
  } as unknown as WASocket;

  const returnedId = await sender.sendSoundSticker({
    socket: mockSocket,
    chatJid: "120363000000000000@g.us",
    webpBuffer: Buffer.from("RIFF0000WEBPMOCK"),
    audioBuffer: Buffer.from("OggS0000MOCK"),
    fallbackDurationSeconds: 6,
  });

  assert.equal(returnedId, "3EB0SOUNDSTICKERTEST");
  assert.equal(relayedChatJid, "120363000000000000@g.us");
  assert.deepEqual(uploadedMediaTypes.sort(), ["audio", "sticker"]);
  assert.equal(removedFiles.length, 4, "Semua file sementara (.enc dan orig) harus dibersihkan");

  assert.ok(relayedMessage);
  const patched = patchAudioStickerBeforeSending(relayedMessage);
  const encoded = proto.Message.encode(patched).finish();
  const decoded = proto.Message.decode(encoded);

  const info = getDecodedAudioSticker(decoded);
  assert.ok(info?.rawFutureProofFound);
  assert.ok(info.stickerMessage);
  assert.ok(info.audioMessage);
  assert.equal(info.stickerMessage.isAnimated, true);
  assert.equal(info.stickerMessage.mimetype, "image/webp");
  assert.equal(info.audioMessage.mimetype, "audio/ogg; codecs=opus");
  assert.equal(info.audioMessage.seconds, 2);
  assert.equal(info.audioMessage.ptt, false);
});

void test("SoundStickerSenderService: tetap membersihkan file sementara jika upload gagal", async () => {
  const removedFiles: string[] = [];

  const sender = new SoundStickerSenderService({
    encryptStream: (_media, mediaType) =>
      Promise.resolve({
        mediaKey: Buffer.alloc(32, 1),
        originalFilePath: undefined,
        encFilePath: `C:/temp/fail-${mediaType}.enc`,
        mac: Buffer.alloc(10, 2),
        fileEncSha256: Buffer.alloc(32, 3),
        fileSha256: Buffer.alloc(32, 4),
        fileLength: 100,
      }),
    getDuration: () => Promise.resolve(1),
    getWaveform: () => Promise.resolve(undefined),
    generateMessageId: () => "3EB0FAIL",
    buildMessageFromContent: (jid, message, options) => ({
      key: { remoteJid: jid, fromMe: true, id: options.messageId ?? "3EB0FAIL" },
      message: proto.Message.create(message),
    }),
    removeTempFile: (filePath) => {
      removedFiles.push(filePath);
      return Promise.resolve();
    },
  });

  const mockSocket = {
    user: { id: "628111111111@s.whatsapp.net" },
    waUploadToServer: () => Promise.reject(new Error("Simulated WA upload failure")),
    relayMessage: () => Promise.resolve("never"),
  } as unknown as WASocket;

  await assert.rejects(
    () =>
      sender.sendSoundSticker({
        socket: mockSocket,
        chatJid: "120363000000000000@g.us",
        webpBuffer: Buffer.from("webp"),
        audioBuffer: Buffer.from("ogg"),
        fallbackDurationSeconds: 1,
      }),
    /Simulated WA upload failure/,
  );

  assert.equal(removedFiles.length, 2, "Temp .enc files must still be unlinked on upload failure");
});

void test("commandRouter: .s dan .sa terdaftar terpisah di router", () => {
  assert.equal(commandRouter.has("s"), true);
  assert.equal(commandRouter.has("sticker"), true);
  assert.equal(commandRouter.has("sa"), true);
  assert.equal(commandRouter.has("stickeraudio"), true);
  assert.equal(commandRouter.has("stickersound"), true);
});

void test("handleSoundSticker: menolak media non-video dan mengarahkan ke .s", async () => {
  const ctxNoMedia = buildCommandContext({ commandName: "sa", isGroup: true });
  await handleSoundSticker(ctxNoMedia);
  assert.equal(ctxNoMedia.replies.length, 1);
  assert.match(ctxNoMedia.replies[0] ?? "", /\.sa/);

  const ctxImage = buildCommandContext({
    commandName: "sa",
    isGroup: true,
    message: {
      key: { remoteJid: "120363000000000000@g.us", id: "img-msg", fromMe: false },
      message: {
        imageMessage: { mimetype: "image/jpeg", fileLength: 1024 },
      },
    },
  });
  await handleSoundSticker(ctxImage);
  assert.equal(ctxImage.replies.length, 1);
  assert.match(ctxImage.replies[0] ?? "", /\.sa/);
  assert.match(ctxImage.replies[0] ?? "", /\.s/);
});

void test("handleSticker: memberi petunjuk perbedaan .s dan .sa saat tidak ada media target", async () => {
  const ctxNoMedia = buildCommandContext({ commandName: "s", isGroup: true });
  await handleSticker(ctxNoMedia);
  assert.equal(ctxNoMedia.replies.length, 1);
  assert.match(ctxNoMedia.replies[0] ?? "", /\.s/);
  assert.match(ctxNoMedia.replies[0] ?? "", /\.sa/);
});
