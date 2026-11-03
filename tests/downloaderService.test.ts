import assert from "node:assert/strict";
import test from "node:test";

import { AppUserError } from "../src/errors/appUserError";
import { downloaderService } from "../src/services/media/downloader.service";
import { videoNormalizeService } from "../src/services/media/videoNormalize.service";

test("downloaderService: rejects non-TikTok URLs with AppUserError", async () => {
  await assert.rejects(
    () => downloaderService.downloadTikTok("https://google.com/malicious"),
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.ok(err.message.includes("TikTok"));
      return true;
    },
  );
});

test("downloaderService: rejects non-Instagram URLs with AppUserError", async () => {
  await assert.rejects(
    () => downloaderService.downloadInstagram("https://evil-site.com/reel/123"),
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.ok(err.message.includes("Instagram"));
      return true;
    },
  );
});

test("downloaderService: rejects non-YouTube URLs with AppUserError", async () => {
  await assert.rejects(
    () => downloaderService.downloadYoutube("https://youtube.fakedomain.org/watch?v=123"),
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.ok(err.message.includes("YouTube"));
      return true;
    },
  );
});

test("downloaderService: rejects non-Twitter URLs with AppUserError", async () => {
  await assert.rejects(
    () => downloaderService.downloadTwitter("https://evil-x.com/user/status/123"),
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.ok(err.message.includes("Twitter"));
      return true;
    },
  );
});

test("downloaderService: rejects non-Pinterest URLs with AppUserError", async () => {
  await assert.rejects(
    () => downloaderService.downloadPinterest("https://fake-pinterest.com/pin/123"),
    (err: unknown) => {
      assert.ok(err instanceof AppUserError);
      assert.ok(err.message.includes("Pinterest"));
      return true;
    },
  );
});

test("downloaderService: rejects SSRF attempts with localhost / cloud metadata IP", async () => {
  await assert.rejects(
    () => downloaderService.downloadTikTok("http://127.0.0.1:8080/video"),
    AppUserError,
  );
  await assert.rejects(
    () => downloaderService.downloadYoutube("http://169.254.169.254/latest/meta-data"),
    AppUserError,
  );
  await assert.rejects(
    () => downloaderService.downloadTwitter("http://127.0.0.1/status/123"),
    AppUserError,
  );
  await assert.rejects(
    () => downloaderService.downloadPinterest("http://169.254.169.254/pin/123"),
    AppUserError,
  );
});

test("videoNormalizeService: isH264Video returns boolean", async () => {
  // Verifies probe function executes without crash
  const isH264 = await videoNormalizeService.isH264Video("non-existent-video.mp4");
  assert.equal(typeof isH264, "boolean");
});
