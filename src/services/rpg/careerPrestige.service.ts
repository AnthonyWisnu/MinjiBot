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
  percentOfBigInt,
} from "../../utils/currency";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { resolveRank, type MemberRank } from "../member/rank.service";
import {
  applyPrestigeMoneyBoost,
  applyPrestigeXpBoost,
  CAREER_CATALOG,
  CAREER_MAP,
  CAREER_MAX_LEVEL,
  CAREER_SHIFT_COOLDOWN_MS,
  getPrestigeCost,
  getStartupDividendPayout,
  getStartupMaxEmployees,
  getStartupUpgradeCost,
  getStartupValuation,
  INSURANCE_CATALOG,
  INSURANCE_MAP,
  JAIL_BAIL_COST,
  PINJOL_DUE_MS,
  PINJOL_INTEREST_PERCENT,
  PINJOL_MAX_BY_RANK,
  PINJOL_MIN_AMOUNT,
  PRESTIGE_BONUS_PERCENT_PER_STAR,
  PRESTIGE_MAX_LEVEL,
  PRESTIGE_MIN_PLAYER_LEVEL,
  PRESTIGE_REWARD_LIMIT,
  PRESTIGE_REWARD_POINTS,
  STARTUP_CREATE_COST,
  STARTUP_DIVIDEND_COOLDOWN_MS,
  STARTUP_MAX_LEVEL,
  STARTUP_MIN_PLAYER_LEVEL,
  STARTUP_RECRUIT_COST,
  UGD_VIP_RELEASE_COST,
  type CareerSpec,
  type InsuranceSpec,
  type InsuranceType,
} from "./careerPrestigeCatalog";
import { RpgExpansionService } from "./rpgExpansion.service";
import {
  getRemainingCooldownMs,
  getRemainingJailMs,
  getRemainingUgdMs,
  isInsuranceActive,
  MAX_PLAYER_HP,
  parseRpgState,
  serializeRpgState,
  withCareer,
  withHp,
  withInsuranceUntil,
  withLoan,
  withPrestige,
  withStartup,
  withUpdatedCooldown,
  type MemberRpgState,
} from "./rpgState";

export interface CareerOverview {
  current: {
    spec: CareerSpec;
    level: number;
    shiftsDone: number;
    shiftCooldownMs: number;
    nextPromoteCost: bigint | null;
  } | null;
  playerLevel: number;
  prestige: number;
  catalog: readonly CareerSpec[];
}

export interface CareerShiftResult {
  spec: CareerSpec;
  careerLevel: number;
  moneyEarned: bigint;
  xpEarned: number;
  pointsEarned: number;
  debtSeized: bigint;
  remainingDebt: bigint;
  currentMoney: bigint;
}

export interface StartupOverview {
  startup: {
    name: string;
    level: number;
    employees: number;
    maxEmployees: number;
    valuation: bigint;
    dividendPayout: bigint;
    dividendCooldownMs: number;
    nextUpgradeCost: bigint | null;
  } | null;
  moneyBalance: bigint;
}

export interface StartupDividendResult {
  startupName: string;
  level: number;
  employees: number;
  dividendGross: bigint;
  xpEarned: number;
  debtSeized: bigint;
  remainingDebt: bigint;
  currentMoney: bigint;
}

export interface LoanOverview {
  active: boolean;
  principal: bigint;
  interest: bigint;
  totalDue: bigint;
  overdue: boolean;
  remainingMs: number;
  rank: MemberRank;
  maxBorrowLimit: bigint;
  moneyBalance: bigint;
}

export interface LoanActionResult {
  action: "borrow" | "repay";
  amount: bigint;
  totalDebtRemaining: bigint;
  dueAt: number;
  currentMoney: bigint;
}

export interface InsuranceOverview {
  items: { spec: InsuranceSpec; remainingMs: number }[];
  jailRemainingMs: number;
  ugdRemainingMs: number;
  moneyBalance: bigint;
}

export interface ReleaseStatusResult {
  kind: "jail" | "ugd";
  coveredByInsurance: boolean;
  costPaid: bigint;
  walletPaid: bigint;
  bankPaid: bigint;
  currentMoney: bigint;
  currentBank: bigint;
}

export interface PrestigeOverview {
  prestige: number;
  maxPrestige: number;
  currentBoostPercent: number;
  playerLevel: number;
  minLevelRequired: number;
  nextCost: bigint | null;
  moneyBalance: bigint;
}

export interface RebirthResult {
  newPrestige: number;
  newBoostPercent: number;
  costPaid: bigint;
  limitBonus: number;
  pointsBonus: number;
  currentMoney: bigint;
  currentLimit: number;
}

export interface TopPrestigeEntry {
  userJid: string;
  prestige: number;
  level: number;
  netCash: bigint;
}

