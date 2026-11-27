import type { Prisma } from "@prisma/client";

export type CrateType = "common" | "uncommon" | "mythic" | "legendary";
export type ToolType = "sword" | "armor" | "pickaxe" | "fishingrod";
export type PetType = "kucing" | "kyubi" | "centaur" | "griffin" | "naga" | "phonix";

export interface ToolState {
  level: number;
  durability: number;
}

export interface PetState {
  level: number;
  exp: number;
  hunger: number;
}

export interface MemberRpgState {
  cooldowns: Record<string, number>;
  jailedUntil: number;
  ugdUntil: number;
  crypto: Record<string, number>;
  hp: number;
  items: Record<string, number>;
  crates: Record<CrateType, number>;
  tools: Record<ToolType, ToolState>;
  pets: Record<PetType, PetState>;
}

export const MAX_PLAYER_HP = 100;
export const CRATE_TYPES: readonly CrateType[] = [
  "common",
  "uncommon",
  "mythic",
  "legendary",
] as const;
export const TOOL_TYPES: readonly ToolType[] = [
  "sword",
  "armor",
  "pickaxe",
  "fishingrod",
] as const;
export const PET_TYPES: readonly PetType[] = [
  "kucing",
  "kyubi",
  "centaur",
  "griffin",
  "naga",
  "phonix",
] as const;

function createEmptyCrates(): Record<CrateType, number> {
  return { common: 0, uncommon: 0, mythic: 0, legendary: 0 };
}

function createEmptyTools(): Record<ToolType, ToolState> {
  return {
    sword: { level: 0, durability: 0 },
    armor: { level: 0, durability: 0 },
    pickaxe: { level: 0, durability: 0 },
    fishingrod: { level: 0, durability: 0 },
  };
}

function createEmptyPets(): Record<PetType, PetState> {
  return {
    kucing: { level: 0, exp: 0, hunger: 100 },
    kyubi: { level: 0, exp: 0, hunger: 100 },
    centaur: { level: 0, exp: 0, hunger: 100 },
    griffin: { level: 0, exp: 0, hunger: 100 },
    naga: { level: 0, exp: 0, hunger: 100 },
    phonix: { level: 0, exp: 0, hunger: 100 },
  };
}

export function createDefaultRpgState(): MemberRpgState {
  return {
    cooldowns: {},
    jailedUntil: 0,
    ugdUntil: 0,
    crypto: {},
    hp: MAX_PLAYER_HP,
    items: {},
    crates: createEmptyCrates(),
    tools: createEmptyTools(),
    pets: createEmptyPets(),
  };
}

export function parseRpgState(raw: unknown): MemberRpgState {
  const defaults = createDefaultRpgState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
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

  const items: Record<string, number> = {};
  if (obj.items && typeof obj.items === "object" && !Array.isArray(obj.items)) {
    for (const [key, val] of Object.entries(obj.items as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isInteger(val) && val > 0) {
        items[key.toLowerCase()] = val;
      }
    }
  }

  const crates = createEmptyCrates();
  if (obj.crates && typeof obj.crates === "object" && !Array.isArray(obj.crates)) {
    const rawCrates = obj.crates as Record<string, unknown>;
    for (const crateKey of CRATE_TYPES) {
      const val = rawCrates[crateKey];
      if (typeof val === "number" && Number.isInteger(val) && val > 0) {
        crates[crateKey] = val;
      }
    }
  }

  const tools = createEmptyTools();
  if (obj.tools && typeof obj.tools === "object" && !Array.isArray(obj.tools)) {
    const rawTools = obj.tools as Record<string, unknown>;
    for (const toolKey of TOOL_TYPES) {
      const entry = rawTools[toolKey];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const rec = entry as Record<string, unknown>;
        const level =
          typeof rec.level === "number" && Number.isInteger(rec.level) && rec.level >= 0
            ? Math.min(10, rec.level)
            : 0;
        const durability =
          typeof rec.durability === "number" && Number.isFinite(rec.durability) && rec.durability >= 0
            ? Math.min(100, Math.floor(rec.durability))
            : 0;
        tools[toolKey] = { level, durability };
      }
    }
  }

  const pets = createEmptyPets();
  if (obj.pets && typeof obj.pets === "object" && !Array.isArray(obj.pets)) {
    const rawPets = obj.pets as Record<string, unknown>;
    for (const petKey of PET_TYPES) {
      const entry = rawPets[petKey];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const rec = entry as Record<string, unknown>;
        const level =
          typeof rec.level === "number" && Number.isInteger(rec.level) && rec.level >= 0
            ? Math.min(20, rec.level)
            : 0;
        const exp =
          typeof rec.exp === "number" && Number.isFinite(rec.exp) && rec.exp >= 0
            ? Math.floor(rec.exp)
            : 0;
        const hunger =
          typeof rec.hunger === "number" && Number.isFinite(rec.hunger)
            ? Math.max(0, Math.min(100, Math.floor(rec.hunger)))
            : 100;
        pets[petKey] = { level, exp, hunger };
      }
    }
  }

  const jailedUntil =
    typeof obj.jailedUntil === "number" && Number.isFinite(obj.jailedUntil) && obj.jailedUntil > 0
      ? obj.jailedUntil
      : 0;

  const ugdUntil =
    typeof obj.ugdUntil === "number" && Number.isFinite(obj.ugdUntil) && obj.ugdUntil > 0
      ? obj.ugdUntil
      : 0;

  const hp =
    typeof obj.hp === "number" && Number.isFinite(obj.hp)
      ? Math.max(0, Math.min(MAX_PLAYER_HP, Math.floor(obj.hp)))
      : MAX_PLAYER_HP;

  return {
    cooldowns,
    jailedUntil,
    ugdUntil,
    crypto,
    hp,
    items,
    crates,
    tools,
    pets,
  };
}

