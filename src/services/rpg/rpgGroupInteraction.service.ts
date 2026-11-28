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
  maxBigInt,
  minBigInt,
  percentOfBigInt,
  scaleMoneyByLevel,
} from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import { calculatePlayerCombatPower } from "./rpgInfinite.service";
import {
  getRemainingCooldownMs,
  getRemainingUgdMs,
  parseRpgState,
  serializeRpgState,
  withCrateDelta,
  withHp,
  withToolState,
  withUgdUntil,
  withUpdatedCooldown,
  type CrateType,
} from "./rpgState";

export const BUSINESS_CAPITAL_PER_PERSON = 2_000_000n;
const BUSINESS_COOLDOWN_MS = 60 * 60 * 1000;
const ATTACK_COOLDOWN_MS = 30 * 60 * 1000;
const UGD_DURATION_MS = 15 * 60 * 1000;
const UGD_STABILIZED_HP = 30;
const ATTACK_MIN_TARGET_WALLET = 1_000_000n;
const ATTACK_MAX_LOOT = 40_000_000n;
const DUNGEON_LOBBY_TTL_MS = 10 * 60 * 1000;
const DUNGEON_COOLDOWN_MS = 40 * 60 * 1000;
const MAX_DUNGEON_LOBBIES = 100;
const MAX_DUNGEON_PLAYERS = 4;

const BUSINESS_VENTURES = [
  "Kafe Kopi Kekinian & Roastery",
  "Ekspor Keripik Pedas Sultan",
  "Studio Game & Top-Up Voucher",
  "Proyek Villa Glamping Puncak",
  "Franchise Dimsum 24 Jam",
] as const;

const DUNGEON_BOSSES = [
  "Raja Lich Menara Hitam",
  "Kraken Lautan Dalam",
  "Golem Obsidian Raksasa",
  "Kaisar Iblis Kawah Merah",
] as const;

export interface GroupBusinessResult {
  ventureName: string;
  profitable: boolean;
  participants: string[];
  capitalPerPerson: bigint;
  netDeltaPerPerson: bigint;
  xpGained: number;
}

export interface DungeonLobby {
  groupJid: string;
  hostJid: string;
  players: string[];
  createdAt: number;
  expiresAt: number;
}

export interface DungeonRunResult {
  bossName: string;
  won: boolean;
  teamPower: number;
  bossPower: number;
  members: {
    userJid: string;
    moneyGained: bigint;
    xpGained: number;
    hpLost: number;
    hpAfter: number;
    crateGained: CrateType | null;
  }[];
}

export interface AttackPlayerResult {
  success: boolean;
  attackerJid: string;
  targetJid: string;
  attackerPower: number;
  defenderPower: number;
  damageDealt: number;
  targetHpAfter: number;
  attackerHpAfter: number;
  sentToUgd: boolean;
  ugdMinutes: number;
  moneyLooted: bigint;
  attackerMoney: bigint;
  targetMoney: bigint;
}

interface GroupRpgProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
}

interface GroupRpgTxStore {
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

interface GroupRpgTx {
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

interface GroupRpgDb {
  $transaction<T>(fn: (tx: GroupRpgTx) => Promise<T>): Promise<T>;
}

export class RpgGroupInteractionService {
  private readonly dungeonLobbies = new Map<string, DungeonLobby>();

  constructor(
    private readonly profileRepo: GroupRpgProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: GroupRpgTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: GroupRpgDb = prisma,
  ) {}

  // ---- 1. .berbisnis @tag1 [@tag2] [@tag3] ----