export interface TopStartupEntry {
  userJid: string;
  startupName: string;
  level: number;
  employees: number;
  valuation: bigint;
}

export interface AssetSummary {
  userJid: string;
  customTitle: string | null;
  rank: MemberRank;
  level: number;
  prestige: number;
  moneyBalance: bigint;
  bankBalance: bigint;
  depositoValue: bigint;
  stocksValue: bigint;
  cryptoValue: bigint;
  propertyValue: bigint;
  startupName: string | null;
  startupValuation: bigint;
  loanDebt: bigint;
  grossAssets: bigint;
  netWorth: bigint;
  wealthPosition: number;
}

interface CareerProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  getPositionByWealth(groupJid: string, userJid: string): Promise<number>;
}

interface CareerTxStore {
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

interface CareerTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

interface CareerDb {
  $transaction<T>(fn: (tx: CareerTx) => Promise<T>): Promise<T>;
  groupMemberProfile: {
    findMany(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile[]>;
  };
}

function getLoanTotalDue(state: MemberRpgState): bigint {
  if (!state.loan) return 0n;
  return BigInt(state.loan.principal) + BigInt(state.loan.interest);
}

function applyDebtCollectorSeizure(
  state: MemberRpgState,
  grossIncome: bigint,
  nowMs: number,
): { nextState: MemberRpgState; netIncome: bigint; debtSeized: bigint; remainingDebt: bigint } {
  if (!state.loan || nowMs <= state.loan.dueAt) {
    return {
      nextState: state,
      netIncome: grossIncome,
      debtSeized: 0n,
      remainingDebt: getLoanTotalDue(state),
    };
  }
  const totalDue = getLoanTotalDue(state);
  if (totalDue <= 0n) {
    return {
      nextState: withLoan(state, null),
      netIncome: grossIncome,
      debtSeized: 0n,
      remainingDebt: 0n,
    };
  }
  // Debt collector menyita hingga 50% penghasilan hingga utang lunas
  const maxSeize = grossIncome / 2n;
  const seized = totalDue < maxSeize ? totalDue : maxSeize;
  const remaining = totalDue - seized;

  let nextState: MemberRpgState;
  if (remaining <= 0n) {
    nextState = withLoan(state, null);
  } else {
    const oldInterest = BigInt(state.loan.interest);
    const interestPaid = seized < oldInterest ? seized : oldInterest;
    const principalPaid = seized - interestPaid;
    const nextInterest = oldInterest - interestPaid;
    const nextPrincipal = BigInt(state.loan.principal) - principalPaid;
    nextState = withLoan(state, {
      ...state.loan,
      principal: (nextPrincipal > 0n ? nextPrincipal : 0n).toString(),
      interest: (nextInterest > 0n ? nextInterest : 0n).toString(),
    });
  }

  return {
    nextState,
    netIncome: grossIncome - seized,
    debtSeized: seized,
    remainingDebt: remaining,
  };
}

export class CareerPrestigeService {
  constructor(
    private readonly profileRepo: CareerProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: CareerTxStore = new GroupMemberTransactionRepository(),
    private readonly expansionService: RpgExpansionService = new RpgExpansionService(),
    private readonly db: CareerDb = prisma,
  ) {}

  async getCareerOverview(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<CareerOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const spec = state.career ? CAREER_MAP.get(state.career.jobId) : undefined;

    return {
      current:
        state.career && spec
          ? {
              spec,
              level: state.career.level,
              shiftsDone: state.career.shiftsDone,
              shiftCooldownMs: getRemainingCooldownMs(
                state,
                "career_shift",
                CAREER_SHIFT_COOLDOWN_MS,
                now.getTime(),
              ),
              nextPromoteCost:
                state.career.level < CAREER_MAX_LEVEL
                  ? spec.promoteCostPerLevel * BigInt(state.career.level)
                  : null,
            }
          : null,
      playerLevel: Math.max(1, profile.level),
      prestige: state.prestige,
      catalog: CAREER_CATALOG,
    };
  }

  async applyCareer(groupJid: string, userJid: string, rawJobId: string): Promise<CareerSpec> {
    const spec = CAREER_MAP.get(rawJobId.trim().toLowerCase());
    if (!spec) {
      const list = CAREER_CATALOG.map((c) => c.id).join(", ");
      throw new AppUserError(`Profesi "${rawJobId}" tidak ditemukan. Pilihan: ${list}.`);
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < spec.minLevel) {
        throw new AppUserError(
          `Profesi *${spec.title}* membutuhkan minimal Level ${String(spec.minLevel)} (levelmu: Lv.${String(playerLevel)}). Naikkan lewat .levelup!`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      if (state.career?.jobId === spec.id) {
        throw new AppUserError(`Kamu sudah bekerja sebagai *${spec.title}*.`);
      }

      const nextState = withCareer(state, { jobId: spec.id, level: 1, shiftsDone: 0 });
      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return spec;
    });
  }

