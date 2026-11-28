import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupClan,
  type GroupMemberProfile,
  type TenantGroup,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupClanRepository } from "../../repositories/groupClan.repository";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import {
  readGroupEventSection,
  writeGroupEventSection,
  type GroupEventTenantClient,
} from "../group/groupEventState.store";
import {
  parsePersistedXpEvent,
  setCachedGroupXpEvent,
  type ActiveGroupXpEvent,
} from "../group/groupXpEvent.cache";
import { generateCorrelationId } from "../member/memberEconomy.service";
import {
  PROFILE_THEME_CATALOG,
  PROFILE_THEME_MAP,
  type ProfileThemeId,
  type ProfileThemeSpec,
} from "../member/profileThemes";
import { DEFAULT_GROUP_TREASURY } from "./rpgEconomy.service";
import {
  parseRpgState,
  serializeRpgState,
  withProfileTheme,
} from "./rpgState";

export const XP_EVENT_MIN_DURATION_MS = 10 * 60 * 1000;
export const XP_EVENT_DEFAULT_DURATION_MS = 60 * 60 * 1000;
export const XP_EVENT_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export interface GroupEconomyReport {
  groupJid: string;
  treasuryBalance: bigint;
  totalMembers: number;
  activeMembers7d: number;
  totalWallet: bigint;
  totalBank: bigint;
  totalDeposito: bigint;
  totalClanTreasury: bigint;
  totalMoneySupply: bigint;
  totalLoanDebt: bigint;
  totalPoints: number;
  totalLimits: number;
  averageWealth: bigint;
  medianWealth: bigint;
  top3Holders: { userJid: string; wealth: bigint }[];
  top3ConcentrationPercent: number;
  inflow24h: bigint;
  outflow24h: bigint;
  netFlow24h: bigint;
  txCount24h: number;
  healthStatus: string;
  recommendations: string[];
  activeXpEvent: ActiveGroupXpEvent | null;
}

export interface ProfileThemesOverview {
  activeTheme: ProfileThemeId;
  ownedThemes: ProfileThemeId[];
  moneyBalance: bigint;
  items: {
    spec: ProfileThemeSpec;
    owned: boolean;
    equipped: boolean;
  }[];
}

export interface BuyThemeResult {
  spec: ProfileThemeSpec;
  pricePaid: bigint;
  currentMoney: bigint;
}

export interface EquipThemeResult {
  spec: ProfileThemeSpec;
}

interface EconomyProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  listAllByGroup(groupJid: string): Promise<GroupMemberProfile[]>;
}

interface EconomyTxStore {
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
  listMoneyTransactionsSince(
    groupJid: string,
    since: Date,
  ): Promise<{ asset: MemberTransactionAsset; type: MemberTransactionType; amount: bigint }[]>;
}

interface EconomyTenantStore {
  findByGroupJid(groupJid: string): Promise<TenantGroup | null>;
}

interface EconomyClanStore {
  listByGroup(groupJid: string): Promise<GroupClan[]>;
}

interface EconomyTx {
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

interface EconomyDb {
  $transaction<T>(fn: (tx: EconomyTx) => Promise<T>): Promise<T>;
  tenantGroup?: GroupEventTenantClient;
}

export function parseXpEventDurationMs(raw: string | undefined): number | null {
  if (!raw) return XP_EVENT_DEFAULT_DURATION_MS;
  const cleaned = raw.trim().toLowerCase();
  const match = /^(\d+)(m|menit|min|j|jam|h|hr)?$/.exec(cleaned);
  if (!match) return null;
  const num = Number.parseInt(match[1] ?? "0", 10);
  if (!Number.isInteger(num) || num <= 0) return null;
  const unit = match[2] ?? "m";
  const ms =
    unit === "j" || unit === "jam" || unit === "h" || unit === "hr"
      ? num * 60 * 60 * 1000
      : num * 60 * 1000;
  return ms;
}

export function parseXpEventMultiplier(raw: string | undefined): number | null {
  if (!raw) return 2;
  const cleaned = raw.trim().toLowerCase().replace(/x$/i, "");
  if (cleaned === "2") return 2;
  if (cleaned === "3") return 3;
  return null;
}

export class GroupEconomyControlService {
  constructor(
    private readonly profileRepo: EconomyProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: EconomyTxStore = new GroupMemberTransactionRepository(),
    private readonly tenantRepo: EconomyTenantStore = new TenantGroupRepository(),
    private readonly clanRepo: EconomyClanStore = new GroupClanRepository(),
    private readonly db: EconomyDb = prisma,
  ) {}

