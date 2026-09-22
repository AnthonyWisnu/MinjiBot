import { test } from "node:test";
import assert from "node:assert/strict";

import { isValidHttpUrl, parseHttpUrl } from "../src/utils/urlValidator";

void test("isValidHttpUrl: validates valid http and https urls", () => {
  assert.equal(isValidHttpUrl("https://www.tiktok.com/@user/video/123"), true);
  assert.equal(isValidHttpUrl("http://instagram.com/p/abc123"), true);
  assert.equal(isValidHttpUrl("https://youtu.be/xyz"), true);
});

void test("isValidHttpUrl: rejects non-http protocols and malformed strings", () => {
  assert.equal(isValidHttpUrl("ftp://example.com/file"), false);
  assert.equal(isValidHttpUrl("javascript:alert(1)"), false);
  assert.equal(isValidHttpUrl("file:///etc/passwd"), false);
  assert.equal(isValidHttpUrl("--option-injection"), false);
  assert.equal(isValidHttpUrl(""), false);
  assert.equal(isValidHttpUrl(undefined), false);
});

void test("parseHttpUrl: returns URL instance for valid URLs and null for invalid", () => {
  const parsed = parseHttpUrl("https://tiktok.com/@user/video/123");
  assert.notEqual(parsed, null);
  assert.equal(parsed?.hostname, "tiktok.com");

  assert.equal(parseHttpUrl("invalid-url"), null);
  assert.equal(parseHttpUrl("ftp://test.com"), null);
});
