import type { Prisma } from "@prisma/client";

import {
  normalizeProfileThemeId,
  type ProfileThemeId,
} from "../member/profileThemes";

export type CrateType = "common" | "uncommon" | "mythic" | "legendary";
export type ToolType = "sword" | "armor" | "pickaxe" | "fishingrod";
export type PetType = "kucing" | "kyubi" | "centaur" | "griffin" | "naga" | "phonix";

export interface PetExpeditionState {
  pet: PetType;
  zoneId: string;
  startedAt: number;
  endsAt: number;
}

export interface ToolState {
  level: number;
  durability: number;
}

export interface PetState {
  level: number;
  exp: number;
  hunger: number;
}

export interface DailyQuestProgressState {
  dateKey: string;
  claimedIds: string[];
}

export interface DepositoState {
  principal: string;
  depositedAt: number;
  ratePercent: number;
}

export interface StockHoldingState {
  lots: number;
  avgPrice: string;
}

export interface CareerState {
  jobId: string;
  level: number;
  shiftsDone: number;
}

export interface StartupState {
  name: string;
  level: number;
  employees: number;
  lastDividendAt: number;
}

export interface LoanState {
  principal: string;
  interest: string;
  borrowedAt: number;
  dueAt: number;
}

export type InsuranceKey = "brankas" | "bpjs" | "pengacara";
export type SkillKey = "str" | "agi" | "luk" | "int" | "cha";
export type BuffKey = "jamukuat" | "jimatcuan" | "ramuanxp" | "perisaibaja";

export interface FarmPlotState {
  cropId: string;
  plantedAt: number;
  readyAt: number;
  watered: boolean;
}

export interface FarmState {
  plots: FarmPlotState[];
  harvest: Record<string, number>;
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
  customTitle: string | null;
  spouseJid: string | null;
  marriedAt: number;
  dowryAmount: string;
  dailyQuest: DailyQuestProgressState;
  achievements: string[];
  properties: Record<string, number>;
  lastPropertyHarvestAt: number;
  lastSalaryDateKey: string;
  deposito: DepositoState | null;
  stocks: Record<string, StockHoldingState>;
  cards: Record<string, number>;
  career: CareerState | null;
  startup: StartupState | null;
  loan: LoanState | null;
  insurances: Record<InsuranceKey, number>;
  prestige: number;
  totalDonated: string;
  skills: Record<SkillKey, number>;
  farm: FarmState;
  buffs: Record<BuffKey, number>;
  bossDamageTotal: number;
  bossKills: number;
  bossMvpCount: number;
  petExpedition: PetExpeditionState | null;
  profileTheme: ProfileThemeId;
  ownedThemes: ProfileThemeId[];
}