  async runGroupBusiness(
    groupJid: string,
    initiatorJid: string,
    rawPartnerJids: string[],
    now: Date = new Date(),
  ): Promise<GroupBusinessResult> {
    const normInit = normalizeUserJid(initiatorJid);
    const uniquePartners: string[] = [];
    for (const raw of rawPartnerJids) {
      const norm = normalizeUserJid(raw);
      if (norm && norm !== normInit && !uniquePartners.includes(norm)) {
        uniquePartners.push(norm);
      }
    }

    if (uniquePartners.length === 0 || uniquePartners.length > 3) {
      throw new AppUserError(
        "Tag 1 sampai 3 teman grup untuk patungan bisnis!\nContoh: .berbisnis @teman1 @teman2",
      );
    }

    const participants = [normInit, ...uniquePartners];
    const nowMs = now.getTime();
    const profitable = this.random.chance(0.75);
    const ventureName =
      BUSINESS_VENTURES[this.random.intBetween(0, BUSINESS_VENTURES.length - 1)] ??
      BUSINESS_VENTURES[0];
    const baseProfit = BigInt(this.random.intBetween(2_400_000, 7_200_000));
    const synergyBasis = BigInt(100 + uniquePartners.length * 25); // +25% per rekan bisnis!
    const profitEach = (baseProfit * synergyBasis) / 100n;
    const lossEach = percentOfBigInt(BUSINESS_CAPITAL_PER_PERSON, 30); // Rp 600.000 jika rugi
    const xpGained = profitable ? 120 + uniquePartners.length * 25 : 45;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profiles: GroupMemberProfile[] = [];
      for (const jid of participants) {
        const p = await this.profileRepo.findOrCreate(groupJid, jid, tx);
        profiles.push(p);
      }

      const initProfile = profiles[0];
      if (!initProfile) {
        throw new AppUserError("Profil inisiator bisnis tidak ditemukan.");
      }

      const initState = parseRpgState(initProfile.rpgState);
      const cdRem = getRemainingCooldownMs(initState, "berbisnis", BUSINESS_COOLDOWN_MS, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Tim bisnismu sedang evaluasi laporan! Bisa .berbisnis lagi dalam *${formatRemainingDuration(cdRem)}*.`,
        );
      }

      for (const p of profiles) {
        if (p.moneyBalance < BUSINESS_CAPITAL_PER_PERSON) {
          const phone = p.userJid.split("@")[0] ?? p.userJid;
          throw new AppUserError(
            `Dompet @${phone} belum cukup untuk modal patungan (${formatRupiah(BUSINESS_CAPITAL_PER_PERSON)}).`,
          );
        }
      }

      const nextInitState = withUpdatedCooldown(initState, "berbisnis", nowMs);

      for (let i = 0; i < profiles.length; i += 1) {
        const p = profiles[i];
        if (!p) continue;
        const isInit = i === 0;

        if (profitable) {
          const gained = clampMoneyCredit(p.moneyBalance, profitEach);
          const updated = await tx.groupMemberProfile.update({
            where: { id: p.id },
            data: {
              moneyBalance: { increment: gained },
              totalMoneyEarned: { increment: gained },
              experience: { increment: xpGained },
              ...(isInit ? { rpgState: serializeRpgState(nextInitState) } : {}),
            },
          });

          await this.txRepo.create(
            {
              profileId: p.id,
              groupJid,
              userJid: p.userJid,
              actorJid: normInit,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_EARN,
              amount: gained,
              balanceBefore: p.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: "berbisnis_profit",
            },
            tx,
          );
        } else {
          const debitRes = await tx.groupMemberProfile.updateMany({
            where: { id: p.id, moneyBalance: { gte: lossEach } },
            data: {
              moneyBalance: { decrement: lossEach },
              experience: { increment: xpGained },
              ...(isInit ? { rpgState: serializeRpgState(nextInitState) } : {}),
            },
          });
          if (debitRes.count === 0) {
            throw new AppUserError("Saldo salah satu partner berubah saat memproses bisnis.");
          }
          const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: p.id } });

          await this.txRepo.create(
            {
              profileId: p.id,
              groupJid,
              userJid: p.userJid,
              actorJid: normInit,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_LOSS,
              amount: -lossEach,
              balanceBefore: p.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: "berbisnis_loss",
            },
            tx,
          );
        }
      }

      return {
        ventureName,
        profitable,
        participants,
        capitalPerPerson: BUSINESS_CAPITAL_PER_PERSON,
        netDeltaPerPerson: profitable ? profitEach : -lossEach,
        xpGained,
      };
    });
  }

  // ---- 2. .dungeon [join|mulai|batal] (Co-Op 1-4 Pemain) ----

  getDungeonLobby(groupJid: string, nowMs = Date.now()): DungeonLobby | null {
    this.sweepExpiredLobbies(nowMs);
    return this.dungeonLobbies.get(groupJid) ?? null;
  }

  async createOrInspectDungeonLobby(
    groupJid: string,
    userJid: string,
    nowMs = Date.now(),
  ): Promise<{ created: boolean; lobby: DungeonLobby }> {
    this.sweepExpiredLobbies(nowMs);
    const existing = this.dungeonLobbies.get(groupJid);
    if (existing) {
      return { created: false, lobby: existing };
    }

    const normUser = normalizeUserJid(userJid);
    await this.assertReadyForDungeon(groupJid, normUser, nowMs);

    if (this.dungeonLobbies.size >= MAX_DUNGEON_LOBBIES) {
      const oldestKey = this.dungeonLobbies.keys().next().value;
      if (oldestKey) {
        this.dungeonLobbies.delete(oldestKey);
      }
    }

    const lobby: DungeonLobby = {
      groupJid,
      hostJid: normUser,
      players: [normUser],
      createdAt: nowMs,
      expiresAt: nowMs + DUNGEON_LOBBY_TTL_MS,
    };
    this.dungeonLobbies.set(groupJid, lobby);
    return { created: true, lobby };
  }

  async joinDungeonLobby(
    groupJid: string,
    userJid: string,
    nowMs = Date.now(),
  ): Promise<DungeonLobby> {
    this.sweepExpiredLobbies(nowMs);
    const lobby = this.dungeonLobbies.get(groupJid);
    if (!lobby) {
      throw new AppUserError("Belum ada lobby dungeon di grup ini. Ketik *.dungeon* untuk membuat!");
    }

    const normUser = normalizeUserJid(userJid);
    if (lobby.players.includes(normUser)) {
      throw new AppUserError("Kamu sudah masuk di lobby dungeon ini.");
    }
    if (lobby.players.length >= MAX_DUNGEON_PLAYERS) {
      throw new AppUserError(
        `Lobby dungeon sudah penuh (${String(MAX_DUNGEON_PLAYERS)}/${String(MAX_DUNGEON_PLAYERS)} pemain).`,
      );
    }

    await this.assertReadyForDungeon(groupJid, normUser, nowMs);
    lobby.players.push(normUser);
    return lobby;
  }

  cancelDungeonLobby(groupJid: string, actorJid: string, nowMs = Date.now()): void {
    this.sweepExpiredLobbies(nowMs);
    const lobby = this.dungeonLobbies.get(groupJid);
    if (!lobby) {
      throw new AppUserError("Tidak ada lobby dungeon yang aktif di grup ini.");
    }

    const normActor = normalizeUserJid(actorJid);
    if (lobby.hostJid !== normActor) {
      const idx = lobby.players.indexOf(normActor);
      if (idx > 0) {
        lobby.players.splice(idx, 1);
        return;
      }
      throw new AppUserError("Hanya pembuat lobby yang bisa membatalkan dungeon.");
    }

    this.dungeonLobbies.delete(groupJid);
  }

  async startDungeonRaid(
    groupJid: string,
    actorJid: string,
    now: Date = new Date(),
  ): Promise<DungeonRunResult> {
    const nowMs = now.getTime();
    this.sweepExpiredLobbies(nowMs);
    const lobby = this.dungeonLobbies.get(groupJid);
    if (!lobby) {
      throw new AppUserError("Belum ada lobby dungeon! Ketik *.dungeon* untuk membuat lobby.");
    }

    const normActor = normalizeUserJid(actorJid);
    if (lobby.hostJid !== normActor) {
      throw new AppUserError("Hanya host pembuat lobby yang bisa menjalankan *.dungeon mulai*.");
    }

    this.dungeonLobbies.delete(groupJid);
    const bossName =
      DUNGEON_BOSSES[this.random.intBetween(0, DUNGEON_BOSSES.length - 1)] ?? DUNGEON_BOSSES[0];
    const teamSize = lobby.players.length;
    const bossPower = 55 + teamSize * 45 + this.random.intBetween(0, 40);
    const baseLootEach = BigInt(this.random.intBetween(13_200_000, 33_000_000));
    const teamBonusBasis = BigInt(100 + (teamSize - 1) * 20);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const loaded: { profile: GroupMemberProfile; state: ReturnType<typeof parseRpgState> }[] = [];
      let teamPower = 0;

      for (const jid of lobby.players) {
        const profile = await this.profileRepo.findOrCreate(groupJid, jid, tx);
        const state = parseRpgState(profile.rpgState);
        teamPower += calculatePlayerCombatPower(profile.level, state) + this.random.intBetween(10, 35);
        loaded.push({ profile, state });
      }

      const won = teamPower >= bossPower;
      const members: DungeonRunResult["members"] = [];

      for (const { profile, state } of loaded) {
        const armorRed = Math.min(18, state.tools.armor.level * 2);
        const rawDmg = won ? 18 : 34;
        const hpLost = Math.max(5, rawDmg - armorRed);
        const hpAfter = Math.max(0, state.hp - hpLost);
        let nextState = withUpdatedCooldown(withHp(state, hpAfter), "dungeon", nowMs);

        let moneyGained = 0n;
        let xpGained = 60;
        let crateGained: CrateType | null = null;

        if (won) {
          const boosted = (baseLootEach * teamBonusBasis) / 100n;
          moneyGained = clampMoneyCredit(
            profile.moneyBalance,
            scaleMoneyByLevel(boosted, profile.level),
          );
          xpGained = 250 + teamSize * 40;
          crateGained = teamSize >= 3 ? "mythic" : "uncommon";
          nextState = withCrateDelta(nextState, crateGained, 1);
        }

        const updated = await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            ...(moneyGained > 0n
              ? {
                  moneyBalance: { increment: moneyGained },
                  totalMoneyEarned: { increment: moneyGained },
                }
              : {}),
            experience: { increment: xpGained },
            rpgState: serializeRpgState(nextState),
          },
        });

        if (moneyGained > 0n) {
          await this.txRepo.create(
            {
              profileId: profile.id,
              groupJid,
              userJid: profile.userJid,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_EARN,
              amount: moneyGained,
              balanceBefore: profile.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: "dungeon_clear",
            },
            tx,
          );
        }

        members.push({
          userJid: profile.userJid,
          moneyGained,
          xpGained,
          hpLost,
          hpAfter,
          crateGained,
        });
      }

      return {
        bossName,
        won,
        teamPower,
        bossPower,
        members,
      };
    });
  }

  // ---- 3. .serang @user (alias .membunuh) dengan Proteksi UGD 15 Menit ----

  async attackPlayer(
    groupJid: string,
    attackerJid: string,
    targetJid: string,
    now: Date = new Date(),
  ): Promise<AttackPlayerResult> {
    const normAttacker = normalizeUserJid(attackerJid);
    const normTarget = normalizeUserJid(targetJid);
    if (!normAttacker || !normTarget || normAttacker === normTarget) {
      throw new AppUserError("Tidak bisa menyerang diri sendiri!");
    }

    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();
    const stealPercent = this.random.intBetween(10, 20);
    const attackerRoll = this.random.intBetween(1, 40);
    const defenderRoll = this.random.intBetween(1, 35);

    return this.db.$transaction(async (tx) => {
      const attacker = await this.profileRepo.findOrCreate(groupJid, normAttacker, tx);
      const target = await this.profileRepo.findByGroupAndUser(groupJid, normTarget, tx);

      const attackerState = parseRpgState(attacker.rpgState);
      const attackerUgd = getRemainingUgdMs(attackerState, nowMs);
      if (attackerUgd > 0) {
        throw new AppUserError(
          `Kamu sedang dirawat di UGD! Pulih dalam *${formatRemainingDuration(attackerUgd)}*.`,
        );
      }

      if (attackerState.hp < 20) {
        throw new AppUserError(
          `HP kamu kritis (${String(attackerState.hp)}/100)! Ketik *.heal* dulu sebelum menyerang.`,
        );
      }

      const cdRem = getRemainingCooldownMs(attackerState, "serang", ATTACK_COOLDOWN_MS, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Senjatamu masih dingin. Bisa .serang lagi dalam *${formatRemainingDuration(cdRem)}*.`,
        );
      }

