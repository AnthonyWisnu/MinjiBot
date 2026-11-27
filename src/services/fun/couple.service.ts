import { type GroupMemberProfile } from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, formatRemainingDuration } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";

const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const COUPLE_BONUS_MONEY = 2_500_000n;
const COUPLE_BONUS_XP = 50;

export interface PendingProposal {
  groupJid: string;
  proposerJid: string;
  targetJid: string;
  expiresAt: number;
}

export interface CoupleAcceptResult {
  proposerJid: string;
  targetJid: string;
  bonusMoney: bigint;
  bonusXp: number;
}

export interface CoupleStatusResult {
  userJid: string;
  partnerJid: string | null;
  partnerSince: Date | null;
  durationText: string | null;
}

interface CoupleProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
}

interface CoupleTx {
  groupMemberProfile: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

interface CoupleDb {
  $transaction<T>(fn: (tx: CoupleTx) => Promise<T>): Promise<T>;
}

export class CoupleService {
  private readonly pendingByTarget = new Map<string, PendingProposal>();

  constructor(
    private readonly profileRepo: CoupleProfileStore = new GroupMemberProfileRepository(),
    private readonly db: CoupleDb = prisma,
  ) {}

  async propose(
    groupJid: string,
    proposerJid: string,
    targetJid: string,
    nowMs = Date.now(),
  ): Promise<PendingProposal> {
    const normProposer = normalizeUserJid(proposerJid);
    const normTarget = normalizeUserJid(targetJid);
    if (!normProposer || !normTarget || normProposer === normTarget) {
      throw new AppUserError("Tidak bisa menembak diri sendiri, cari pasangan di grup ini dong!");
    }

    const proposer = await this.profileRepo.findOrCreate(groupJid, normProposer);
    if (proposer.partnerJid) {
      throw new AppUserError("Kamu sudah punya pasangan di grup ini! Ketik .putus dulu kalau mau cari baru.");
    }

    const target = await this.profileRepo.findOrCreate(groupJid, normTarget);
    if (target.partnerJid) {
      throw new AppUserError("Target sudah punya pasangan di grup ini. Jangan jadi orang ketiga ya!");
    }

    const key = `${groupJid}:${normTarget}`;
    const existing = this.pendingByTarget.get(key);
    if (existing && existing.expiresAt > nowMs) {
      throw new AppUserError("Target sedang mendapat lamaran dari member lain. Tunggu dijawab dulu!");
    }

    const proposal: PendingProposal = {
      groupJid,
      proposerJid: normProposer,
      targetJid: normTarget,
      expiresAt: nowMs + PROPOSAL_TTL_MS,
    };
    this.pendingByTarget.set(key, proposal);
    return proposal;
  }

  async acceptProposal(
    groupJid: string,
    acceptorJid: string,
    expectedProposerJid?: string,
    now: Date = new Date(),
  ): Promise<CoupleAcceptResult> {
    const normAcceptor = normalizeUserJid(acceptorJid);
    const key = `${groupJid}:${normAcceptor}`;
    const pending = this.pendingByTarget.get(key);

    if (!pending || pending.expiresAt <= now.getTime()) {
      this.pendingByTarget.delete(key);
      throw new AppUserError("Tidak ada yang sedang menembakmu di grup ini.");
    }

    if (expectedProposerJid && normalizeUserJid(expectedProposerJid) !== pending.proposerJid) {
      throw new AppUserError("Orang yang kamu tag bukan yang sedang menembakmu.");
    }

    this.pendingByTarget.delete(key);

    return this.db.$transaction(async (tx) => {
      const proposer = await this.profileRepo.findOrCreate(groupJid, pending.proposerJid, tx);
      const acceptor = await this.profileRepo.findOrCreate(groupJid, pending.targetJid, tx);

      if (proposer.partnerJid || acceptor.partnerJid) {
        throw new AppUserError("Salah satu pihak sudah berpasangan.");
      }

      const bonusP = clampMoneyCredit(proposer.moneyBalance, COUPLE_BONUS_MONEY);
      const bonusA = clampMoneyCredit(acceptor.moneyBalance, COUPLE_BONUS_MONEY);

      await tx.groupMemberProfile.update({
        where: { id: proposer.id },
        data: {
          partnerJid: pending.targetJid,
          partnerSince: now,
          moneyBalance: { increment: bonusP },
          totalMoneyEarned: { increment: bonusP },
          experience: { increment: COUPLE_BONUS_XP },
        },
      });

      await tx.groupMemberProfile.update({
        where: { id: acceptor.id },
        data: {
          partnerJid: pending.proposerJid,
          partnerSince: now,
          moneyBalance: { increment: bonusA },
          totalMoneyEarned: { increment: bonusA },
          experience: { increment: COUPLE_BONUS_XP },
        },
      });

      return {
        proposerJid: pending.proposerJid,
        targetJid: pending.targetJid,
        bonusMoney: COUPLE_BONUS_MONEY,
        bonusXp: COUPLE_BONUS_XP,
      };
    });
  }