  // ==================== 1. DASHBOARD EKONOMI & INFLASI GRUP ====================

  async getGroupEconomyReport(
    groupJid: string,
    now: Date = new Date(),
  ): Promise<GroupEconomyReport> {
    const nowMs = now.getTime();
    const since24h = new Date(nowMs - 24 * 60 * 60 * 1000);
    const since7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;

    const [tenant, profiles, clans, txs24h, activeXpEvent] = await Promise.all([
      this.tenantRepo.findByGroupJid(groupJid),
      this.profileRepo.listAllByGroup(groupJid),
      this.clanRepo.listByGroup(groupJid),
      this.txRepo.listMoneyTransactionsSince(groupJid, since24h),
      this.getXpEventStatus(groupJid, now),
    ]);

    const treasuryBalance = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
    let totalWallet = 0n;
    let totalBank = 0n;
    let totalDeposito = 0n;
    let totalLoanDebt = 0n;
    let totalPoints = 0;
    let totalLimits = 0;
    let activeMembers7d = 0;

    const wealthEntries: { userJid: string; wealth: bigint }[] = [];

    for (const p of profiles) {
      const state = parseRpgState(p.rpgState);
      const dep = state.deposito ? BigInt(state.deposito.principal) : 0n;
      const debt = state.loan
        ? BigInt(state.loan.principal) + BigInt(state.loan.interest)
        : 0n;

      totalWallet += p.moneyBalance;
      totalBank += p.bankBalance;
      totalDeposito += dep;
      totalLoanDebt += debt;
      totalPoints += p.pointsBalance;
      totalLimits += p.limitBalance;

      if (p.lastActiveAt.getTime() >= since7dMs) {
        activeMembers7d += 1;
      }

      wealthEntries.push({
        userJid: p.userJid,
        wealth: p.moneyBalance + p.bankBalance + dep,
      });
    }

    let totalClanTreasury = 0n;
    for (const c of clans) {
      totalClanTreasury += c.treasuryBalance;
    }

    const totalMoneySupply = totalWallet + totalBank + totalDeposito + totalClanTreasury;

    wealthEntries.sort((a, b) => (b.wealth > a.wealth ? 1 : b.wealth < a.wealth ? -1 : 0));
    const top3Holders = wealthEntries.slice(0, 3);
    const top3Sum = top3Holders.reduce((acc, item) => acc + item.wealth, 0n);
    const top3ConcentrationPercent =
      totalMoneySupply > 0n
        ? Math.min(100, Math.round(Number((top3Sum * 1000n) / totalMoneySupply) / 10))
        : 0;

    const memberCount = profiles.length;
    const memberTotalWealth = totalWallet + totalBank + totalDeposito;
    const averageWealth = memberCount > 0 ? memberTotalWealth / BigInt(memberCount) : 0n;

    let medianWealth = 0n;
    if (wealthEntries.length > 0) {
      const mid = Math.floor(wealthEntries.length / 2);
      if (wealthEntries.length % 2 === 1) {
        medianWealth = wealthEntries[mid]?.wealth ?? 0n;
      } else {
        const left = wealthEntries[mid - 1]?.wealth ?? 0n;
        const right = wealthEntries[mid]?.wealth ?? 0n;
        medianWealth = (left + right) / 2n;
      }
    }

    let inflow24h = 0n;
    let outflow24h = 0n;
    let txCount24h = 0;

    for (const tx of txs24h) {
      // Abaikan transfer internal dompet <-> bank agar tidak mendistorsi arus masuk/keluar
      if (
        tx.type === MemberTransactionType.BANK_DEPOSIT ||
        tx.type === MemberTransactionType.BANK_WITHDRAW
      ) {
        continue;
      }
      txCount24h += 1;
      if (tx.amount > 0n) {
        inflow24h += tx.amount;
      } else if (tx.amount < 0n) {
        outflow24h += -tx.amount;
      }
    }

    const netFlow24h = inflow24h - outflow24h;
    let healthStatus = "SEHAT & TERKENDALI";
    const recommendations: string[] = [];

    if (inflow24h === 0n && outflow24h === 0n) {
      healthStatus = "TENANG (Minim Transaksi 24j)";
      recommendations.push("Aktifkan *.eventxp 1j* untuk memancing aktivitas member grup.");
    } else if (netFlow24h <= 0n) {
      healthStatus = "DEFLASI / SINK KUAT (Sangat Sehat)";
      recommendations.push("Peredaran uang terkendali baik. Bisa cairkan bansos/event berkala.");
    } else if (outflow24h === 0n || inflow24h * 10n >= outflow24h * 50n) {
      healthStatus = "INFLASI TINGGI (Waspada)";
      recommendations.push(
        "Uang masuk jauh lebih besar dari money sink! Pertimbangkan *.pajaktop 10* atau dorong belanja *.temaprofil*, *.telurpet*, & *.rebirth*.",
      );
    } else if (inflow24h * 10n > outflow24h * 25n) {
      healthStatus = "WASPADA INFLASI";
      recommendations.push(
        "Arus masuk mulai tinggi. Ajak member koleksi *.temaprofil*, *.petshop*, & upgrade *.gengupgrade*.",
      );
    } else {
      healthStatus = "SEHAT & TERKENDALI";
      recommendations.push("Rasio cetak uang dan money sink seimbang.");
    }

    if (top3ConcentrationPercent >= 65 && memberCount >= 5) {
      recommendations.push(
        `Konsentrasi Top 3 mencapai ${String(top3ConcentrationPercent)}%. Gunakan *.pajaktop* untuk pemerataan ke Kas Negara.`,
      );
    }

    return {
      groupJid,
      treasuryBalance,
      totalMembers: memberCount,
      activeMembers7d,
      totalWallet,
      totalBank,
      totalDeposito,
      totalClanTreasury,
      totalMoneySupply,
      totalLoanDebt,
      totalPoints,
      totalLimits,
      averageWealth,
      medianWealth,
      top3Holders,
      top3ConcentrationPercent,
      inflow24h,
      outflow24h,
      netFlow24h,
      txCount24h,
      healthStatus,
      recommendations,
      activeXpEvent,
    };
  }

