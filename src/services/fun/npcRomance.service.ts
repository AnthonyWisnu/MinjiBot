import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type Prisma,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { formatRemainingDuration, formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import {
  readGroupEventSection,
  writeGroupEventSection,
  type GroupEventTenantClient,
} from "../group/groupEventState.store";
import { applyGroupXpEvent } from "../group/groupXpEvent.cache";
import { geekNetworkService, type AniListCharacterResult } from "../info/geekNetwork.service";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import {
  getPrimaryNpcPartner,
  getRemainingCooldownMs,
  MAX_NPC_PARTNER_SLOTS,
  parseRpgState,
  serializeRpgState,
  withNpcRomance,
  withUpdatedCooldown,
  type NpcCharacterGender,
  type NpcCharacterKind,
  type NpcPartnerEntry,
  type NpcPartnerRelation,
} from "../rpg/rpgState";
import { findCuratedGameCharacter, renderNpcFallbackAvatar } from "./npcCharacterCatalog";

export const NPC_ROLL_COOLDOWN_MS = 5 * 60 * 1000; // 5 menit per gacha roll kecocokan
export const NPC_TICKET_TTL_MS = 15 * 60 * 1000; // 15 menit tiket tembak saat >= 90%
export const NPC_COMPAT_THRESHOLD = 90;
export const NPC_PROPOSE_COST = 50_000_000n;
export const NPC_DATE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 jam antar kencan
export const NPC_DATE_COST = 15_000_000n;
export const NPC_DATE_XP = 80;
export const NPC_DATE_AFFECTION_EXP = 50;
export const NPC_MARRY_MIN_AFFECTION_LEVEL = 3;
export const NPC_MARRY_COST = 200_000_000n;
export const NPC_MARRY_XP = 350;
export const NPC_MAX_AFFECTION_LEVEL = 10;

export const NPC_SLOT_UPGRADE_COSTS: Record<number, bigint> = {
  2: 250_000_000n,
  3: 750_000_000n,
  4: 2_000_000_000n,
};

const DATE_STORIES = [
  "jalan sore di tepi taman bunga sambil minum matcha hangat berdua",
  "nonton film malam di bioskop VIP sambil rebutan popcorn karamel",
  "kulineran ramen tengah malam di kedai favorit sambil ketawa bareng",
  "bermain arkade bareng dan berhasil memenangkan boneka lucu untuknya",
  "duduk santai memandangi bintang di rooftop sambil berbagi cerita masa depan",
  "piknik estetik di bukit sambil menikmati sunset dan angin sore",
] as const;

export interface ResolvedNpcCharacter {
  characterKey: string;
  name: string;
  sourceTitle: string;
  kind: NpcCharacterKind;
  gender: NpcCharacterGender;
  tagline: string;
  imageUrl: string | null;
  imageBuffer: Buffer;
}

export interface GroupNpcClaimEntry {
  characterKey: string;
  ownerJid: string;
  name: string;
  sourceTitle: string;
  relation: NpcPartnerRelation;
  claimedAt: number;
}

export interface NpcCompatibilityRollResult {
  character: ResolvedNpcCharacter;
  score: number;
  verdict: string;
  canPropose: boolean;
  alreadyOwnedBySelf: boolean;
  claimedByOtherJid: string | null;
  claimedByOtherRelation: NpcPartnerRelation | null;
  lockedByMemberPartner: boolean;
  ticketExpiresAt: number | null;
}

export interface NpcProposeResult {
  accepted: boolean;
  characterName: string;
  sourceTitle: string;
  kind: NpcCharacterKind;
  score: number;
  costPaid: bigint;
  xpGained: number;
  partnerCount: number;
  maxSlots: number;
  currentMoney: bigint;
  imageUrl: string | null;
}

export interface NpcDateResult {
  partner: NpcPartnerEntry;
  story: string;
  costPaid: bigint;
  xpGained: number;
  oldAffectionLevel: number;
  newAffectionLevel: number;
  readyToMarry: boolean;
  currentMoney: bigint;
}

export interface NpcMarryResult {
  partner: NpcPartnerEntry;
  costPaid: bigint;
  xpGained: number;
  currentMoney: bigint;
}

export interface NpcSlotBuyResult {
  oldSlots: number;
  newSlots: number;
  costPaid: bigint;
  currentMoney: bigint;
}

export interface NpcBreakupResult {
  removed: NpcPartnerEntry;
  remainingCount: number;
}

export interface NpcRomanceOverview {
  userJid: string;
  maxSlots: number;
  primary: NpcPartnerEntry | null;
  partners: NpcPartnerEntry[];
  nextSlotCost: bigint | null;
  lockedByMemberJid: string | null;
}

interface NpcProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface NpcTxStore {
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

interface NpcTx {
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

interface NpcDb {
  $transaction<T>(fn: (tx: NpcTx) => Promise<T>): Promise<T>;
  tenantGroup?: GroupEventTenantClient;
}

interface CharacterLookupProvider {
  searchAniListCharacter(queryText: string): Promise<AniListCharacterResult>;
}

function normalizeGender(raw: string | null | undefined): NpcCharacterGender {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "female" || val === "f" || val === "perempuan" || val === "wanita") return "female";
  if (val === "male" || val === "m" || val === "laki-laki" || val === "pria") return "male";
  return "other";
}

function defaultMarriageRelation(
  gender: NpcCharacterGender,
  requested?: string,
): NpcPartnerRelation {
  const req = (requested ?? "").trim().toLowerCase();
  if (req === "istri" || req === "waifu" || req === "wife") return "istri";
  if (req === "suami" || req === "husbando" || req === "husband") return "suami";
  if (gender === "female") return "istri";
  if (gender === "male") return "suami";
  return "pasangan";
}

export function formatNpcRelationLabel(relation: NpcPartnerRelation): string {
  switch (relation) {
    case "istri":
      return "Istri Sah";
    case "suami":
      return "Suami Sah";
    case "pasangan":
      return "Pasangan Sah";
    case "pacar":
      return "Pacar";
  }
}

function parsePersistedNpcClaims(raw: unknown): Map<string, GroupNpcClaimEntry> {
  const map = new Map<string, GroupNpcClaimEntry>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return map;
  }
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const rec = val as Record<string, unknown>;
    if (
      typeof rec.ownerJid === "string" &&
      rec.ownerJid.length > 0 &&
      typeof rec.name === "string" &&
      rec.name.length > 0
    ) {
      const relation: NpcPartnerRelation =
        rec.relation === "istri" ||
        rec.relation === "suami" ||
        rec.relation === "pasangan" ||
        rec.relation === "pacar"
          ? rec.relation
          : "pacar";
      map.set(key, {
        characterKey: key,
        ownerJid: normalizeUserJid(rec.ownerJid),
        name: rec.name.slice(0, 64),
        sourceTitle: typeof rec.sourceTitle === "string" ? rec.sourceTitle.slice(0, 80) : "Anime/Game",
        relation,
        claimedAt:
          typeof rec.claimedAt === "number" && Number.isFinite(rec.claimedAt)
            ? Math.floor(rec.claimedAt)
            : 0,
      });
    }
  }
  return map;
}