      if (!target) {
        throw new AppUserError("Target belum punya profil RPG di grup ini.");
      }

      const targetState = parseRpgState(target.rpgState);
      const targetUgd = getRemainingUgdMs(targetState, nowMs);
      if (targetUgd > 0) {
        throw new AppUserError(
          `Target sedang dirawat di UGD (kebal serangan anti-bully selama *${formatRemainingDuration(targetUgd)}* lagi)!`,
        );
      }

      if (target.moneyBalance < ATTACK_MIN_TARGET_WALLET) {
        throw new AppUserError(
          `Dompet target tipis (< ${formatRupiah(ATTACK_MIN_TARGET_WALLET)}). Cari sultan lain yang bawa uang tunai!`,
        );
      }

      const attackerPower =
        attacker.level * 10 + attackerState.tools.sword.level * 30 + attackerRoll;
      const defenderPower =
        target.level * 10 + targetState.tools.armor.level * 32 + defenderRoll;

      let nextAttackerState = withUpdatedCooldown(attackerState, "serang", nowMs);
      if (nextAttackerState.tools.sword.level > 0) {
        nextAttackerState = withToolState(nextAttackerState, "sword", {
          level: nextAttackerState.tools.sword.level,
          durability: Math.max(0, nextAttackerState.tools.sword.durability - 5),
        });
      }

