import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  clampMoneyCredit,
  formatRemainingDuration,
  formatRupiah,
  scaleMoneyByLevel,
} from "../../utils/currency";
import { applyGroupXpEvent } from "../group/groupXpEvent.cache";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import {
  BOSS_FIGHT_SPECS,
  COOK_RECIPES,
  COOK_RECIPE_MAP,
  CRATE_LOOT_SPECS,
  PET_EGG_MAP,
  PET_EXPEDITION_DURATION_MS,
  PET_EXPEDITION_HUNGER_COST,
  PET_EXPEDITION_ZONE_MAP,
  PET_EXPEDITION_ZONES,
  PET_LABELS,
  PET_SHOP_MAP,
  PET_TIER_WEIGHT,
  SHOP_CATALOG,
  SHOP_ITEM_MAP,
  TOOL_SPECS,
  type PetEggTier,
} from "./rpgCatalog";
import {
  CRATE_TYPES,
  getFeaturedPet,
  getRemainingCooldownMs,
  getRemainingUgdMs,
  MAX_PLAYER_HP,
  parseRpgState,
  PET_TYPES,
  serializeRpgState,
  TOOL_TYPES,
  withCrateDelta,
  withHp,
  withItemDelta,
  withItemsDelta,
  withPetExpedition,
  withPetState,
  withToolState,
  withUpdatedCooldown,
  type CrateType,
  type MemberRpgState,
  type PetType,
  type ToolType,
} from "./rpgState";

export const INFINITE_RPG_COOLDOWNS_MS: Record<string, number> = {
  adventure: 16 * 60 * 1000,
  nebang: 10 * 60 * 1000,
  berkebon: 10 * 60 * 1000,
  fight_kucing: 24 * 60 * 1000,
  fight_kyubi: 30 * 60 * 1000,
  fight_centaur: 30 * 60 * 1000,
  fight_griffin: 36 * 60 * 1000,
  fight_naga: 40 * 60 * 1000,
  fight_phonix: 50 * 60 * 1000,
};

const POTION_HEAL_AMOUNT = 40;
const MIN_HP_FOR_COMBAT = 20;
const MAX_TOOL_LEVEL = 10;
const MAX_PET_LEVEL = 20;
const MAX_OPEN_CRATE_BATCH = 20;
const MAX_SHOP_QTY = 500;

const ADVENTURE_ZONES = [
  "Hutan Kristal Abadi",
  "Reruntuhan Kerajaan Nusantara",
  "Lembah Naga Terlarang",
  "Gua Zamrud Selatan",
  "Pulau Harta Karun Emas",
  "Puncak Gunung Awan",
] as const;

export interface InventorySnapshot {
  hp: number;
  maxHp: number;
  level: number;
  moneyBalance: bigint;
  bankBalance: bigint;
  ugdRemainingMs: number;
  tools: { id: ToolType; label: string; level: number; durability: number }[];
  crates: { id: CrateType; count: number }[];
  items: { id: string; label: string; count: number; sellPrice: bigint }[];
}

export interface PetPenSnapshot {
  pets: { id: PetType; label: string; level: number; exp: number; hunger: number; power: number }[];
  foodCount: number;
  elixirCount: number;
  expedition: {
    pet: PetType;
    petLabel: string;
    zoneName: string;
    remainingMs: number;
    ready: boolean;
  } | null;
}

export interface PetAdoptResult {
  pet: PetType;
  petLabel: string;
  pricePaid: bigint;
  xpGained: number;
  currentMoney: bigint;
}

export interface PetEggHatchResult {
  tier: PetEggTier;
  eggLabel: string;
  pricePaid: bigint;
  pet: PetType;
  petLabel: string;
  outcome: "unlocked" | "leveled_up" | "max_compensated";
  oldLevel: number;
  newLevel: number;
  bonusItems: Record<string, number>;
  xpGained: number;
  currentMoney: bigint;
}

export interface PetExpeditionStatus {
  active: {
    pet: PetType;
    petLabel: string;
    petLevel: number;
    zoneName: string;
    remainingMs: number;
    ready: boolean;
  } | null;
  ownedPets: { id: PetType; label: string; level: number; hunger: number }[];
}

export interface PetExpeditionStartResult {
  pet: PetType;
  petLabel: string;
  petLevel: number;
  zoneName: string;
  durationMs: number;
  hungerAfter: number;
}

export interface PetExpeditionClaimResult {
  pet: PetType;
  petLabel: string;
  zoneName: string;
  moneyGained: bigint;
  xpGained: number;
  itemsFound: Record<string, number>;
  crateFound: CrateType | null;
  petExpGained: number;
  petOldLevel: number;
  petNewLevel: number;
  currentMoney: bigint;
}

export interface HealResult {
  potionsUsed: number;
  hpBefore: number;
  hpAfter: number;
  potionsLeft: number;
}

export interface AdventureResult {
  zone: string;
  moneyGained: bigint;
  xpGained: number;
  hpLost: number;
  hpAfter: number;
  itemsFound: Record<string, number>;
  crateFound: CrateType | null;
  currentMoney: bigint;
}

export interface GatherResult {
  action: "nebang" | "berkebon";
  moneyGained: bigint;
  xpGained: number;
  itemsGained: Record<string, number>;
  toolBonusPercent: number;
  currentMoney: bigint;
}

export interface CookResult {
  recipeId: string;
  recipeLabel: string;
  quantity: number;
  xpGained: number;
  totalOwned: number;
  sellValueEach: bigint;
}

export interface ShopTradeResult {
  mode: "buy" | "sell";
  itemId: string;
  itemLabel: string;
  quantity: number;
  totalMoney: bigint;
  currentMoney: bigint;
  remainingQty: number;
}

export interface ToolForgeResult {
  mode: "craft" | "upgrade";
  toolId: ToolType;
  toolLabel: string;
  newLevel: number;
  durability: number;
  moneySpent: bigint;
  currentMoney: bigint;
}

