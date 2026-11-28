import { PET_EXPEDITION_DURATION_MS } from "./cooldownCatalog";
import type { CrateType, PetType, ToolType } from "./rpgState";

export { PET_EXPEDITION_DURATION_MS };

export interface ShopItemSpec {
  id: string;
  label: string;
  category: "supply" | "crate" | "material" | "food";
  buyPrice: bigint | null; // null = hanya bisa didapat dari produksi/masak, tidak dijual di toko
  sellPrice: bigint;
  isCrate?: CrateType;
}

export const SHOP_CATALOG: readonly ShopItemSpec[] = [
  // Supplies
  { id: "potion", label: "Potion HP (+40 HP)", category: "supply", buyPrice: 400_000n, sellPrice: 140_000n },
  { id: "makananpet", label: "Pakan Pet", category: "supply", buyPrice: 450_000n, sellPrice: 150_000n },
  { id: "ramuanpet", label: "Ramuan Kuat Pet", category: "supply", buyPrice: 4_000_000n, sellPrice: 1_400_000n },
  // Crates (uang murni ~60% harga beli & cashback jual <90% agar bebas spam cetak uang)
  { id: "common", label: "Common Crate", category: "crate", buyPrice: 2_500_000n, sellPrice: 900_000n, isCrate: "common" },
  { id: "uncommon", label: "Uncommon Crate", category: "crate", buyPrice: 7_500_000n, sellPrice: 2_500_000n, isCrate: "uncommon" },
  { id: "mythic", label: "Mythic Crate", category: "crate", buyPrice: 22_000_000n, sellPrice: 7_500_000n, isCrate: "mythic" },
  { id: "legendary", label: "Legendary Crate", category: "crate", buyPrice: 65_000_000n, sellPrice: 22_000_000n, isCrate: "legendary" },
  // Raw materials
  { id: "kayu", label: "Kayu", category: "material", buyPrice: 220_000n, sellPrice: 80_000n },
  { id: "batu", label: "Batu", category: "material", buyPrice: 250_000n, sellPrice: 90_000n },
  { id: "besi", label: "Bijih Besi", category: "material", buyPrice: 500_000n, sellPrice: 180_000n },
  { id: "emas", label: "Bongkahan Emas", category: "material", buyPrice: 1_200_000n, sellPrice: 450_000n },
  { id: "berlian", label: "Berlian", category: "material", buyPrice: 3_500_000n, sellPrice: 1_250_000n },
  // Farm & hunt raw food
  { id: "apel", label: "Apel", category: "food", buyPrice: null, sellPrice: 40_000n },
  { id: "pisang", label: "Pisang", category: "food", buyPrice: null, sellPrice: 40_000n },
  { id: "anggur", label: "Anggur", category: "food", buyPrice: null, sellPrice: 55_000n },
  { id: "mangga", label: "Mangga", category: "food", buyPrice: null, sellPrice: 60_000n },
  { id: "daging", label: "Daging Segar", category: "food", buyPrice: null, sellPrice: 90_000n },
  { id: "ikan", label: "Ikan Segar", category: "food", buyPrice: null, sellPrice: 85_000n },
  // Cooked luxury food (.masak)
  { id: "salad", label: "Salad Buah Sultan", category: "food", buyPrice: null, sellPrice: 450_000n },
  { id: "jus", label: "Jus Tropis Premium", category: "food", buyPrice: null, sellPrice: 500_000n },
  { id: "steak", label: "Steak Wagyu A5", category: "food", buyPrice: null, sellPrice: 750_000n },
  { id: "sup", label: "Sup Seafood Mewah", category: "food", buyPrice: null, sellPrice: 850_000n },
  { id: "nasigoreng", label: "Nasi Goreng Sultan", category: "food", buyPrice: null, sellPrice: 1_000_000n },
] as const;

export const SHOP_ITEM_MAP = new Map<string, ShopItemSpec>(
  SHOP_CATALOG.map((item) => [item.id, item]),
);

export interface CookRecipeSpec {
  id: string;
  label: string;
  ingredients: Record<string, number>;
  xp: number;
  sellPrice: bigint;
}

