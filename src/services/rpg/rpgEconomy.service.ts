import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type TenantGroup,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  absBigInt,
  clampMoneyCredit,
  formatRemainingDuration,
  formatRupiah,
  maxBigInt,
  MAX_SAFE_MONEY_BIGINT,
  minBigInt,
  percentOfBigInt,
  scaleMoneyByLevel,
} from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import {
  getRemainingCooldownMs,
  getRemainingJailMs,
  isInsuranceActive,
  parseRpgState,
  serializeRpgState,
  withJailUntil,
  withUpdatedCooldown,
} from "./rpgState";

export type RpgJobType = "mulung" | "kerja" | "ojek" | "nambang" | "berburu" | "mancing";

export const RPG_COOLDOWNS_MS: Record<string, number> = {
  mulung: 3 * 60 * 1000,
  kerja: 5 * 60 * 1000,
  ojek: 5 * 60 * 1000,
  nambang: 10 * 60 * 1000,
  berburu: 10 * 60 * 1000,
  mancing: 10 * 60 * 1000,
  korupsi: 15 * 60 * 1000,
  megakorupsi: 2 * 60 * 60 * 1000,
  pajak: 30 * 60 * 1000,
  maling: 20 * 60 * 1000,
  bansos: 6 * 60 * 60 * 1000,
  casino: 10 * 1000,
};

export const DEFAULT_GROUP_TREASURY = 50_000_000n;
export const CASINO_MIN_BET = 100_000n;
export const CASINO_MAX_BET = 100_000_000n;
export const MIN_TARGET_WALLET_FOR_ACTION = 1_000_000n;
export const MAX_TAX_PER_ACTION = 25_000_000n;
export const MAX_ROB_PER_ACTION = 35_000_000n;
export const MAX_ROB_FINE = 15_000_000n;
export const BANSOS_POVERTY_THRESHOLD = 5_000_000n;
export const BANSOS_POVERTY_BONUS = 3_000_000n;

interface JobDefinition {
  title: string;
  minMoney: number;
  maxMoney: number;
  xp: number;
  rareChance: number;
  rareMinMoney: number;
  rareMaxMoney: number;
  rareXp: number;
  stories: readonly string[];
  rareStories: readonly string[];
}