  // ==================== 2. TOKO TEMA VISUAL (.temaprofil) ====================

  async getProfileThemesOverview(
    groupJid: string,
    userJid: string,
  ): Promise<ProfileThemesOverview> {
    const normUser = normalizeUserJid(userJid);
    const profile = await this.profileRepo.findOrCreate(groupJid, normUser);
    const state = parseRpgState(profile.rpgState);
    const ownedSet = new Set<ProfileThemeId>(state.ownedThemes);

    return {
      activeTheme: state.profileTheme,
      ownedThemes: [...state.ownedThemes],
      moneyBalance: profile.moneyBalance,
      items: PROFILE_THEME_CATALOG.map((spec) => ({
        spec,
        owned: ownedSet.has(spec.id),
        equipped: state.profileTheme === spec.id,
      })),
    };
  }

  async buyProfileTheme(
    groupJid: string,
    userJid: string,
    themeId: ProfileThemeId,
  ): Promise<BuyThemeResult> {
    const spec = PROFILE_THEME_MAP.get(themeId);
    if (!spec) {
      throw new AppUserError("Kode tema tidak dikenal. Ketik *.temaprofil* untuk melihat daftar tema.");
    }
    if (spec.price <= 0n) {
      throw new AppUserError(
        `Tema *${spec.name}* gratis bawaan! Pasang langsung dengan *.temaprofil pakai ${spec.id}*.`,
      );
    }

    const normUser = normalizeUserJid(userJid);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);

