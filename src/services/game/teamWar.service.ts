import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, formatRupiah, minBigInt } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import { parseRpgState } from "../rpg/rpgState";

export type WarTeam = "a" | "b";
export type WarPhase = "lobby" | "active";

export interface WarFighter {
  userJid: string;
  team: WarTeam;
  hp: number;
  swordLevel: number;
  armorLevel: number;
  lastAttackAt: number;
}

export interface TeamWarSession {
  groupJid: string;
  hostJid: string;
  betPerPlayer: bigint;
  phase: WarPhase;
  fighters: WarFighter[];
  createdAt: number;
  expiresAt: number;
}

export interface WarAttackOutcome {
  attackerJid: string;
  targetJid: string;
  damage: number;
  targetHpAfter: number;
  targetEliminated: boolean;
  winningTeam: WarTeam | null;
  rewardPerWinner: bigint;
  winnerJids: string[];
  loserJids: string[];
  session: TeamWarSession;
}

export const WAR_MIN_BET = 250_000n;
export const WAR_MAX_BET = 100_000_000n;
export const WAR_DEFAULT_BET = 1_000_000n;
export const WAR_VICTORY_BONUS_PER_WINNER = 9_000_000n;
export const WAR_WIN_XP = 108;
export const WAR_LOSE_XP = 24;
export const WAR_TTL_MS = 15 * 60 * 1000;
const WAR_ATTACK_COOLDOWN_MS = 5_000;
const WAR_MAX_PER_TEAM = 5;
const MAX_WAR_ROOMS = 50;

interface WarProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface WarTxStore {
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

interface WarTx {
  groupMemberProfile: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

interface WarDb {
  $transaction<T>(fn: (tx: WarTx) => Promise<T>): Promise<T>;
}

export class TeamWarService {
  private readonly sessions = new Map<string, TeamWarSession>();

  constructor(
    private readonly profileRepo: WarProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: WarTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: WarDb = prisma,
  ) {}

  getSession(groupJid: string, nowMs = Date.now()): TeamWarSession | null {
    this.sweepExpired(nowMs);
    return this.sessions.get(groupJid) ?? null;
  }

  async createLobby(
    groupJid: string,
    hostJid: string,
    betPerPlayer: bigint = WAR_DEFAULT_BET,
    nowMs = Date.now(),
  ): Promise<TeamWarSession> {
    this.sweepExpired(nowMs);
    if (this.sessions.has(groupJid)) {
      throw new AppUserError("Sudah ada sesi .war aktif di grup ini! Ketik *.war status*.");
    }
    if (betPerPlayer < WAR_MIN_BET || betPerPlayer > WAR_MAX_BET) {
      throw new AppUserError(
        `Taruhan perang antara ${formatRupiah(WAR_MIN_BET)} sampai ${formatRupiah(WAR_MAX_BET)}.`,
      );
    }

    const normHost = normalizeUserJid(hostJid);
    const hostProfile = await this.profileRepo.findOrCreate(groupJid, normHost);
    if (hostProfile.moneyBalance < betPerPlayer) {
      throw new AppUserError(
        `Uang dompetmu belum cukup untuk taruhan ${formatRupiah(betPerPlayer)} (dompet: ${formatRupiah(hostProfile.moneyBalance)}).`,
      );
    }

    if (this.sessions.size >= MAX_WAR_ROOMS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }

    const hostState = parseRpgState(hostProfile.rpgState);
    const session: TeamWarSession = {
      groupJid,
      hostJid: normHost,
      betPerPlayer,
      phase: "lobby",
      fighters: [
        {
          userJid: normHost,
          team: "a",
          hp: 100,
          swordLevel: hostState.tools.sword.level,
          armorLevel: hostState.tools.armor.level,
          lastAttackAt: 0,
        },
      ],
      createdAt: nowMs,
      expiresAt: nowMs + WAR_TTL_MS,
    };

    this.sessions.set(groupJid, session);
    return session;
  }