const JOB_DEFINITIONS: Record<RpgJobType, JobDefinition> = {
  mulung: {
    title: "MULUNG",
    minMoney: 400_000,
    maxMoney: 1_200_000,
    xp: 30,
    rareChance: 0.08,
    rareMinMoney: 2_500_000,
    rareMaxMoney: 5_000_000,
    rareXp: 70,
    stories: [
      "Mengumpulkan kardus bekas dan botol plastik di gang belakang",
      "Menemukan tumpukan kaleng minuman sisa acara warga",
      "Menjual besi tua dan kabel bekas ke pengepul",
      "Memulung koran bekas dan botol kaca di pinggir pasar",
    ],
    rareStories: [
      "HOKI! Menemukan jam tangan antik di tumpukan barang bekas dan laku mahal",
      "JACKPOT MULUNG! Menemukan dompet tanpa pemilik berisi uang tunai utuh",
    ],
  },
  kerja: {
    title: "KERJA SERABUTAN",
    minMoney: 900_000,
    maxMoney: 2_800_000,
    xp: 55,
    rareChance: 0.1,
    rareMinMoney: 5_000_000,
    rareMaxMoney: 10_000_000,
    rareXp: 110,
    stories: [
      "Lembur memperbaiki bug server yang error jam 2 pagi",
      "Jadi barista kafe dan berhasil bikin latte art estetik",
      "Mengantar 40 paket COD tanpa satupun yang dibatalkan",
      "Bantu jaga warnet sambil nyambi edit desain poster",
      "Jadi tukang parkir minimarket pas jam gajian",
    ],
    rareStories: [
      "BONUS PROYEK! Klien puas berat dan langsung transfer uang tip dadakan",
      "PROMOSI KILAT! Bos lagi senang dan bagi-bagi bonus kinerja ekstra",
    ],
  },
  ojek: {
    title: "NGOJEK ONLINE",
    minMoney: 800_000,
    maxMoney: 2_400_000,
    xp: 50,
    rareChance: 0.1,
    rareMinMoney: 4_500_000,
    rareMaxMoney: 8_500_000,
    rareXp: 100,
    stories: [
      "Mengantar penumpang terburu-buru mengejar kereta pagi",
      "Dapat orderan makanan jarak jauh saat gerimis dengan ongkir tinggi",
      "Narik 5 penumpang berturut-turut tanpa kena macet",
      "Mengantar paket dokumen penting lintas kota dengan selamat",
    ],
    rareStories: [
      "PENUMPANG SULTAN! Dapat bintang 5 plus uang tip tebal berlipat",
      "ORDERAN VIP! Borong antar rombongan acara dan dibayar tunai dobel",
    ],
  },
  nambang: {
    title: "NAMBANG MINERAL",
    minMoney: 1_500_000,
    maxMoney: 5_000_000,
    xp: 85,
    rareChance: 0.12,
    rareMinMoney: 8_000_000,
    rareMaxMoney: 18_000_000,
    rareXp: 160,
    stories: [
      "Menambang bijih besi dan batu bara dari gua dalam",
      "Menemukan bongkahan tembaga dan perak berkualitas tinggi",
      "Menggali urat batu giok hijau di lereng bukit",
      "Mengangkut satu gerobak penuh kristal kuarsa murni",
    ],
    rareStories: [
      "RARE DROP: BERLIAN BIRU! Langsung dibeli kolektor dengan harga fantastis",
      "RARE DROP: BONGKAHAN EMAS 24 KARAT! Satu gua langsung heboh",
    ],
  },
  berburu: {
    title: "BERBURU DI HUTAN",
    minMoney: 1_500_000,
    maxMoney: 4_800_000,
    xp: 85,
    rareChance: 0.12,
    rareMinMoney: 7_500_000,
    rareMaxMoney: 16_000_000,
    rareXp: 155,
    stories: [
      "Berhasil menangkap rusa liar di pinggir lembah",
      "Memburu babi hutan besar dan menjual hasil buruan ke pasar",
      "Menangkap ayam hutan dan kelinci liar dengan perangkap jitu",
      "Menaklukkan serigala gunung yang meresahkan warga desa",
    ],
    rareStories: [
      "RARE CATCH: HARIMAU EMAS LEGENDARIS! Hadiah buruan tembus angka sultan",
      "RARE CATCH: TELUR NAGA LANGKA! Kolektor langsung bayar tunai tanpa nawar",
    ],
  },
  mancing: {
    title: "MANCING MANIA",
    minMoney: 1_200_000,
    maxMoney: 4_500_000,
    xp: 80,
    rareChance: 0.1,
    rareMinMoney: 9_000_000,
    rareMaxMoney: 20_000_000,
    rareXp: 160,
    stories: [
      "Strike ikan kakap merah besar di spot karang tengah",
      "Menarik ikan tuna sirip kuning seberat 18 kg",
      "Dapat 1 ember penuh lele jumbo dan gurame segar",
      "Memancing udang lobster segar di pinggir teluk",
    ],
    rareStories: [
      "MONSTER STRIKE: MEGALODON PURBA! Pelelangan ikan langsung pecah rekor",
      "GOLDEN CATCH: IKAN ARWANA SUPER RED! Langsung diborong juragan",
    ],
  },
};

const CORRUPTION_SUCCESS_STORIES = [
  "Berhasil mark-up anggaran pengadaan stiker resmi grup!",
  "Dana proyek renovasi deskripsi grup sukses dialihkan ke kantong pribadi!",
  "Tender fiktif pengadaan kuota admin lolos audit tanpa jejak!",
  "Menjual aset virtual fiktif atas nama kas negara grup!",
] as const;

const MEGA_CORRUPTION_SUCCESS_STORIES = [
  "MEGA PROYEK! Berhasil menggelembungkan anggaran pembangunan server fiktif grup!",
  "SKANDAL BESAR! Dana cadangan darurat grup sukses digelapkan lewat rekening bayangan!",
  "KAKAP! Proyek pengadaan satelit grup cair 100% langsung masuk dompet pribadi!",
] as const;

export interface JobRunResult {
  jobType: RpgJobType;
  title: string;
  story: string;
  isRare: boolean;
  moneyGained: bigint;
  xpGained: number;
  currentMoney: bigint;
}

