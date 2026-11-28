import type { MemberRank } from "../member/rank.service";

export interface DailyQuestSpec {
  id: "absen_harian" | "pekerja_keras" | "warga_aktif" | "bonus_semua";
  title: string;
  description: string;
  rewardMoney: bigint;
  rewardLimit: number;
  rewardXp: number;
}

export const DAILY_QUEST_SPECS: readonly DailyQuestSpec[] = [
  {
    id: "absen_harian",
    title: "Absen Harian",
    description: "Klaim .daily hari ini",
    rewardMoney: 15_000_000n,
    rewardLimit: 3,
    rewardXp: 100,
  },
  {
    id: "pekerja_keras",
    title: "Pekerja Keras",
    description: "Lakukan minimal 2 aksi RPG hari ini (.kerja/.nambang/.adventure/dll)",
    rewardMoney: 25_000_000n,
    rewardLimit: 4,
    rewardXp: 150,
  },
  {
    id: "warga_aktif",
    title: "Warga Tongkrongan",
    description: "Aktif chat di grup hari ini (min. 5 pesan) atau punya investasi/aset",
    rewardMoney: 20_000_000n,
    rewardLimit: 3,
    rewardXp: 120,
  },
  {
    id: "bonus_semua",
    title: "Sapubersih Misi",
    description: "Selesaikan ketiga misi harian di atas",
    rewardMoney: 50_000_000n,
    rewardLimit: 5,
    rewardXp: 300,
  },
] as const;

export interface AchievementSpec {
  id: string;
  badge: string;
  title: string;
  requirement: string;
  rewardMoney: bigint;
  rewardLimit: number;
  rewardXp: number;
}

export const ACHIEVEMENT_SPECS: readonly AchievementSpec[] = [
  {
    id: "jutawan",
    badge: "[JUTAWAN]",
    title: "Jutawan Grup",
    requirement: "Total kekayaan (Dompet+Bank) >= Rp 100 Juta",
    rewardMoney: 15_000_000n,
    rewardLimit: 3,
    rewardXp: 200,
  },
  {
    id: "miliarder",
    badge: "[MILIARDER]",
    title: "Miliarder Tongkrongan",
    requirement: "Total kekayaan (Dompet+Bank) >= Rp 1 Miliar",
    rewardMoney: 100_000_000n,
    rewardLimit: 8,
    rewardXp: 600,
  },
  {
    id: "triliuner",
    badge: "[TRILIUNER]",
    title: "Crazy Rich Triliuner",
    requirement: "Total kekayaan (Dompet+Bank) >= Rp 1 Triliun",
    rewardMoney: 2_500_000_000n,
    rewardLimit: 25,
    rewardXp: 2_500,
  },
  {
    id: "petualang",
    badge: "[PETUALANG]",
    title: "Petualang Tangguh",
    requirement: "Mencapai Level 5 ke atas (.levelup)",
    rewardMoney: 30_000_000n,
    rewardLimit: 4,
    rewardXp: 300,
  },
  {
    id: "legenda_xp",
    badge: "[EPIC+]",
    title: "Sepuh Berpengalaman",
    requirement: "Mencapai Rank Epic (40.000+ XP)",
    rewardMoney: 75_000_000n,
    rewardLimit: 10,
    rewardXp: 500,
  },
  {
    id: "juragan_properti",
    badge: "[JURAGAN]",
    title: "Juragan Properti",
    requirement: "Memiliki minimal 3 unit properti",
    rewardMoney: 40_000_000n,
    rewardLimit: 5,
    rewardXp: 350,
  },
  {
    id: "investor_bursa",
    badge: "[INVESTOR]",
    title: "Investor Bursa",
    requirement: "Memiliki saham (.belisaham) atau kripto (.crypto)",
    rewardMoney: 25_000_000n,
    rewardLimit: 4,
    rewardXp: 250,
  },
  {
    id: "kolektor_kartu",
    badge: "[KOLEKTOR]",
    title: "Kolektor Kartu",
    requirement: "Mengoleksi minimal 5 kartu gacha unik",
    rewardMoney: 45_000_000n,
    rewardLimit: 6,
    rewardXp: 400,
  },
  {
    id: "raja_kartu_ur",
    badge: "[UR HUNTER]",
    title: "Pemburu Kartu Ultra Rare",
    requirement: "Mendapatkan minimal 1 kartu tier UR (.gachakartu)",
    rewardMoney: 150_000_000n,
    rewardLimit: 15,
    rewardXp: 1_000,
  },
  {
    id: "pasangan_sah",
    badge: "[SAH]",
    title: "Pasangan Resmi Grup",
    requirement: "Menikah secara resmi lewat .nikah",
    rewardMoney: 35_000_000n,
    rewardLimit: 5,
    rewardXp: 300,
  },
  {
    id: "sultan_berkelas",
    badge: "[GELAR]",
    title: "Sultan Bergelar",
    requirement: "Memiliki gelar custom lewat .beligelar",
    rewardMoney: 30_000_000n,
    rewardLimit: 4,
    rewardXp: 250,
  },
  {
    id: "aktif_grup",
    badge: "[RAMAI]",
    title: "Penghidup Suasana",
    requirement: "Mengirim minimal 100 pesan di grup",
    rewardMoney: 20_000_000n,
    rewardLimit: 5,
    rewardXp: 350,
  },
] as const;

