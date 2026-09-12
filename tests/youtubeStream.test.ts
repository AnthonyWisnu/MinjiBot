import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { youtubeStreamService } from "../src/services/media/youtubeStream.service";

describe("YoutubeStreamService SSRF & Validation", () => {
  it("harus memvalidasi URL YouTube resmi dan videoId secara benar", () => {
    assert.strictEqual(
      youtubeStreamService.isValidYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      true,
    );
    assert.strictEqual(
      youtubeStreamService.isValidYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"),
      true,
    );
    assert.strictEqual(
      youtubeStreamService.isValidYoutubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ"),
      true,
    );
    assert.strictEqual(youtubeStreamService.isValidYoutubeUrl("dQw4w9WgXcQ"), true);
  });

  it("harus menolak URL berbahaya atau upaya SSRF", () => {
    assert.strictEqual(youtubeStreamService.isValidYoutubeUrl("http://127.0.0.1:3000"), false);
    assert.strictEqual(youtubeStreamService.isValidYoutubeUrl("http://169.254.169.254"), false);
    assert.strictEqual(youtubeStreamService.isValidYoutubeUrl("file:///etc/passwd"), false);
    assert.strictEqual(
      youtubeStreamService.isValidYoutubeUrl("https://evil-phishing.com/watch?v=dQw4w9WgXcQ"),
      false,
    );
    assert.strictEqual(youtubeStreamService.isValidYoutubeUrl(""), false);
  });

  it("harus menormalisasi videoId dan URL pendek menjadi URL watch standar", () => {
    assert.strictEqual(
      youtubeStreamService.normalizeYoutubeUrl("dQw4w9WgXcQ"),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    assert.strictEqual(
      youtubeStreamService.normalizeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });
});