function serializePersistedNpcClaims(
  claims: Map<string, GroupNpcClaimEntry>,
): Prisma.InputJsonValue | null {
  if (claims.size === 0) return null;
  const out: Record<string, Record<string, string | number>> = {};
  for (const [key, entry] of claims.entries()) {
    out[key] = {
      ownerJid: entry.ownerJid,
      name: entry.name,
      sourceTitle: entry.sourceTitle,
      relation: entry.relation,
      claimedAt: entry.claimedAt,
    };
  }
  return out;
}

function selectPartnerFromList(
  partners: readonly NpcPartnerEntry[],
  query?: string,
): NpcPartnerEntry | null {
  if (partners.length === 0) return null;
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return partners[0] ?? null;
  if (/^\d+$/.test(q)) {
    const idx = Number.parseInt(q, 10) - 1;
    return partners[idx] ?? null;
  }
  return (
    partners.find((p) => p.name.toLowerCase() === q) ??
    partners.find((p) => p.name.toLowerCase().includes(q)) ??
    partners.find((p) => p.sourceTitle.toLowerCase().includes(q)) ??
    null
  );
}

export class NpcRomanceService {
  private readonly claimsByGroup = new Map<string, Map<string, GroupNpcClaimEntry>>();
  private readonly hydratedGroups = new Set<string>();