  rejectProposal(
    groupJid: string,
    rejectorJid: string,
    expectedProposerJid?: string,
    nowMs = Date.now(),
  ): PendingProposal {
    const normRejector = normalizeUserJid(rejectorJid);
    const key = `${groupJid}:${normRejector}`;
    const pending = this.pendingByTarget.get(key);

    if (!pending || pending.expiresAt <= nowMs) {
      this.pendingByTarget.delete(key);
      throw new AppUserError("Tidak ada lamaran aktif yang perlu ditolak.");
    }

    if (expectedProposerJid && normalizeUserJid(expectedProposerJid) !== pending.proposerJid) {
      throw new AppUserError("Orang yang kamu tag bukan yang sedang menembakmu.");
    }

    this.pendingByTarget.delete(key);
    return pending;
  }

  async breakUp(
    groupJid: string,
    userJid: string,
  ): Promise<{ userJid: string; exPartnerJid: string }> {
    const normUser = normalizeUserJid(userJid);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      if (!profile.partnerJid) {
        throw new AppUserError("Kamu kan masih jomblo, mau putus sama siapa?");
      }

      const exPartnerJid = profile.partnerJid;
      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { partnerJid: null, partnerSince: null },
      });

      const exProfile = await this.profileRepo.findByGroupAndUser(groupJid, exPartnerJid, tx);
      if (exProfile?.partnerJid === normUser) {
        await tx.groupMemberProfile.update({
          where: { id: exProfile.id },
          data: { partnerJid: null, partnerSince: null },
        });
      }

      return { userJid: normUser, exPartnerJid };
    });
  }

  async checkPartner(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<CoupleStatusResult> {
    const normUser = normalizeUserJid(userJid);
    const profile = await this.profileRepo.findByGroupAndUser(groupJid, normUser);
    if (!profile?.partnerJid) {
      return {
        userJid: normUser,
        partnerJid: null,
        partnerSince: null,
        durationText: null,
      };
    }

    const durationText = profile.partnerSince
      ? formatRemainingDuration(Math.max(1000, now.getTime() - profile.partnerSince.getTime()))
      : "baru saja";

    return {
      userJid: normUser,
      partnerJid: profile.partnerJid,
      partnerSince: profile.partnerSince,
      durationText,
    };
  }

  pickRandomMatch(
    memberJids: string[],
  ): { firstJid: string; secondJid: string; compatibility: number; comment: string } {
    const unique = [...new Set(memberJids.map((j) => normalizeUserJid(j)).filter(Boolean))];
    if (unique.length < 2) {
      throw new AppUserError("Minimal butuh 2 anggota di grup untuk mencari pasangan acak.");
    }

    const idx1 = Math.floor(Math.random() * unique.length);
    let idx2 = Math.floor(Math.random() * (unique.length - 1));
    if (idx2 >= idx1) idx2 += 1;

    const firstJid = unique[idx1] ?? unique[0] ?? "";
    const secondJid = unique[idx2] ?? unique[1] ?? "";
    const compatibility = Math.floor(Math.random() * 51) + 50; // 50% - 100% biar seru!
    const comment =
      compatibility >= 90
        ? "JODOH SEJATI! Langsung sebar undangan grup!"
        : compatibility >= 75
          ? "Cocok banget nih, tinggal tunggu siapa yang .tembak duluan!"
          : "Lumayan serasi, butuh traktiran es teh bareng biar makin akrab!";

    return { firstJid, secondJid, compatibility, comment };
  }
}

export const coupleService = new CoupleService();