  async joinTeam(
    groupJid: string,
    userJid: string,
    team: WarTeam,
    nowMs = Date.now(),
  ): Promise<TeamWarSession> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada lobby perang! Ketik *.war buat <taruhan>* untuk mulai.");
    }
    if (session.phase !== "lobby") {
      throw new AppUserError("Perang sedang berlangsung! Tunggu selesai untuk ikut ronde baru.");
    }

    const normUser = normalizeUserJid(userJid);
    if (session.fighters.some((f) => f.userJid === normUser)) {
      throw new AppUserError("Kamu sudah terdaftar di perang ini.");
    }

    const teamCount = session.fighters.filter((f) => f.team === team).length;
    if (teamCount >= WAR_MAX_PER_TEAM) {
      throw new AppUserError(`Tim ${team.toUpperCase()} sudah penuh (maks ${String(WAR_MAX_PER_TEAM)} pemain).`);
    }

    const profile = await this.profileRepo.findOrCreate(groupJid, normUser);
    if (profile.moneyBalance < session.betPerPlayer) {
      throw new AppUserError(
        `Dompetmu kurang untuk taruhan ${formatRupiah(session.betPerPlayer)} (dompet: ${formatRupiah(profile.moneyBalance)}).`,
      );
    }

    const state = parseRpgState(profile.rpgState);
    session.fighters.push({
      userJid: normUser,
      team,
      hp: 100,
      swordLevel: state.tools.sword.level,
      armorLevel: state.tools.armor.level,
      lastAttackAt: 0,
    });
    return session;
  }

  startWar(groupJid: string, actorJid: string, nowMs = Date.now()): TeamWarSession {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada lobby perang di grup ini.");
    }
    if (session.phase !== "lobby") {
      throw new AppUserError("Perang sudah dimulai!");
    }

    const normActor = normalizeUserJid(actorJid);
    if (session.hostJid !== normActor) {
      throw new AppUserError("Hanya host pembuat lobby yang bisa menjalankan *.war mulai*.");
    }

    const teamACount = session.fighters.filter((f) => f.team === "a").length;
    const teamBCount = session.fighters.filter((f) => f.team === "b").length;
    if (teamACount === 0 || teamBCount === 0) {
      throw new AppUserError("Minimal harus ada 1 pemain di Tim A dan 1 pemain di Tim B!");
    }