export interface CorruptionResult {
  mega: boolean;
  success: boolean;
  story: string;
  amountDelta: bigint;
  xpGained: number;
  jailMinutes: number;
  currentMoney: bigint;
  treasuryBalance: bigint;
}

export interface TaxResult {
  success: boolean;
  story: string;
  taxCollected: bigint;
  collectorShare: bigint;
  treasuryShare: bigint;
  collectorMoney: bigint;
  targetMoney: bigint;
  treasuryBalance: bigint;
}

export interface RobResult {
  success: boolean;
  story: string;
  amountMoved: bigint;
  treasuryShare: bigint;
  jailMinutes: number;
  thiefMoney: bigint;
  victimMoney: bigint;
}

export interface BansosResult {
  moneyGained: bigint;
  wasSkimmed: boolean;
  povertyBonus: boolean;
  currentMoney: bigint;
  treasuryBalance: bigint;
}

export interface CasinoResult {
  outcome: "win" | "jackpot" | "draw" | "lose";
  betAmount: bigint;
  netDelta: bigint;
  playerDice: [number, number];
  dealerDice: [number, number];
  xpGained: number;
  currentMoney: bigint;
}

export interface CooldownSummary {
  jailedRemainingMs: number;
  entries: { key: string; label: string; remainingMs: number }[];
}

interface RpgProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
}

interface RpgTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      actorJid?: string;
      targetUserJid?: string;
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

interface RpgTx {
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
  tenantGroup: {
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
    update(args: {
      where: { groupJid: string };
      data: Record<string, unknown>;
    }): Promise<TenantGroup>;
  };
}

interface RpgDb {
  $transaction<T>(fn: (tx: RpgTx) => Promise<T>): Promise<T>;
  tenantGroup: {
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
  };
}

export class RpgEconomyService {
  constructor(
    private readonly profileRepo: RpgProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: RpgTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: RpgDb = prisma,
  ) {}