export interface PropertySpec {
  id: string;
  name: string;
  price: bigint;
  incomePerHour: bigint;
  maxOwned: number;
}

export const PROPERTY_CATALOG: readonly PropertySpec[] = [
  {
    id: "warung",
    name: "Warung Kopi Tongkrongan",
    price: 15_000_000n,
    incomePerHour: 1_500_000n,
    maxOwned: 10,
  },
  {
    id: "kosan",
    name: "Kos-Kosan 10 Pintu",
    price: 60_000_000n,
    incomePerHour: 6_500_000n,
    maxOwned: 10,
  },
  {
    id: "cafe",
    name: "Cafe Estetik 24 Jam",
    price: 180_000_000n,
    incomePerHour: 21_000_000n,
    maxOwned: 10,
  },
  {
    id: "spbu",
    name: "SPBU Pasti Pas",
    price: 500_000_000n,
    incomePerHour: 62_000_000n,
    maxOwned: 10,
  },
  {
    id: "hotel",
    name: "Hotel Bintang 5",
    price: 1_500_000_000n,
    incomePerHour: 195_000_000n,
    maxOwned: 10,
  },
  {
    id: "mall",
    name: "Mall Pusat Kota",
    price: 5_000_000_000n,
    incomePerHour: 680_000_000n,
    maxOwned: 10,
  },
  {
    id: "maskapai",
    name: "Maskapai Jet Pribadi",
    price: 18_000_000_000n,
    incomePerHour: 2_600_000_000n,
    maxOwned: 10,
  },
  {
    id: "pulau",
    name: "Pulau Resort Pribadi",
    price: 75_000_000_000n,
    incomePerHour: 11_500_000_000n,
    maxOwned: 5,
  },
] as const;

export const PROPERTY_MAP = new Map<string, PropertySpec>(
  PROPERTY_CATALOG.map((item) => [item.id, item]),
);

export const PROPERTY_SELL_REFUND_PERCENT = 65;
export const PROPERTY_MIN_HARVEST_MS = 10 * 60 * 1000;
export const PROPERTY_MAX_ACCUMULATION_HOURS = 24;

export interface RankSalarySpec {
  money: bigint;
  limit: number;
  xp: number;
}

export const RANK_SALARY_TABLE: Record<MemberRank, RankSalarySpec> = {
  Warrior: { money: 10_000_000n, limit: 2, xp: 60 },
  Elite: { money: 25_000_000n, limit: 3, xp: 90 },
  Master: { money: 50_000_000n, limit: 4, xp: 120 },
  Grandmaster: { money: 100_000_000n, limit: 5, xp: 160 },
  Epic: { money: 200_000_000n, limit: 6, xp: 200 },
  Legend: { money: 400_000_000n, limit: 8, xp: 260 },
  Mythic: { money: 800_000_000n, limit: 10, xp: 340 },
  "Immortal [MAX]": { money: 1_500_000_000n, limit: 12, xp: 450 },
};