      if (state.ownedThemes.includes(themeId)) {
        throw new AppUserError(
          `Kamu sudah memiliki tema *${spec.name}*! Pasang kapan saja lewat *.temaprofil pakai ${spec.id}*.`,
        );
      }
      if (profile.moneyBalance < spec.price) {
        throw new AppUserError(
          `Dompetmu kurang! Harga tema *${spec.name}* = ${formatRupiah(spec.price)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withProfileTheme(state, themeId);
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: spec.price } },
        data: {
          moneyBalance: { decrement: spec.price },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat membeli tema profil.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -spec.price,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `buy_theme:${spec.id}`,
        },
        tx,
      );

      return {
        spec,
        pricePaid: spec.price,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async equipProfileTheme(
    groupJid: string,
    userJid: string,
    themeId: ProfileThemeId,
  ): Promise<EquipThemeResult> {
    const spec = PROFILE_THEME_MAP.get(themeId);
    if (!spec) {
      throw new AppUserError("Kode tema tidak dikenal. Ketik *.temaprofil* untuk melihat daftar.");
    }

    const normUser = normalizeUserJid(userJid);
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);

      if (!state.ownedThemes.includes(themeId)) {
        throw new AppUserError(
          `Kamu belum memiliki tema *${spec.name}* (${formatRupiah(spec.price)}). Beli dulu dengan *.temaprofil beli ${spec.id}*!`,
        );
      }

      const nextState = withProfileTheme(state, themeId);
      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return { spec };
    });
  }

  // ==================== 3. HAPPY HOUR DOUBLE XP (.eventxp) ====================

  async getXpEventStatus(
    groupJid: string,
    now: Date = new Date(),
  ): Promise<ActiveGroupXpEvent | null> {
    const nowMs = now.getTime();
    const raw = await readGroupEventSection(this.db.tenantGroup, groupJid, "xpEvent");
    const parsed = parsePersistedXpEvent(groupJid, raw);
    if (!parsed || parsed.endsAt <= nowMs) {
      setCachedGroupXpEvent(groupJid, null);
      if (parsed && parsed.endsAt <= nowMs) {
        await writeGroupEventSection(this.db.tenantGroup, groupJid, "xpEvent", null);
      }
      return null;
    }
    setCachedGroupXpEvent(groupJid, parsed);
    return parsed;
  }

  async startXpEvent(
    groupJid: string,
    actorJid: string,
    durationMs: number = XP_EVENT_DEFAULT_DURATION_MS,
    multiplier = 2,
    now: Date = new Date(),
  ): Promise<ActiveGroupXpEvent> {
    if (durationMs < XP_EVENT_MIN_DURATION_MS || durationMs > XP_EVENT_MAX_DURATION_MS) {
      throw new AppUserError("Durasi Event XP harus antara *10 menit* sampai *6 jam* (contoh: 30m, 1j, 2j).");
    }
    if (multiplier !== 2 && multiplier !== 3) {
      throw new AppUserError("Pengali Event XP yang didukung hanya *2x* atau *3x*.");
    }

    const nowMs = now.getTime();
    const normActor = normalizeUserJid(actorJid);
    const event: ActiveGroupXpEvent = {
      groupJid,
      multiplier,
      startedByJid: normActor,
      startedAt: nowMs,
      endsAt: nowMs + durationMs,
      label: `Happy Hour ${String(multiplier)}x XP`,
    };

    await writeGroupEventSection(this.db.tenantGroup, groupJid, "xpEvent", {
      multiplier: event.multiplier,
      startedByJid: event.startedByJid,
      startedAt: event.startedAt,
      endsAt: event.endsAt,
      label: event.label,
    });
    setCachedGroupXpEvent(groupJid, event);
    return event;
  }

  async stopXpEvent(groupJid: string): Promise<void> {
    await writeGroupEventSection(this.db.tenantGroup, groupJid, "xpEvent", null);
    setCachedGroupXpEvent(groupJid, null);
  }
}

export const groupEconomyControlService = new GroupEconomyControlService();