export function serializeRpgState(state: MemberRpgState): Prisma.InputJsonValue {
  return {
    cooldowns: state.cooldowns,
    jailedUntil: state.jailedUntil,
    ugdUntil: state.ugdUntil,
    crypto: state.crypto,
    hp: state.hp,
    items: state.items,
    crates: state.crates,
    tools: {
      sword: { ...state.tools.sword },
      armor: { ...state.tools.armor },
      pickaxe: { ...state.tools.pickaxe },
      fishingrod: { ...state.tools.fishingrod },
    },
    pets: {
      kucing: { ...state.pets.kucing },
      kyubi: { ...state.pets.kyubi },
      centaur: { ...state.pets.centaur },
      griffin: { ...state.pets.griffin },
      naga: { ...state.pets.naga },
      phonix: { ...state.pets.phonix },
    },
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

export function getRemainingUgdMs(state: MemberRpgState, nowMs: number): number {
  if (state.ugdUntil <= nowMs) {
    return 0;
  }
  return state.ugdUntil - nowMs;
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

export function withUgdUntil(state: MemberRpgState, untilMs: number): MemberRpgState {
  return {
    ...state,
    ugdUntil: Math.max(state.ugdUntil, untilMs),
  };
}

export function withHp(state: MemberRpgState, nextHp: number): MemberRpgState {
  return {
    ...state,
    hp: Math.max(0, Math.min(MAX_PLAYER_HP, Math.floor(nextHp))),
  };
}

export function withItemDelta(
  state: MemberRpgState,
  itemKey: string,
  delta: number,
): MemberRpgState {
  const key = itemKey.toLowerCase();
  const current = state.items[key] ?? 0;
  const nextQty = Math.max(0, Math.floor(current + delta));
  const nextItems: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.items)) {
    if (k !== key) {
      nextItems[k] = v;
    }
  }
  if (nextQty > 0) {
    nextItems[key] = nextQty;
  }
  return {
    ...state,
    items: nextItems,
  };
}

export function withItemsDelta(
  state: MemberRpgState,
  deltas: Record<string, number>,
): MemberRpgState {
  let next = state;
  for (const [key, delta] of Object.entries(deltas)) {
    if (delta !== 0) {
      next = withItemDelta(next, key, delta);
    }
  }
  return next;
}

export function withCrateDelta(
  state: MemberRpgState,
  crate: CrateType,
  delta: number,
): MemberRpgState {
  const current = state.crates[crate];
  return {
    ...state,
    crates: {
      ...state.crates,
      [crate]: Math.max(0, Math.floor(current + delta)),
    },
  };
}

export function withToolState(
  state: MemberRpgState,
  tool: ToolType,
  nextTool: ToolState,
): MemberRpgState {
  return {
    ...state,
    tools: {
      ...state.tools,
      [tool]: {
        level: Math.max(0, Math.min(10, Math.floor(nextTool.level))),
        durability: Math.max(0, Math.min(100, Math.floor(nextTool.durability))),
      },
    },
  };
}

export function withPetState(
  state: MemberRpgState,
  pet: PetType,
  nextPet: PetState,
): MemberRpgState {
  return {
    ...state,
    pets: {
      ...state.pets,
      [pet]: {
        level: Math.max(0, Math.min(20, Math.floor(nextPet.level))),
        exp: Math.max(0, Math.floor(nextPet.exp)),
        hunger: Math.max(0, Math.min(100, Math.floor(nextPet.hunger))),
      },
    },
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