  async workShift(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<CareerShiftResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const spec = state.career ? CAREER_MAP.get(state.career.jobId) : undefined;
      if (!state.career || !spec) {
        throw new AppUserError(
          "Kamu belum punya profesi! Lihat daftar lowongan di .karir lalu lamar dengan .lamar <profesi>.",
        );
      }
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < spec.minLevel) {
        throw new AppUserError(
          `Profesi *${spec.title}* membutuhkan minimal *Level ${String(spec.minLevel)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan level via *.levelup* atau *.resign* untuk melamar profesi sesuai levelmu!`,
        );
      }

      const jailMs = getRemainingJailMs(state, nowMs);
      if (jailMs > 0) {
        throw new AppUserError(
          `Kamu sedang di penjara (${formatRemainingDuration(jailMs)} lagi). Gunakan .bebaspenjara!`,
        );
      }
      const ugdMs = getRemainingUgdMs(state, nowMs);
      if (ugdMs > 0) {
        throw new AppUserError(
          `Kamu sedang dirawat di UGD (${formatRemainingDuration(ugdMs)} lagi). Gunakan .bebasugd!`,
        );
      }

      const cdMs = getRemainingCooldownMs(state, "career_shift", CAREER_SHIFT_COOLDOWN_MS, nowMs);
      if (cdMs > 0) {
        throw new AppUserError(
          `Shift kerja berikutnya siap dalam ${formatRemainingDuration(cdMs)}.`,
        );
      }

      const levelMult = BigInt(100 + (state.career.level - 1) * 35);
      const baseWithJobLvl = (spec.basePay * levelMult) / 100n;
      const grossMoney = applyPrestigeMoneyBoost(baseWithJobLvl, state.prestige);
      const xpEarned = applyPrestigeXpBoost(
        spec.baseXp + (state.career.level - 1) * 25,
        state.prestige,
      );
      const pointsEarned = spec.basePoints + (state.career.level - 1) * 8;

      const seized = applyDebtCollectorSeizure(state, grossMoney, nowMs);
      const moneyCredit = clampMoneyCredit(profile.moneyBalance, seized.netIncome);

