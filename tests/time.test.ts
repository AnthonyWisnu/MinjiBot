import { test } from "node:test";
import assert from "node:assert/strict";

import { parseReminderTime } from "../src/utils/time";

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
