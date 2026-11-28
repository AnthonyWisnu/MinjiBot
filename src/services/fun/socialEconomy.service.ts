import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupClan,
  type GroupMemberProfile,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import {
  GroupClanRepository,
  parseClanMembers,
} from "../../repositories/groupClan.repository";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import {
  parseRpgState,
  serializeRpgState,
  withCustomTitle,
  withMarriage,
} from "../rpg/rpgState";

export const CUSTOM_TITLE_PRICE = 100_000_000n;
export const MARRIAGE_DEFAULT_DOWRY = 50_000_000n;
export const MARRIAGE_MIN_DOWRY = 10_000_000n;
export const MARRIAGE_MAX_DOWRY = 5_000_000_000n;
export const MARRIAGE_PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const MARRIAGE_XP_BONUS = 300;

export const CLAN_CREATE_PRICE = 50_000_000n;
export const CLAN_MAX_PER_GROUP = 15;
export const CLAN_MAX_MEMBERS = 15;
export const CLAN_MIN_DONATION = 100_000n;

export const AUCTION_MIN_START = 1_000_000n;
export const AUCTION_TTL_MS = 15 * 60 * 1000;
const MAX_PROPOSALS = 200;
const MAX_AUCTIONS = 50;

export const PRESET_TITLES = [
  "Sultan Muda",
  "Raja Korupsi",
  "Donatur Tetap",
  "Sepuh Grup",
  "Sider Elit",
  "Bandar Slot",
  "Wibu Terhormat",
  "Beban Tongkrongan",
] as const;

export interface MarriageProposal {
  groupJid: string;
  proposerJid: string;
  targetJid: string;
  dowry: bigint;
  expiresAt: number;
}

export interface GroupAuctionSession {
  groupJid: string;
  sellerJid: string;
  itemName: string;
  startPrice: bigint;
  currentBid: bigint;
  highestBidderJid: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface MarriageRecordInfo {
  userJid: string;
  spouseJid: string;
  marriedAt: number;
  dowryAmount: bigint;
}

interface SocialProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
}

interface SocialTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
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

interface SocialClanStore {
  findBySlug(groupJid: string, slug: string): Promise<GroupClan | null>;
  listByGroup(groupJid: string): Promise<GroupClan[]>;
  countByGroup(groupJid: string): Promise<number>;
  findByMember(groupJid: string, userJid: string): Promise<GroupClan | null>;
  create(data: {
    groupJid: string;
    name: string;
    slug: string;
    leaderJid: string;
    memberJids: string[];
  }): Promise<GroupClan>;
  update(
    id: string,
    data: {
      leaderJid?: string;
      memberJids?: string[];
      treasuryBalance?: bigint | { increment: bigint };
    },
  ): Promise<GroupClan>;
  deleteById(id: string): Promise<void>;
}

interface SocialTx {
  groupMemberProfile: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
  groupClan?: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupClan>;
  };
}

interface SocialDb {
  $transaction<T>(fn: (tx: SocialTx) => Promise<T>): Promise<T>;
}

