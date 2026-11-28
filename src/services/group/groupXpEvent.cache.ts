export interface ActiveGroupXpEvent {
  groupJid: string;
  multiplier: number;
  startedByJid: string;
  startedAt: number;
  endsAt: number;
  label: string;
}

const MAX_CACHED_GROUPS = 250;
const activeXpEvents = new Map<string, ActiveGroupXpEvent>();

function evictOldestIfNeeded(): void {
  while (activeXpEvents.size > MAX_CACHED_GROUPS) {
    const oldest = activeXpEvents.keys().next().value;
    if (oldest === undefined) break;
    activeXpEvents.delete(oldest);
  }
}

export function parsePersistedXpEvent(
  groupJid: string,
  rawSection: unknown,
): ActiveGroupXpEvent | null {
  if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) {
    return null;
  }
  const rec = rawSection as Record<string, unknown>;
  const multiplier =
    typeof rec.multiplier === "number" && Number.isFinite(rec.multiplier) && rec.multiplier >= 2
      ? Math.min(3, Math.floor(rec.multiplier))
      : 0;
  const startedAt =
    typeof rec.startedAt === "number" && Number.isFinite(rec.startedAt) && rec.startedAt > 0
      ? Math.floor(rec.startedAt)
      : 0;
  const endsAt =
    typeof rec.endsAt === "number" && Number.isFinite(rec.endsAt) && rec.endsAt > 0
      ? Math.floor(rec.endsAt)
      : 0;
  const startedByJid = typeof rec.startedByJid === "string" ? rec.startedByJid : "";
  const label =
    typeof rec.label === "string" && rec.label.trim().length > 0
      ? rec.label.trim().slice(0, 60)
      : `Happy Hour ${String(multiplier)}x XP`;

  if (multiplier < 2 || endsAt <= 0) {
    return null;
  }

  return {
    groupJid,
    multiplier,
    startedByJid,
    startedAt,
    endsAt,
    label,
  };
}

export function syncGroupXpEventFromTenantState(
  groupJid: string,
  rawGroupEventState: unknown,
  nowMs: number = Date.now(),
): ActiveGroupXpEvent | null {
  if (!rawGroupEventState || typeof rawGroupEventState !== "object" || Array.isArray(rawGroupEventState)) {
    activeXpEvents.delete(groupJid);
    return null;
  }
  const rawSection = (rawGroupEventState as Record<string, unknown>).xpEvent;
  const parsed = parsePersistedXpEvent(groupJid, rawSection);
  if (!parsed || parsed.endsAt <= nowMs) {
    activeXpEvents.delete(groupJid);
    return null;
  }
  activeXpEvents.set(groupJid, parsed);
  evictOldestIfNeeded();
  return parsed;
}

export function setCachedGroupXpEvent(
  groupJid: string,
  event: ActiveGroupXpEvent | null,
): void {
  if (!event || event.endsAt <= 0 || event.multiplier < 2) {
    activeXpEvents.delete(groupJid);
    return;
  }
  activeXpEvents.set(groupJid, { ...event });
  evictOldestIfNeeded();
}

export function getActiveGroupXpEvent(
  groupJid: string,
  nowMs: number = Date.now(),
): ActiveGroupXpEvent | null {
  const current = activeXpEvents.get(groupJid);
  if (!current) return null;
  if (current.endsAt <= nowMs) {
    activeXpEvents.delete(groupJid);
    return null;
  }
  return current;
}

export function getActiveGroupXpMultiplier(
  groupJid: string,
  nowMs: number = Date.now(),
): number {
  const active = getActiveGroupXpEvent(groupJid, nowMs);
  return active ? active.multiplier : 1;
}

export function applyGroupXpEvent(
  groupJid: string,
  baseXp: number,
  nowMs: number = Date.now(),
): number {
  if (!Number.isFinite(baseXp) || baseXp <= 0) return 0;
  const mult = getActiveGroupXpMultiplier(groupJid, nowMs);
  return Math.max(1, Math.round(baseXp * mult));
}

export function clearGroupXpEventCacheForTests(): void {
  activeXpEvents.clear();
}