export const DEPOSITO_MIN_AMOUNT = 10_000_000n;
export const DEPOSITO_DAILY_INTEREST_PERCENT = 8;
export const DEPOSITO_MAX_INTEREST_DAYS = 7;

export interface StockSpec {
  ticker: string;
  name: string;
  sector: string;
  baseLotPrice: bigint;
  volatility: number;
  seedOffset: number;
}

export const STOCK_CATALOG: readonly StockSpec[] = [
  {
    ticker: "BBCA",
    name: "Bank Central Tongkrongan",
    sector: "Perbankan",
    baseLotPrice: 1_000_000n,
    volatility: 0.14,
    seedOffset: 701,
  },
  {
    ticker: "BBRI",
    name: "Bank Rakyat Sultan",
    sector: "Perbankan",
    baseLotPrice: 580_000n,
    volatility: 0.17,
    seedOffset: 733,
  },
  {
    ticker: "TLKM",
    name: "Telkom Sinyal Hilang",
    sector: "Telekomunikasi",
    baseLotPrice: 420_000n,
    volatility: 0.19,
    seedOffset: 769,
  },
  {
    ticker: "ICBP",
    name: "Indomie Mie Instan",
    sector: "Konsumer",
    baseLotPrice: 1_150_000n,
    volatility: 0.12,
    seedOffset: 809,
  },
  {
    ticker: "ANTM",
    name: "Aneka Tambang Emas",
    sector: "Komoditas",
    baseLotPrice: 280_000n,
    volatility: 0.28,
    seedOffset: 853,
  },
  {
    ticker: "GOTO",
    name: "GoTo Ojol Semesta",
    sector: "Teknologi",
    baseLotPrice: 120_000n,
    volatility: 0.42,
    seedOffset: 887,
  },
  {
    ticker: "NGPI",
    name: "Kopi Kenangan Mantan",
    sector: "Kuliner",
    baseLotPrice: 350_000n,
    volatility: 0.3,
    seedOffset: 929,
  },
  {
    ticker: "MNJI",
    name: "MinjiBot Tech Tbk",
    sector: "AI & Bot",
    baseLotPrice: 2_500_000n,
    volatility: 0.35,
    seedOffset: 977,
  },
] as const;

export const STOCK_MAP = new Map<string, StockSpec>(
  STOCK_CATALOG.map((item) => [item.ticker, item]),
);

const STOCK_PRICE_EPOCH_MS = 10 * 60 * 1000;

function deterministicStockWave(epoch: number, seedOffset: number): number {
  const x = Math.sin((epoch + seedOffset) * 19.1371) * 31991.7331;
  const frac = x - Math.floor(x);
  const macroTrend = Math.sin((epoch + seedOffset) * 0.19) * 0.55;
  return (frac * 2 - 1) * 0.45 + macroTrend;
}

export function computeStockPriceAtEpoch(spec: StockSpec, epoch: number): bigint {
  const wave = deterministicStockWave(epoch, spec.seedOffset);
  const multiplier = Math.max(0.4, 1 + wave * spec.volatility);
  const basisPoints = BigInt(Math.round(multiplier * 10_000));
  const rawPrice = (spec.baseLotPrice * basisPoints) / 10_000n;
  const rounded = ((rawPrice + 2_500n) / 5_000n) * 5_000n;
  return rounded < 25_000n ? 25_000n : rounded;
}

export interface StockQuote {
  ticker: string;
  name: string;
  sector: string;
  lotPrice: bigint;
  previousLotPrice: bigint;
  changePercent: number;
}

