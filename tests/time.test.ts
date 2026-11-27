import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDurationLimitLabel, parseReminderTime } from "../src/utils/time";

void test("parseReminderTime accepts HH:mm for later today", () => {
  const baseDate = new Date("2026-06-10T13:00:00.000Z");

  const result = parseReminderTime(baseDate, "21:00");

  assert.equal(result.toISOString(), "2026-06-10T14:00:00.000Z");
});

void test("parseReminderTime moves HH:mm to tomorrow when time already passed", () => {
  const baseDate = new Date("2026-06-10T15:00:00.000Z");

  const result = parseReminderTime(baseDate, "21:00");

  assert.equal(result.toISOString(), "2026-06-11T14:00:00.000Z");
});

void test("parseReminderTime treats explicit date time as WIB", () => {
  const baseDate = new Date("2026-06-10T10:00:00.000Z");

  const result = parseReminderTime(baseDate, "2026-06-10T21:00");

  assert.equal(result.toISOString(), "2026-06-10T14:00:00.000Z");
});

void test("formatDurationLimitLabel formats minutes and hours clearly", () => {
  assert.equal(formatDurationLimitLabel(1800), "30 menit");
  assert.equal(formatDurationLimitLabel(3600), "1 jam");
  assert.equal(formatDurationLimitLabel(4200), "70 menit (1 jam 10 menit)");
  assert.equal(formatDurationLimitLabel(5400), "90 menit (1 jam 30 menit)");
  assert.equal(formatDurationLimitLabel(7200), "120 menit (2 jam)");
});
