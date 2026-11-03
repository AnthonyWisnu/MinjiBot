import assert from "node:assert/strict";
import test from "node:test";

import { AppUserError } from "../src/errors/appUserError";
import {
  downloaderService,
  TIKTOK_MEDIA_ALLOWED_DOMAINS,
  TWITTER_MEDIA_ALLOWED_DOMAINS,
} from "../src/services/media/downloader.service";
import { videoNormalizeService } from "../src/services/media/videoNormalize.service";
import { matchesAllowedDomain } from "../src/utils/urlValidator";

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

test("videoNormalizeService: getVideoDurationSeconds returns null safely on missing file", async () => {
  const duration = await videoNormalizeService.getVideoDurationSeconds("non-existent-video.mp4");
  assert.equal(duration, null);
});

test("downloaderService: CDN allowlists permit official TikTok and Twitter CDNs while blocking spoofs", () => {
  assert.equal(
    matchesAllowedDomain("p16-common-sign.tiktokcdn-us.com", TIKTOK_MEDIA_ALLOWED_DOMAINS),
    true,
  );
  assert.equal(matchesAllowedDomain("v16m.tiktokcdn-us.com", TIKTOK_MEDIA_ALLOWED_DOMAINS), true);
  assert.equal(
    matchesAllowedDomain("v16-ies-music.tiktokcdn-us.com", TIKTOK_MEDIA_ALLOWED_DOMAINS),
    true,
  );
  assert.equal(
    matchesAllowedDomain("p16-sign-sg.tiktokcdn.com", TIKTOK_MEDIA_ALLOWED_DOMAINS),
    true,
  );
  assert.equal(matchesAllowedDomain("www.tikwm.com", TIKTOK_MEDIA_ALLOWED_DOMAINS), true);
  assert.equal(
    matchesAllowedDomain("tiktokcdn-us.com.attacker.org", TIKTOK_MEDIA_ALLOWED_DOMAINS),
    false,
  );

  assert.equal(matchesAllowedDomain("pbs.twimg.com", TWITTER_MEDIA_ALLOWED_DOMAINS), true);
  assert.equal(matchesAllowedDomain("video.twimg.com", TWITTER_MEDIA_ALLOWED_DOMAINS), true);
  assert.equal(matchesAllowedDomain("twimg.com.evil.net", TWITTER_MEDIA_ALLOWED_DOMAINS), false);
});