  constructor(
    private readonly profileRepo: NpcProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: NpcTxStore = new GroupMemberTransactionRepository(),
    private readonly lookupProvider: CharacterLookupProvider = geekNetworkService,
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: NpcDb = prisma,
  ) {}

  resetCacheForTests(): void {
    this.claimsByGroup.clear();
    this.hydratedGroups.clear();
  }

  private async hydrateClaims(groupJid: string): Promise<Map<string, GroupNpcClaimEntry>> {
    if (!this.hydratedGroups.has(groupJid)) {
      this.hydratedGroups.add(groupJid);
      const raw = await readGroupEventSection(this.db.tenantGroup, groupJid, "npcClaims");
      this.claimsByGroup.set(groupJid, parsePersistedNpcClaims(raw));
    }
    let map = this.claimsByGroup.get(groupJid);
    if (!map) {
      map = new Map<string, GroupNpcClaimEntry>();
      this.claimsByGroup.set(groupJid, map);
    }
    return map;
  }

  private async persistClaims(groupJid: string): Promise<void> {
    const map = this.claimsByGroup.get(groupJid) ?? new Map<string, GroupNpcClaimEntry>();
    await writeGroupEventSection(
      this.db.tenantGroup,
      groupJid,
      "npcClaims",
      serializePersistedNpcClaims(map),
    );
  }

  async resolveCharacter(rawQuery: string): Promise<ResolvedNpcCharacter> {
    const cleaned = rawQuery.trim();
    if (cleaned.length < 2) {
      throw new AppUserError(
        "Masukkan nama karakter anime atau game! Contoh: *.cocoknpc Frieren* atau *.cocoknpc Raiden Shogun*",
      );
    }

    const curated = findCuratedGameCharacter(cleaned);
    if (curated) {
      let imageBuffer: Buffer | null = null;
      let imageUrl: string | null = null;
      if (curated.anilistSearchHint) {
        try {
          const ani = await this.lookupProvider.searchAniListCharacter(curated.anilistSearchHint);
          imageBuffer = ani.imageBuffer;
          imageUrl = ani.imageUrl;
        } catch {
          // Gunakan avatar fallback karakter game jika AniList tidak merespons
        }
      }
      const finalBuffer =
        imageBuffer && imageBuffer.length > 0
          ? imageBuffer
          : await renderNpcFallbackAvatar({
              name: curated.name,
              sourceTitle: curated.sourceTitle,
              kind: curated.kind,
              accentColor: curated.accentColor,
            });
      return {
        characterKey: curated.key,
        name: curated.name,
        sourceTitle: curated.sourceTitle,
        kind: curated.kind,
        gender: curated.gender,
        tagline: curated.tagline,
        imageUrl,
        imageBuffer: finalBuffer,
      };
    }

    const ani = await this.lookupProvider.searchAniListCharacter(cleaned);
    const slug = ani.nameFull
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const characterKey = ani.id ? `anilist:${String(ani.id)}` : `anilist:${slug || "unknown"}`;
    const sourceTitle = ani.appearances[0] ?? "Anime / Manga";
    const gender = normalizeGender(ani.gender);
    const finalBuffer =
      ani.imageBuffer && ani.imageBuffer.length > 0
        ? ani.imageBuffer
        : await renderNpcFallbackAvatar({
            name: ani.nameFull,
            sourceTitle,
            kind: "anime",
          });

    return {
      characterKey,
      name: ani.nameFull,
      sourceTitle,
      kind: "anime",
      gender,
      tagline:
        ani.description && ani.description !== "-"
          ? ani.description.slice(0, 120)
          : `Karakter populer dari ${sourceTitle}.`,
      imageUrl: ani.imageUrl,
      imageBuffer: finalBuffer,
    };
  }