function slugifyClanName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class SocialEconomyService {
  private readonly proposals = new Map<string, MarriageProposal>(); // key: groupJid::targetJid
  private readonly auctions = new Map<string, GroupAuctionSession>(); // key: groupJid

  constructor(
    private readonly profileRepo: SocialProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: SocialTxStore = new GroupMemberTransactionRepository(),
    private readonly clanRepo: SocialClanStore = new GroupClanRepository(),
    private readonly db: SocialDb = prisma,
  ) {}

  // ======================== GELAR SULTAN ========================

  async buyCustomTitle(
    groupJid: string,
    userJid: string,
    rawTitle: string,
  ): Promise<{ title: string; remainingMoney: bigint }> {
    const cleaned = rawTitle
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 2 || cleaned.length > 24) {
      throw new AppUserError("Panjang gelar harus antara 2 sampai 24 karakter.");
    }

    const normUser = normalizeUserJid(userJid);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      if (profile.moneyBalance < CUSTOM_TITLE_PRICE) {
        throw new AppUserError(
          `Uang dompetmu kurang! Harga beli gelar adalah ${formatRupiah(CUSTOM_TITLE_PRICE)} (dompet: ${formatRupiah(profile.moneyBalance)}).`,
        );
      }

      const nextState = withCustomTitle(parseRpgState(profile.rpgState), cleaned);
      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { decrement: CUSTOM_TITLE_PRICE },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -CUSTOM_TITLE_PRICE,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `buy_title:${cleaned}`,
        },
        tx,
      );

      return { title: cleaned, remainingMoney: updated.moneyBalance };
    });
  }

  async getCurrentTitle(groupJid: string, userJid: string): Promise<string | null> {
    const profile = await this.profileRepo.findOrCreate(groupJid, normalizeUserJid(userJid));
    return parseRpgState(profile.rpgState).customTitle;
  }

  async clearCustomTitle(groupJid: string, userJid: string): Promise<void> {
    const normUser = normalizeUserJid(userJid);
    await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const nextState = withCustomTitle(parseRpgState(profile.rpgState), null);
      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });
    });
  }

  // ======================== PERNIKAHAN ========================

  async proposeMarriage(
    groupJid: string,
    proposerJid: string,
    targetJid: string,
    dowry: bigint = MARRIAGE_DEFAULT_DOWRY,
    nowMs = Date.now(),
  ): Promise<MarriageProposal> {
    this.sweepProposals(nowMs);
    const normProposer = normalizeUserJid(proposerJid);
    const normTarget = normalizeUserJid(targetJid);
    if (normProposer === normTarget) {
      throw new AppUserError("Tidak bisa melamar diri sendiri dong!");
    }
    if (dowry < MARRIAGE_MIN_DOWRY || dowry > MARRIAGE_MAX_DOWRY) {
      throw new AppUserError(
        `Mahar nikah antara ${formatRupiah(MARRIAGE_MIN_DOWRY)} sampai ${formatRupiah(MARRIAGE_MAX_DOWRY)}.`,
      );
    }

    const [pProf, tProf] = await Promise.all([
      this.profileRepo.findOrCreate(groupJid, normProposer),
      this.profileRepo.findOrCreate(groupJid, normTarget),
    ]);

    if (parseRpgState(pProf.rpgState).spouseJid) {
      throw new AppUserError("Kamu sudah menikah! Selesaikan dulu dengan *.cerai* kalau mau ganti pasangan.");
    }
    if (parseRpgState(tProf.rpgState).spouseJid) {
      throw new AppUserError("Target yang kamu lamar sudah menikah dengan orang lain!");
    }
    if (pProf.moneyBalance < dowry) {
      throw new AppUserError(
        `Uang dompetmu belum cukup untuk mahar ${formatRupiah(dowry)} (dompet: ${formatRupiah(pProf.moneyBalance)}).`,
      );
    }

    if (this.proposals.size >= MAX_PROPOSALS) {
      const oldest = this.proposals.keys().next().value;
      if (oldest) this.proposals.delete(oldest);
    }

    const proposal: MarriageProposal = {
      groupJid,
      proposerJid: normProposer,
      targetJid: normTarget,
      dowry,
      expiresAt: nowMs + MARRIAGE_PROPOSAL_TTL_MS,
    };
    this.proposals.set(`${groupJid}::${normTarget}`, proposal);
    return proposal;
  }

  async acceptMarriage(
    groupJid: string,
    targetJid: string,
    nowMs = Date.now(),
  ): Promise<MarriageRecordInfo> {
    this.sweepProposals(nowMs);
    const normTarget = normalizeUserJid(targetJid);
    const key = `${groupJid}::${normTarget}`;
    const proposal = this.proposals.get(key);
    if (!proposal) {
      throw new AppUserError("Tidak ada lamaran nikah aktif untukmu di grup ini.");
    }

    const correlationId = generateCorrelationId();
    const record = await this.db.$transaction(async (tx) => {
      const pProf = await this.profileRepo.findOrCreate(groupJid, proposal.proposerJid, tx);
      const tProf = await this.profileRepo.findOrCreate(groupJid, normTarget, tx);

      if (parseRpgState(pProf.rpgState).spouseJid || parseRpgState(tProf.rpgState).spouseJid) {
        throw new AppUserError("Salah satu pihak sudah menikah.");
      }
      if (pProf.moneyBalance < proposal.dowry) {
        throw new AppUserError("Saldo pelamar tidak lagi cukup untuk membayar mahar.");
      }

      const dowryStr = proposal.dowry.toString();
      const nextPState = withMarriage(parseRpgState(pProf.rpgState), normTarget, nowMs, dowryStr);
      const nextTState = withMarriage(
        parseRpgState(tProf.rpgState),
        proposal.proposerJid,
        nowMs,
        dowryStr,
      );

      const creditDowry = clampMoneyCredit(tProf.moneyBalance, proposal.dowry);

      const updatedP = await tx.groupMemberProfile.update({
        where: { id: pProf.id },
        data: {
          moneyBalance: { decrement: proposal.dowry },
          experience: { increment: MARRIAGE_XP_BONUS },
          partnerJid: normTarget,
          partnerSince: new Date(nowMs),
          rpgState: serializeRpgState(nextPState),
        },
      });

      const updatedT = await tx.groupMemberProfile.update({
        where: { id: tProf.id },
        data: {
          moneyBalance: { increment: creditDowry },
          totalMoneyEarned: { increment: creditDowry },
          experience: { increment: MARRIAGE_XP_BONUS },
          partnerJid: proposal.proposerJid,
          partnerSince: new Date(nowMs),
          rpgState: serializeRpgState(nextTState),
        },
      });

      await this.txRepo.create(
        {
          profileId: pProf.id,
          groupJid,
          userJid: proposal.proposerJid,
          targetUserJid: normTarget,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -proposal.dowry,
          balanceBefore: pProf.moneyBalance,
          balanceAfter: updatedP.moneyBalance,
          correlationId,
          note: "marriage_dowry_sent",
        },
        tx,
      );
      await this.txRepo.create(
        {
          profileId: tProf.id,
          groupJid,
          userJid: normTarget,
          targetUserJid: proposal.proposerJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_RECEIVED,
          amount: creditDowry,
          balanceBefore: tProf.moneyBalance,
          balanceAfter: updatedT.moneyBalance,
          correlationId,
          note: "marriage_dowry_received",
        },
        tx,
      );

      return {
        userJid: proposal.proposerJid,
        spouseJid: normTarget,
        marriedAt: nowMs,
        dowryAmount: proposal.dowry,
      };
    });

    this.proposals.delete(key);
    return record;
  }

  declineMarriage(groupJid: string, targetJid: string, nowMs = Date.now()): MarriageProposal {
    this.sweepProposals(nowMs);
    const key = `${groupJid}::${normalizeUserJid(targetJid)}`;
    const proposal = this.proposals.get(key);
    if (!proposal) {
      throw new AppUserError("Tidak ada lamaran nikah aktif untukmu.");
    }
    this.proposals.delete(key);
    return proposal;
  }

  async getMarriageRecord(groupJid: string, userJid: string): Promise<MarriageRecordInfo | null> {
    const normUser = normalizeUserJid(userJid);
    const profile = await this.profileRepo.findByGroupAndUser(groupJid, normUser);
    if (!profile) return null;
    const state = parseRpgState(profile.rpgState);
    if (!state.spouseJid) return null;
    return {
      userJid: normUser,
      spouseJid: state.spouseJid,
      marriedAt: state.marriedAt || Date.now(),
      dowryAmount: BigInt(state.dowryAmount || "0"),
    };
  }

  async divorce(groupJid: string, userJid: string): Promise<{ formerSpouseJid: string }> {
    const normUser = normalizeUserJid(userJid);
    return this.db.$transaction(async (tx) => {
      const prof = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(prof.rpgState);
      if (!state.spouseJid) {
        throw new AppUserError("Kamu belum menikah di grup ini.");
      }

      const spouseJid = state.spouseJid;
      await tx.groupMemberProfile.update({
        where: { id: prof.id },
        data: {
          partnerJid: null,
          partnerSince: null,
          rpgState: serializeRpgState(withMarriage(state, null)),
        },
      });

      const spouseProf = await this.profileRepo.findByGroupAndUser(groupJid, spouseJid, tx);
      if (spouseProf) {
        const spouseState = parseRpgState(spouseProf.rpgState);
        await tx.groupMemberProfile.update({
          where: { id: spouseProf.id },
          data: {
            partnerJid: null,
            partnerSince: null,
            rpgState: serializeRpgState(withMarriage(spouseState, null)),
          },
        });
      }

      return { formerSpouseJid: spouseJid };
    });
  }

  // ======================== GENG / KLAN GRUP ========================

  async createClan(groupJid: string, leaderJid: string, rawName: string): Promise<GroupClan> {
    const name = rawName.replace(/\s+/g, " ").trim();
    const slug = slugifyClanName(name);
    if (name.length < 3 || name.length > 24 || !slug) {
      throw new AppUserError("Nama geng harus 3-24 karakter huruf/angka. Contoh: *.geng buat Elit Grup*");
    }

    const normLeader = normalizeUserJid(leaderJid);
    const existingMember = await this.clanRepo.findByMember(groupJid, normLeader);
    if (existingMember) {
      throw new AppUserError(
        `Kamu sudah bergabung di geng *${existingMember.name}*. Keluar dulu dengan *.geng keluar*.`,
      );
    }

    const existingSlug = await this.clanRepo.findBySlug(groupJid, slug);
    if (existingSlug) {
      throw new AppUserError(`Nama geng *${name}* sudah dipakai di grup ini.`);
    }

    const count = await this.clanRepo.countByGroup(groupJid);
    if (count >= CLAN_MAX_PER_GROUP) {
      throw new AppUserError(`Maksimal ${String(CLAN_MAX_PER_GROUP)} geng per grup sudah tercapai.`);
    }

    const correlationId = generateCorrelationId();
    await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normLeader, tx);
      if (profile.moneyBalance < CLAN_CREATE_PRICE) {
        throw new AppUserError(
          `Biaya mendirikan geng adalah ${formatRupiah(CLAN_CREATE_PRICE)} (dompetmu: ${formatRupiah(profile.moneyBalance)}).`,
        );
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { moneyBalance: { decrement: CLAN_CREATE_PRICE } },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normLeader,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -CLAN_CREATE_PRICE,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `clan_create:${slug}`,
        },
        tx,
      );
    });

    return this.clanRepo.create({
      groupJid,
      name,
      slug,
      leaderJid: normLeader,
      memberJids: [normLeader],
    });
  }

  async joinClan(groupJid: string, userJid: string, rawName: string): Promise<GroupClan> {
    const slug = slugifyClanName(rawName);
    if (!slug) {
      throw new AppUserError("Masukkan nama geng tujuan. Contoh: *.geng join Elit Grup*");
    }

    const normUser = normalizeUserJid(userJid);
    const current = await this.clanRepo.findByMember(groupJid, normUser);
    if (current) {
      throw new AppUserError(`Kamu sudah anggota geng *${current.name}*. Keluar dulu dengan *.geng keluar*.`);
    }

    const clan = await this.clanRepo.findBySlug(groupJid, slug);
    if (!clan) {
      throw new AppUserError(`Geng *${rawName.trim()}* tidak ditemukan. Cek daftar dengan *.geng top*.`);
    }

    const members = parseClanMembers(clan.memberJids);
    if (members.length >= CLAN_MAX_MEMBERS) {
      throw new AppUserError(`Geng *${clan.name}* sudah penuh (${String(CLAN_MAX_MEMBERS)} anggota).`);
    }

    return this.clanRepo.update(clan.id, { memberJids: [...members, normUser] });
  }

  async leaveClan(
    groupJid: string,
    userJid: string,
  ): Promise<{ clanName: string; dissolved: boolean; newLeaderJid: string | null }> {
    const normUser = normalizeUserJid(userJid);
    const clan = await this.clanRepo.findByMember(groupJid, normUser);
    if (!clan) {
      throw new AppUserError("Kamu belum bergabung di geng mana pun.");
    }

    const remaining = parseClanMembers(clan.memberJids).filter((j) => j !== normUser);
    if (remaining.length === 0) {
      await this.clanRepo.deleteById(clan.id);
      return { clanName: clan.name, dissolved: true, newLeaderJid: null };
    }

    const newLeader = clan.leaderJid === normUser ? (remaining[0] ?? clan.leaderJid) : clan.leaderJid;
    await this.clanRepo.update(clan.id, {
      leaderJid: newLeader,
      memberJids: remaining,
    });
    return {
      clanName: clan.name,
      dissolved: false,
      newLeaderJid: clan.leaderJid === normUser ? newLeader : null,
    };
  }

  async kickClanMember(
    groupJid: string,
    actorJid: string,
    targetJid: string,
  ): Promise<{ clanName: string; kickedJid: string }> {
    const normActor = normalizeUserJid(actorJid);
    const normTarget = normalizeUserJid(targetJid);
    const clan = await this.clanRepo.findByMember(groupJid, normActor);
    if (clan?.leaderJid !== normActor) {
      throw new AppUserError("Hanya Ketua Geng yang bisa mengeluarkan anggota.");
    }
    if (normTarget === normActor) {
      throw new AppUserError("Ketua geng tidak bisa kick diri sendiri. Gunakan *.geng keluar*.");
    }

    const members = parseClanMembers(clan.memberJids);
    if (!members.includes(normTarget)) {
      throw new AppUserError("Member tersebut bukan anggota gengmu.");
    }

    await this.clanRepo.update(clan.id, {
      memberJids: members.filter((j) => j !== normTarget),
    });
    return { clanName: clan.name, kickedJid: normTarget };
  }

  async donateToClan(
    groupJid: string,
    userJid: string,
    amount: bigint,
  ): Promise<{ clanName: string; newTreasury: bigint; remainingMoney: bigint }> {
    if (amount < CLAN_MIN_DONATION) {
      throw new AppUserError(`Donasi kas geng minimal ${formatRupiah(CLAN_MIN_DONATION)}.`);
    }

    const normUser = normalizeUserJid(userJid);
    const clan = await this.clanRepo.findByMember(groupJid, normUser);
    if (!clan) {
      throw new AppUserError("Kamu harus bergabung di geng terlebih dahulu untuk berdonasi.");
    }

    const correlationId = generateCorrelationId();
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      if (profile.moneyBalance < amount) {
        throw new AppUserError(
          `Uang dompetmu tidak cukup (dompet: ${formatRupiah(profile.moneyBalance)}).`,
        );
      }

      const updatedProfile = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { moneyBalance: { decrement: amount } },
      });

      const updatedClan = tx.groupClan
        ? await tx.groupClan.update({
            where: { id: clan.id },
            data: { treasuryBalance: { increment: amount } },
          })
        : await this.clanRepo.update(clan.id, {
            treasuryBalance: { increment: amount },
          });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -amount,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updatedProfile.moneyBalance,
          correlationId,
          note: `clan_donate:${clan.slug}`,
        },
        tx,
      );

      return {
        clanName: clan.name,
        newTreasury: updatedClan.treasuryBalance,
        remainingMoney: updatedProfile.moneyBalance,
      };
    });
  }

  getClanInfo(groupJid: string, userJid: string, rawName?: string): Promise<GroupClan | null> {
    if (rawName?.trim()) {
      return this.clanRepo.findBySlug(groupJid, slugifyClanName(rawName));
    }
    return this.clanRepo.findByMember(groupJid, normalizeUserJid(userJid));
  }

  listTopClans(groupJid: string): Promise<GroupClan[]> {
    return this.clanRepo.listByGroup(groupJid);
  }

  // ======================== LELANG GRUP ========================

  getAuction(groupJid: string, nowMs = Date.now()): GroupAuctionSession | null {
    this.sweepAuctions(nowMs);
    return this.auctions.get(groupJid) ?? null;
  }

  openAuction(
    groupJid: string,
    sellerJid: string,
    rawItemName: string,
    startPrice: bigint,
    nowMs = Date.now(),
  ): GroupAuctionSession {
    this.sweepAuctions(nowMs);
    if (this.auctions.has(groupJid)) {
      throw new AppUserError("Masih ada lelang aktif di grup ini! Cek dengan *.lelang info*.");
    }

    const itemName = rawItemName.replace(/\s+/g, " ").trim();
    if (itemName.length < 2 || itemName.length > 60) {
      throw new AppUserError("Nama barang lelang harus 2-60 karakter.");
    }
    if (startPrice < AUCTION_MIN_START) {
      throw new AppUserError(`Harga pembukaan lelang minimal ${formatRupiah(AUCTION_MIN_START)}.`);
    }

    if (this.auctions.size >= MAX_AUCTIONS) {
      const oldest = this.auctions.keys().next().value;
      if (oldest) this.auctions.delete(oldest);
    }

    const session: GroupAuctionSession = {
      groupJid,
      sellerJid: normalizeUserJid(sellerJid),
      itemName,
      startPrice,
      currentBid: startPrice,
      highestBidderJid: null,
      createdAt: nowMs,
      expiresAt: nowMs + AUCTION_TTL_MS,
    };
    this.auctions.set(groupJid, session);
    return session;
  }

  async placeBid(
    groupJid: string,
    bidderJid: string,
    amount: bigint,
    nowMs = Date.now(),
  ): Promise<GroupAuctionSession> {
    this.sweepAuctions(nowMs);
    const session = this.auctions.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada lelang aktif di grup ini. Buka dengan *.lelang buka <barang> | <harga>*.");
    }

    const normBidder = normalizeUserJid(bidderJid);
    if (normBidder === session.sellerJid) {
      throw new AppUserError("Penjual tidak boleh menawar barang lelangnya sendiri!");
    }

    const minAllowed = session.highestBidderJid ? session.currentBid + 1n : session.startPrice;
    if (amount < minAllowed) {
      throw new AppUserError(
        `Tawaran harus minimal ${formatRupiah(minAllowed)} (harga saat ini: ${formatRupiah(session.currentBid)}).`,
      );
    }

    const bidderProfile = await this.profileRepo.findOrCreate(groupJid, normBidder);
    if (bidderProfile.moneyBalance < amount) {
      throw new AppUserError(
        `Uang dompetmu belum cukup untuk menawar ${formatRupiah(amount)} (dompet: ${formatRupiah(bidderProfile.moneyBalance)}).`,
      );
    }

    session.currentBid = amount;
    session.highestBidderJid = normBidder;
    session.expiresAt = nowMs + AUCTION_TTL_MS;
    return session;
  }

  async closeAuction(
    groupJid: string,
    actorJid: string,
    isAdminOrOwner: boolean,
    nowMs = Date.now(),
  ): Promise<{ session: GroupAuctionSession; settled: boolean }> {
    this.sweepAuctions(nowMs);
    const session = this.auctions.get(groupJid);
    if (!session) {
      throw new AppUserError("Tidak ada lelang aktif di grup ini.");
    }

    const normActor = normalizeUserJid(actorJid);
    if (!isAdminOrOwner && normActor !== session.sellerJid) {
      throw new AppUserError("Hanya pembuat lelang atau Admin yang bisa menutup lelang.");
    }

    this.auctions.delete(groupJid);
    if (!session.highestBidderJid) {
      return { session, settled: false };
    }

    const winnerJid = session.highestBidderJid;
    const price = session.currentBid;
    const correlationId = generateCorrelationId();

    await this.db.$transaction(async (tx) => {
      const buyer = await this.profileRepo.findOrCreate(groupJid, winnerJid, tx);
      if (buyer.moneyBalance < price) {
        throw new AppUserError(
          `Saldo penawar tertinggi (@${winnerJid.split("@")[0] ?? winnerJid}) sudah tidak cukup untuk membayar ${formatRupiah(price)}. Lelang dibatalkan.`,
        );
      }
      const seller = await this.profileRepo.findOrCreate(groupJid, session.sellerJid, tx);
      const sellerCredit = clampMoneyCredit(seller.moneyBalance, price);

      const updatedBuyer = await tx.groupMemberProfile.update({
        where: { id: buyer.id },
        data: { moneyBalance: { decrement: price } },
      });
      const updatedSeller = await tx.groupMemberProfile.update({
        where: { id: seller.id },
        data: {
          moneyBalance: { increment: sellerCredit },
          totalMoneyEarned: { increment: sellerCredit },
        },
      });

      await this.txRepo.create(
        {
          profileId: buyer.id,
          groupJid,
          userJid: winnerJid,
          targetUserJid: session.sellerJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -price,
          balanceBefore: buyer.moneyBalance,
          balanceAfter: updatedBuyer.moneyBalance,
          correlationId,
          note: `auction_buy:${session.itemName}`,
        },
        tx,
      );
      await this.txRepo.create(
        {
          profileId: seller.id,
          groupJid,
          userJid: session.sellerJid,
          targetUserJid: winnerJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_RECEIVED,
          amount: sellerCredit,
          balanceBefore: seller.moneyBalance,
          balanceAfter: updatedSeller.moneyBalance,
          correlationId,
          note: `auction_sell:${session.itemName}`,
        },
        tx,
      );
    });

    return { session, settled: true };
  }

  cancelAuction(
    groupJid: string,
    actorJid: string,
    isAdminOrOwner: boolean,
    nowMs = Date.now(),
  ): GroupAuctionSession {
    this.sweepAuctions(nowMs);
    const session = this.auctions.get(groupJid);
    if (!session) {
      throw new AppUserError("Tidak ada lelang aktif di grup ini.");
    }
    const normActor = normalizeUserJid(actorJid);
    if (!isAdminOrOwner && normActor !== session.sellerJid) {
      throw new AppUserError("Hanya pembuat lelang atau Admin yang bisa membatalkan lelang.");
    }
    this.auctions.delete(groupJid);
    return session;
  }

  private sweepProposals(nowMs: number): void {
    for (const [k, p] of this.proposals.entries()) {
      if (p.expiresAt <= nowMs) this.proposals.delete(k);
    }
  }

  private sweepAuctions(nowMs: number): void {
    for (const [k, a] of this.auctions.entries()) {
      if (a.expiresAt <= nowMs) this.auctions.delete(k);
    }
  }
}

export const socialEconomyService = new SocialEconomyService();