      if (attackerPower < defenderPower) {
        // Serangan gagal, kena counter damage
        const counterDamage = 20;
        const attackerHpAfter = Math.max(0, attackerState.hp - counterDamage);
        nextAttackerState = withHp(nextAttackerState, attackerHpAfter);

        await tx.groupMemberProfile.update({
          where: { id: attacker.id },
          data: {
            experience: { increment: 20 },
            rpgState: serializeRpgState(nextAttackerState),
          },
        });

        return {
          success: false,
          attackerJid: normAttacker,
          targetJid: normTarget,
          attackerPower,
          defenderPower,
          damageDealt: 0,
          targetHpAfter: targetState.hp,
          attackerHpAfter,
          sentToUgd: false,
          ugdMinutes: 0,
          moneyLooted: 0n,
          attackerMoney: attacker.moneyBalance,
          targetMoney: target.moneyBalance,
        };
      }

      // Serangan tembus!
      const damageDealt = Math.max(
        15,
        35 + attackerState.tools.sword.level * 5 - targetState.tools.armor.level * 4,
      );
      const rawTargetHp = Math.max(0, targetState.hp - damageDealt);
      const sentToUgd = rawTargetHp === 0;
      const finalTargetHp = sentToUgd ? UGD_STABILIZED_HP : rawTargetHp;