export const MAX_PLAYER_HP = 100;
export const SKILL_KEYS: readonly SkillKey[] = ["str", "agi", "luk", "int", "cha"] as const;
export const BUFF_KEYS: readonly BuffKey[] = [
  "jamukuat",
  "jimatcuan",
  "ramuanxp",
  "perisaibaja",
] as const;
export const MAX_SKILL_STAT = 50;
export const MAX_FARM_PLOTS = 6;
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
    customTitle: null,
    spouseJid: null,
    marriedAt: 0,
    dowryAmount: "0",
    dailyQuest: { dateKey: "", claimedIds: [] },
    achievements: [],
    properties: {},
    lastPropertyHarvestAt: 0,
    lastSalaryDateKey: "",
    deposito: null,
    stocks: {},
    cards: {},
    career: null,
    startup: null,
    loan: null,
    insurances: { brankas: 0, bpjs: 0, pengacara: 0 },
    prestige: 0,
    totalDonated: "0",
    skills: { str: 0, agi: 0, luk: 0, int: 0, cha: 0 },
    farm: { plots: [], harvest: {} },
    buffs: { jamukuat: 0, jimatcuan: 0, ramuanxp: 0, perisaibaja: 0 },
    bossDamageTotal: 0,
    bossKills: 0,
    bossMvpCount: 0,
    petExpedition: null,
    profileTheme: "midnight",
    ownedThemes: ["midnight"],
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

  const customTitle =
    typeof obj.customTitle === "string" && obj.customTitle.trim().length > 0
      ? obj.customTitle.trim().slice(0, 32)
      : null;

  const spouseJid =
    typeof obj.spouseJid === "string" && obj.spouseJid.trim().length > 0
      ? obj.spouseJid.trim()
      : null;

  const marriedAt =
    typeof obj.marriedAt === "number" && Number.isFinite(obj.marriedAt) && obj.marriedAt > 0
      ? Math.floor(obj.marriedAt)
      : 0;

  const dowryAmount =
    typeof obj.dowryAmount === "string" && /^\d+$/.test(obj.dowryAmount)
      ? obj.dowryAmount
      : "0";

  const dailyQuest: DailyQuestProgressState = { dateKey: "", claimedIds: [] };
  if (obj.dailyQuest && typeof obj.dailyQuest === "object" && !Array.isArray(obj.dailyQuest)) {
    const rawDq = obj.dailyQuest as Record<string, unknown>;
    if (typeof rawDq.dateKey === "string") {
      dailyQuest.dateKey = rawDq.dateKey.slice(0, 16);
    }
    if (Array.isArray(rawDq.claimedIds)) {
      const seen = new Set<string>();
      for (const id of rawDq.claimedIds) {
        if (typeof id === "string" && id.trim().length > 0 && !seen.has(id)) {
          seen.add(id);
          dailyQuest.claimedIds.push(id);
        }
      }
    }
  }

  const achievements: string[] = [];
  if (Array.isArray(obj.achievements)) {
    const seen = new Set<string>();
    for (const id of obj.achievements) {
      if (typeof id === "string" && id.trim().length > 0 && !seen.has(id)) {
        seen.add(id);
        achievements.push(id);
      }
    }
  }

  const properties: Record<string, number> = {};
  if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
    for (const [key, val] of Object.entries(obj.properties as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isInteger(val) && val > 0) {
        properties[key.toLowerCase()] = val;
      }
    }
  }

  const lastPropertyHarvestAt =
    typeof obj.lastPropertyHarvestAt === "number" &&
    Number.isFinite(obj.lastPropertyHarvestAt) &&
    obj.lastPropertyHarvestAt > 0
      ? Math.floor(obj.lastPropertyHarvestAt)
      : 0;

  const lastSalaryDateKey =
    typeof obj.lastSalaryDateKey === "string" ? obj.lastSalaryDateKey.slice(0, 16) : "";

  let deposito: DepositoState | null = null;
  if (obj.deposito && typeof obj.deposito === "object" && !Array.isArray(obj.deposito)) {
    const rawDep = obj.deposito as Record<string, unknown>;
    if (
      typeof rawDep.principal === "string" &&
      /^\d+$/.test(rawDep.principal) &&
      rawDep.principal !== "0" &&
      typeof rawDep.depositedAt === "number" &&
      Number.isFinite(rawDep.depositedAt) &&
      rawDep.depositedAt > 0
    ) {
      const ratePercent =
        typeof rawDep.ratePercent === "number" && Number.isFinite(rawDep.ratePercent) && rawDep.ratePercent > 0
          ? rawDep.ratePercent
          : 5;
      deposito = {
        principal: rawDep.principal,
        depositedAt: Math.floor(rawDep.depositedAt),
        ratePercent,
      };
    }
  }

  const stocks: Record<string, StockHoldingState> = {};
  if (obj.stocks && typeof obj.stocks === "object" && !Array.isArray(obj.stocks)) {
    for (const [key, val] of Object.entries(obj.stocks as Record<string, unknown>)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const rec = val as Record<string, unknown>;
        if (
          typeof rec.lots === "number" &&
          Number.isInteger(rec.lots) &&
          rec.lots > 0 &&
          typeof rec.avgPrice === "string" &&
          /^\d+$/.test(rec.avgPrice)
        ) {
          stocks[key.toUpperCase()] = { lots: rec.lots, avgPrice: rec.avgPrice };
        }
      }
    }
  }

  const cards: Record<string, number> = {};
  if (obj.cards && typeof obj.cards === "object" && !Array.isArray(obj.cards)) {
    for (const [key, val] of Object.entries(obj.cards as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isInteger(val) && val > 0) {
        cards[key.toLowerCase()] = val;
      }
    }
  }

  let career: CareerState | null = null;
  if (obj.career && typeof obj.career === "object" && !Array.isArray(obj.career)) {
    const rec = obj.career as Record<string, unknown>;
    if (typeof rec.jobId === "string" && rec.jobId.trim().length > 0) {
      career = {
        jobId: rec.jobId.trim().toLowerCase(),
        level:
          typeof rec.level === "number" && Number.isInteger(rec.level) && rec.level >= 1
            ? Math.min(10, rec.level)
            : 1,
        shiftsDone:
          typeof rec.shiftsDone === "number" && Number.isInteger(rec.shiftsDone) && rec.shiftsDone >= 0
            ? rec.shiftsDone
            : 0,
      };
    }
  }

  let startup: StartupState | null = null;
  if (obj.startup && typeof obj.startup === "object" && !Array.isArray(obj.startup)) {
    const rec = obj.startup as Record<string, unknown>;
    if (typeof rec.name === "string" && rec.name.trim().length > 0) {
      startup = {
        name: rec.name.trim().slice(0, 32),
        level:
          typeof rec.level === "number" && Number.isInteger(rec.level) && rec.level >= 1
            ? Math.min(20, rec.level)
            : 1,
        employees:
          typeof rec.employees === "number" && Number.isInteger(rec.employees) && rec.employees >= 0
            ? rec.employees
            : 0,
        lastDividendAt:
          typeof rec.lastDividendAt === "number" &&
          Number.isFinite(rec.lastDividendAt) &&
          rec.lastDividendAt > 0
            ? Math.floor(rec.lastDividendAt)
            : 0,
      };
    }
  }

  let loan: LoanState | null = null;
  if (obj.loan && typeof obj.loan === "object" && !Array.isArray(obj.loan)) {
    const rec = obj.loan as Record<string, unknown>;
    if (
      typeof rec.principal === "string" &&
      /^\d+$/.test(rec.principal) &&
      typeof rec.interest === "string" &&
      /^\d+$/.test(rec.interest) &&
      (rec.principal !== "0" || rec.interest !== "0")
    ) {
      loan = {
        principal: rec.principal,
        interest: rec.interest,
        borrowedAt:
          typeof rec.borrowedAt === "number" && Number.isFinite(rec.borrowedAt)
            ? Math.floor(rec.borrowedAt)
            : 0,
        dueAt:
          typeof rec.dueAt === "number" && Number.isFinite(rec.dueAt) ? Math.floor(rec.dueAt) : 0,
      };
    }
  }

  const insurances: Record<InsuranceKey, number> = { brankas: 0, bpjs: 0, pengacara: 0 };
  if (obj.insurances && typeof obj.insurances === "object" && !Array.isArray(obj.insurances)) {
    const rec = obj.insurances as Record<string, unknown>;
    for (const key of ["brankas", "bpjs", "pengacara"] as const) {
      const val = rec[key];
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        insurances[key] = Math.floor(val);
      }
    }
  }

  const prestige =
    typeof obj.prestige === "number" && Number.isInteger(obj.prestige) && obj.prestige >= 0
      ? Math.min(10, obj.prestige)
      : 0;

  const totalDonated =
    typeof obj.totalDonated === "string" && /^\d+$/.test(obj.totalDonated)
      ? obj.totalDonated
      : "0";

  const skills: Record<SkillKey, number> = { str: 0, agi: 0, luk: 0, int: 0, cha: 0 };
  if (obj.skills && typeof obj.skills === "object" && !Array.isArray(obj.skills)) {
    const rec = obj.skills as Record<string, unknown>;
    for (const key of SKILL_KEYS) {
      const val = rec[key];
      if (typeof val === "number" && Number.isInteger(val) && val > 0) {
        skills[key] = Math.min(MAX_SKILL_STAT, val);
      }
    }
  }

  const farm: FarmState = { plots: [], harvest: {} };
  if (obj.farm && typeof obj.farm === "object" && !Array.isArray(obj.farm)) {
    const rec = obj.farm as Record<string, unknown>;
    if (Array.isArray(rec.plots)) {
      for (const rawPlot of rec.plots) {
        if (farm.plots.length >= MAX_FARM_PLOTS) break;
        if (rawPlot && typeof rawPlot === "object" && !Array.isArray(rawPlot)) {
          const p = rawPlot as Record<string, unknown>;
          if (
            typeof p.cropId === "string" &&
            p.cropId.trim().length > 0 &&
            typeof p.plantedAt === "number" &&
            Number.isFinite(p.plantedAt) &&
            typeof p.readyAt === "number" &&
            Number.isFinite(p.readyAt)
          ) {
            farm.plots.push({
              cropId: p.cropId.trim().toLowerCase(),
              plantedAt: Math.floor(p.plantedAt),
              readyAt: Math.floor(p.readyAt),
              watered: p.watered === true,
            });
          }
        }
      }
    }
    if (rec.harvest && typeof rec.harvest === "object" && !Array.isArray(rec.harvest)) {
      for (const [k, v] of Object.entries(rec.harvest as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isInteger(v) && v > 0) {
          farm.harvest[k.toLowerCase()] = v;
        }
      }
    }
  }

  const buffs: Record<BuffKey, number> = {
    jamukuat: 0,
    jimatcuan: 0,
    ramuanxp: 0,
    perisaibaja: 0,
  };
  if (obj.buffs && typeof obj.buffs === "object" && !Array.isArray(obj.buffs)) {
    const rec = obj.buffs as Record<string, unknown>;
    for (const key of BUFF_KEYS) {
      const val = rec[key];
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        buffs[key] = Math.floor(val);
      }
    }
  }

  const bossDamageTotal =
    typeof obj.bossDamageTotal === "number" &&
    Number.isFinite(obj.bossDamageTotal) &&
    obj.bossDamageTotal > 0
      ? Math.floor(obj.bossDamageTotal)
      : 0;

  const bossKills =
    typeof obj.bossKills === "number" && Number.isInteger(obj.bossKills) && obj.bossKills > 0
      ? obj.bossKills
      : 0;

  const bossMvpCount =
    typeof obj.bossMvpCount === "number" &&
    Number.isInteger(obj.bossMvpCount) &&
    obj.bossMvpCount > 0
      ? obj.bossMvpCount
      : 0;

  let petExpedition: PetExpeditionState | null = null;
  if (obj.petExpedition && typeof obj.petExpedition === "object" && !Array.isArray(obj.petExpedition)) {
    const expObj = obj.petExpedition as Record<string, unknown>;
    const rawPet = typeof expObj.pet === "string" ? expObj.pet.toLowerCase() : "";
    if (
      (PET_TYPES as readonly string[]).includes(rawPet) &&
      typeof expObj.zoneId === "string" &&
      expObj.zoneId.trim().length > 0 &&
      typeof expObj.startedAt === "number" &&
      Number.isFinite(expObj.startedAt) &&
      typeof expObj.endsAt === "number" &&
      Number.isFinite(expObj.endsAt)
    ) {
      petExpedition = {
        pet: rawPet as PetType,
        zoneId: expObj.zoneId.trim().slice(0, 32),
        startedAt: Math.floor(expObj.startedAt),
        endsAt: Math.floor(expObj.endsAt),
      };
    }
  }

  const ownedThemesSet = new Set<ProfileThemeId>(["midnight"]);
  if (Array.isArray(obj.ownedThemes)) {
    for (const rawTheme of obj.ownedThemes) {
      if (typeof rawTheme === "string") {
        const norm = normalizeProfileThemeId(rawTheme);
        if (norm) ownedThemesSet.add(norm);
      }
    }
  }
  const parsedTheme =
    typeof obj.profileTheme === "string" ? normalizeProfileThemeId(obj.profileTheme) : null;
  const profileTheme: ProfileThemeId =
    parsedTheme && ownedThemesSet.has(parsedTheme) ? parsedTheme : "midnight";
  const ownedThemes = Array.from(ownedThemesSet);

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
    customTitle,
    spouseJid,
    marriedAt,
    dowryAmount,
    dailyQuest,
    achievements,
    properties,
    lastPropertyHarvestAt,
    lastSalaryDateKey,
    deposito,
    stocks,
    cards,
    career,
    startup,
    loan,
    insurances,
    prestige,
    totalDonated,
    skills,
    farm,
    buffs,
    bossDamageTotal,
    bossKills,
    bossMvpCount,
    petExpedition,
    profileTheme,
    ownedThemes,
  };
}