  async runJob(
    groupJid: string,
    userJid: string,
    jobType: RpgJobType,
    now: Date = new Date(),
  ): Promise<JobRunResult> {
    const def = JOB_DEFINITIONS[jobType];
    const cooldownMs = RPG_COOLDOWNS_MS[jobType] ?? 5 * 60 * 1000;
    const nowMs = now.getTime();
    const isRare = this.random.chance(def.rareChance);
    const baseMoney = BigInt(
      isRare
        ? this.random.intBetween(def.rareMinMoney, def.rareMaxMoney)
        : this.random.intBetween(def.minMoney, def.maxMoney),
    );
    const xpGained = isRare ? def.rareXp : def.xp;
    const storyPool = isRare ? def.rareStories : def.stories;
    const story = storyPool[this.random.intBetween(0, storyPool.length - 1)] ?? def.title;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const remaining = getRemainingCooldownMs(state, jobType, cooldownMs, nowMs);
      if (remaining > 0) {
        throw new AppUserError(
          `Kamu baru saja ${jobType}. Istirahat dulu *${formatRemainingDuration(remaining)}* lagi.`,
        );
      }

      const scaledMoney = scaleMoneyByLevel(baseMoney, profile.level);
      const moneyGained = clampMoneyCredit(profile.moneyBalance, scaledMoney);
      const nextState = withUpdatedCooldown(state, jobType, nowMs);

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
          note: jobType,
        },
        tx,
      );

      return {
        jobType,
        title: def.title,
        story,
        isRare,
        moneyGained,
        xpGained,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async runCorruption(
    groupJid: string,
    userJid: string,
    mega: boolean,
    now: Date = new Date(),
  ): Promise<CorruptionResult> {
    const actionKey = mega ? "megakorupsi" : "korupsi";
    const cooldownMs = RPG_COOLDOWNS_MS[actionKey] ?? 15 * 60 * 1000;
    const nowMs = now.getTime();
    const successRate = mega ? 0.45 : 0.58;
    const success = this.random.chance(successRate);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
      const currentTreasury = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
      const state = parseRpgState(profile.rpgState);

      const jailRemaining = getRemainingJailMs(state, nowMs);
      if (jailRemaining > 0) {
        throw new AppUserError(
          `Kamu sedang ditahan KPK grup! Bebas dalam *${formatRemainingDuration(jailRemaining)}*.`,
        );
      }

      const cooldownRemaining = getRemainingCooldownMs(state, actionKey, cooldownMs, nowMs);
      if (cooldownRemaining > 0) {
        throw new AppUserError(
          `Tunggu *${formatRemainingDuration(cooldownRemaining)}* lagi sebelum berani .${actionKey} lagi.`,
        );
      }

      if (success) {
        const baseGain = BigInt(
          mega
            ? this.random.intBetween(25_000_000, 120_000_000)
            : this.random.intBetween(4_000_000, 15_000_000),
        );
        const xpGained = mega ? 260 : 90;
        const scaledGain = scaleMoneyByLevel(baseGain, profile.level);
        const moneyGained = clampMoneyCredit(profile.moneyBalance, scaledGain);
        const treasuryDeduction = minBigInt(currentTreasury, moneyGained / 2n);
        const nextTreasury = maxBigInt(0n, currentTreasury - treasuryDeduction);
        const nextState = withUpdatedCooldown(state, actionKey, nowMs);

        const updated = await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            moneyBalance: { increment: moneyGained },
            totalMoneyEarned: { increment: moneyGained },
            experience: { increment: xpGained },
            rpgState: serializeRpgState(nextState),
          },
        });

        if (tenant) {
          await tx.tenantGroup.update({
            where: { groupJid },
            data: { treasuryBalance: nextTreasury },
          });
        }

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
            note: actionKey,
          },
          tx,
        );

        const pool = mega ? MEGA_CORRUPTION_SUCCESS_STORIES : CORRUPTION_SUCCESS_STORIES;
        const story = pool[this.random.intBetween(0, pool.length - 1)] ?? pool[0];

        return {
          mega,
          success: true,
          story,
          amountDelta: moneyGained,
          xpGained,
          jailMinutes: 0,
          currentMoney: updated.moneyBalance,
          treasuryBalance: nextTreasury,
        };
      }

      // Ketangkap OTT KPK
      const finePercent = mega ? 35 : 20;
      const fine = minBigInt(profile.moneyBalance, percentOfBigInt(profile.moneyBalance, finePercent));
      const jailMinutes = mega ? 30 : 10;
      const nextTreasury = minBigInt(MAX_SAFE_MONEY_BIGINT, currentTreasury + fine);
      const nextState = withJailUntil(
        withUpdatedCooldown(state, actionKey, nowMs),
        nowMs + jailMinutes * 60 * 1000,
      );

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { decrement: fine },
          experience: { increment: 15 },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (tenant && fine > 0n) {
        await tx.tenantGroup.update({
          where: { groupJid },
          data: { treasuryBalance: nextTreasury },
        });
      }

      if (fine > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -fine,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: `${actionKey}_ott`,
          },
          tx,
        );
      }

      return {
        mega,
        success: false,
        story: mega
          ? "OTT KPK GRUP! Kamu tertangkap tangan bawa koper uang tunai dan langsung pakai rompi oranye!"
          : "KETANGKAP KPK! Bukti kuitansi palsumu bocor ke grup dan kamu langsung diciduk!",
        amountDelta: -fine,
        xpGained: 15,
        jailMinutes,
        currentMoney: updated.moneyBalance,
        treasuryBalance: nextTreasury,
      };
    });
  }

  async getGroupTreasury(groupJid: string): Promise<bigint> {
    const tenant = await this.db.tenantGroup.findUnique({ where: { groupJid } });
    return tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
  }

  async collectTax(
    groupJid: string,
    collectorJid: string,
    targetJid: string,
    now: Date = new Date(),
  ): Promise<TaxResult> {
    const normCollector = normalizeUserJid(collectorJid);
    const normTarget = normalizeUserJid(targetJid);
    if (!normCollector || !normTarget || normCollector === normTarget) {
      throw new AppUserError("Tidak dapat memajaki diri sendiri.");
    }

    const cooldownMs = RPG_COOLDOWNS_MS.pajak ?? 30 * 60 * 1000;
    const nowMs = now.getTime();
    const success = this.random.chance(0.75);
    const taxPercent = this.random.intBetween(6, 12);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const collector = await this.profileRepo.findOrCreate(groupJid, normCollector, tx);
      const target = await this.profileRepo.findByGroupAndUser(groupJid, normTarget, tx);
      const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
      const currentTreasury = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
      const collectorState = parseRpgState(collector.rpgState);

      const remaining = getRemainingCooldownMs(collectorState, "pajak", cooldownMs, nowMs);
      if (remaining > 0) {
        throw new AppUserError(
          `Petugas pajak sedang rehat. Kamu bisa narik .pajak lagi dalam *${formatRemainingDuration(remaining)}*.`,
        );
      }

      if (!target || target.moneyBalance < MIN_TARGET_WALLET_FOR_ACTION) {
        throw new AppUserError(
          `Target sedang melarat (dompet di bawah ${formatRupiah(MIN_TARGET_WALLET_FOR_ACTION)}). Kasihan, cari sultan lain!`,
        );
      }

      if (isInsuranceActive(parseRpgState(target.rpgState), "brankas", nowMs)) {
        throw new AppUserError(
          "Target sedang dilindungi *Asuransi Brankas Anti-Maling*! Tidak bisa dipajaki sementara.",
        );
      }

      const nextCollectorState = withUpdatedCooldown(collectorState, "pajak", nowMs);

      if (!success) {
        await tx.groupMemberProfile.update({
          where: { id: collector.id },
          data: { rpgState: serializeRpgState(nextCollectorState) },
        });
        return {
          success: false,
          story:
            "Target pura-pura lupa password dompet dan kabur ke luar negeri! Penagihan pajak gagal.",
          taxCollected: 0n,
          collectorShare: 0n,
          treasuryShare: 0n,
          collectorMoney: collector.moneyBalance,
          targetMoney: target.moneyBalance,
          treasuryBalance: currentTreasury,
        };
      }

      const rawTax = percentOfBigInt(target.moneyBalance, taxPercent);
      const taxCollected = maxBigInt(
        100_000n,
        minBigInt(MAX_TAX_PER_ACTION, rawTax, target.moneyBalance),
      );
      const collectorShare = clampMoneyCredit(
        collector.moneyBalance,
        percentOfBigInt(taxCollected, 40),
      );
      const treasuryShare = taxCollected - collectorShare;
      const nextTreasury = minBigInt(MAX_SAFE_MONEY_BIGINT, currentTreasury + treasuryShare);

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: target.id, moneyBalance: { gte: taxCollected } },
        data: { moneyBalance: { decrement: taxCollected } },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Dompet target keburu kosong saat dipajaki.");
      }

      const updatedTarget = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: target.id },
      });
      const updatedCollector = await tx.groupMemberProfile.update({
        where: { id: collector.id },
        data: {
          moneyBalance: { increment: collectorShare },
          totalMoneyEarned: { increment: collectorShare },
          experience: { increment: 45 },
          rpgState: serializeRpgState(nextCollectorState),
        },
      });

      if (tenant) {
        await tx.tenantGroup.update({
          where: { groupJid },
          data: { treasuryBalance: nextTreasury },
        });
      }

      await this.txRepo.create(
        {
          profileId: target.id,
          groupJid,
          userJid: normTarget,
          actorJid: normCollector,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.TAX_DEBIT,
          amount: -taxCollected,
          balanceBefore: target.moneyBalance,
          balanceAfter: updatedTarget.moneyBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: collector.id,
          groupJid,
          userJid: normCollector,
          targetUserJid: normTarget,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.TAX_CREDIT,
          amount: collectorShare,
          balanceBefore: collector.moneyBalance,
          balanceAfter: updatedCollector.moneyBalance,
          correlationId,
        },
        tx,
      );

      return {
        success: true,
        story: `Berhasil menarik pajak kekayaan ${String(taxPercent)}% dari dompet target!`,
        taxCollected,
        collectorShare,
        treasuryShare,
        collectorMoney: updatedCollector.moneyBalance,
        targetMoney: updatedTarget.moneyBalance,
        treasuryBalance: nextTreasury,
      };
    });
  }

  async robMember(
    groupJid: string,
    thiefJid: string,
    victimJid: string,
    now: Date = new Date(),
  ): Promise<RobResult> {
    const normThief = normalizeUserJid(thiefJid);
    const normVictim = normalizeUserJid(victimJid);
    if (!normThief || !normVictim || normThief === normVictim) {
      throw new AppUserError("Masa mau maling dompet sendiri?");
    }

    const cooldownMs = RPG_COOLDOWNS_MS.maling ?? 20 * 60 * 1000;
    const nowMs = now.getTime();
    const success = this.random.chance(0.55);
    const stealPercent = this.random.intBetween(10, 25);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const thief = await this.profileRepo.findOrCreate(groupJid, normThief, tx);
      const victim = await this.profileRepo.findByGroupAndUser(groupJid, normVictim, tx);
      const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
      const currentTreasury = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
      const thiefState = parseRpgState(thief.rpgState);

      const jailRemaining = getRemainingJailMs(thiefState, nowMs);
      if (jailRemaining > 0) {
        throw new AppUserError(
          `Kamu masih di dalam sel! Tunggu *${formatRemainingDuration(jailRemaining)}* lagi.`,
        );
      }

      const remaining = getRemainingCooldownMs(thiefState, "maling", cooldownMs, nowMs);
      if (remaining > 0) {
        throw new AppUserError(
          `Sabar, warga lagi waspada! Bisa .maling lagi dalam *${formatRemainingDuration(remaining)}*.`,
        );
      }

      if (!victim || victim.moneyBalance < MIN_TARGET_WALLET_FOR_ACTION) {
        throw new AppUserError(
          `Dompet target hampir kosong (< ${formatRupiah(MIN_TARGET_WALLET_FOR_ACTION)}). Kayaknya uangnya sudah aman di Bank!`,
        );
      }

      if (isInsuranceActive(parseRpgState(victim.rpgState), "brankas", nowMs)) {
        throw new AppUserError(
          "Brankas target sedang dilindungi *Asuransi Brankas Anti-Maling*! Aksi maling dibatalkan.",
        );
      }

      if (success) {
        const rawSteal = percentOfBigInt(victim.moneyBalance, stealPercent);
        const stolen = maxBigInt(
          100_000n,
          minBigInt(MAX_ROB_PER_ACTION, rawSteal, victim.moneyBalance),
        );
        const creditToThief = clampMoneyCredit(thief.moneyBalance, stolen);
        const nextThiefState = withUpdatedCooldown(thiefState, "maling", nowMs);

        const debitRes = await tx.groupMemberProfile.updateMany({
          where: { id: victim.id, moneyBalance: { gte: stolen } },
          data: { moneyBalance: { decrement: stolen } },
        });
        if (debitRes.count === 0) {
          throw new AppUserError("Target keburu menyelamatkan dompetnya ke Bank.");
        }

        const updatedVictim = await tx.groupMemberProfile.findUniqueOrThrow({
          where: { id: victim.id },
        });
        const updatedThief = await tx.groupMemberProfile.update({
          where: { id: thief.id },
          data: {
            moneyBalance: { increment: creditToThief },
            totalMoneyEarned: { increment: creditToThief },
            experience: { increment: 60 },
            rpgState: serializeRpgState(nextThiefState),
          },
        });

        await this.txRepo.create(
          {
            profileId: victim.id,
            groupJid,
            userJid: normVictim,
            actorJid: normThief,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.ROB_DEBIT,
            amount: -stolen,
            balanceBefore: victim.moneyBalance,
            balanceAfter: updatedVictim.moneyBalance,
            correlationId,
          },
          tx,
        );

        await this.txRepo.create(
          {
            profileId: thief.id,
            groupJid,
            userJid: normThief,
            targetUserJid: normVictim,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.ROB_CREDIT,
            amount: creditToThief,
            balanceBefore: thief.moneyBalance,
            balanceAfter: updatedThief.moneyBalance,
            correlationId,
          },
          tx,
        );

        return {
          success: true,
          story: `Aksi mulus! Berhasil menyikat ${String(stealPercent)}% isi dompet target tanpa ketahuan ronda!`,
          amountMoved: stolen,
          treasuryShare: 0n,
          jailMinutes: 0,
          thiefMoney: updatedThief.moneyBalance,
          victimMoney: updatedVictim.moneyBalance,
        };
      }

      // Gagal & ketangkap ronda warga
      const jailMinutes = 15;
      const fine = minBigInt(
        thief.moneyBalance,
        MAX_ROB_FINE,
        percentOfBigInt(thief.moneyBalance, 15),
      );
      const victimCompensation = clampMoneyCredit(victim.moneyBalance, fine / 2n);
      const treasuryShare = fine - victimCompensation;
      const nextThiefState = withJailUntil(
        withUpdatedCooldown(thiefState, "maling", nowMs),
        nowMs + jailMinutes * 60 * 1000,
      );

      const updatedThief = await tx.groupMemberProfile.update({
        where: { id: thief.id },
        data: {
          moneyBalance: { decrement: fine },
          rpgState: serializeRpgState(nextThiefState),
        },
      });

      let updatedVictimMoney = victim.moneyBalance;
      if (victimCompensation > 0n) {
        const updatedVictim = await tx.groupMemberProfile.update({
          where: { id: victim.id },
          data: {
            moneyBalance: { increment: victimCompensation },
            totalMoneyEarned: { increment: victimCompensation },
          },
        });
        updatedVictimMoney = updatedVictim.moneyBalance;
      }

      if (tenant && treasuryShare > 0n) {
        await tx.tenantGroup.update({
          where: { groupJid },
          data: { treasuryBalance: minBigInt(MAX_SAFE_MONEY_BIGINT, currentTreasury + treasuryShare) },
        });
      }

      if (fine > 0n) {
        await this.txRepo.create(
          {
            profileId: thief.id,
            groupJid,
            userJid: normThief,
            targetUserJid: normVictim,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -fine,
            balanceBefore: thief.moneyBalance,
            balanceAfter: updatedThief.moneyBalance,
            correlationId,
            note: "rob_caught",
          },
          tx,
        );
      }

      return {
        success: false,
        story:
          "KETANGKAP RONDA! Sendal ketinggalan di TKP, kamu diamankan hansip grup dan kena denda!",
        amountMoved: fine,
        treasuryShare,
        jailMinutes,
        thiefMoney: updatedThief.moneyBalance,
        victimMoney: updatedVictimMoney,
      };
    });
  }

  async claimBansos(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<BansosResult> {
    const cooldownMs = RPG_COOLDOWNS_MS.bansos ?? 6 * 60 * 60 * 1000;
    const nowMs = now.getTime();
    const baseAid = BigInt(this.random.intBetween(2_500_000, 6_000_000));
    const wasSkimmed = this.random.chance(0.15);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
      const currentTreasury = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
      const state = parseRpgState(profile.rpgState);

      const remaining = getRemainingCooldownMs(state, "bansos", cooldownMs, nowMs);
      if (remaining > 0) {
        throw new AppUserError(
          `Kamu sudah ambil bansos. Antre lagi dalam *${formatRemainingDuration(remaining)}*.`,
        );
      }

      const totalWealth = profile.moneyBalance + profile.bankBalance;
      const povertyBonus = totalWealth < BANSOS_POVERTY_THRESHOLD;
      const grossAid = baseAid + (povertyBonus ? BANSOS_POVERTY_BONUS : 0n);
      const netAid = wasSkimmed ? grossAid / 2n : grossAid;
      const moneyGained = clampMoneyCredit(profile.moneyBalance, netAid);
      const treasuryUsed = minBigInt(currentTreasury, moneyGained / 2n);
      const nextTreasury = maxBigInt(0n, currentTreasury - treasuryUsed);
      const nextState = withUpdatedCooldown(state, "bansos", nowMs);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          experience: { increment: 25 },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (tenant && treasuryUsed > 0n) {
        await tx.tenantGroup.update({
          where: { groupJid },
          data: { treasuryBalance: nextTreasury },
        });
      }

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.BANSOS_REWARD,
          amount: moneyGained,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
        },
        tx,
      );

      return {
        moneyGained,
        wasSkimmed,
        povertyBonus,
        currentMoney: updated.moneyBalance,
        treasuryBalance: nextTreasury,
      };
    });
  }

  async playCasino(
    groupJid: string,
    userJid: string,
    betInput: bigint | "all",
    now: Date = new Date(),
  ): Promise<CasinoResult> {
    const cooldownMs = RPG_COOLDOWNS_MS.casino ?? 10_000;
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    const p1 = this.random.intBetween(1, 6);
    const p2 = this.random.intBetween(1, 6);
    const d1 = this.random.intBetween(1, 6);
    const d2 = this.random.intBetween(1, 6);
    const pTotal = p1 + p2;
    const dTotal = d1 + d2;

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
      const state = parseRpgState(profile.rpgState);

      const remaining = getRemainingCooldownMs(state, "casino", cooldownMs, nowMs);
      if (remaining > 0) {
        throw new AppUserError(
          `Tunggu *${formatRemainingDuration(remaining)}* sebelum taruhan casino berikutnya.`,
        );
      }

      const betAmount =
        betInput === "all" ? minBigInt(profile.moneyBalance, CASINO_MAX_BET) : betInput;

      if (betAmount < CASINO_MIN_BET || betAmount > CASINO_MAX_BET) {
        throw new AppUserError(
          `Taruhan casino antara ${formatRupiah(CASINO_MIN_BET)} sampai ${formatRupiah(CASINO_MAX_BET)}.`,
        );
      }

      if (profile.moneyBalance < betAmount) {
        throw new AppUserError(
          `Uang di dompet tidak cukup! Dompet kamu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withUpdatedCooldown(state, "casino", nowMs);
      let outcome: CasinoResult["outcome"];
      let netDelta = 0n;
      let xpGained = 10;

      if (pTotal > dTotal) {
        const isJackpot = p1 === 6 && p2 === 6;
        outcome = isJackpot ? "jackpot" : "win";
        const profit = isJackpot ? (betAmount * 3n) / 2n : betAmount;
        netDelta = clampMoneyCredit(profile.moneyBalance, profit);
        xpGained = isJackpot ? 75 : 35;
      } else if (pTotal === dTotal) {
        outcome = "draw";
        netDelta = 0n;
        xpGained = 10;
      } else {
        outcome = "lose";
        netDelta = -betAmount;
        xpGained = 10;
      }

      const updateData: Record<string, unknown> = {
        experience: { increment: xpGained },
        rpgState: serializeRpgState(nextState),
      };
      if (netDelta > 0n) {
        updateData.moneyBalance = { increment: netDelta };
        updateData.totalMoneyEarned = { increment: netDelta };
      } else if (netDelta < 0n) {
        updateData.moneyBalance = { decrement: absBigInt(netDelta) };
      }

      const debitCheck = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: betAmount } },
        data: updateData,
      });
      if (debitCheck.count === 0) {
        throw new AppUserError("Saldo dompet berubah saat memproses taruhan casino.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      if (netDelta < 0n && tenant) {
        const houseTax = absBigInt(netDelta) / 2n;
        await tx.tenantGroup.update({
          where: { groupJid },
          data: {
            treasuryBalance: minBigInt(MAX_SAFE_MONEY_BIGINT, tenant.treasuryBalance + houseTax),
          },
        });
      }

      if (netDelta !== 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: netDelta > 0n ? MemberTransactionType.RPG_EARN : MemberTransactionType.RPG_LOSS,
            amount: netDelta,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: `casino_${outcome}`,
          },
          tx,
        );
      }

      return {
        outcome,
        betAmount,
        netDelta,
        playerDice: [p1, p2],
        dealerDice: [d1, d2],
        xpGained,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getCooldownSummary(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<CooldownSummary> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const nowMs = now.getTime();

    const labels: [string, string][] = [
      ["mulung", ".mulung"],
      ["kerja", ".kerja"],
      ["ojek", ".ojek"],
      ["nambang", ".nambang"],
      ["berburu", ".berburu"],
      ["mancing", ".mancing"],
      ["korupsi", ".korupsi"],
      ["megakorupsi", ".megakorupsi"],
      ["pajak", ".pajak"],
      ["maling", ".maling"],
      ["bansos", ".bansos"],
    ];

    return {
      jailedRemainingMs: getRemainingJailMs(state, nowMs),
      entries: labels.map(([key, label]) => ({
        key,
        label,
        remainingMs: getRemainingCooldownMs(state, key, RPG_COOLDOWNS_MS[key] ?? 0, nowMs),
      })),
    };
  }
}

export const rpgEconomyService = new RpgEconomyService();