      let nextTargetState = withHp(targetState, finalTargetHp);
      if (sentToUgd) {
        nextTargetState = withUgdUntil(nextTargetState, nowMs + UGD_DURATION_MS);
      }

      const rawLoot = percentOfBigInt(target.moneyBalance, stealPercent);
      const moneyLooted = maxBigInt(
        100_000n,
        minBigInt(ATTACK_MAX_LOOT, rawLoot, target.moneyBalance),
      );
      const creditAttacker = clampMoneyCredit(attacker.moneyBalance, moneyLooted);

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: target.id, moneyBalance: { gte: moneyLooted } },
        data: {
          moneyBalance: { decrement: moneyLooted },
          rpgState: serializeRpgState(nextTargetState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Dompet target berubah saat diserang.");
      }

      const updatedTarget = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: target.id },
      });
      const updatedAttacker = await tx.groupMemberProfile.update({
        where: { id: attacker.id },
        data: {
          moneyBalance: { increment: creditAttacker },
          totalMoneyEarned: { increment: creditAttacker },
          experience: { increment: 80 },
          rpgState: serializeRpgState(nextAttackerState),
        },
      });

      await this.txRepo.create(
        {
          profileId: target.id,
          groupJid,
          userJid: normTarget,
          actorJid: normAttacker,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.ROB_DEBIT,
          amount: -moneyLooted,
          balanceBefore: target.moneyBalance,
          balanceAfter: updatedTarget.moneyBalance,
          correlationId,
          note: "pvp_serang_victim",
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: attacker.id,
          groupJid,
          userJid: normAttacker,
          targetUserJid: normTarget,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.ROB_CREDIT,
          amount: creditAttacker,
          balanceBefore: attacker.moneyBalance,
          balanceAfter: updatedAttacker.moneyBalance,
          correlationId,
          note: "pvp_serang_attacker",
        },
        tx,
      );

      return {
        success: true,
        attackerJid: normAttacker,
        targetJid: normTarget,
        attackerPower,
        defenderPower,
        damageDealt,
        targetHpAfter: finalTargetHp,
        attackerHpAfter: nextAttackerState.hp,
        sentToUgd,
        ugdMinutes: sentToUgd ? 15 : 0,
        moneyLooted,
        attackerMoney: updatedAttacker.moneyBalance,
        targetMoney: updatedTarget.moneyBalance,
      };
    });
  }

  private async assertReadyForDungeon(
    groupJid: string,
    userJid: string,
    nowMs: number,
  ): Promise<void> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const ugdRem = getRemainingUgdMs(state, nowMs);
    if (ugdRem > 0) {
      throw new AppUserError(
        `Kamu masih dirawat di UGD (*${formatRemainingDuration(ugdRem)}* lagi).`,
      );
    }
    if (state.hp < 20) {
      throw new AppUserError(
        `HP kamu terlalu rendah (${String(state.hp)}/100)! Pakai *.heal* dulu sebelum masuk dungeon.`,
      );
    }
    const cdRem = getRemainingCooldownMs(state, "dungeon", DUNGEON_COOLDOWN_MS, nowMs);
    if (cdRem > 0) {
      throw new AppUserError(
        `Stamina dungeon masih pulih. Tunggu *${formatRemainingDuration(cdRem)}* lagi.`,
      );
    }
  }

  private sweepExpiredLobbies(nowMs: number): void {
    for (const [key, lobby] of this.dungeonLobbies.entries()) {
      if (lobby.expiresAt <= nowMs) {
        this.dungeonLobbies.delete(key);
      }
    }
  }
}

export const rpgGroupInteractionService = new RpgGroupInteractionService();
