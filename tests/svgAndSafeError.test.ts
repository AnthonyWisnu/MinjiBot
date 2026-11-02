import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AppUserError,
  formatUserSafeError,
  isUserSafeErrorMessage,
} from "../src/utils/userSafeError";
import { clampAndWrapText, clampText, escapeXml, stripInvalidXmlChars } from "../src/utils/xml";
import { MAX_SAFE_ANIMATED_PAGES, MAX_SAFE_IMAGE_PIXELS } from "../src/utils/imageSafety";

void test("escapeXml: properly escapes dangerous characters and strips XML control characters", () => {
  const dangerous = `<script>alert("XSS & 'pwned'")</script>\x00\x08\x1F`;
  const escaped = escapeXml(dangerous);

  assert.equal(
    escaped,
    "&lt;script&gt;alert(&quot;XSS &amp; &apos;pwned&apos;&quot;)&lt;/script&gt;",
  );
  assert.equal(stripInvalidXmlChars("Hello\x00World\x1F!"), "HelloWorld!");
});

void test("clampAndWrapText: handles long unbroken tokens and enforces maximum boundaries", () => {
  // Hard break on 100-character unbroken word
  const longToken = "A".repeat(100);
  const wrapped = clampAndWrapText(longToken, 200, 16, 8);

  assert.ok(wrapped.length > 1);
  for (const line of wrapped) {
    assert.ok(line.length <= 16);
  }

  // Clamps total text length and lines
  const multiLine = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
  const clampedLines = clampAndWrapText(multiLine, 50, 20, 3, true);
  assert.equal(clampedLines.length, 3);
  assert.ok(clampedLines[2]?.endsWith("…"));

  // Clamps single text string
  assert.equal(clampText("Testing String", 7, "…"), "Testin…");
});

void test("formatUserSafeError: permits natural Indonesian words while blocking technical leaks", () => {
  const fallback = "Terjadi kesalahan internal. Silakan coba lagi.";

  // Words with 'ig' or 'api' substrings MUST NOT be falsely blocked!
  const indonesianMsg1 = "Limit ini tidak dapat digunakan tetapi bisa dibeli lagi.";
  assert.equal(isUserSafeErrorMessage(indonesianMsg1), true);
  assert.equal(formatUserSafeError(new Error(indonesianMsg1), fallback), indonesianMsg1);

  const indonesianMsg2 = "Sesi kuis ditutup karena tidak ada lagi jawaban.";
  assert.equal(isUserSafeErrorMessage(indonesianMsg2), true);
  assert.equal(formatUserSafeError(new Error(indonesianMsg2), fallback), indonesianMsg2);

  // AppUserError domain instances are always preserved
  const appError = new AppUserError("Format command salah. Gunakan .tt <link>");
  assert.equal(formatUserSafeError(appError, fallback), "Format command salah. Gunakan .tt <link>");

  // Technical errors, paths, DB codes, stack traces MUST be sanitized to fallback
  assert.equal(
    formatUserSafeError(
      new Error("ENOENT: no such file or directory, open '/home/server/.env'"),
      fallback,
    ),
    fallback,
  );
  assert.equal(
    formatUserSafeError(
      new Error("PrismaClientKnownRequestError: P2025 Record not found"),
      fallback,
    ),
    fallback,
  );
  assert.equal(
    formatUserSafeError(
      new Error(
        "TypeError: Cannot read properties of undefined (reading 'split')\n    at Object.run",
      ),
      fallback,
    ),
    fallback,
  );
  assert.equal(formatUserSafeError(new Error("ECONNREFUSED 127.0.0.1:5432"), fallback), fallback);
});

void test("imageSafety constants: correctly define safe boundaries", () => {
  assert.equal(MAX_SAFE_IMAGE_PIXELS, 4096 * 4096);
  assert.equal(MAX_SAFE_ANIMATED_PAGES, 150);
});