      let nextState = withCareer(seized.nextState, {
        ...state.career,
        shiftsDone: state.career.shiftsDone + 1,
      });
      nextState = withUpdatedCooldown(nextState, "career_shift", nowMs);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyCredit },
          totalMoneyEarned: { increment: moneyCredit },
          experience: { increment: xpEarned },
          pointsBalance: { increment: pointsEarned },
          totalPointsEarned: { increment: pointsEarned },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (moneyCredit > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_EARN,
            amount: moneyCredit,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: `career_shift:${spec.id}:lv${String(state.career.level)}`,
          },
          tx,
        );
      }

      return {
        spec,
        careerLevel: state.career.level,
        moneyEarned: moneyCredit,
        xpEarned,
        pointsEarned,
        debtSeized: seized.debtSeized,
        remainingDebt: seized.remainingDebt,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async promoteCareer(
    groupJid: string,
    userJid: string,
  ): Promise<{ spec: CareerSpec; newLevel: number; costPaid: bigint; currentMoney: bigint }> {
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const spec = state.career ? CAREER_MAP.get(state.career.jobId) : undefined;
      if (!state.career || !spec) {
        throw new AppUserError("Kamu belum punya profesi. Lamar dulu di .karir!");
      }
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < spec.minLevel) {
        throw new AppUserError(
          `Promosi *${spec.title}* membutuhkan minimal *Level ${String(spec.minLevel)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan level via *.levelup* dulu!`,
        );
      }
      if (state.career.level >= CAREER_MAX_LEVEL) {
        throw new AppUserError(
          `Jabatan *${spec.title}* sudah di level maksimal (Lv.${String(CAREER_MAX_LEVEL)}). Coba lamar profesi lebih tinggi di .karir!`,
        );
      }

      const cost = spec.promoteCostPerLevel * BigInt(state.career.level);
      if (profile.moneyBalance < cost) {
        throw new AppUserError(
          `Dompet tidak cukup! Biaya promosi ke Lv.${String(state.career.level + 1)} = ${formatRupiah(cost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextLevel = state.career.level + 1;
      const nextState = withCareer(state, { ...state.career, level: nextLevel });
      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: cost } },
        data: {
          moneyBalance: { decrement: cost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat promosi karir.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -cost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `career_promote:${spec.id}:lv${String(nextLevel)}`,
        },
        tx,
      );

      return { spec, newLevel: nextLevel, costPaid: cost, currentMoney: updated.moneyBalance };
    });
  }

  async resignCareer(groupJid: string, userJid: string): Promise<string> {
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const spec = state.career ? CAREER_MAP.get(state.career.jobId) : undefined;
      if (!state.career || !spec) {
        throw new AppUserError("Kamu sedang tidak bekerja di profesi mana pun.");
      }

      const nextState = withCareer(state, null);
      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return spec.title;
    });
  }

  async getStartupOverview(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<StartupOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    if (!state.startup) {
      return { startup: null, moneyBalance: profile.moneyBalance };
    }

    const s = state.startup;
    const elapsed = Math.max(0, now.getTime() - s.lastDividendAt);
    const cd =
      s.lastDividendAt > 0 && elapsed < STARTUP_DIVIDEND_COOLDOWN_MS
        ? STARTUP_DIVIDEND_COOLDOWN_MS - elapsed
        : 0;

    return {
      startup: {
        name: s.name,
        level: s.level,
        employees: s.employees,
        maxEmployees: getStartupMaxEmployees(s.level),
        valuation: getStartupValuation(s.level, s.employees),
        dividendPayout: applyPrestigeMoneyBoost(
          getStartupDividendPayout(s.level, s.employees),
          state.prestige,
        ),
        dividendCooldownMs: cd,
        nextUpgradeCost: s.level < STARTUP_MAX_LEVEL ? getStartupUpgradeCost(s.level) : null,
      },
      moneyBalance: profile.moneyBalance,
    };
  }

  async createStartup(
    groupJid: string,
    userJid: string,
    rawName: string,
  ): Promise<{ name: string; costPaid: bigint; currentMoney: bigint }> {
    const name = rawName.trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 28) {
      throw new AppUserError("Nama startup harus 3 sampai 28 karakter. Contoh: .buatstartup PT Minji Jaya");
    }

    const correlationId = generateCorrelationId();
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (state.startup) {
        throw new AppUserError(`Kamu sudah memiliki startup *${state.startup.name}*!`);
      }
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < STARTUP_MIN_PLAYER_LEVEL) {
        throw new AppUserError(
          `Mendirikan startup membutuhkan minimal *Level ${String(STARTUP_MIN_PLAYER_LEVEL)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan lewat *.levelup*!`,
        );
      }
      if (profile.moneyBalance < STARTUP_CREATE_COST) {
        throw new AppUserError(
          `Modal pendirian startup ${formatRupiah(STARTUP_CREATE_COST)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withStartup(state, {
        name,
        level: 1,
        employees: 1,
        lastDividendAt: 0,
      });

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: STARTUP_CREATE_COST } },
        data: {
          moneyBalance: { decrement: STARTUP_CREATE_COST },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup mendirikan startup.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -STARTUP_CREATE_COST,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `create_startup:${name}`,
        },
        tx,
      );

      return { name, costPaid: STARTUP_CREATE_COST, currentMoney: updated.moneyBalance };
    });
  }

  async recruitEmployees(
    groupJid: string,
    userJid: string,
    count = 1,
  ): Promise<{ startupName: string; added: number; totalEmployees: number; costPaid: bigint; currentMoney: bigint }> {
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new AppUserError("Jumlah rekruit karyawan harus 1 sampai 20.");
    }

    const correlationId = generateCorrelationId();
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (!state.startup) {
        throw new AppUserError("Kamu belum punya startup. Buat dulu dengan .buatstartup <nama>.");
      }
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < STARTUP_MIN_PLAYER_LEVEL) {
        throw new AppUserError(
          `Mengelola startup membutuhkan minimal *Level ${String(STARTUP_MIN_PLAYER_LEVEL)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan lewat *.levelup*!`,
        );
      }

      const maxEmp = getStartupMaxEmployees(state.startup.level);
      if (state.startup.employees + count > maxEmp) {
        throw new AppUserError(
          `Kapasitas maksimal karyawan Lv.${String(state.startup.level)} adalah ${String(maxEmp)} orang (saat ini ${String(state.startup.employees)}). Upgrade dulu pakai .upgradestartup!`,
        );
      }

      const cost = STARTUP_RECRUIT_COST * BigInt(count);
      if (profile.moneyBalance < cost) {
        throw new AppUserError(
          `Biaya rekruit ${String(count)} karyawan = ${formatRupiah(cost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const totalEmployees = state.startup.employees + count;
      const nextState = withStartup(state, { ...state.startup, employees: totalEmployees });
      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: cost } },
        data: {
          moneyBalance: { decrement: cost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk rekruit karyawan.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -cost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `startup_recruit:${String(count)}`,
        },
        tx,
      );

      return {
        startupName: state.startup.name,
        added: count,
        totalEmployees,
        costPaid: cost,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async upgradeStartup(
    groupJid: string,
    userJid: string,
  ): Promise<{ startupName: string; newLevel: number; maxEmployees: number; costPaid: bigint; currentMoney: bigint }> {
    const correlationId = generateCorrelationId();
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (!state.startup) {
        throw new AppUserError("Kamu belum punya startup. Buat dulu dengan .buatstartup <nama>.");
      }
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < STARTUP_MIN_PLAYER_LEVEL) {
        throw new AppUserError(
          `Mengelola startup membutuhkan minimal *Level ${String(STARTUP_MIN_PLAYER_LEVEL)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan lewat *.levelup*!`,
        );
      }
      if (state.startup.level >= STARTUP_MAX_LEVEL) {
        throw new AppUserError(`Startup *${state.startup.name}* sudah di level maksimal (Lv.${String(STARTUP_MAX_LEVEL)})!`);
      }

      const cost = getStartupUpgradeCost(state.startup.level);
      if (profile.moneyBalance < cost) {
        throw new AppUserError(
          `Biaya upgrade ke Lv.${String(state.startup.level + 1)} = ${formatRupiah(cost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const newLevel = state.startup.level + 1;
      const nextState = withStartup(state, { ...state.startup, level: newLevel });
      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: cost } },
        data: {
          moneyBalance: { decrement: cost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup upgrade startup.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -cost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `startup_upgrade:lv${String(newLevel)}`,
        },
        tx,
      );

      return {
        startupName: state.startup.name,
        newLevel,
        maxEmployees: getStartupMaxEmployees(newLevel),
        costPaid: cost,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async claimDividend(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<StartupDividendResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (!state.startup) {
        throw new AppUserError("Kamu belum punya startup. Buat dulu lewat .buatstartup <nama>.");
      }
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < STARTUP_MIN_PLAYER_LEVEL) {
        throw new AppUserError(
          `Menarik dividen startup membutuhkan minimal *Level ${String(STARTUP_MIN_PLAYER_LEVEL)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan lewat *.levelup* dulu!`,
        );
      }

      const elapsed = Math.max(0, nowMs - state.startup.lastDividendAt);
      if (state.startup.lastDividendAt > 0 && elapsed < STARTUP_DIVIDEND_COOLDOWN_MS) {
        const waitMs = STARTUP_DIVIDEND_COOLDOWN_MS - elapsed;
        throw new AppUserError(
          `Dividen *${state.startup.name}* baru bisa ditarik lagi dalam ${formatRemainingDuration(waitMs)}.`,
        );
      }

      const basePayout = getStartupDividendPayout(state.startup.level, state.startup.employees);
      const grossPayout = applyPrestigeMoneyBoost(basePayout, state.prestige);
      const xpEarned = applyPrestigeXpBoost(80 + state.startup.level * 20, state.prestige);
      const seized = applyDebtCollectorSeizure(state, grossPayout, nowMs);
      const credit = clampMoneyCredit(profile.moneyBalance, seized.netIncome);

      let nextState = withStartup(seized.nextState, { ...state.startup, lastDividendAt: nowMs });
      nextState = withUpdatedCooldown(nextState, "startup_dividend", nowMs);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: credit },
          totalMoneyEarned: { increment: credit },
          experience: { increment: xpEarned },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (credit > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_EARN,
            amount: credit,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: `startup_dividend:${state.startup.name}`,
          },
          tx,
        );
      }

      return {
        startupName: state.startup.name,
        level: state.startup.level,
        employees: state.startup.employees,
        dividendGross: credit,
        xpEarned,
        debtSeized: seized.debtSeized,
        remainingDebt: seized.remainingDebt,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getLoanOverview(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<LoanOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const rank = resolveRank(profile.experience);
    const maxBorrowLimit = PINJOL_MAX_BY_RANK[rank];

    if (!state.loan) {
      return {
        active: false,
        principal: 0n,
        interest: 0n,
        totalDue: 0n,
        overdue: false,
        remainingMs: 0,
        rank,
        maxBorrowLimit,
        moneyBalance: profile.moneyBalance,
      };
    }

    const principal = BigInt(state.loan.principal);
    const interest = BigInt(state.loan.interest);
    const nowMs = now.getTime();
    const overdue = nowMs > state.loan.dueAt;

    return {
      active: true,
      principal,
      interest,
      totalDue: principal + interest,
      overdue,
      remainingMs: overdue ? 0 : state.loan.dueAt - nowMs,
      rank,
      maxBorrowLimit,
      moneyBalance: profile.moneyBalance,
    };
  }

  async borrowLoan(
    groupJid: string,
    userJid: string,
    amount: bigint,
    now: Date = new Date(),
  ): Promise<LoanActionResult> {
    if (amount < PINJOL_MIN_AMOUNT) {
      throw new AppUserError(`Minimal pinjaman adalah ${formatRupiah(PINJOL_MIN_AMOUNT)}.`);
    }

    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (state.loan) {
        throw new AppUserError(
          `Kamu masih punya tagihan pinjol sebesar ${formatRupiah(getLoanTotalDue(state))}. Lunasi dulu lewat .bayarutang!`,
        );
      }

      const rank = resolveRank(profile.experience);
      const maxLimit = PINJOL_MAX_BY_RANK[rank];
      if (amount > maxLimit) {
        throw new AppUserError(
          `Limit pinjaman untuk Rank *${rank}* maksimal ${formatRupiah(maxLimit)}.`,
        );
      }

      const interest = percentOfBigInt(amount, PINJOL_INTEREST_PERCENT);
      const dueAt = nowMs + PINJOL_DUE_MS;
      const credit = clampMoneyCredit(profile.moneyBalance, amount);
      const nextState = withLoan(state, {
        principal: amount.toString(),
        interest: interest.toString(),
        borrowedAt: nowMs,
        dueAt,
      });

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: credit },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.BANK_WITHDRAW,
          amount: credit,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `pinjol_borrow:${String(PINJOL_INTEREST_PERCENT)}pct`,
        },
        tx,
      );

      return {
        action: "borrow",
        amount: credit,
        totalDebtRemaining: amount + interest,
        dueAt,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async repayLoan(
    groupJid: string,
    userJid: string,
    amountOrAll: bigint | "all",
  ): Promise<LoanActionResult> {
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (!state.loan) {
        throw new AppUserError("Kamu tidak memiliki utang pinjol. Mantap, bebas utang!");
      }

      const totalDue = getLoanTotalDue(state);
      const desired =
        amountOrAll === "all"
          ? totalDue < profile.moneyBalance
            ? totalDue
            : profile.moneyBalance
          : amountOrAll < totalDue
            ? amountOrAll
            : totalDue;

      if (desired <= 0n) {
        throw new AppUserError("Dompetmu kosong, tidak bisa membayar utang saat ini.");
      }
      if (profile.moneyBalance < desired) {
        throw new AppUserError(
          `Saldo dompet tidak cukup! Dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const remaining = totalDue - desired;
      let nextState: MemberRpgState;
      if (remaining <= 0n) {
        nextState = withLoan(state, null);
      } else {
        const oldInterest = BigInt(state.loan.interest);
        const interestPaid = desired < oldInterest ? desired : oldInterest;
        const principalPaid = desired - interestPaid;
        nextState = withLoan(state, {
          ...state.loan,
          principal: (BigInt(state.loan.principal) - principalPaid).toString(),
          interest: (oldInterest - interestPaid).toString(),
        });
      }

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: desired } },
        data: {
          moneyBalance: { decrement: desired },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat membayar utang.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.BANK_DEPOSIT,
          amount: -desired,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: remaining <= 0n ? "pinjol_paid_full" : "pinjol_partial",
        },
        tx,
      );

      return {
        action: "repay",
        amount: desired,
        totalDebtRemaining: remaining,
        dueAt: state.loan.dueAt,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getInsuranceOverview(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<InsuranceOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const nowMs = now.getTime();

    return {
      items: INSURANCE_CATALOG.map((spec) => ({
        spec,
        remainingMs: Math.max(0, state.insurances[spec.id] - nowMs),
      })),
      jailRemainingMs: getRemainingJailMs(state, nowMs),
      ugdRemainingMs: getRemainingUgdMs(state, nowMs),
      moneyBalance: profile.moneyBalance,
    };
  }

  async buyInsurance(
    groupJid: string,
    userJid: string,
    rawType: string,
    now: Date = new Date(),
  ): Promise<{ spec: InsuranceSpec; expiresAt: number; currentMoney: bigint }> {
    const key = rawType.trim().toLowerCase() as InsuranceType;
    const spec = INSURANCE_MAP.get(key);
    if (!spec) {
      throw new AppUserError("Paket asuransi tersedia: brankas, bpjs, pengacara.");
    }

    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      if (profile.moneyBalance < spec.price) {
        throw new AppUserError(
          `Dompet tidak cukup! Harga *${spec.name}* = ${formatRupiah(spec.price)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      const baseStart = Math.max(nowMs, state.insurances[spec.id]);
      const expiresAt = baseStart + spec.durationMs;
      const nextState = withInsuranceUntil(state, spec.id, expiresAt);

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: spec.price } },
        data: {
          moneyBalance: { decrement: spec.price },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup membeli asuransi.");
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
          note: `buy_insurance:${spec.id}`,
        },
        tx,
      );

      return { spec, expiresAt, currentMoney: updated.moneyBalance };
    });
  }

  async releaseFromJail(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<ReleaseStatusResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (getRemainingJailMs(state, nowMs) <= 0) {
        throw new AppUserError("Kamu sedang tidak berada di dalam penjara.");
      }

      const hasLawyer = isInsuranceActive(state, "pengacara", nowMs);
      const cost = hasLawyer ? 0n : JAIL_BAIL_COST;
      const totalFunds = profile.moneyBalance + profile.bankBalance;
      if (cost > 0n && totalFunds < cost) {
        throw new AppUserError(
          `Uang tebusan penjara ${formatRupiah(cost)}, total saldo (Dompet ${formatRupiah(profile.moneyBalance)} + ATM ${formatRupiah(profile.bankBalance)}) hanya ${formatRupiah(totalFunds)}.`,
        );
      }

      const walletPaid =
        cost > 0n ? (profile.moneyBalance >= cost ? cost : profile.moneyBalance) : 0n;
      const bankPaid = cost - walletPaid;

      const nextState: MemberRpgState = { ...state, jailedUntil: 0 };
      if (cost > 0n) {
        const res = await tx.groupMemberProfile.updateMany({
          where: {
            id: profile.id,
            ...(walletPaid > 0n ? { moneyBalance: { gte: walletPaid } } : {}),
            ...(bankPaid > 0n ? { bankBalance: { gte: bankPaid } } : {}),
          },
          data: {
            ...(walletPaid > 0n ? { moneyBalance: { decrement: walletPaid } } : {}),
            ...(bankPaid > 0n ? { bankBalance: { decrement: bankPaid } } : {}),
            rpgState: serializeRpgState(nextState),
          },
        });
        if (res.count === 0) {
          throw new AppUserError("Saldo dompet/ATM tidak cukup membayar tebusan.");
        }
      } else {
        await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: { rpgState: serializeRpgState(nextState) },
        });
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      if (walletPaid > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -walletPaid,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: "jail_bail",
          },
          tx,
        );
      }
      if (bankPaid > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -bankPaid,
            balanceBefore: profile.bankBalance,
            balanceAfter: updated.bankBalance,
            correlationId,
            note: "jail_bail_bank_autodebit",
          },
          tx,
        );
      }

      return {
        kind: "jail",
        coveredByInsurance: hasLawyer,
        costPaid: cost,
        walletPaid,
        bankPaid,
        currentMoney: updated.moneyBalance,
        currentBank: updated.bankBalance,
      };
    });
  }

  async releaseFromUgd(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<ReleaseStatusResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (getRemainingUgdMs(state, nowMs) <= 0) {
        throw new AppUserError("Kamu sedang sehat dan tidak dirawat di UGD.");
      }

      const hasBpjs = isInsuranceActive(state, "bpjs", nowMs);
      const cost = hasBpjs ? 0n : UGD_VIP_RELEASE_COST;
      const totalFunds = profile.moneyBalance + profile.bankBalance;
      if (cost > 0n && totalFunds < cost) {
        throw new AppUserError(
          `Biaya rawat VIP keluar UGD ${formatRupiah(cost)}, total saldo (Dompet ${formatRupiah(profile.moneyBalance)} + ATM ${formatRupiah(profile.bankBalance)}) hanya ${formatRupiah(totalFunds)}.`,
        );
      }

      const walletPaid =
        cost > 0n ? (profile.moneyBalance >= cost ? cost : profile.moneyBalance) : 0n;
      const bankPaid = cost - walletPaid;

      const nextState: MemberRpgState = withHp({ ...state, ugdUntil: 0 }, MAX_PLAYER_HP);
      if (cost > 0n) {
        const res = await tx.groupMemberProfile.updateMany({
          where: {
            id: profile.id,
            ...(walletPaid > 0n ? { moneyBalance: { gte: walletPaid } } : {}),
            ...(bankPaid > 0n ? { bankBalance: { gte: bankPaid } } : {}),
          },
          data: {
            ...(walletPaid > 0n ? { moneyBalance: { decrement: walletPaid } } : {}),
            ...(bankPaid > 0n ? { bankBalance: { decrement: bankPaid } } : {}),
            rpgState: serializeRpgState(nextState),
          },
        });
        if (res.count === 0) {
          throw new AppUserError("Saldo dompet/ATM tidak cukup membayar biaya UGD VIP.");
        }
      } else {
        await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: { rpgState: serializeRpgState(nextState) },
        });
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      if (walletPaid > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -walletPaid,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: "ugd_vip_release",
          },
          tx,
        );
      }
      if (bankPaid > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -bankPaid,
            balanceBefore: profile.bankBalance,
            balanceAfter: updated.bankBalance,
            correlationId,
            note: "ugd_vip_release_bank_autodebit",
          },
          tx,
        );
      }

      return {
        kind: "ugd",
        coveredByInsurance: hasBpjs,
        costPaid: cost,
        walletPaid,
        bankPaid,
        currentMoney: updated.moneyBalance,
        currentBank: updated.bankBalance,
      };
    });
  }

  async getPrestigeOverview(groupJid: string, userJid: string): Promise<PrestigeOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    return {
      prestige: state.prestige,
      maxPrestige: PRESTIGE_MAX_LEVEL,
      currentBoostPercent: state.prestige * PRESTIGE_BONUS_PERCENT_PER_STAR,
      playerLevel: Math.max(1, profile.level),
      minLevelRequired: PRESTIGE_MIN_PLAYER_LEVEL,
      nextCost: state.prestige < PRESTIGE_MAX_LEVEL ? getPrestigeCost(state.prestige) : null,
      moneyBalance: profile.moneyBalance,
    };
  }

  async performRebirth(groupJid: string, userJid: string): Promise<RebirthResult> {
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (state.prestige >= PRESTIGE_MAX_LEVEL) {
        throw new AppUserError(
          `Kamu sudah mencapai Prestige tertinggi (★${String(PRESTIGE_MAX_LEVEL)})!`,
        );
      }
      if (profile.level < PRESTIGE_MIN_PLAYER_LEVEL) {
        throw new AppUserError(
          `Syarat .rebirth minimal Level ${String(PRESTIGE_MIN_PLAYER_LEVEL)} (levelmu saat ini Lv.${String(profile.level)}).`,
        );
      }

      const cost = getPrestigeCost(state.prestige);
      if (profile.moneyBalance < cost) {
        throw new AppUserError(
          `Biaya Rebirth ke Prestige ★${String(state.prestige + 1)} adalah ${formatRupiah(cost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const newPrestige = state.prestige + 1;
      const nextState = withPrestige(state, newPrestige);

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: cost } },
        data: {
          moneyBalance: { decrement: cost },
          limitBalance: { increment: PRESTIGE_REWARD_LIMIT },
          totalLimitsEarned: { increment: PRESTIGE_REWARD_LIMIT },
          pointsBalance: { increment: PRESTIGE_REWARD_POINTS },
          totalPointsEarned: { increment: PRESTIGE_REWARD_POINTS },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk melakukan Rebirth.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -cost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `rebirth:prestige_${String(newPrestige)}`,
        },
        tx,
      );

      return {
        newPrestige,
        newBoostPercent: newPrestige * PRESTIGE_BONUS_PERCENT_PER_STAR,
        costPaid: cost,
        limitBonus: PRESTIGE_REWARD_LIMIT,
        pointsBonus: PRESTIGE_REWARD_POINTS,
        currentMoney: updated.moneyBalance,
        currentLimit: updated.limitBalance,
      };
    });
  }

  async listTopPrestige(groupJid: string, limit = 10): Promise<TopPrestigeEntry[]> {
    const profiles = await this.db.groupMemberProfile.findMany({ where: { groupJid } });
    return profiles
      .map((p) => {
        const state = parseRpgState(p.rpgState);
        return {
          userJid: p.userJid,
          prestige: state.prestige,
          level: Math.max(1, p.level),
          netCash: p.moneyBalance + p.bankBalance,
        };
      })
      .filter((e) => e.prestige > 0)
      .sort((a, b) => {
        if (b.prestige !== a.prestige) return b.prestige - a.prestige;
        return b.level - a.level;
      })
      .slice(0, limit);
  }

  async listTopStartups(groupJid: string, limit = 10): Promise<TopStartupEntry[]> {
    const profiles = await this.db.groupMemberProfile.findMany({ where: { groupJid } });
    const rows: TopStartupEntry[] = [];
    for (const p of profiles) {
      const state = parseRpgState(p.rpgState);
      if (!state.startup) continue;
      rows.push({
        userJid: p.userJid,
        startupName: state.startup.name,
        level: state.startup.level,
        employees: state.startup.employees,
        valuation: getStartupValuation(state.startup.level, state.startup.employees),
      });
    }
    return rows
      .sort((a, b) => (b.valuation > a.valuation ? 1 : b.valuation < a.valuation ? -1 : 0))
      .slice(0, limit);
  }

  async getAssetSummary(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<AssetSummary> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const pf = await this.expansionService.getFullPortfolio(groupJid, userJid, now);
    const startupValuation = state.startup
      ? getStartupValuation(state.startup.level, state.startup.employees)
      : 0n;
    const loanDebt = getLoanTotalDue(state);
    const grossAssets = pf.netWorth + startupValuation;
    const netWorth = grossAssets > loanDebt ? grossAssets - loanDebt : 0n;
    const wealthPosition = await this.profileRepo.getPositionByWealth(groupJid, userJid);

    return {
      userJid,
      customTitle: state.customTitle,
      rank: resolveRank(profile.experience),
      level: Math.max(1, profile.level),
      prestige: state.prestige,
      moneyBalance: pf.moneyBalance,
      bankBalance: pf.bankBalance,
      depositoValue: pf.depositoValue,
      stocksValue: pf.totalStocksValue,
      cryptoValue: pf.totalCryptoValue,
      propertyValue: pf.totalPropertyValue,
      startupName: state.startup?.name ?? null,
      startupValuation,
      loanDebt,
      grossAssets,
      netWorth,
      wealthPosition,
    };
  }
}

export const careerPrestigeService = new CareerPrestigeService();