export function serializeRpgState(state: MemberRpgState): Prisma.InputJsonValue {
  const serializedStocks: Record<string, { lots: number; avgPrice: string }> = {};
  for (const [ticker, holding] of Object.entries(state.stocks)) {
    serializedStocks[ticker] = { lots: holding.lots, avgPrice: holding.avgPrice };
  }

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
    customTitle: state.customTitle,
    spouseJid: state.spouseJid,
    marriedAt: state.marriedAt,
    dowryAmount: state.dowryAmount,
    dailyQuest: {
      dateKey: state.dailyQuest.dateKey,
      claimedIds: [...state.dailyQuest.claimedIds],
    },
    achievements: [...state.achievements],
    properties: { ...state.properties },
    lastPropertyHarvestAt: state.lastPropertyHarvestAt,
    lastSalaryDateKey: state.lastSalaryDateKey,
    deposito: state.deposito ? { ...state.deposito } : null,
    stocks: serializedStocks,
    cards: { ...state.cards },
    career: state.career ? { ...state.career } : null,
    startup: state.startup ? { ...state.startup } : null,
    loan: state.loan ? { ...state.loan } : null,
    insurances: { ...state.insurances },
    prestige: state.prestige,
    totalDonated: state.totalDonated,
    skills: { ...state.skills },
    farm: {
      plots: state.farm.plots.map((p) => ({ ...p })),
      harvest: { ...state.farm.harvest },
    },
    buffs: { ...state.buffs },
    bossDamageTotal: state.bossDamageTotal,
    bossKills: state.bossKills,
    bossMvpCount: state.bossMvpCount,
    petExpedition: state.petExpedition ? { ...state.petExpedition } : null,
    profileTheme: state.profileTheme,
    ownedThemes: [...state.ownedThemes],
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

export function withCustomTitle(state: MemberRpgState, title: string | null): MemberRpgState {
  return {
    ...state,
    customTitle: title ? title.trim().slice(0, 32) : null,
  };
}

export function withMarriage(
  state: MemberRpgState,
  spouseJid: string | null,
  marriedAt = 0,
  dowryAmount = "0",
): MemberRpgState {
  return {
    ...state,
    spouseJid,
    marriedAt: spouseJid ? marriedAt : 0,
    dowryAmount: spouseJid ? dowryAmount : "0",
  };
}

export function withDailyQuestClaimed(
  state: MemberRpgState,
  dateKey: string,
  newlyClaimedIds: string[],
): MemberRpgState {
  const existing = state.dailyQuest.dateKey === dateKey ? state.dailyQuest.claimedIds : [];
  const merged = Array.from(new Set([...existing, ...newlyClaimedIds]));
  return {
    ...state,
    dailyQuest: {
      dateKey,
      claimedIds: merged,
    },
  };
}

export function withAchievementsAdded(
  state: MemberRpgState,
  newIds: string[],
): MemberRpgState {
  const merged = Array.from(new Set([...state.achievements, ...newIds]));
  return {
    ...state,
    achievements: merged,
  };
}

export function withPropertyDelta(
  state: MemberRpgState,
  propertyId: string,
  delta: number,
): MemberRpgState {
  const key = propertyId.toLowerCase();
  const current = state.properties[key] ?? 0;
  const nextQty = Math.max(0, Math.floor(current + delta));
  const nextProps: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.properties)) {
    if (k !== key) {
      nextProps[k] = v;
    }
  }
  if (nextQty > 0) {
    nextProps[key] = nextQty;
  }
  return {
    ...state,
    properties: nextProps,
  };
}