export const COOK_RECIPES: readonly CookRecipeSpec[] = [
  {
    id: "salad",
    label: "Salad Buah Sultan",
    ingredients: { apel: 2, mangga: 2 },
    xp: 45,
    sellPrice: 450_000n,
  },
  {
    id: "jus",
    label: "Jus Tropis Premium",
    ingredients: { pisang: 2, anggur: 2 },
    xp: 45,
    sellPrice: 500_000n,
  },
  {
    id: "steak",
    label: "Steak Wagyu A5",
    ingredients: { daging: 2, kayu: 2 },
    xp: 65,
    sellPrice: 750_000n,
  },
  {
    id: "sup",
    label: "Sup Seafood Mewah",
    ingredients: { ikan: 2, apel: 2, kayu: 1 },
    xp: 75,
    sellPrice: 850_000n,
  },
  {
    id: "nasigoreng",
    label: "Nasi Goreng Sultan",
    ingredients: { daging: 1, ikan: 1, kayu: 2 },
    xp: 85,
    sellPrice: 1_000_000n,
  },
] as const;

export const COOK_RECIPE_MAP = new Map<string, CookRecipeSpec>(
  COOK_RECIPES.map((r) => [r.id, r]),
);

export interface ToolCraftSpec {
  id: ToolType;
  label: string;
  bonusDesc: string;
  craftCostMoney: bigint;
  craftMaterials: Record<string, number>;
  upgradeMoneyPerLevel: bigint;
  upgradeMaterials: Record<string, number>;
}

export const TOOL_SPECS: Record<ToolType, ToolCraftSpec> = {
  sword: {
    id: "sword",
    label: "Pedang",
    bonusDesc: "+Power tempur selama durability > 0% (.repair jika aus)",
    craftCostMoney: 3_000_000n,
    craftMaterials: { kayu: 4, besi: 3 },
    upgradeMoneyPerLevel: 3_500_000n,
    upgradeMaterials: { besi: 2, emas: 1 },
  },
  armor: {
    id: "armor",
    label: "Armor Zirah",
    bonusDesc: "Kurangi damage boss hingga -40% & lindungi PvP selama durability > 0%",
    craftCostMoney: 3_500_000n,
    craftMaterials: { batu: 4, besi: 4 },
    upgradeMoneyPerLevel: 4_000_000n,
    upgradeMaterials: { besi: 3, emas: 1 },
  },
  pickaxe: {
    id: "pickaxe",
    label: "Pickaxe",
    bonusDesc: "+15%/level cuan .nebang & bonus mineral selama durability > 0%",
    craftCostMoney: 2_500_000n,
    craftMaterials: { kayu: 4, batu: 4 },
    upgradeMoneyPerLevel: 3_000_000n,
    upgradeMaterials: { kayu: 2, besi: 2 },
  },
  fishingrod: {
    id: "fishingrod",
    label: "Pancingan",
    bonusDesc: "+15%/level hasil .berkebon & bonus drop selama durability > 0%",
    craftCostMoney: 2_500_000n,
    craftMaterials: { kayu: 5, besi: 1 },
    upgradeMoneyPerLevel: 3_000_000n,
    upgradeMaterials: { kayu: 3, emas: 1 },
  },
};

export interface BossFightSpec {
  id: PetType;
  label: string;
  bossName: string;
  power: number;
  hpDamageOnWin: number;
  hpDamageOnLose: number;
  minMoney: number;
  maxMoney: number;
  xp: number;
  crateDrop: CrateType;
  crateDropChance: number;
  petDropChance: number;
}

export const BOSS_FIGHT_SPECS: Record<PetType, BossFightSpec> = {
  kucing: {
    id: "kucing",
    label: "Kucing",
    bossName: "Raja Kucing Oren",
    power: 95,
    hpDamageOnWin: 22,
    hpDamageOnLose: 38,
    minMoney: 600_000,
    maxMoney: 1_100_000,
    xp: 160,
    crateDrop: "common",
    crateDropChance: 0.35,
    petDropChance: 0.3,
  },
  kyubi: {
    id: "kyubi",
    label: "Kyubi",
    bossName: "Rubah Ekor Sembilan",
    power: 170,
    hpDamageOnWin: 26,
    hpDamageOnLose: 44,
    minMoney: 1_100_000,
    maxMoney: 2_000_000,
    xp: 260,
    crateDrop: "uncommon",
    crateDropChance: 0.32,
    petDropChance: 0.25,
  },
  centaur: {
    id: "centaur",
    label: "Centaur",
    bossName: "Panglima Centaur",
    power: 250,
    hpDamageOnWin: 30,
    hpDamageOnLose: 50,
    minMoney: 1_800_000,
    maxMoney: 3_200_000,
    xp: 380,
    crateDrop: "uncommon",
    crateDropChance: 0.35,
    petDropChance: 0.2,
  },
  griffin: {
    id: "griffin",
    label: "Griffin",
    bossName: "Griffin Langit Emas",
    power: 340,
    hpDamageOnWin: 34,
    hpDamageOnLose: 56,
    minMoney: 2_800_000,
    maxMoney: 5_000_000,
    xp: 520,
    crateDrop: "mythic",
    crateDropChance: 0.25,
    petDropChance: 0.18,
  },
  naga: {
    id: "naga",
    label: "Naga",
    bossName: "Naga Purba Kawah",
    power: 440,
    hpDamageOnWin: 38,
    hpDamageOnLose: 62,
    minMoney: 4_200_000,
    maxMoney: 7_200_000,
    xp: 720,
    crateDrop: "mythic",
    crateDropChance: 0.28,
    petDropChance: 0.15,
  },
  phonix: {
    id: "phonix",
    label: "Phonix",
    bossName: "Immortal Phoenix",
    power: 560,
    hpDamageOnWin: 44,
    hpDamageOnLose: 72,
    minMoney: 6_000_000,
    maxMoney: 10_500_000,
    xp: 1_000,
    crateDrop: "legendary",
    crateDropChance: 0.2,
    petDropChance: 0.12,
  },
};

