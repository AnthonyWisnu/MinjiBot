import type { CrateType, PetType, ToolType } from "./rpgState";

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
  { id: "potion", label: "Potion HP (+40 HP)", category: "supply", buyPrice: 1_800_000n, sellPrice: 600_000n },
  { id: "makananpet", label: "Pakan Pet", category: "supply", buyPrice: 2_500_000n, sellPrice: 800_000n },
  { id: "ramuanpet", label: "Ramuan Kuat Pet", category: "supply", buyPrice: 30_000_000n, sellPrice: 10_000_000n },
  // Crates (harga mahal & cashback <50% agar murni money sink + gacha item/pet, bukan mesin cetak uang)
  { id: "common", label: "Common Crate", category: "crate", buyPrice: 18_000_000n, sellPrice: 6_000_000n, isCrate: "common" },
  { id: "uncommon", label: "Uncommon Crate", category: "crate", buyPrice: 55_000_000n, sellPrice: 18_000_000n, isCrate: "uncommon" },
  { id: "mythic", label: "Mythic Crate", category: "crate", buyPrice: 180_000_000n, sellPrice: 60_000_000n, isCrate: "mythic" },
  { id: "legendary", label: "Legendary Crate", category: "crate", buyPrice: 550_000_000n, sellPrice: 180_000_000n, isCrate: "legendary" },
  // Raw materials
  { id: "kayu", label: "Kayu", category: "material", buyPrice: 1_200_000n, sellPrice: 450_000n },
  { id: "batu", label: "Batu", category: "material", buyPrice: 1_400_000n, sellPrice: 500_000n },
  { id: "besi", label: "Bijih Besi", category: "material", buyPrice: 2_800_000n, sellPrice: 1_000_000n },
  { id: "emas", label: "Bongkahan Emas", category: "material", buyPrice: 7_500_000n, sellPrice: 2_800_000n },
  { id: "berlian", label: "Berlian", category: "material", buyPrice: 22_000_000n, sellPrice: 8_000_000n },
  // Farm & hunt raw food
  { id: "apel", label: "Apel", category: "food", buyPrice: null, sellPrice: 180_000n },
  { id: "pisang", label: "Pisang", category: "food", buyPrice: null, sellPrice: 180_000n },
  { id: "anggur", label: "Anggur", category: "food", buyPrice: null, sellPrice: 240_000n },
  { id: "mangga", label: "Mangga", category: "food", buyPrice: null, sellPrice: 270_000n },
  { id: "daging", label: "Daging Segar", category: "food", buyPrice: null, sellPrice: 390_000n },
  { id: "ikan", label: "Ikan Segar", category: "food", buyPrice: null, sellPrice: 360_000n },
  // Cooked luxury food (.masak)
  { id: "salad", label: "Salad Buah Sultan", category: "food", buyPrice: null, sellPrice: 2_100_000n },
  { id: "jus", label: "Jus Tropis Premium", category: "food", buyPrice: null, sellPrice: 2_280_000n },
  { id: "steak", label: "Steak Wagyu A5", category: "food", buyPrice: null, sellPrice: 3_300_000n },
  { id: "sup", label: "Sup Seafood Mewah", category: "food", buyPrice: null, sellPrice: 3_900_000n },
  { id: "nasigoreng", label: "Nasi Goreng Sultan", category: "food", buyPrice: null, sellPrice: 4_500_000n },
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
    sellPrice: 2_100_000n,
  },
  {
    id: "jus",
    label: "Jus Tropis Premium",
    ingredients: { pisang: 2, anggur: 2 },
    xp: 45,
    sellPrice: 2_280_000n,
  },
  {
    id: "steak",
    label: "Steak Wagyu A5",
    ingredients: { daging: 2, kayu: 2 },
    xp: 65,
    sellPrice: 3_300_000n,
  },
  {
    id: "sup",
    label: "Sup Seafood Mewah",
    ingredients: { ikan: 2, apel: 2, kayu: 1 },
    xp: 75,
    sellPrice: 3_900_000n,
  },
  {
    id: "nasigoreng",
    label: "Nasi Goreng Sultan",
    ingredients: { daging: 1, ikan: 1, kayu: 2 },
    xp: 85,
    sellPrice: 4_500_000n,
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
    bonusDesc: "+Power saat .adventure, .dungeon, .fight*, & .serang",
    craftCostMoney: 18_000_000n,
    craftMaterials: { kayu: 4, besi: 3 },
    upgradeMoneyPerLevel: 20_000_000n,
    upgradeMaterials: { besi: 2, emas: 1 },
  },
  armor: {
    id: "armor",
    label: "Armor Zirah",
    bonusDesc: "Kurangi damage HP & lindungi dompet saat diserang",
    craftCostMoney: 20_000_000n,
    craftMaterials: { batu: 4, besi: 4 },
    upgradeMoneyPerLevel: 22_000_000n,
    upgradeMaterials: { besi: 3, emas: 1 },
  },
  pickaxe: {
    id: "pickaxe",
    label: "Pickaxe",
    bonusDesc: "+15%/level cuan .nebang & tambah drop mineral langka",
    craftCostMoney: 15_000_000n,
    craftMaterials: { kayu: 4, batu: 4 },
    upgradeMoneyPerLevel: 18_000_000n,
    upgradeMaterials: { kayu: 2, besi: 2 },
  },
  fishingrod: {
    id: "fishingrod",
    label: "Pancingan",
    bonusDesc: "+15%/level hasil .berkebon & bonus drop ikan/bahan",
    craftCostMoney: 15_000_000n,
    craftMaterials: { kayu: 5, besi: 1 },
    upgradeMoneyPerLevel: 18_000_000n,
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
  petDropChance: number;
}