  async rollCompatibility(
    groupJid: string,
    userJid: string,
    rawQuery: string,
    now: Date = new Date(),
  ): Promise<NpcCompatibilityRollResult> {
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();

    const preProfile = await this.profileRepo.findOrCreate(groupJid, normUser);
    const preState = parseRpgState(preProfile.rpgState);
    const remCd = getRemainingCooldownMs(preState, "npc_cocok", NPC_ROLL_COOLDOWN_MS, nowMs);
    if (remCd > 0) {
      throw new AppUserError(
        `Radar kecocokan masih mengisi ulang energi. Tunggu *${formatRemainingDuration(remCd)}* lagi sebelum roll karakter berikutnya!`,
      );
    }

    const character = await this.resolveCharacter(rawQuery);
    const claims = await this.hydrateClaims(groupJid);
    const existingClaim = claims.get(character.characterKey);

    // Gacha roll: 15% peluang tembus >= 90% (90-100), 85% di rentang 15-89
    const isLuckyHigh = this.random.chance(0.15);
    const score = isLuckyHigh
      ? this.random.intBetween(NPC_COMPAT_THRESHOLD, 100)
      : this.random.intBetween(15, NPC_COMPAT_THRESHOLD - 1);

    const alreadyOwnedBySelf = preState.npcRomance.partners.some(
      (p) => p.characterKey === character.characterKey,
    );
    const claimedByOtherJid =
      existingClaim && existingClaim.ownerJid !== normUser ? existingClaim.ownerJid : null;
    const claimedByOtherRelation = claimedByOtherJid ? (existingClaim?.relation ?? "pacar") : null;
    const lockedByMemberPartner = Boolean(preProfile.partnerJid ?? preState.spouseJid);

    const canPropose =
      score >= NPC_COMPAT_THRESHOLD &&
      !alreadyOwnedBySelf &&
      !claimedByOtherJid &&
      !lockedByMemberPartner;

    const ticketExpiresAt = canPropose ? nowMs + NPC_TICKET_TTL_MS : null;

    await this.db.$transaction(async (tx) => {
      const fresh = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      let nextState = withUpdatedCooldown(parseRpgState(fresh.rpgState), "npc_cocok", nowMs);
      if (canPropose && ticketExpiresAt !== null) {
        nextState = withNpcRomance(nextState, {
          ...nextState.npcRomance,
          pendingTicket: {
            characterKey: character.characterKey,
            name: character.name,
            sourceTitle: character.sourceTitle,
            kind: character.kind,
            gender: character.gender,
            score,
            rolledAt: nowMs,
            expiresAt: ticketExpiresAt,
            imageUrl: character.imageUrl,
          },
        });
      }
      await tx.groupMemberProfile.update({
        where: { id: fresh.id },
        data: { rpgState: serializeRpgState(nextState) },
      });
    });

    let verdict: string;
    if (claimedByOtherJid) {
      verdict = `Sudah resmi dimiliki member lain di grup ini!`;
    } else if (alreadyOwnedBySelf) {
      verdict = `Sudah menjadi pasanganmu! Ajak .kencan biar makin mesra.`;
    } else if (score >= 95) {
      verdict = "TAKDIR SEJATI! 100% langsung terima kalau ditembak sekarang!";
    } else if (score >= NPC_COMPAT_THRESHOLD) {
      verdict = "COCOK PARAH (>=90%)! Segera tembak pakai .tembaknpc!";
    } else if (score >= 70) {
      verdict = "Nyaris nembus 90%! Coba roll lagi setelah cooldown selesai.";
    } else if (score >= 45) {
      verdict = "Chemistry lumayan, masih perlu hoki sedikit lagi.";
    } else {
      verdict = "Belum klik hari ini, sabar dan coba roll lagi nanti ya!";
    }

    return {
      character,
      score,
      verdict,
      canPropose,
      alreadyOwnedBySelf,
      claimedByOtherJid,
      claimedByOtherRelation,
      lockedByMemberPartner,
      ticketExpiresAt,
    };
  }