export interface CrateLootSpec {
  id: CrateType;
  label: string;
  minMoney: number;
  maxMoney: number;
  xp: number;
  petChance: number;
  petPool: readonly PetType[];
  itemRolls: number;
  itemPool: readonly { id: string; min: number; max: number }[];
}

export const CRATE_LOOT_SPECS: Record<CrateType, CrateLootSpec> = {
  common: {
    id: "common",
    label: "Common Crate",
    minMoney: 1_200_000,
    maxMoney: 1_900_000,
    xp: 30,
    petChance: 0.12,
    petPool: ["kucing", "kyubi"],
    itemRolls: 1,
    itemPool: [
      { id: "potion", min: 2, max: 4 },
      { id: "kayu", min: 4, max: 8 },
      { id: "batu", min: 4, max: 7 },
      { id: "makananpet", min: 2, max: 4 },
    ],
  },
  uncommon: {
    id: "uncommon",
    label: "Uncommon Crate",
    minMoney: 3_500_000,
    maxMoney: 5_800_000,
    xp: 75,
    petChance: 0.2,
    petPool: ["kucing", "kyubi", "centaur"],
    itemRolls: 1,
    itemPool: [
      { id: "besi", min: 6, max: 10 },
      { id: "emas", min: 2, max: 4 },
      { id: "makananpet", min: 6, max: 10 },
      { id: "ramuanpet", min: 1, max: 1 },
    ],
  },
  mythic: {
    id: "mythic",
    label: "Mythic Crate",
    minMoney: 10_000_000,
    maxMoney: 16_500_000,
    xp: 180,
    petChance: 0.32,
    petPool: ["centaur", "griffin", "naga"],
    itemRolls: 2,
    itemPool: [
      { id: "emas", min: 4, max: 6 },
      { id: "berlian", min: 1, max: 2 },
      { id: "ramuanpet", min: 1, max: 2 },
      { id: "potion", min: 10, max: 18 },
    ],
  },
  legendary: {
    id: "legendary",
    label: "Legendary Crate",
    minMoney: 30_000_000,
    maxMoney: 48_000_000,
    xp: 380,
    petChance: 0.5,
    petPool: ["griffin", "naga", "phonix"],
    itemRolls: 2,
    itemPool: [
      { id: "berlian", min: 3, max: 6 },
      { id: "emas", min: 10, max: 16 },
      { id: "ramuanpet", min: 3, max: 5 },
      { id: "makananpet", min: 25, max: 45 },
    ],
  },
};

export const PET_LABELS: Record<PetType, string> = {
  kucing: "Kucing",
  kyubi: "Kyubi",
  centaur: "Centaur",
  griffin: "Griffin",
  naga: "Naga",
  phonix: "Phonix",
};

export const PET_TIER_WEIGHT: Record<PetType, number> = {
  kucing: 1,
  kyubi: 2,
  centaur: 3,
  griffin: 4,
  naga: 5,
  phonix: 6,
};

export interface PetShopSpec {
  id: PetType;
  label: string;
  price: bigint;
  minLevel: number;
  desc: string;
}