export function getStockQuotesAt(now: Date = new Date()): StockQuote[] {
  const epoch = Math.floor(now.getTime() / STOCK_PRICE_EPOCH_MS);
  return STOCK_CATALOG.map((spec) => {
    const lotPrice = computeStockPriceAtEpoch(spec, epoch);
    const previousLotPrice = computeStockPriceAtEpoch(spec, epoch - 1);
    const changePercent =
      previousLotPrice > 0n
        ? Number(((lotPrice - previousLotPrice) * 1000n) / previousLotPrice) / 10
        : 0;
    return {
      ticker: spec.ticker,
      name: spec.name,
      sector: spec.sector,
      lotPrice,
      previousLotPrice,
      changePercent,
    };
  });
}

export type GachaRarity = "R" | "SR" | "SSR" | "UR";

export interface GachaCardSpec {
  id: string;
  serial: string;
  name: string;
  subtitle: string;
  rarity: GachaRarity;
  power: number;
  quote: string;
  duplicateCashback: bigint;
}

export const GACHA_PULL_PRICE = 25_000_000n;

export const GACHA_CARDS: readonly GachaCardSpec[] = [
  // R (55% rate) - 8 cards
  {
    id: "r_sider_handal",
    serial: "001",
    name: "Sider Berbakat",
    subtitle: "Penjaga Read-Only",
    rarity: "R",
    power: 120,
    quote: "Online terus tapi cuma baca doang.",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_tukang_kopi",
    serial: "002",
    name: "Barista Angkringan",
    subtitle: "Kopi Sachet Expert",
    rarity: "R",
    power: 135,
    quote: "Begadang demi push rank sampe subuh.",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_ojol_ngebut",
    serial: "003",
    name: "Driver Ojol Turbo",
    subtitle: "Raja Jalan Pintas",
    rarity: "R",
    power: 150,
    quote: "Sesuai titik ya kak, jangan geser.",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_pemburu_wifi",
    serial: "004",
    name: "Pemburu WiFi Gratis",
    subtitle: "Pencari Sinyal 5 Bar",
    rarity: "R",
    power: 145,
    quote: "Mas, password WiFi-nya apa ya?",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_anak_indomie",
    serial: "005",
    name: "Chef Mie Instan",
    subtitle: "Telur Setengah Matang",
    rarity: "R",
    power: 160,
    quote: "Satu kurang, dua kebanyakan.",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_kolektor_stiker",
    serial: "006",
    name: "Kolektor Stiker Aib",
    subtitle: "Arsiparis Tongkrongan",
    rarity: "R",
    power: 170,
    quote: "Semua muka kaget sudah aman di galeri.",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_tukang_tidur",
    serial: "007",
    name: "Juara Tidur Siang",
    subtitle: "Alarm Hanyalah Hiasan",
    rarity: "R",
    power: 155,
    quote: "Lima menit lagi, beneran deh.",
    duplicateCashback: 6_000_000n,
  },
  {
    id: "r_kucing_oren",
    serial: "008",
    name: "Kucing Oren Barbar",
    subtitle: "Penguasa Gang Sebelah",
    rarity: "R",
    power: 180,
    quote: "Tidak ada rasa takut, hanya gaspol.",
    duplicateCashback: 6_000_000n,
  },
  // SR (30% rate) - 6 cards
  {
    id: "sr_admin_galak",
    serial: "009",
    name: "Admin Grup Tegas",
    subtitle: "Pemegang Tombol Kick",
    rarity: "SR",
    power: 320,
    quote: "Share link sembarangan langsung auto terbang.",
    duplicateCashback: 18_000_000n,
  },
  {
    id: "sr_trader_santai",
    serial: "010",
    name: "Trader Lilin Hijau",
    subtitle: "Beli Pucuk Jual Bawah",
    rarity: "SR",
    power: 350,
    quote: "Tenang, ini cuma koreksi sehat.",
    duplicateCashback: 18_000_000n,
  },
  {
    id: "sr_bandar_slot",
    serial: "011",
    name: "Bandar Dadu Legendaris",
    subtitle: "Master Probabilitas",
    rarity: "SR",
    power: 380,
    quote: "All-in sekarang, nangis belakangan.",
    duplicateCashback: 18_000_000n,
  },
  {
    id: "sr_sepuh_coding",
    serial: "012",
    name: "Sepuh Bug Hunter",
    subtitle: "Deploy Jumat Sore",
    rarity: "SR",
    power: 410,
    quote: "Di laptop saya jalan kok.",
    duplicateCashback: 18_000_000n,
  },
  {
    id: "sr_wibu_elit",
    serial: "013",
    name: "Wibu Terhormat",
    subtitle: "Penjaga Lore Anime",
    rarity: "SR",
    power: 390,
    quote: "Manga-nya jauh lebih bagus bro.",
    duplicateCashback: 18_000_000n,
  },
  {
    id: "sr_juragan_kos",
    serial: "014",
    name: "Ibu Kos Berwibawa",
    subtitle: "Penagih Tanggal Satu",
    rarity: "SR",
    power: 430,
    quote: "Halo dek, kosan bulan ini belum ya.",
    duplicateCashback: 18_000_000n,
  },
  // SSR (12% rate) - 4 cards
  {
    id: "ssr_sultan_minji",
    serial: "015",
    name: "Sultan Pemilik Pulau",
    subtitle: "Saldo Tak Terbatas",
    rarity: "SSR",
    power: 680,
    quote: "Uang bukan masalah, yang penting rame.",
    duplicateCashback: 55_000_000n,
  },
  {
    id: "ssr_naga_emas",
    serial: "016",
    name: "Naga Kawah Emas",
    subtitle: "Penjaga Harta RPG",
    rarity: "SSR",
    power: 720,
    quote: "Hanya petualang terkuat yang selamat.",
    duplicateCashback: 55_000_000n,
  },
  {
    id: "ssr_raja_bursa",
    serial: "017",
    name: "Paus Bursa Saham",
    subtitle: "Penggerak Pasar IDX",
    rarity: "SSR",
    power: 750,
    quote: "Sekali borong langsung auto ARA.",
    duplicateCashback: 55_000_000n,
  },
  {
    id: "ssr_detektif_uc",
    serial: "018",
    name: "Master Undercover",
    subtitle: "Raja Bluffing Grup",
    rarity: "SSR",
    power: 710,
    quote: "Percaya aku, bukan aku impostor-nya.",
    duplicateCashback: 55_000_000n,
  },
  // UR (3% rate) - 2 cards
  {
    id: "ur_minji_divine",
    serial: "019",
    name: "Minji Sovereign AI",
    subtitle: "Entitas Tertinggi Bot",
    rarity: "UR",
    power: 999,
    quote: "Seluruh server dan takdir ada di genggamanku.",
    duplicateCashback: 150_000_000n,
  },
  {
    id: "ur_emperor_sultan",
    serial: "020",
    name: "Kaisar Triliuner",
    subtitle: "Penguasa Absolut Ekonomi",
    rarity: "UR",
    power: 980,
    quote: "Membeli grup beserta isinya tanpa berkedip.",
    duplicateCashback: 150_000_000n,
  },
] as const;

export const GACHA_CARD_MAP = new Map<string, GachaCardSpec>(
  GACHA_CARDS.map((card) => [card.id, card]),
);

export function rollGachaCard(randomValue: number = Math.random()): GachaCardSpec {
  const r = Math.max(0, Math.min(0.999999, randomValue));
  let rarity: GachaRarity;
  if (r < 0.03) {
    rarity = "UR";
  } else if (r < 0.15) {
    rarity = "SSR";
  } else if (r < 0.45) {
    rarity = "SR";
  } else {
    rarity = "R";
  }

  const pool = GACHA_CARDS.filter((c) => c.rarity === rarity);
  const index = Math.floor(Math.random() * pool.length);
  const fallback: GachaCardSpec = {
    id: "r_sider_handal",
    serial: "001",
    name: "Sider Berbakat",
    subtitle: "Penjaga Read-Only",
    rarity: "R",
    power: 120,
    quote: "Online terus tapi cuma baca doang.",
    duplicateCashback: 6_000_000n,
  };
  return pool[index] ?? GACHA_CARDS[0] ?? fallback;
}