export interface OpenCrateResult {
  crate: CrateType;
  crateLabel: string;
  openedCount: number;
  moneyGained: bigint;
  xpGained: number;
  itemsGained: Record<string, number>;
  petsGained: { pet: PetType; newLevel: number; unlocked: boolean }[];
  currentMoney: bigint;
}

export interface PetCareResult {
  mode: "feed" | "ramuan";
  pet: PetType;
  petLabel: string;
  oldLevel: number;
  newLevel: number;
  exp: number;
  hunger: number;
  remainingSupply: number;
}

export interface BossFightResult {
  bossId: PetType;
  bossName: string;
  won: boolean;
  playerPower: number;
  bossPower: number;
  hpLost: number;
  hpAfter: number;
  moneyGained: bigint;
  xpGained: number;
  crateGained: CrateType | null;
  petDropped: boolean;
  petNewLevel: number;
  currentMoney: bigint;
}

interface InfiniteProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface InfiniteTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number | bigint;
      balanceBefore?: number | bigint;
      balanceAfter?: number | bigint;
      correlationId?: string;
      note?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
}

interface InfiniteTx {
  groupMemberProfile: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
  };
}

interface InfiniteDb {
  $transaction<T>(fn: (tx: InfiniteTx) => Promise<T>): Promise<T>;
}

export function calculatePlayerCombatPower(
  level: number,
  state: MemberRpgState,
  matchingPet?: PetType,
  nowMs: number = Date.now(),
): number {
  const base = Math.max(1, level) * 12;
  const swordBonus = state.tools.sword.level * 28;
  const armorBonus = state.tools.armor.level * 16;

  let bestPetPower = 0;
  for (const petKey of PET_TYPES) {
    const pet = state.pets[petKey];
    if (pet.level > 0) {
      const weight = matchingPet === petKey ? 32 : 18;
      const pwr = pet.level * weight;
      if (pwr > bestPetPower) bestPetPower = pwr;
    }
  }

  const rawPower = base + swordBonus + armorBonus + bestPetPower;
  const strMult = 1 + state.skills.str * 0.06;
  const buffMult = state.buffs.jamukuat > nowMs ? 1.35 : 1;
  return Math.round(rawPower * strMult * buffMult);
}

export class RpgInfiniteService {
  constructor(
    private readonly profileRepo: InfiniteProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: InfiniteTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: InfiniteDb = prisma,
  ) {}

  async getInventory(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<InventorySnapshot> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);

    const tools = TOOL_TYPES.map((id) => ({
      id,
      label: TOOL_SPECS[id].label,
      level: state.tools[id].level,
      durability: state.tools[id].durability,
    }));

    const crates = CRATE_TYPES.map((id) => ({
      id,
      count: state.crates[id],
    }));

    const items: InventorySnapshot["items"] = [];
    for (const [id, count] of Object.entries(state.items)) {
      if (count > 0) {
        const spec = SHOP_ITEM_MAP.get(id);
        items.push({
          id,
          label: spec?.label ?? id,
          count,
          sellPrice: spec?.sellPrice ?? 100_000n,
        });
      }
    }
    items.sort((a, b) => a.label.localeCompare(b.label));