export const BOSS_FIGHT_SPECS: Record<PetType, BossFightSpec> = {
  kucing: {
    id: "kucing",
    label: "Kucing",
    bossName: "Raja Kucing Oren",
    power: 45,
    hpDamageOnWin: 12,
    hpDamageOnLose: 25,
    minMoney: 7_200_000,
    maxMoney: 14_400_000,
    xp: 160,
    crateDrop: "common",
    petDropChance: 0.35,
  },
  kyubi: {
    id: "kyubi",
    label: "Kyubi",
    bossName: "Rubah Ekor Sembilan",
    power: 90,
    hpDamageOnWin: 16,
    hpDamageOnLose: 30,
    minMoney: 13_200_000,
    maxMoney: 25_200_000,
    xp: 260,
    crateDrop: "uncommon",
    petDropChance: 0.3,
  },
  centaur: {
    id: "centaur",
    label: "Centaur",
    bossName: "Panglima Centaur",
    power: 145,
    hpDamageOnWin: 20,
    hpDamageOnLose: 35,
    minMoney: 22_800_000,
    maxMoney: 42_000_000,
    xp: 380,
    crateDrop: "uncommon",
    petDropChance: 0.25,
  },
  griffin: {
    id: "griffin",
    label: "Griffin",
    bossName: "Griffin Langit Emas",
    power: 210,
    hpDamageOnWin: 22,
    hpDamageOnLose: 40,
    minMoney: 33_000_000,
    maxMoney: 63_000_000,
    xp: 520,
    crateDrop: "mythic",
    petDropChance: 0.22,
  },
  naga: {
    id: "naga",
    label: "Naga",
    bossName: "Naga Purba Kawah",
    power: 290,
    hpDamageOnWin: 26,
    hpDamageOnLose: 45,
    minMoney: 51_000_000,
    maxMoney: 96_000_000,
    xp: 720,
    crateDrop: "mythic",
    petDropChance: 0.18,
  },
  phonix: {
    id: "phonix",
    label: "Phonix",
    bossName: "Immortal Phoenix",
    power: 380,
    hpDamageOnWin: 30,
    hpDamageOnLose: 50,
    minMoney: 78_000_000,
    maxMoney: 150_000_000,
    xp: 1_000,
    crateDrop: "legendary",
    petDropChance: 0.15,
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
    minMoney: 8_000_000,
    maxMoney: 14_000_000,
    xp: 30,
    petChance: 0.12,
    petPool: ["kucing", "kyubi"],
    itemRolls: 1,
    itemPool: [
      { id: "potion", min: 2, max: 4 },
      { id: "kayu", min: 4, max: 8 },
      { id: "batu", min: 4, max: 8 },
      { id: "makananpet", min: 2, max: 4 },
    ],
  },
  uncommon: {
    id: "uncommon",
    label: "Uncommon Crate",
    minMoney: 25_000_000,
    maxMoney: 42_000_000,
    xp: 75,
    petChance: 0.2,
    petPool: ["kucing", "kyubi", "centaur"],
    itemRolls: 1,
    itemPool: [
      { id: "besi", min: 6, max: 12 },
      { id: "emas", min: 2, max: 5 },
      { id: "makananpet", min: 8, max: 14 },
      { id: "ramuanpet", min: 1, max: 2 },
    ],
  },
  mythic: {
    id: "mythic",
    label: "Mythic Crate",
    minMoney: 85_000_000,
    maxMoney: 140_000_000,
    xp: 180,
    petChance: 0.32,
    petPool: ["centaur", "griffin", "naga"],
    itemRolls: 2,
    itemPool: [
      { id: "emas", min: 4, max: 8 },
      { id: "berlian", min: 2, max: 4 },
      { id: "ramuanpet", min: 1, max: 3 },
      { id: "potion", min: 15, max: 25 },
    ],
  },
  legendary: {
    id: "legendary",
    label: "Legendary Crate",
    minMoney: 260_000_000,
    maxMoney: 430_000_000,
    xp: 380,
    petChance: 0.5,
    petPool: ["griffin", "naga", "phonix"],
    itemRolls: 2,
    itemPool: [
      { id: "berlian", min: 5, max: 10 },
      { id: "emas", min: 12, max: 24 },
      { id: "ramuanpet", min: 4, max: 8 },
      { id: "makananpet", min: 35, max: 65 },
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
    price: 60_000_000n,
    minLevel: 1,
    desc: "Pet pemula lincah & hemat pakan",
  },
  {
    id: "kyubi",
    label: "Kyubi Rubah",
    price: 220_000_000n,
    minLevel: 8,
    desc: "Rubah berekor sembilan penuh hoki",
  },
  {
    id: "centaur",
    label: "Centaur Ksatria",
    price: 550_000_000n,
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
    price: 45_000_000n,
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
    price: 180_000_000n,
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
    price: 600_000_000n,
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

export const PET_EXPEDITION_DURATION_MS = 30 * 60 * 1000;
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