export const PET_SHOP_CATALOG: readonly PetShopSpec[] = [
  {
    id: "kucing",
    label: "Kucing Oren",
    price: 10_000_000n,
    minLevel: 1,
    desc: "Pet pemula lincah & hemat pakan",
  },
  {
    id: "kyubi",
    label: "Kyubi Rubah",
    price: 32_000_000n,
    minLevel: 8,
    desc: "Rubah berekor sembilan penuh hoki",
  },
  {
    id: "centaur",
    label: "Centaur Ksatria",
    price: 80_000_000n,
    minLevel: 16,
    desc: "Pet menengah tangguh penambah Combat Power",
  },
] as const;

export const PET_SHOP_MAP = new Map<PetType, PetShopSpec>(
  PET_SHOP_CATALOG.map((spec) => [spec.id, spec]),
);

export type PetEggTier = "biasa" | "langka" | "mitos";

export interface PetEggSpec {
  id: PetEggTier;
  label: string;
  price: bigint;
  minLevel: number;
  xp: number;
  pool: readonly { pet: PetType; weight: number }[];
}

export const PET_EGG_CATALOG: readonly PetEggSpec[] = [
  {
    id: "biasa",
    label: "Telur Pet Biasa",
    price: 8_000_000n,
    minLevel: 1,
    xp: 40,
    pool: [
      { pet: "kucing", weight: 55 },
      { pet: "kyubi", weight: 35 },
      { pet: "centaur", weight: 10 },
    ],
  },
  {
    id: "langka",
    label: "Telur Pet Langka",
    price: 28_000_000n,
    minLevel: 5,
    xp: 90,
    pool: [
      { pet: "kyubi", weight: 35 },
      { pet: "centaur", weight: 35 },
      { pet: "griffin", weight: 22 },
      { pet: "naga", weight: 8 },
    ],
  },
  {
    id: "mitos",
    label: "Telur Pet Mitos",
    price: 90_000_000n,
    minLevel: 15,
    xp: 180,
    pool: [
      { pet: "griffin", weight: 40 },
      { pet: "naga", weight: 38 },
      { pet: "phonix", weight: 22 },
    ],
  },
] as const;

export const PET_EGG_MAP = new Map<PetEggTier, PetEggSpec>(
  PET_EGG_CATALOG.map((spec) => [spec.id, spec]),
);

export interface PetExpeditionZoneSpec {
  id: string;
  name: string;
  desc: string;
}

export const PET_EXPEDITION_ZONES: readonly PetExpeditionZoneSpec[] = [
  { id: "lembah_bambu", name: "Lembah Bambu Berkabut", desc: "Kaya kayu, batu & pakan alami" },
  { id: "gua_kristal", name: "Gua Kristal Utara", desc: "Sarang bijih besi & bongkahan emas" },
  { id: "pulau_karang", name: "Pulau Karang Tersembunyi", desc: "Berpeluang membawa peti gacha & ramuan" },
  { id: "kuil_langit", name: "Reruntuhan Kuil Langit", desc: "Zona harta kuno untuk pet pemberani" },
  { id: "kawah_naga", name: "Pinggiran Kawah Naga", desc: "Panas ekstrem berhadiah mineral langka" },
] as const;

export const PET_EXPEDITION_ZONE_MAP = new Map<string, PetExpeditionZoneSpec>(
  PET_EXPEDITION_ZONES.map((z) => [z.id, z]),
);

export const PET_EXPEDITION_HUNGER_COST = 20;

export function normalizePetEggTier(raw: string | undefined): PetEggTier | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "biasa" || val === "common" || val === "normal" || val === "starter") return "biasa";
  if (val === "langka" || val === "rare" || val === "uncommon") return "langka";
  if (val === "mitos" || val === "mythic" || val === "legend" || val === "legendary") return "mitos";
  return null;
}

export function normalizeCrateType(raw: string | undefined): CrateType | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "common" || val === "uncommon" || val === "mythic" || val === "legendary") {
    return val;
  }
  return null;
}

export function normalizeToolType(raw: string | undefined): ToolType | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "sword" || val === "pedang") return "sword";
  if (val === "armor" || val === "zirah") return "armor";
  if (val === "pickaxe" || val === "beliung") return "pickaxe";
  if (val === "fishingrod" || val === "pancing" || val === "pancingan" || val === "rod") {
    return "fishingrod";
  }
  return null;
}

export function normalizePetType(raw: string | undefined): PetType | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "kucing" || val === "cat") return "kucing";
  if (val === "kyubi" || val === "fox" || val === "rubah") return "kyubi";
  if (val === "centaur") return "centaur";
  if (val === "griffin") return "griffin";
  if (val === "naga" || val === "dragon") return "naga";
  if (val === "phonix" || val === "phoenix") return "phonix";
  return null;
}