    return {
      hp: state.hp,
      maxHp: MAX_PLAYER_HP,
      level: Math.max(1, profile.level),
      moneyBalance: profile.moneyBalance,
      bankBalance: profile.bankBalance,
      ugdRemainingMs: getRemainingUgdMs(state, now.getTime()),
      tools,
      crates,
      items,
    };
  }

  async getPetPen(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PetPenSnapshot> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const nowMs = now.getTime();

    const pets = PET_TYPES.map((id) => {
      const p = state.pets[id];
      return {
        id,
        label: PET_LABELS[id],
        level: p.level,
        exp: p.exp,
        hunger: p.hunger,
        power: p.level * 25,
      };
    });

    let expedition: PetPenSnapshot["expedition"] = null;
    if (state.petExpedition) {
      const exp = state.petExpedition;
      const zone = PET_EXPEDITION_ZONE_MAP.get(exp.zoneId);
      const remainingMs = Math.max(0, exp.endsAt - nowMs);
      expedition = {
        pet: exp.pet,
        petLabel: PET_LABELS[exp.pet],
        zoneName: zone?.name ?? "Zona Petualangan",
        remainingMs,
        ready: remainingMs <= 0,
      };
    }

    return {
      pets,
      foodCount: state.items.makananpet ?? 0,
      elixirCount: state.items.ramuanpet ?? 0,
      expedition,
    };
  }

  async adoptPet(groupJid: string, userJid: string, pet: PetType): Promise<PetAdoptResult> {
    const spec = PET_SHOP_MAP.get(pet);
    if (!spec) {
      throw new AppUserError(
        `Pet *${PET_LABELS[pet]}* tidak dijual langsung di Pet Shop! Dapatkan lewat *.telurpet mitos*, *.open*, atau *.fight${pet}*.`,
      );
    }

    const xpGained = applyGroupXpEvent(groupJid, 50);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const playerLevel = Math.max(1, profile.level);

      if (playerLevel < spec.minLevel) {
        throw new AppUserError(
          `Syarat adopsi *${spec.label}* minimal Level ${String(spec.minLevel)} (levelmu saat ini Lv.${String(playerLevel)}).`,
        );
      }
      if (state.pets[pet].level > 0) {
        throw new AppUserError(
          `Kamu sudah memiliki pet *${PET_LABELS[pet]}* (Lv.${String(state.pets[pet].level)})! Naikkan levelnya lewat *.feed ${pet}*, *.ramuan ${pet}*, atau *.telurpet*.`,
        );
      }
      if (profile.moneyBalance < spec.price) {
        throw new AppUserError(
          `Biaya adopsi *${spec.label}* sebesar ${formatRupiah(spec.price)}, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withPetState(state, pet, { level: 1, exp: 0, hunger: 100 });
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: spec.price } },
        data: {
          moneyBalance: { decrement: spec.price },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat memproses adopsi pet.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -spec.price,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `petshop_adopt_${pet}`,
        },
        tx,
      );

      return {
        pet,
        petLabel: PET_LABELS[pet],
        pricePaid: spec.price,
        xpGained,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async hatchPetEgg(
    groupJid: string,
    userJid: string,
    tier: PetEggTier,
  ): Promise<PetEggHatchResult> {
    const spec = PET_EGG_MAP.get(tier);
    if (!spec) {
      throw new AppUserError("Tier telur tersedia: biasa, langka, mitos.");
    }

    const totalWeight = spec.pool.reduce((sum, entry) => sum + entry.weight, 0);
    const roll = this.random.intBetween(1, Math.max(1, totalWeight));
    let cursor = 0;
    let hatchedPet: PetType = spec.pool[0]?.pet ?? "kucing";
    for (const entry of spec.pool) {
      cursor += entry.weight;
      if (roll <= cursor) {
        hatchedPet = entry.pet;
        break;
      }
    }

    const xpGained = applyGroupXpEvent(groupJid, spec.xp);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const playerLevel = Math.max(1, profile.level);

      if (playerLevel < spec.minLevel) {
        throw new AppUserError(
          `Syarat menetas *${spec.label}* minimal Level ${String(spec.minLevel)} (levelmu saat ini Lv.${String(playerLevel)}).`,
        );
      }
      if (profile.moneyBalance < spec.price) {
        throw new AppUserError(
          `Harga *${spec.label}* adalah ${formatRupiah(spec.price)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const cur = state.pets[hatchedPet];
      const oldLevel = cur.level;
      let newLevel = oldLevel;
      let outcome: PetEggHatchResult["outcome"] = "unlocked";
      const bonusItems: Record<string, number> = {};
      let nextState = state;

      if (oldLevel <= 0) {
        newLevel = 1;
        outcome = "unlocked";
        nextState = withPetState(state, hatchedPet, { level: 1, exp: 0, hunger: 100 });
      } else if (oldLevel < MAX_PET_LEVEL) {
        newLevel = oldLevel + 1;
        outcome = "leveled_up";
        nextState = withPetState(state, hatchedPet, {
          level: newLevel,
          exp: cur.exp,
          hunger: 100,
        });
      } else {
        outcome = "max_compensated";
        bonusItems.ramuanpet = 3;
        bonusItems.makananpet = 5;
        nextState = withItemsDelta(state, bonusItems);
      }

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: spec.price } },
        data: {
          moneyBalance: { decrement: spec.price },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup membeli telur pet.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -spec.price,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `telurpet_${tier}_${hatchedPet}`,
        },
        tx,
      );

      return {
        tier,
        eggLabel: spec.label,
        pricePaid: spec.price,
        pet: hatchedPet,
        petLabel: PET_LABELS[hatchedPet],
        outcome,
        oldLevel,
        newLevel,
        bonusItems,
        xpGained,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getPetExpeditionStatus(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PetExpeditionStatus> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const nowMs = now.getTime();

    const ownedPets = PET_TYPES.filter((id) => state.pets[id].level > 0).map((id) => ({
      id,
      label: PET_LABELS[id],
      level: state.pets[id].level,
      hunger: state.pets[id].hunger,
    }));

    if (!state.petExpedition) {
      return { active: null, ownedPets };
    }

    const exp = state.petExpedition;
    const zone = PET_EXPEDITION_ZONE_MAP.get(exp.zoneId);
    const remainingMs = Math.max(0, exp.endsAt - nowMs);

    return {
      active: {
        pet: exp.pet,
        petLabel: PET_LABELS[exp.pet],
        petLevel: state.pets[exp.pet].level,
        zoneName: zone?.name ?? "Zona Petualangan",
        remainingMs,
        ready: remainingMs <= 0,
      },
      ownedPets,
    };
  }

  async startPetExpedition(
    groupJid: string,
    userJid: string,
    requestedPet?: PetType,
    now: Date = new Date(),
  ): Promise<PetExpeditionStartResult> {
    const nowMs = now.getTime();
    const zone = PET_EXPEDITION_ZONES[this.random.intBetween(0, PET_EXPEDITION_ZONES.length - 1)] ?? {
      id: "lembah_bambu",
      name: "Lembah Bambu Berkabut",
      desc: "Kaya kayu, batu & pakan alami",
    };

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      if (state.petExpedition) {
        const rem = Math.max(0, state.petExpedition.endsAt - nowMs);
        if (rem <= 0) {
          throw new AppUserError(
            `Ekspedisi *${PET_LABELS[state.petExpedition.pet]}* sudah selesai! Ketik *.ekspedisipet klaim* dulu untuk ambil hadiahnya.`,
          );
        }
        throw new AppUserError(
          `Pet *${PET_LABELS[state.petExpedition.pet]}* masih dalam ekspedisi (sisa *${formatRemainingDuration(rem)}*).`,
        );
      }

      const chosenPet: PetType | null = requestedPet ?? getFeaturedPet(state)?.id ?? null;
      if (!chosenPet || state.pets[chosenPet].level <= 0) {
        throw new AppUserError(
          requestedPet
            ? `Kamu belum memiliki pet *${PET_LABELS[requestedPet]}*. Dapatkan lewat *.petshop* atau *.telurpet*!`
            : "Kamu belum memiliki pet di kandang! Adopsi dulu di *.petshop* atau *.telurpet*.",
        );
      }

      const petState = state.pets[chosenPet];
      if (petState.hunger < PET_EXPEDITION_HUNGER_COST) {
        throw new AppUserError(
          `Pet *${PET_LABELS[chosenPet]}* terlalu lapar (${String(petState.hunger)}%). Beri makan dulu lewat *.feed ${chosenPet}*!`,
        );
      }

      const hungerAfter = Math.max(0, petState.hunger - PET_EXPEDITION_HUNGER_COST);
      let nextState = withPetState(state, chosenPet, {
        ...petState,
        hunger: hungerAfter,
      });
      nextState = withPetExpedition(nextState, {
        pet: chosenPet,
        zoneId: zone.id,
        startedAt: nowMs,
        endsAt: nowMs + PET_EXPEDITION_DURATION_MS,
      });

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return {
        pet: chosenPet,
        petLabel: PET_LABELS[chosenPet],
        petLevel: petState.level,
        zoneName: zone.name,
        durationMs: PET_EXPEDITION_DURATION_MS,
        hungerAfter,
      };
    });
  }

  async claimPetExpedition(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PetExpeditionClaimResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      if (!state.petExpedition) {
        throw new AppUserError(
          "Tidak ada pet yang sedang menjalankan ekspedisi. Kirim pet dulu dengan *.ekspedisipet <pet>*!",
        );
      }

      const exp = state.petExpedition;
      const remainingMs = Math.max(0, exp.endsAt - nowMs);
      if (remainingMs > 0) {
        throw new AppUserError(
          `Pet *${PET_LABELS[exp.pet]}* masih menjelajah! Kembali dalam *${formatRemainingDuration(remainingMs)}*.`,
        );
      }

      const petState = state.pets[exp.pet];
      const tier = PET_TIER_WEIGHT[exp.pet];
      const petOldLevel = Math.max(1, petState.level);
      const zone = PET_EXPEDITION_ZONE_MAP.get(exp.zoneId);

      // Loot skala tier & level pet (uang tetap skala 60% anti-inflasi)
      const itemsFound: Record<string, number> = {
        makananpet: this.random.intBetween(1, 2 + (tier >= 4 ? 1 : 0)),
        kayu: this.random.intBetween(2, 4 + tier),
        batu: this.random.intBetween(2, 4 + tier),
        besi: this.random.intBetween(1, 2 + Math.floor(tier / 2)),
      };
      if (this.random.chance(Math.min(0.75, 0.25 + tier * 0.08))) {
        itemsFound.emas = this.random.intBetween(1, 1 + Math.floor(tier / 3));
      }
      if (tier >= 4 && this.random.chance(0.25 + (tier - 4) * 0.1)) {
        itemsFound.berlian = 1;
      }
      if (this.random.chance(Math.min(0.45, 0.12 + tier * 0.04 + petOldLevel * 0.01))) {
        itemsFound.ramuanpet = 1;
      }

      let crateFound: CrateType | null = null;
      const crateRollChance = Math.min(0.55, 0.18 + tier * 0.05 + petOldLevel * 0.01);
      if (this.random.chance(crateRollChance)) {
        if (tier >= 5 && this.random.chance(0.3)) {
          crateFound = "mythic";
        } else if (tier >= 3 && this.random.chance(0.45)) {
          crateFound = "uncommon";
        } else {
          crateFound = "common";
        }
      }

      const basePocket = BigInt(this.random.intBetween(1_200_000, 2_400_000));
      const petFactorPct = BigInt(100 + tier * 30 + petOldLevel * 5);
      const scaledMoney = (basePocket * petFactorPct) / 100n;
      const moneyGained = clampMoneyCredit(
        profile.moneyBalance,
        scaleMoneyByLevel(scaledMoney, profile.level),
      );
      const xpGained = applyGroupXpEvent(groupJid, 75 + tier * 15);

      const petExpGained = 60 + tier * 10 + petOldLevel * 5;
      let nextPetLevel = petOldLevel;
      let nextPetExp = petState.exp + petExpGained;
      while (nextPetLevel < MAX_PET_LEVEL && nextPetExp >= nextPetLevel * 100) {
        nextPetExp -= nextPetLevel * 100;
        nextPetLevel += 1;
      }

      let nextState = withPetExpedition(state, null);
      nextState = withPetState(nextState, exp.pet, {
        level: nextPetLevel,
        exp: nextPetExp,
        hunger: petState.hunger,
      });
      nextState = withItemsDelta(nextState, itemsFound);
      if (crateFound) {
        nextState = withCrateDelta(nextState, crateFound, 1);
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: moneyGained,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `pet_expedition_${exp.pet}`,
        },
        tx,
      );

      return {
        pet: exp.pet,
        petLabel: PET_LABELS[exp.pet],
        zoneName: zone?.name ?? "Zona Petualangan",
        moneyGained,
        xpGained,
        itemsFound,
        crateFound,
        petExpGained,
        petOldLevel,
        petNewLevel: nextPetLevel,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async healPlayer(groupJid: string, userJid: string, requestedCount?: number): Promise<HealResult> {
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      if (state.hp >= MAX_PLAYER_HP) {
        throw new AppUserError("HP kamu sudah penuh (100/100)! Tidak perlu pakai potion.");
      }

      const ownedPotions = state.items.potion ?? 0;
      if (ownedPotions <= 0) {
        throw new AppUserError(
          "Kamu belum punya Potion HP! Beli dulu di toko: *.shop buy potion 3*",
        );
      }

      const missingHp = MAX_PLAYER_HP - state.hp;
      const neededToFull = Math.ceil(missingHp / POTION_HEAL_AMOUNT);
      const countToUse =
        requestedCount !== undefined
          ? Math.max(1, Math.min(requestedCount, ownedPotions, neededToFull))
          : Math.min(ownedPotions, neededToFull);

      const hpAfter = Math.min(MAX_PLAYER_HP, state.hp + countToUse * POTION_HEAL_AMOUNT);
      const nextState = withItemDelta(withHp(state, hpAfter), "potion", -countToUse);

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return {
        potionsUsed: countToUse,
        hpBefore: state.hp,
        hpAfter,
        potionsLeft: nextState.items.potion ?? 0,
      };
    });
  }

  async runAdventure(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<AdventureResult> {
    const cooldownMs = INFINITE_RPG_COOLDOWNS_MS.adventure ?? 8 * 60 * 1000;
    const nowMs = now.getTime();
    const zone =
      ADVENTURE_ZONES[this.random.intBetween(0, ADVENTURE_ZONES.length - 1)] ?? ADVENTURE_ZONES[0];
    const baseMoney = BigInt(this.random.intBetween(1_500_000, 4_500_000));
    const xpGained = applyGroupXpEvent(groupJid, this.random.intBetween(90, 180), nowMs);
    const rawDamage = this.random.intBetween(15, 32);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      const ugdRem = getRemainingUgdMs(state, nowMs);
      if (ugdRem > 0) {
        throw new AppUserError(
          `Kamu sedang dirawat di UGD! Istirahat dulu *${formatRemainingDuration(ugdRem)}* lagi.`,
        );
      }

      if (state.hp < MIN_HP_FOR_COMBAT) {
        throw new AppUserError(
          `HP kamu terlalu rendah (${String(state.hp)}/100)! Pulihkan dulu dengan *.heal* sebelum berpetualang.`,
        );
      }

      const cdRem = getRemainingCooldownMs(state, "adventure", cooldownMs, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Kamu baru pulang berpetualang. Tunggu *${formatRemainingDuration(cdRem)}* lagi.`,
        );
      }

      const armorReduction = Math.min(20, state.tools.armor.level * 2);
      const hpLost = Math.max(5, rawDamage - armorReduction);
      const hpAfter = Math.max(0, state.hp - hpLost);

      const swordBonusPct = state.tools.sword.level * 12;
      const boostedBase = (baseMoney * BigInt(100 + swordBonusPct)) / 100n;
      const moneyGained = clampMoneyCredit(
        profile.moneyBalance,
        scaleMoneyByLevel(boostedBase, profile.level),
      );

      const itemsFound: Record<string, number> = {
        kayu: this.random.intBetween(1, 3),
        batu: this.random.intBetween(1, 3),
        besi: this.random.intBetween(1, 2),
      };
      if (this.random.chance(0.4)) {
        itemsFound.emas = this.random.intBetween(1, 2);
      }
      if (this.random.chance(0.15)) {
        itemsFound.berlian = 1;
      }
      if (this.random.chance(0.55)) {
        itemsFound.daging = this.random.intBetween(1, 3);
      }

      let crateFound: CrateType | null = null;
      if (this.random.chance(0.1)) {
        crateFound = "mythic";
      } else if (this.random.chance(0.3)) {
        crateFound = "uncommon";
      } else if (this.random.chance(0.65)) {
        crateFound = "common";
      }

      let nextState = withUpdatedCooldown(withHp(state, hpAfter), "adventure", nowMs);
      nextState = withItemsDelta(nextState, itemsFound);
      if (crateFound) {
        nextState = withCrateDelta(nextState, crateFound, 1);
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: moneyGained,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: "adventure",
        },
        tx,
      );

      return {
        zone,
        moneyGained,
        xpGained,
        hpLost,
        hpAfter,
        itemsFound,
        crateFound,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async runGathering(
    groupJid: string,
    userJid: string,
    action: "nebang" | "berkebon",
    now: Date = new Date(),
  ): Promise<GatherResult> {
    const cooldownMs = INFINITE_RPG_COOLDOWNS_MS[action] ?? 5 * 60 * 1000;
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const cdRem = getRemainingCooldownMs(state, action, cooldownMs, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Tunggu *${formatRemainingDuration(cdRem)}* lagi sebelum .${action} kembali.`,
        );
      }

      const toolLevel =
        action === "nebang" ? state.tools.pickaxe.level : state.tools.fishingrod.level;
      const toolBonusPercent = toolLevel * 15;
      const baseMoney = BigInt(this.random.intBetween(720_000, 1_920_000));
      const boosted = (baseMoney * BigInt(100 + toolBonusPercent)) / 100n;
      const moneyGained = clampMoneyCredit(
        profile.moneyBalance,
        scaleMoneyByLevel(boosted, profile.level),
      );
      const xpGained = applyGroupXpEvent(groupJid, 65 + toolLevel * 5, nowMs);

      const itemsGained: Record<string, number> = {};
      if (action === "nebang") {
        itemsGained.kayu = this.random.intBetween(3, 6) + Math.floor(toolLevel / 2);
        itemsGained.batu = this.random.intBetween(1, 3);
        if (this.random.chance(0.35 + toolLevel * 0.03)) {
          itemsGained.besi = this.random.intBetween(1, 2);
        }
      } else {
        itemsGained.apel = this.random.intBetween(2, 5);
        itemsGained.mangga = this.random.intBetween(1, 4);
        itemsGained.pisang = this.random.intBetween(2, 4);
        itemsGained.anggur = this.random.intBetween(1, 3);
        if (this.random.chance(0.4 + toolLevel * 0.03)) {
          itemsGained.ikan = this.random.intBetween(1, 3);
        }
      }

      const nextState = withItemsDelta(
        withUpdatedCooldown(state, action, nowMs),
        itemsGained,
      );

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: moneyGained,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: action,
        },
        tx,
      );

      return {
        action,
        moneyGained,
        xpGained,
        itemsGained,
        toolBonusPercent,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  listCookRecipes() {
    return COOK_RECIPES;
  }

  async cookFood(
    groupJid: string,
    userJid: string,
    rawRecipeId: string,
    quantity = 1,
  ): Promise<CookResult> {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
      throw new AppUserError("Jumlah masakan harus antara 1 sampai 50.");
    }

    const recipe = COOK_RECIPE_MAP.get(rawRecipeId.trim().toLowerCase());
    if (!recipe) {
      const list = COOK_RECIPES.map((r) => r.id).join(", ");
      throw new AppUserError(`Resep "${rawRecipeId}" tidak dikenal. Resep tersedia: ${list}.`);
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      const missing: string[] = [];
      const deltas: Record<string, number> = { [recipe.id]: quantity };
      for (const [ing, reqQty] of Object.entries(recipe.ingredients)) {
        const totalReq = reqQty * quantity;
        const owned = state.items[ing] ?? 0;
        if (owned < totalReq) {
          missing.push(`${ing} (${String(owned)}/${String(totalReq)})`);
        }
        deltas[ing] = -totalReq;
      }

      if (missing.length > 0) {
        throw new AppUserError(`Bahan kurang untuk memasak ${recipe.label}: ${missing.join(", ")}.`);
      }

      const nextState = withItemsDelta(state, deltas);
      const xpGained = recipe.xp * quantity;

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      return {
        recipeId: recipe.id,
        recipeLabel: recipe.label,
        quantity,
        xpGained,
        totalOwned: nextState.items[recipe.id] ?? quantity,
        sellValueEach: recipe.sellPrice,
      };
    });
  }

  listShopItems() {
    return SHOP_CATALOG;
  }

  async shopBuy(
    groupJid: string,
    userJid: string,
    rawItemId: string,
    quantity = 1,
  ): Promise<ShopTradeResult> {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_SHOP_QTY) {
      throw new AppUserError(`Jumlah pembelian harus antara 1 sampai ${String(MAX_SHOP_QTY)}.`);
    }

    const spec = SHOP_ITEM_MAP.get(rawItemId.trim().toLowerCase());
    if (!spec) {
      throw new AppUserError(
        `Item "${rawItemId}" tidak ada di toko. Ketik *.shop list* untuk lihat daftar barang.`,
      );
    }
    if (spec.buyPrice === null) {
      throw new AppUserError(
        `${spec.label} tidak dijual di toko. Dapatkan lewat .berkebon, .adventure, atau .masak!`,
      );
    }

    const totalCost = spec.buyPrice * BigInt(quantity);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      if (profile.moneyBalance < totalCost) {
        throw new AppUserError(
          `Uang dompet kurang! Harga ${String(quantity)}x ${spec.label} = ${formatRupiah(totalCost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      const nextState = spec.isCrate
        ? withCrateDelta(state, spec.isCrate, quantity)
        : withItemDelta(state, spec.id, quantity);

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: totalCost } },
        data: {
          moneyBalance: { decrement: totalCost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Uang dompet tidak cukup saat memproses pembelian.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -totalCost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `shop_buy_${spec.id}x${String(quantity)}`,
        },
        tx,
      );

      const remainingQty = spec.isCrate
        ? nextState.crates[spec.isCrate]
        : (nextState.items[spec.id] ?? 0);

      return {
        mode: "buy",
        itemId: spec.id,
        itemLabel: spec.label,
        quantity,
        totalMoney: totalCost,
        currentMoney: updated.moneyBalance,
        remainingQty,
      };
    });
  }

  async shopSell(
    groupJid: string,
    userJid: string,
    rawItemId: string,
    qtyOrAll: number | "all",
  ): Promise<ShopTradeResult> {
    if (
      qtyOrAll !== "all" &&
      (!Number.isInteger(qtyOrAll) || qtyOrAll <= 0 || qtyOrAll > MAX_SHOP_QTY)
    ) {
      throw new AppUserError(`Jumlah jual harus antara 1 sampai ${String(MAX_SHOP_QTY)} atau 'all'.`);
    }

    const spec = SHOP_ITEM_MAP.get(rawItemId.trim().toLowerCase());
    if (!spec) {
      throw new AppUserError(`Item "${rawItemId}" tidak ditemukan di daftar toko.`);
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const owned = spec.isCrate ? state.crates[spec.isCrate] : (state.items[spec.id] ?? 0);
      const qtyToSell = qtyOrAll === "all" ? owned : qtyOrAll;

      if (owned <= 0 || qtyToSell <= 0 || qtyToSell > owned) {
        throw new AppUserError(`Kamu hanya punya ${String(owned)}x ${spec.label} di tas.`);
      }

      const rawProceeds = spec.sellPrice * BigInt(qtyToSell);
      const proceeds = clampMoneyCredit(profile.moneyBalance, rawProceeds);
      const nextState = spec.isCrate
        ? withCrateDelta(state, spec.isCrate, -qtyToSell)
        : withItemDelta(state, spec.id, -qtyToSell);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: proceeds },
          totalMoneyEarned: { increment: proceeds },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: proceeds,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `shop_sell_${spec.id}x${String(qtyToSell)}`,
        },
        tx,
      );

      const remainingQty = spec.isCrate
        ? nextState.crates[spec.isCrate]
        : (nextState.items[spec.id] ?? 0);

      return {
        mode: "sell",
        itemId: spec.id,
        itemLabel: spec.label,
        quantity: qtyToSell,
        totalMoney: proceeds,
        currentMoney: updated.moneyBalance,
        remainingQty,
      };
    });
  }

  async craftTool(groupJid: string, userJid: string, tool: ToolType): Promise<ToolForgeResult> {
    const spec = TOOL_SPECS[tool];
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      if (state.tools[tool].level > 0) {
        throw new AppUserError(
          `Kamu sudah punya ${spec.label} (Lv. ${String(state.tools[tool].level)}). Gunakan *.upgrade ${tool}* untuk menaikkan levelnya!`,
        );
      }

      if (profile.moneyBalance < spec.craftCostMoney) {
        throw new AppUserError(
          `Biaya craft ${spec.label} adalah ${formatRupiah(spec.craftCostMoney)}, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const missing: string[] = [];
      const deltas: Record<string, number> = {};
      for (const [mat, reqQty] of Object.entries(spec.craftMaterials)) {
        const owned = state.items[mat] ?? 0;
        if (owned < reqQty) {
          missing.push(`${mat} (${String(owned)}/${String(reqQty)})`);
        }
        deltas[mat] = -reqQty;
      }
      if (missing.length > 0) {
        throw new AppUserError(`Bahan kurang untuk craft ${spec.label}: ${missing.join(", ")}.`);
      }

      const nextState = withToolState(withItemsDelta(state, deltas), tool, {
        level: 1,
        durability: 100,
      });

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: spec.craftCostMoney } },
        data: {
          moneyBalance: { decrement: spec.craftCostMoney },
          experience: { increment: 120 },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Uang dompet tidak cukup saat membuat alat.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -spec.craftCostMoney,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `craft_${tool}`,
        },
        tx,
      );

      return {
        mode: "craft",
        toolId: tool,
        toolLabel: spec.label,
        newLevel: 1,
        durability: 100,
        moneySpent: spec.craftCostMoney,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async upgradeTool(groupJid: string, userJid: string, tool: ToolType): Promise<ToolForgeResult> {
    const spec = TOOL_SPECS[tool];
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const current = state.tools[tool];

      if (current.level <= 0) {
        throw new AppUserError(
          `Kamu belum punya ${spec.label}. Buat dulu dengan *.craft ${tool}*!`,
        );
      }
      if (current.level >= MAX_TOOL_LEVEL) {
        throw new AppUserError(`${spec.label} kamu sudah mencapai level maksimal (Lv. ${String(MAX_TOOL_LEVEL)})!`);
      }

      const nextLevel = current.level + 1;
      const upgradeCost = spec.upgradeMoneyPerLevel * BigInt(nextLevel);
      if (profile.moneyBalance < upgradeCost) {
        throw new AppUserError(
          `Biaya upgrade ${spec.label} ke Lv. ${String(nextLevel)} adalah ${formatRupiah(upgradeCost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const missing: string[] = [];
      const deltas: Record<string, number> = {};
      for (const [mat, reqBase] of Object.entries(spec.upgradeMaterials)) {
        const reqQty = reqBase * nextLevel;
        const owned = state.items[mat] ?? 0;
        if (owned < reqQty) {
          missing.push(`${mat} (${String(owned)}/${String(reqQty)})`);
        }
        deltas[mat] = -reqQty;
      }
      if (missing.length > 0) {
        throw new AppUserError(
          `Bahan kurang untuk upgrade ${spec.label} ke Lv. ${String(nextLevel)}: ${missing.join(", ")}.`,
        );
      }

      const nextState = withToolState(withItemsDelta(state, deltas), tool, {
        level: nextLevel,
        durability: 100,
      });

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: upgradeCost } },
        data: {
          moneyBalance: { decrement: upgradeCost },
          experience: { increment: 150 * nextLevel },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Uang dompet tidak cukup saat upgrade alat.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -upgradeCost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `upgrade_${tool}_lv${String(nextLevel)}`,
        },
        tx,
      );

      return {
        mode: "upgrade",
        toolId: tool,
        toolLabel: spec.label,
        newLevel: nextLevel,
        durability: 100,
        moneySpent: upgradeCost,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async openCrate(
    groupJid: string,
    userJid: string,
    crate: CrateType,
    requestedCount = 1,
  ): Promise<OpenCrateResult> {
    if (!Number.isInteger(requestedCount) || requestedCount <= 0 || requestedCount > MAX_OPEN_CRATE_BATCH) {
      throw new AppUserError(`Jumlah buka peti harus antara 1 sampai ${String(MAX_OPEN_CRATE_BATCH)}.`);
    }

    const spec = CRATE_LOOT_SPECS[crate];
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const owned = state.crates[crate];

      if (owned < requestedCount) {
        throw new AppUserError(
          `Kamu hanya punya ${String(owned)}x ${spec.label}. Beli di *.shop buy ${crate} 1* atau cari di *.adventure*!`,
        );
      }

      let rawMoney = 0n;
      let xpGained = 0;
      const itemsGained: Record<string, number> = {};
      const petsGained: OpenCrateResult["petsGained"] = [];
      let nextState = withCrateDelta(state, crate, -requestedCount);

      for (let i = 0; i < requestedCount; i += 1) {
        rawMoney += BigInt(this.random.intBetween(spec.minMoney, spec.maxMoney));
        xpGained += spec.xp;

        const chosenItem =
          spec.itemPool[this.random.intBetween(0, spec.itemPool.length - 1)] ?? spec.itemPool[0];
        if (chosenItem) {
          const qty = this.random.intBetween(chosenItem.min, chosenItem.max);
          itemsGained[chosenItem.id] = (itemsGained[chosenItem.id] ?? 0) + qty;
        }

        if (this.random.chance(spec.petChance)) {
          const pet =
            spec.petPool[this.random.intBetween(0, spec.petPool.length - 1)] ?? spec.petPool[0];
          if (pet) {
            const cur = nextState.pets[pet];
            const unlocked = cur.level === 0;
            const newLevel = Math.min(MAX_PET_LEVEL, cur.level + 1);
            nextState = withPetState(nextState, pet, {
              level: newLevel,
              exp: cur.exp,
              hunger: 100,
            });
            petsGained.push({ pet, newLevel, unlocked });
          }
        }
      }

      nextState = withItemsDelta(nextState, itemsGained);
      const moneyGained = clampMoneyCredit(
        profile.moneyBalance,
        scaleMoneyByLevel(rawMoney, profile.level),
      );

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: moneyGained,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `open_${crate}x${String(requestedCount)}`,
        },
        tx,
      );

      return {
        crate,
        crateLabel: spec.label,
        openedCount: requestedCount,
        moneyGained,
        xpGained,
        itemsGained,
        petsGained,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async careForPet(
    groupJid: string,
    userJid: string,
    pet: PetType,
    mode: "feed" | "ramuan",
  ): Promise<PetCareResult> {
    const supplyKey = mode === "feed" ? "makananpet" : "ramuanpet";
    const supplyLabel = mode === "feed" ? "Pakan Pet (makananpet)" : "Ramuan Kuat Pet (ramuanpet)";

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const currentPet = state.pets[pet];

      if (currentPet.level <= 0) {
        throw new AppUserError(
          `Kamu belum memiliki pet *${PET_LABELS[pet]}*. Dapatkan dari *.open* peti atau menang *.fight${pet}*!`,
        );
      }

      const ownedSupply = state.items[supplyKey] ?? 0;
      if (ownedSupply <= 0) {
        throw new AppUserError(
          `Stok ${supplyLabel} kosong! Beli dulu dengan *.shop buy ${supplyKey} 2*`,
        );
      }

      let newLevel = currentPet.level;
      let newExp = currentPet.exp;
      let newHunger = currentPet.hunger;

      if (mode === "feed") {
        newHunger = Math.min(100, currentPet.hunger + 40);
        newExp += 50;
        const neededExp = currentPet.level * 100;
        if (newExp >= neededExp && newLevel < MAX_PET_LEVEL) {
          newExp -= neededExp;
          newLevel += 1;
        }
      } else {
        if (currentPet.level >= MAX_PET_LEVEL) {
          throw new AppUserError(
            `Pet *${PET_LABELS[pet]}* kamu sudah mencapai level maksimal (Lv. ${String(MAX_PET_LEVEL)})!`,
          );
        }
        newLevel = Math.min(MAX_PET_LEVEL, currentPet.level + 1);
        newHunger = 100;
      }

      const nextState = withPetState(withItemDelta(state, supplyKey, -1), pet, {
        level: newLevel,
        exp: newExp,
        hunger: newHunger,
      });

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          experience: { increment: mode === "ramuan" ? 80 : 30 },
          rpgState: serializeRpgState(nextState),
        },
      });

      return {
        mode,
        pet,
        petLabel: PET_LABELS[pet],
        oldLevel: currentPet.level,
        newLevel,
        exp: newExp,
        hunger: newHunger,
        remainingSupply: nextState.items[supplyKey] ?? 0,
      };
    });
  }

  async fightBoss(
    groupJid: string,
    userJid: string,
    bossId: PetType,
    now: Date = new Date(),
  ): Promise<BossFightResult> {
    const spec = BOSS_FIGHT_SPECS[bossId];
    const cdKey = `fight_${bossId}`;
    const cooldownMs = INFINITE_RPG_COOLDOWNS_MS[cdKey] ?? 15 * 60 * 1000;
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      const ugdRem = getRemainingUgdMs(state, nowMs);
      if (ugdRem > 0) {
        throw new AppUserError(
          `Kamu sedang dirawat di UGD! Tunggu *${formatRemainingDuration(ugdRem)}* lagi.`,
        );
      }

      if (state.hp < MIN_HP_FOR_COMBAT) {
        throw new AppUserError(
          `HP kamu terlalu kritis (${String(state.hp)}/100)! Pakai *.heal* dulu sebelum melawan ${spec.bossName}.`,
        );
      }

      const cdRem = getRemainingCooldownMs(state, cdKey, cooldownMs, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `${spec.bossName} sedang bersembunyi. Bisa ditantang lagi dalam *${formatRemainingDuration(cdRem)}*.`,
        );
      }

      const playerPower =
        calculatePlayerCombatPower(profile.level, state, bossId) + this.random.intBetween(10, 50);
      const bossPower = spec.power + this.random.intBetween(0, 35);
      const won = playerPower >= bossPower;

      const armorReduction = Math.min(18, state.tools.armor.level * 2);
      const rawDamage = won ? spec.hpDamageOnWin : spec.hpDamageOnLose;
      const hpLost = Math.max(5, rawDamage - armorReduction);
      const hpAfter = Math.max(0, state.hp - hpLost);

      let nextState = withUpdatedCooldown(withHp(state, hpAfter), cdKey, nowMs);

      if (!won) {
        await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            experience: { increment: 35 },
            rpgState: serializeRpgState(nextState),
          },
        });

        return {
          bossId,
          bossName: spec.bossName,
          won: false,
          playerPower,
          bossPower,
          hpLost,
          hpAfter,
          moneyGained: 0n,
          xpGained: 35,
          crateGained: null,
          petDropped: false,
          petNewLevel: state.pets[bossId].level,
          currentMoney: profile.moneyBalance,
        };
      }

      const rawMoney = BigInt(this.random.intBetween(spec.minMoney, spec.maxMoney));
      const moneyGained = clampMoneyCredit(
        profile.moneyBalance,
        scaleMoneyByLevel(rawMoney, profile.level),
      );
      nextState = withCrateDelta(nextState, spec.crateDrop, 1);

      let petDropped = false;
      let petNewLevel = state.pets[bossId].level;
      if (this.random.chance(spec.petDropChance)) {
        petDropped = true;
        petNewLevel = Math.min(MAX_PET_LEVEL, state.pets[bossId].level + 1);
        nextState = withPetState(nextState, bossId, {
          level: petNewLevel,
          exp: state.pets[bossId].exp,
          hunger: 100,
        });
      }

      const xpGained = applyGroupXpEvent(groupJid, spec.xp, nowMs);
      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: moneyGained,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `boss_${bossId}`,
        },
        tx,
      );

      return {
        bossId,
        bossName: spec.bossName,
        won: true,
        playerPower,
        bossPower,
        hpLost,
        hpAfter,
        moneyGained,
        xpGained,
        crateGained: spec.crateDrop,
        petDropped,
        petNewLevel,
        currentMoney: updated.moneyBalance,
      };
    });
  }
}

export const rpgInfiniteService = new RpgInfiniteService();