export function withPropertyHarvestAt(state: MemberRpgState, timestampMs: number): MemberRpgState {
  return {
    ...state,
    lastPropertyHarvestAt: Math.max(0, Math.floor(timestampMs)),
  };
}

export function withSalaryDateKey(state: MemberRpgState, dateKey: string): MemberRpgState {
  return {
    ...state,
    lastSalaryDateKey: dateKey,
  };
}

export function withDeposito(state: MemberRpgState, deposito: DepositoState | null): MemberRpgState {
  return {
    ...state,
    deposito: deposito ? { ...deposito } : null,
  };
}

export function withStockHolding(
  state: MemberRpgState,
  ticker: string,
  holding: StockHoldingState | null,
): MemberRpgState {
  const key = ticker.toUpperCase();
  const nextStocks: Record<string, StockHoldingState> = {};
  for (const [k, v] of Object.entries(state.stocks)) {
    if (k !== key) {
      nextStocks[k] = { ...v };
    }
  }
  if (holding && holding.lots > 0) {
    nextStocks[key] = { lots: Math.floor(holding.lots), avgPrice: holding.avgPrice };
  }
  return {
    ...state,
    stocks: nextStocks,
  };
}

export function withCardDelta(
  state: MemberRpgState,
  cardId: string,
  delta: number,
): MemberRpgState {
  const key = cardId.toLowerCase();
  const current = state.cards[key] ?? 0;
  const nextQty = Math.max(0, Math.floor(current + delta));
  const nextCards: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.cards)) {
    if (k !== key) {
      nextCards[k] = v;
    }
  }
  if (nextQty > 0) {
    nextCards[key] = nextQty;
  }
  return {
    ...state,
    cards: nextCards,
  };
}