    session.phase = "active";
    session.expiresAt = nowMs + WAR_TTL_MS;
    return session;
  }

  cancelWar(groupJid: string, actorJid: string, isAdminOrOwner: boolean, nowMs = Date.now()): void {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      throw new AppUserError("Tidak ada sesi perang aktif di grup ini.");
    }
    const normActor = normalizeUserJid(actorJid);
    if (!isAdminOrOwner && session.hostJid !== normActor) {
      throw new AppUserError("Hanya host atau Admin grup yang bisa membatalkan perang.");
    }
    this.sessions.delete(groupJid);
  }

  async attackEnemy(
    groupJid: string,
    attackerJid: string,
    targetJid: string,
    nowMs = Date.now(),
  ): Promise<WarAttackOutcome> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (session?.phase !== "active") {
      throw new AppUserError("Tidak ada perang aktif di grup ini. Mulai dulu dengan *.war buat*!");
    }

    const normAttacker = normalizeUserJid(attackerJid);
    const normTarget = normalizeUserJid(targetJid);
    const attacker = session.fighters.find((f) => f.userJid === normAttacker);
    if (!attacker) {
      throw new AppUserError("Kamu bukan peserta perang ini.");
    }
    if (attacker.hp <= 0) {
      throw new AppUserError("Kamu sudah tumbang (0 HP) dan tidak bisa menyerang lagi.");
    }

    const elapsed = nowMs - attacker.lastAttackAt;
    if (attacker.lastAttackAt > 0 && elapsed < WAR_ATTACK_COOLDOWN_MS) {
      const waitSec = Math.ceil((WAR_ATTACK_COOLDOWN_MS - elapsed) / 1000);
      throw new AppUserError(`Tunggu *${String(waitSec)} detik* lagi sebelum menyerang kembali!`);
    }

    const target = session.fighters.find((f) => f.userJid === normTarget);
    if (!target) {
      throw new AppUserError("Target yang kamu tag bukan peserta perang ini.");
    }
    if (target.team === attacker.team) {
      throw new AppUserError("Jangan serang teman satu tim sendiri!");
    }
    if (target.hp <= 0) {
      throw new AppUserError("Target tersebut sudah tumbang (0 HP). Pilih lawan lain!");
    }

    attacker.lastAttackAt = nowMs;
    const baseDmg = this.random.intBetween(22, 42);
    const damage = Math.max(12, baseDmg + attacker.swordLevel * 4 - target.armorLevel * 2);
    target.hp = Math.max(0, target.hp - damage);
    const targetEliminated = target.hp === 0;

    const enemyAlive = session.fighters.some((f) => f.team === target.team && f.hp > 0);
    if (enemyAlive) {
      return {
        attackerJid: normAttacker,
        targetJid: normTarget,
        damage,
        targetHpAfter: target.hp,
        targetEliminated,
        winningTeam: null,
        rewardPerWinner: 0n,
        winnerJids: [],
        loserJids: [],
        session,
      };
    }

    // Team wins! Settle pot + victory bonus atomically
    this.sessions.delete(groupJid);
    const winningTeam = attacker.team;
    const winners = session.fighters.filter((f) => f.team === winningTeam);
    const losers = session.fighters.filter((f) => f.team !== winningTeam);
    const correlationId = generateCorrelationId();

    const rewardPerWinner = await this.db.$transaction(async (tx) => {
      let totalPotCollected = 0n;

      for (const loser of losers) {
        const prof = await this.profileRepo.findOrCreate(groupJid, loser.userJid, tx);
        const deduction = minBigInt(prof.moneyBalance, session.betPerPlayer);
        totalPotCollected += deduction;

        const updated = await tx.groupMemberProfile.update({
          where: { id: prof.id },
          data: {
            ...(deduction > 0n ? { moneyBalance: { decrement: deduction } } : {}),
            experience: { increment: WAR_LOSE_XP },
          },
        });

        if (deduction > 0n) {
          await this.txRepo.create(
            {
              profileId: prof.id,
              groupJid,
              userJid: loser.userJid,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.DUEL_STAKE,
              amount: -deduction,
              balanceBefore: prof.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: "team_war_loss",
            },
            tx,
          );
        }
      }

      const potShare = winners.length > 0 ? totalPotCollected / BigInt(winners.length) : 0n;
      const prizeEach = potShare + WAR_VICTORY_BONUS_PER_WINNER;

      for (const winner of winners) {
        const prof = await this.profileRepo.findOrCreate(groupJid, winner.userJid, tx);
        const credit = clampMoneyCredit(prof.moneyBalance, prizeEach);
        const updated = await tx.groupMemberProfile.update({
          where: { id: prof.id },
          data: {
            moneyBalance: { increment: credit },
            totalMoneyEarned: { increment: credit },
            experience: { increment: WAR_WIN_XP },
          },
        });

        await this.txRepo.create(
          {
            profileId: prof.id,
            groupJid,
            userJid: winner.userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.DUEL_WIN,
            amount: credit,
            balanceBefore: prof.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: "team_war_win",
          },
          tx,
        );
      }

      return prizeEach;
    });

    return {
      attackerJid: normAttacker,
      targetJid: normTarget,
      damage,
      targetHpAfter: target.hp,
      targetEliminated,
      winningTeam,
      rewardPerWinner,
      winnerJids: winners.map((w) => w.userJid),
      loserJids: losers.map((l) => l.userJid),
      session,
    };
  }

  private sweepExpired(nowMs: number): void {
    for (const [k, s] of this.sessions.entries()) {
      if (s.expiresAt <= nowMs) {
        this.sessions.delete(k);
      }
    }
  }
}

export const teamWarService = new TeamWarService();
