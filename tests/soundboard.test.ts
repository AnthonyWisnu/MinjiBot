import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { soundboardService, SOUNDBOARD_CATALOG } from "../src/services/media/soundboard.service";

describe("SoundboardService", () => {
  it("harus menyediakan katalog suara lengkap dengan metadata yang valid", () => {
    const catalog = soundboardService.getCatalog();
    assert.ok(Array.isArray(catalog));
    assert.strictEqual(catalog.length, SOUNDBOARD_CATALOG.length);
    assert.ok(catalog.length >= 10);

    for (const item of catalog) {
      assert.ok(item.id);
      assert.ok(item.title);
      assert.ok(item.category);
      assert.ok(item.durationSeconds > 0);
      assert.ok(item.badge);
    }
  });

  it("harus dapat mengambil sound item berdasarkan id", () => {
    const vineBoom = soundboardService.getSoundItem("vine-boom");
    assert.ok(vineBoom);
    assert.strictEqual(vineBoom.id, "vine-boom");
    assert.strictEqual(vineBoom.title, "Vine Boom");
    assert.strictEqual(vineBoom.category, "meme");

    const nonExistent = soundboardService.getSoundItem("non-existent-sound-12345");
    assert.strictEqual(nonExistent, undefined);
  });

  it("harus menghasilkan synthesized WAV buffer yang valid dengan header PCM 44-byte", async () => {
    const testIds = ["vine-boom", "air-horn", "retro-coin", "laser-shot", "ba-dum-tss"];

    for (const id of testIds) {
      const { buffer, mimetype } = await soundboardService.getSoundBuffer(id);
      assert.ok(buffer);
      assert.ok(buffer.length > 44, `Buffer untuk ${id} harus lebih dari 44 bytes`);
      assert.strictEqual(mimetype, "audio/wav");

      // Verify RIFF header
      const riffHeader = buffer.subarray(0, 4).toString("ascii");
      const waveHeader = buffer.subarray(8, 12).toString("ascii");
      const fmtHeader = buffer.subarray(12, 16).toString("ascii");

      assert.strictEqual(riffHeader, "RIFF");
      assert.strictEqual(waveHeader, "WAVE");
      assert.strictEqual(fmtHeader, "fmt ");
    }
  });

  it("harus melempar error saat sendVoiceNote dipanggil dengan soundId tidak valid", async () => {
    const dummySocket = {} as any;
    await assert.rejects(
      async () => {
        await soundboardService.sendVoiceNote("test@s.whatsapp.net", "invalid-sound-id-999", dummySocket);
      },
      /tidak ditemukan di katalog/
    );
  });
});