export function withCareer(state: MemberRpgState, career: CareerState | null): MemberRpgState {
  return { ...state, career: career ? { ...career } : null };
}

export function withStartup(state: MemberRpgState, startup: StartupState | null): MemberRpgState {
  return { ...state, startup: startup ? { ...startup } : null };
}

export function withLoan(state: MemberRpgState, loan: LoanState | null): MemberRpgState {
  return { ...state, loan: loan ? { ...loan } : null };
}

export function withInsuranceUntil(
  state: MemberRpgState,
  key: InsuranceKey,
  untilMs: number,
): MemberRpgState {
  return {
    ...state,
    insurances: {
      ...state.insurances,
      [key]: Math.max(0, Math.floor(untilMs)),
    },
  };
}

export function isInsuranceActive(
  state: MemberRpgState,
  key: InsuranceKey,
  nowMs: number = Date.now(),
): boolean {
  return state.insurances[key] > nowMs;
}

export function withPrestige(state: MemberRpgState, prestige: number): MemberRpgState {
  return {
    ...state,
    prestige: Math.max(0, Math.min(10, Math.floor(prestige))),
  };
}

export function withDonatedAdded(state: MemberRpgState, delta: bigint): MemberRpgState {
  const prev = BigInt(state.totalDonated);
  const next = prev + (delta > 0n ? delta : 0n);
  return { ...state, totalDonated: next.toString() };
}

