import type { Prisma } from "@prisma/client";

export interface MemberRpgState {
  cooldowns: Record<string, number>;
  jailedUntil: number;
  crypto: Record<string, number>;
}

export function parseRpgState(raw: unknown): MemberRpgState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { cooldowns: {}, jailedUntil: 0, crypto: {} };
  }

  const obj = raw as Record<string, unknown>;
  const cooldowns: Record<string, number> = {};
  if (obj.cooldowns && typeof obj.cooldowns === "object" && !Array.isArray(obj.cooldowns)) {
    for (const [key, val] of Object.entries(obj.cooldowns as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        cooldowns[key] = val;
      }
    }
  }

  const crypto: Record<string, number> = {};
  if (obj.crypto && typeof obj.crypto === "object" && !Array.isArray(obj.crypto)) {
    for (const [key, val] of Object.entries(obj.crypto as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isInteger(val) && val > 0) {
        crypto[key.toUpperCase()] = val;
      }
    }
  }

  const jailedUntil =
    typeof obj.jailedUntil === "number" && Number.isFinite(obj.jailedUntil) && obj.jailedUntil > 0
      ? obj.jailedUntil
      : 0;

  return { cooldowns, jailedUntil, crypto };
}

export function serializeRpgState(state: MemberRpgState): Prisma.InputJsonValue {
  return {
    cooldowns: state.cooldowns,
    jailedUntil: state.jailedUntil,
    crypto: state.crypto,
  };
}

export function getRemainingCooldownMs(
  state: MemberRpgState,
  actionKey: string,
  cooldownMs: number,
  nowMs: number,
): number {
  const lastAt = state.cooldowns[actionKey] ?? 0;
  if (lastAt <= 0) {
    return 0;
  }
  const elapsed = nowMs - lastAt;
  return elapsed >= cooldownMs ? 0 : cooldownMs - elapsed;
}

export function getRemainingJailMs(state: MemberRpgState, nowMs: number): number {
  if (state.jailedUntil <= nowMs) {
    return 0;
  }
  return state.jailedUntil - nowMs;
}

export function withUpdatedCooldown(
  state: MemberRpgState,
  actionKey: string,
  nowMs: number,
): MemberRpgState {
  return {
    ...state,
    cooldowns: {
      ...state.cooldowns,
      [actionKey]: nowMs,
    },
  };
}

export function withJailUntil(state: MemberRpgState, untilMs: number): MemberRpgState {
  return {
    ...state,
    jailedUntil: Math.max(state.jailedUntil, untilMs),
  };
}

export function withUpdatedCryptoHolding(
  state: MemberRpgState,
  symbol: string,
  newQuantity: number,
): MemberRpgState {
  const normalized = symbol.toUpperCase();
  const nextCrypto: Record<string, number> = {};
  for (const [key, val] of Object.entries(state.crypto)) {
    if (key !== normalized) {
      nextCrypto[key] = val;
    }
  }
  if (newQuantity > 0) {
    nextCrypto[normalized] = Math.floor(newQuantity);
  }
  return {
    ...state,
    crypto: nextCrypto,
  };
}