  async proposeToNpc(
    groupJid: string,
    userJid: string,
    optionalNameQuery?: string,
    now: Date = new Date(),
  ): Promise<NpcProposeResult> {
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();
    const claims = await this.hydrateClaims(groupJid);

    const correlationId = generateCorrelationId();
    const xpOnAccept = applyGroupXpEvent(groupJid, 120, nowMs);
    const xpOnReject = applyGroupXpEvent(groupJid, 25, nowMs);

    const outcome = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);

      if (profile.partnerJid || state.spouseJid) {
        throw new AppUserError(
          "Kamu sudah berpasangan/menikah dengan member asli di grup ini! Sistem saling mengunci aktif, selesaikan dulu lewat *.putus* atau *.cerai*.",
        );
      }

      const ticket = state.npcRomance.pendingTicket;
      if (!ticket || ticket.expiresAt <= nowMs) {
        throw new AppUserError(
          `Kamu belum punya tiket kecocokan >=${String(NPC_COMPAT_THRESHOLD)}% yang aktif (atau sudah kedaluwarsa 15 menit). Roll dulu lewat *.cocoknpc <nama karakter>*!`,
        );
      }

      const q = (optionalNameQuery ?? "").trim().toLowerCase();
      if (q && !ticket.name.toLowerCase().includes(q) && !ticket.sourceTitle.toLowerCase().includes(q)) {
        throw new AppUserError(
          `Tiket >=90% aktifmu saat ini adalah untuk *${ticket.name}* (${String(ticket.score)}%). Ketik *.tembaknpc* langsung untuk menembaknya, atau roll ulang *.cocoknpc ${optionalNameQuery ?? ""}*.`,
        );
      }

      const claimed = claims.get(ticket.characterKey);
      if (claimed && claimed.ownerJid !== normUser) {
        throw new AppUserError(
          `Yah telat! *${ticket.name}* baru saja resmi menjadi ${formatNpcRelationLabel(claimed.relation)} milik @${claimed.ownerJid.split("@")[0] ?? claimed.ownerJid} di grup ini.`,
        );
      }
      if (state.npcRomance.partners.some((p) => p.characterKey === ticket.characterKey)) {
        throw new AppUserError(`*${ticket.name}* sudah ada di daftar pasanganmu!`);
      }

      if (state.npcRomance.partners.length >= state.npcRomance.maxSlots) {
        const nextSlot = state.npcRomance.maxSlots + 1;
        const nextCost = NPC_SLOT_UPGRADE_COSTS[nextSlot];
        throw new AppUserError(
          nextCost
            ? `Slot pasangan NPC kamu penuh (${String(state.npcRomance.partners.length)}/${String(state.npcRomance.maxSlots)}). Tambah slot lewat *.waifuslot* (${formatRupiah(nextCost)}) atau putuskan salah satu lewat *.putusnpc*.`
            : `Slot pasangan NPC kamu sudah mencapai batas maksimal (${String(MAX_NPC_PARTNER_SLOTS)}/${String(MAX_NPC_PARTNER_SLOTS)}). Putuskan salah satu lewat *.putusnpc* jika ingin ganti.`,
        );
      }