export function getTotalSkillPointsForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return safeLevel * 2;
}

export function getSpentSkillPoints(state: MemberRpgState): number {
  return (
    state.skills.str +
    state.skills.agi +
    state.skills.luk +
    state.skills.int +
    state.skills.cha
  );
}

export function withSkills(
  state: MemberRpgState,
  nextSkills: Record<SkillKey, number>,
): MemberRpgState {
  return {
    ...state,
    skills: {
      str: Math.max(0, Math.min(MAX_SKILL_STAT, Math.floor(nextSkills.str))),
      agi: Math.max(0, Math.min(MAX_SKILL_STAT, Math.floor(nextSkills.agi))),
      luk: Math.max(0, Math.min(MAX_SKILL_STAT, Math.floor(nextSkills.luk))),
      int: Math.max(0, Math.min(MAX_SKILL_STAT, Math.floor(nextSkills.int))),
      cha: Math.max(0, Math.min(MAX_SKILL_STAT, Math.floor(nextSkills.cha))),
    },
  };
}

export function withFarm(state: MemberRpgState, nextFarm: FarmState): MemberRpgState {
  const cleanHarvest: Record<string, number> = {};
  for (const [k, v] of Object.entries(nextFarm.harvest)) {
    const qty = Math.floor(v);
    if (qty > 0) cleanHarvest[k.toLowerCase()] = qty;
  }
  return {
    ...state,
    farm: {
      plots: nextFarm.plots.slice(0, MAX_FARM_PLOTS).map((p) => ({ ...p })),
      harvest: cleanHarvest,
    },
  };
}

