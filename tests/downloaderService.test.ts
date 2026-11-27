import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/minjibot?schema=public";
process.env.COMMAND_PREFIX ??= ".";
process.env.SUPER_OWNER_JIDS ??= "6281234567890@s.whatsapp.net";
process.env.SESSION_DIR ??= "./sessions";
process.env.TEMP_DIR ??= "./tmp";
process.env.LOG_LEVEL ??= "silent";
process.env.BOT_BROWSER_NAME ??= "MinjiBot";
process.env.RECONNECT_INITIAL_MS ??= "3000";
process.env.RECONNECT_MAX_MS ??= "60000";
process.env.MAX_DOWNLOAD_FILE_MB ??= "400";
process.env.DOWNLOADER_BIN ??= "yt-dlp";
process.env.DOWNLOADER_TIMEOUT_MS ??= "600000";
process.env.HD_MAX_INPUT_MB ??= "10";
process.env.HD_AI_MAX_CONCURRENT_JOBS ??= "2";
process.env.TENANT_SESSION_TTL_DAYS ??= "7";
process.env.REMINDER_POLL_MS ??= "30000";

import {
  formatInstagramError,
  formatTwitterError,
  formatYoutubeError,
} from "../src/commands/media/downloaderDelivery";
import { AppUserError } from "../src/errors/appUserError";
import {
  downloaderService,
  TIKTOK_MEDIA_ALLOWED_DOMAINS,
  TWITTER_MEDIA_ALLOWED_DOMAINS,
} from "../src/services/media/downloader.service";
import {
  MAX_INSTAGRAM_DURATION_SEC,
  MAX_TIKTOK_DURATION_SEC,
  MAX_TWITTER_DURATION_SEC,
  MAX_YOUTUBE_DURATION_SEC,
  MAX_YOUTUBE_MUSIC_DURATION_SEC,
} from "../src/services/media/downloaders/downloader.types";
import { extractYoutubeVideoId } from "../src/services/media/youtubeSearch.service";
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

test("downloader limits: Instagram 70m, Twitter/X 90m, YouTube Music 90m, TikTok 70m, YouTube 60m", () => {
  assert.equal(MAX_TIKTOK_DURATION_SEC, 4200);
  assert.equal(MAX_INSTAGRAM_DURATION_SEC, 4200);
  assert.equal(MAX_YOUTUBE_DURATION_SEC, 3600);
  assert.equal(MAX_YOUTUBE_MUSIC_DURATION_SEC, 5400);
  assert.equal(MAX_TWITTER_DURATION_SEC, 5400);

  assert.equal(
    formatInstagramError(new Error("Video does not pass match-filter duration")),
    "Video Instagram melebihi batas durasi 70 menit (1 jam 10 menit).",
  );
  assert.equal(
    formatTwitterError(new Error("Video does not pass match-filter duration")),
    "Video X (Twitter) melebihi batas durasi 90 menit (1 jam 30 menit).",
  );
  assert.equal(
    formatYoutubeError(new Error("Video does not pass match-filter duration")),
    "Video melebihi batas durasi 1 jam.",
  );
  assert.equal(
    formatYoutubeError(
      new AppUserError("Video YouTube Music melebihi batas durasi 90 menit (1 jam 30 menit)."),
    ),
    "Video YouTube Music melebihi batas durasi 90 menit (1 jam 30 menit).",
  );
});

test("youtubeSearchService: extractYoutubeVideoId parses youtube, youtu.be, shorts, and music.youtube.com", () => {
  assert.equal(
    extractYoutubeVideoId(new URL("https://music.youtube.com/watch?v=abc123XYZ&si=foo")),
    "abc123XYZ",
  );
  assert.equal(extractYoutubeVideoId(new URL("https://youtu.be/dQw4w9WgXcQ")), "dQw4w9WgXcQ");
  assert.equal(
    extractYoutubeVideoId(new URL("https://www.youtube.com/shorts/short999")),
    "short999",
  );
});