      if (profile.moneyBalance < NPC_PROPOSE_COST) {
        throw new AppUserError(
          `Biaya bunga & kencan penembakan adalah ${formatRupiah(NPC_PROPOSE_COST)}, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const accepted = ticket.score >= 95 ? true : this.random.chance(0.8);
      const xpGained = accepted ? xpOnAccept : xpOnReject;

      const nextPartners = [...state.npcRomance.partners];
      if (accepted) {
        nextPartners.push({
          characterKey: ticket.characterKey,
          name: ticket.name,
          sourceTitle: ticket.sourceTitle,
          kind: ticket.kind,
          gender: ticket.gender,
          relation: "pacar",
          affectionLevel: 1,
          affectionExp: 0,
          startedAt: nowMs,
          marriedAt: 0,
          lastDateAt: 0,
          imageUrl: ticket.imageUrl,
        });
      }

      const nextState = withNpcRomance(state, {
        ...state.npcRomance,
        primaryKey: state.npcRomance.primaryKey ?? (accepted ? ticket.characterKey : null),
        partners: nextPartners,
        pendingTicket: null,
      });

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: NPC_PROPOSE_COST } },
        data: {
          moneyBalance: { decrement: NPC_PROPOSE_COST },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat memproses penembakan.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -NPC_PROPOSE_COST,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `npc_propose:${ticket.characterKey}:${accepted ? "accepted" : "rejected"}`,
        },
        tx,
      );

      return {
        accepted,
        ticket,
        xpGained,
        partnerCount: nextPartners.length,
        maxSlots: nextState.npcRomance.maxSlots,
        currentMoney: updated.moneyBalance,
      };
    });

    if (outcome.accepted) {
      claims.set(outcome.ticket.characterKey, {
        characterKey: outcome.ticket.characterKey,
        ownerJid: normUser,
        name: outcome.ticket.name,
        sourceTitle: outcome.ticket.sourceTitle,
        relation: "pacar",
        claimedAt: nowMs,
      });
      await this.persistClaims(groupJid);
    }

    return {
      accepted: outcome.accepted,
      characterName: outcome.ticket.name,
      sourceTitle: outcome.ticket.sourceTitle,
      kind: outcome.ticket.kind,
      score: outcome.ticket.score,
      costPaid: NPC_PROPOSE_COST,
      xpGained: outcome.xpGained,
      partnerCount: outcome.partnerCount,
      maxSlots: outcome.maxSlots,
      currentMoney: outcome.currentMoney,
      imageUrl: outcome.ticket.imageUrl,
    };
  }

  async dateNpcPartner(
    groupJid: string,
    userJid: string,
    partnerQuery?: string,
    now: Date = new Date(),
  ): Promise<NpcDateResult> {
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();
    const xpGained = applyGroupXpEvent(groupJid, NPC_DATE_XP, nowMs);
    const story =
      DATE_STORIES[this.random.intBetween(0, DATE_STORIES.length - 1)] ?? DATE_STORIES[0];
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);

      const target = selectPartnerFromList(state.npcRomance.partners, partnerQuery);
      if (!target) {
        throw new AppUserError(
          state.npcRomance.partners.length === 0
            ? "Kamu belum punya pasangan karakter anime/game! Cari kecocokan >=90% dulu lewat *.cocoknpc <nama>*."
            : `Pasangan "${partnerQuery ?? ""}" tidak ditemukan di daftarmu. Cek lewat *.waifuku*.`,
        );
      }

      if (target.lastDateAt > 0 && nowMs - target.lastDateAt < NPC_DATE_COOLDOWN_MS) {
        const rem = NPC_DATE_COOLDOWN_MS - (nowMs - target.lastDateAt);
        throw new AppUserError(
          `Kamu baru saja berkencan dengan *${target.name}*. Tunggu *${formatRemainingDuration(rem)}* lagi ya!`,
        );
      }

      if (profile.moneyBalance < NPC_DATE_COST) {
        throw new AppUserError(
          `Biaya kencan adalah ${formatRupiah(NPC_DATE_COST)}, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const oldLevel = target.affectionLevel;
      let nextLevel = oldLevel;
      let nextExp = target.affectionExp + NPC_DATE_AFFECTION_EXP;
      while (nextLevel < NPC_MAX_AFFECTION_LEVEL && nextExp >= nextLevel * 50) {
        nextExp -= nextLevel * 50;
        nextLevel += 1;
      }

      const updatedPartner: NpcPartnerEntry = {
        ...target,
        affectionLevel: nextLevel,
        affectionExp: nextExp,
        lastDateAt: nowMs,
      };
      const nextPartners = state.npcRomance.partners.map((p) =>
        p.characterKey === target.characterKey ? updatedPartner : p,
      );
      const nextState = withNpcRomance(state, { ...state.npcRomance, partners: nextPartners });

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: NPC_DATE_COST } },
        data: {
          moneyBalance: { decrement: NPC_DATE_COST },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk biaya kencan.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -NPC_DATE_COST,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `npc_date:${target.characterKey}`,
        },
        tx,
      );

      return {
        partner: updatedPartner,
        story,
        costPaid: NPC_DATE_COST,
        xpGained,
        oldAffectionLevel: oldLevel,
        newAffectionLevel: nextLevel,
        readyToMarry:
          updatedPartner.relation === "pacar" &&
          updatedPartner.affectionLevel >= NPC_MARRY_MIN_AFFECTION_LEVEL,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async marryNpcPartner(
    groupJid: string,
    userJid: string,
    partnerQuery?: string,
    requestedRelation?: string,
    now: Date = new Date(),
  ): Promise<NpcMarryResult> {
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();
    const claims = await this.hydrateClaims(groupJid);
    const xpGained = applyGroupXpEvent(groupJid, NPC_MARRY_XP, nowMs);
    const correlationId = generateCorrelationId();

    const result = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);

      if (profile.partnerJid || state.spouseJid) {
        throw new AppUserError(
          "Kamu sedang terikat hubungan dengan member asli! Selesaikan dulu lewat *.putus* / *.cerai*.",
        );
      }

      const target = selectPartnerFromList(state.npcRomance.partners, partnerQuery);
      if (!target) {
        throw new AppUserError(
          state.npcRomance.partners.length === 0
            ? "Kamu belum punya pacar karakter NPC untuk dinikahi!"
            : `Pasangan "${partnerQuery ?? ""}" tidak ditemukan di *.waifuku*.`,
        );
      }
      if (target.relation !== "pacar") {
        throw new AppUserError(
          `*${target.name}* sudah resmi menjadi *${formatNpcRelationLabel(target.relation)}*-mu!`,
        );
      }
      if (target.affectionLevel < NPC_MARRY_MIN_AFFECTION_LEVEL) {
        throw new AppUserError(
          `Level Cinta dengan *${target.name}* masih Lv.${String(target.affectionLevel)}/${String(NPC_MARRY_MIN_AFFECTION_LEVEL)}. Ajak *.kencan* dulu sampai minimal Lv.${String(NPC_MARRY_MIN_AFFECTION_LEVEL)} sebelum melamar nikah!`,
        );
      }
      if (profile.moneyBalance < NPC_MARRY_COST) {
        throw new AppUserError(
          `Biaya cincin & resepsi nikah adalah ${formatRupiah(NPC_MARRY_COST)}, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextRelation = defaultMarriageRelation(target.gender, requestedRelation);
      const updatedPartner: NpcPartnerEntry = {
        ...target,
        relation: nextRelation,
        marriedAt: nowMs,
      };
      const nextPartners = state.npcRomance.partners.map((p) =>
        p.characterKey === target.characterKey ? updatedPartner : p,
      );
      const nextState = withNpcRomance(state, { ...state.npcRomance, partners: nextPartners });

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: NPC_MARRY_COST } },
        data: {
          moneyBalance: { decrement: NPC_MARRY_COST },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk biaya pernikahan.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -NPC_MARRY_COST,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `npc_marry:${target.characterKey}:${nextRelation}`,
        },
        tx,
      );

      return {
        partner: updatedPartner,
        costPaid: NPC_MARRY_COST,
        xpGained,
        currentMoney: updated.moneyBalance,
      };
    });

    claims.set(result.partner.characterKey, {
      characterKey: result.partner.characterKey,
      ownerJid: normUser,
      name: result.partner.name,
      sourceTitle: result.partner.sourceTitle,
      relation: result.partner.relation,
      claimedAt: result.partner.startedAt || nowMs,
    });
    await this.persistClaims(groupJid);

    return result;
  }

  async buyExtraSlot(groupJid: string, userJid: string): Promise<NpcSlotBuyResult> {
    const normUser = normalizeUserJid(userJid);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);
      const currentSlots = state.npcRomance.maxSlots;
      if (currentSlots >= MAX_NPC_PARTNER_SLOTS) {
        throw new AppUserError(
          `Slot pasangan NPC kamu sudah maksimal (${String(MAX_NPC_PARTNER_SLOTS)}/${String(MAX_NPC_PARTNER_SLOTS)})!`,
        );
      }

      const nextSlots = currentSlots + 1;
      const cost = NPC_SLOT_UPGRADE_COSTS[nextSlots] ?? 2_000_000_000n;
      if (profile.moneyBalance < cost) {
        throw new AppUserError(
          `Biaya buka Slot ke-${String(nextSlots)} adalah ${formatRupiah(cost)}, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withNpcRomance(state, { ...state.npcRomance, maxSlots: nextSlots });
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: cost } },
        data: {
          moneyBalance: { decrement: cost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat membeli slot.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -cost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `npc_buy_slot_${String(nextSlots)}`,
        },
        tx,
      );

      return {
        oldSlots: currentSlots,
        newSlots: nextSlots,
        costPaid: cost,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async setPrimaryPartner(
    groupJid: string,
    userJid: string,
    partnerQuery: string,
  ): Promise<NpcPartnerEntry> {
    const normUser = normalizeUserJid(userJid);
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);
      const target = selectPartnerFromList(state.npcRomance.partners, partnerQuery);
      if (!target) {
        throw new AppUserError(
          `Karakter "${partnerQuery}" tidak ditemukan di daftar pasanganmu. Cek nomor/nama lewat *.waifuku*.`,
        );
      }
      const nextState = withNpcRomance(state, {
        ...state.npcRomance,
        primaryKey: target.characterKey,
      });
      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });
      return target;
    });
  }

  async breakupNpcPartner(
    groupJid: string,
    userJid: string,
    partnerQuery?: string,
  ): Promise<NpcBreakupResult> {
    const normUser = normalizeUserJid(userJid);
    const claims = await this.hydrateClaims(groupJid);

    const res = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);
      if (state.npcRomance.partners.length === 0) {
        throw new AppUserError("Kamu sedang tidak punya pasangan karakter anime/game.");
      }

      const target = selectPartnerFromList(state.npcRomance.partners, partnerQuery);
      if (!target) {
        throw new AppUserError(
          `Pasangan "${partnerQuery ?? ""}" tidak ditemukan di *.waifuku*. Masukkan nomor atau nama karakternya.`,
        );
      }

      const remaining = state.npcRomance.partners.filter(
        (p) => p.characterKey !== target.characterKey,
      );
      const nextPrimary =
        state.npcRomance.primaryKey === target.characterKey
          ? (remaining[0]?.characterKey ?? null)
          : state.npcRomance.primaryKey;
      const nextState = withNpcRomance(state, {
        ...state.npcRomance,
        primaryKey: nextPrimary,
        partners: remaining,
      });

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return { removed: target, remainingCount: remaining.length };
    });

    const existingClaim = claims.get(res.removed.characterKey);
    if (existingClaim?.ownerJid === normUser) {
      claims.delete(res.removed.characterKey);
      await this.persistClaims(groupJid);
    }

    return res;
  }

  async getOverview(groupJid: string, userJid: string): Promise<NpcRomanceOverview> {
    const normUser = normalizeUserJid(userJid);
    const profile = await this.profileRepo.findOrCreate(groupJid, normUser);
    const state = parseRpgState(profile.rpgState);
    const nextSlots = state.npcRomance.maxSlots + 1;
    const nextSlotCost =
      nextSlots <= MAX_NPC_PARTNER_SLOTS ? (NPC_SLOT_UPGRADE_COSTS[nextSlots] ?? null) : null;
    return {
      userJid: normUser,
      maxSlots: state.npcRomance.maxSlots,
      primary: getPrimaryNpcPartner(state),
      partners: state.npcRomance.partners,
      nextSlotCost,
      lockedByMemberJid: state.spouseJid ?? profile.partnerJid ?? null,
    };
  }

  async listGroupClaims(groupJid: string): Promise<GroupNpcClaimEntry[]> {
    const claims = await this.hydrateClaims(groupJid);
    return Array.from(claims.values()).sort((a, b) => b.claimedAt - a.claimedAt);
  }
}

export const npcRomanceService = new NpcRomanceService();