export function withBuffUntil(
  state: MemberRpgState,
  key: BuffKey,
  untilMs: number,
): MemberRpgState {
  return {
    ...state,
    buffs: {
      ...state.buffs,
      [key]: Math.max(0, Math.floor(untilMs)),
    },
  };
}

export function isBuffActive(
  state: MemberRpgState,
  key: BuffKey,
  nowMs: number = Date.now(),
): boolean {
  return state.buffs[key] > nowMs;
}

export function withBossRaidStatsDelta(
  state: MemberRpgState,
  delta: { damageDelta?: number; killsDelta?: number; mvpDelta?: number },
): MemberRpgState {
  return {
    ...state,
    bossDamageTotal: Math.max(0, state.bossDamageTotal + Math.floor(delta.damageDelta ?? 0)),
    bossKills: Math.max(0, state.bossKills + Math.floor(delta.killsDelta ?? 0)),
    bossMvpCount: Math.max(0, state.bossMvpCount + Math.floor(delta.mvpDelta ?? 0)),
  };
}

export function withPetExpedition(
  state: MemberRpgState,
  expedition: PetExpeditionState | null,
): MemberRpgState {
  return {
    ...state,
    petExpedition: expedition ? { ...expedition } : null,
  };
}

export function withProfileTheme(
  state: MemberRpgState,
  themeId: ProfileThemeId,
): MemberRpgState {
  const owned = Array.from(new Set<ProfileThemeId>(["midnight", ...state.ownedThemes, themeId]));
  return {
    ...state,
    profileTheme: themeId,
    ownedThemes: owned,
  };
}

export function withOwnedThemeAdded(
  state: MemberRpgState,
  themeId: ProfileThemeId,
): MemberRpgState {
  const owned = Array.from(new Set<ProfileThemeId>(["midnight", ...state.ownedThemes, themeId]));
  return {
    ...state,
    ownedThemes: owned,
  };
}

const PET_RARITY_ORDER: Record<PetType, number> = {
  kucing: 1,
  kyubi: 2,
  centaur: 3,
  griffin: 4,
  naga: 5,
  phonix: 6,
};

export interface FeaturedPetSummary {
  id: PetType;
  level: number;
  exp: number;
  hunger: number;
  power: number;
}

export function getFeaturedPet(state: MemberRpgState): FeaturedPetSummary | null {
  let best: FeaturedPetSummary | null = null;
  for (const petKey of PET_TYPES) {
    const p = state.pets[petKey];
    if (p.level <= 0) continue;
    if (
      !best ||
      p.level > best.level ||
      (p.level === best.level && PET_RARITY_ORDER[petKey] > PET_RARITY_ORDER[best.id]) ||
      (p.level === best.level &&
        PET_RARITY_ORDER[petKey] === PET_RARITY_ORDER[best.id] &&
        p.exp > best.exp)
    ) {
      best = {
        id: petKey,
        level: p.level,
        exp: p.exp,
        hunger: p.hunger,
        power: p.level * 25,
      };
    }
  }
  return best;
}
