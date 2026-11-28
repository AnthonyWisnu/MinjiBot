import { AppUserError } from "../../errors/appUserError";
import { formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId, MemberEconomyService } from "../member/memberEconomy.service";

export interface SambungKataSession {
  groupJid: string;
  currentWord: string;
  usedWords: Set<string>;
  chainCount: number;
  lastPlayerJid: string | null;
  expiresAt: number;
  messageId?: string;
}

export interface SambungKataResult {
  accepted: boolean;
  text: string;
  mentions?: string[];
  finished?: boolean;
}

export const SAMBUNG_KATA_TTL_MS = 3 * 60 * 1000;
export const SAMBUNG_KATA_REWARD_PER_WORD = 1_000_000n;
export const SAMBUNG_KATA_COMBO_BONUS = 10_000_000n;
export const SAMBUNG_KATA_COMBO_TARGET = 10;
const MAX_SAMBUNG_ROOMS = 50;

const STARTER_WORDS = [
  "MAKAN",
  "MINUM",
  "TIDUR",
  "JALAN",
  "RUMAH",
  "BUKU",
  "KUCING",
  "HUJAN",
  "KOPI",
  "PANTAI",
  "GUNUNG",
  "MUSIK",
  "BINTANG",
  "AWAN",
  "SEPATU",
  "SEPEDAH",
  "SEKOLAH",
  "TEMAN",
  "MALAM",
  "SIANG",
] as const;

interface SambungEconomy {
  creditMoney(input: {
    groupJid: string;
    userJid: string;
    amount: bigint;
    type: "GAME_REWARD";
    scaleByLevel?: boolean;
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
  creditPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
  creditXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
}

export class SambungKataService {
  private readonly sessions = new Map<string, SambungKataSession>();

  constructor(private readonly economy: SambungEconomy = new MemberEconomyService()) {}

  getSession(groupJid: string, nowMs = Date.now()): SambungKataSession | null {
    this.sweepExpired(nowMs);
    return this.sessions.get(groupJid) ?? null;
  }

  setMessageId(groupJid: string, messageId: string): void {
    const s = this.sessions.get(groupJid);
    if (s) s.messageId = messageId;
  }

  startGame(groupJid: string, nowMs = Date.now()): { session: SambungKataSession; text: string } {
    this.sweepExpired(nowMs);
    const existing = this.sessions.get(groupJid);
    if (existing) {
      const nextLetter = existing.currentWord.slice(-1);
      return {
        session: existing,
        text: [
          "*── [ SAMBUNG KATA AKTIF ] ──*",
          `Kata terakhir : *${existing.currentWord}*`,
          `Huruf awal    : *${nextLetter}*`,
          `Rantai        : ${String(existing.chainCount)} / ${String(SAMBUNG_KATA_COMBO_TARGET)}`,
          "",
          `_Swipe/reply pesan ini dengan kata berawalan huruf *${nextLetter}*!_`,
        ].join("\n"),
      };
    }

    if (this.sessions.size >= MAX_SAMBUNG_ROOMS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }

    const idx = Math.floor(Math.random() * STARTER_WORDS.length);
    const starter = STARTER_WORDS[idx] ?? "MAKAN";
    const session: SambungKataSession = {
      groupJid,
      currentWord: starter,
      usedWords: new Set([starter]),
      chainCount: 0,
      lastPlayerJid: null,
      expiresAt: nowMs + SAMBUNG_KATA_TTL_MS,
    };
    this.sessions.set(groupJid, session);

    const nextLetter = starter.slice(-1);
    return {
      session,
      text: [
        "*── [ SAMBUNG KATA DIMULAI ] ──*",
        `Kata Pertama : *${starter}*`,
        `Lanjutkan    : Kata berawalan huruf *${nextLetter}* (min 3 huruf)`,
        `Hadiah       : ${formatRupiah(SAMBUNG_KATA_REWARD_PER_WORD)}/kata (Combo ${String(SAMBUNG_KATA_COMBO_TARGET)}x = Bonus ${formatRupiah(SAMBUNG_KATA_COMBO_BONUS)}!)`,
        "",
        "_Swipe/reply pesan ini langsung dengan kata sambunganmu, atau ketik .sambungkata stop._",
      ].join("\n"),
    };
  }

  stopGame(groupJid: string): void {
    if (!this.sessions.delete(groupJid)) {
      throw new AppUserError("Tidak ada sesi Sambung Kata aktif di grup ini.");
    }
  }

  async submitWord(
    groupJid: string,
    userJid: string,
    rawWord: string,
    nowMs = Date.now(),
  ): Promise<SambungKataResult> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      return { accepted: false, text: "" };
    }

    const cleaned = rawWord.trim().toUpperCase();
    if (!/^[A-Z]{3,24}$/.test(cleaned)) {
      return {
        accepted: false,
        text: "Masukkan 1 kata huruf alfabet minimal 3 huruf tanpa spasi/angka.",
      };
    }

    const normUser = normalizeUserJid(userJid);
    const requiredStart = session.currentWord.slice(-1);
    if (!cleaned.startsWith(requiredStart)) {
      return {
        accepted: false,
        text: `Kata harus diawali huruf *${requiredStart}* (dari *${session.currentWord}*)!`,
      };
    }

    if (session.usedWords.has(cleaned)) {
      return {
        accepted: false,
        text: `Kata *${cleaned}* sudah pernah dipakai di ronde ini! Cari kata lain berawalan *${requiredStart}*.`,
      };
    }

    if (session.lastPlayerJid === normUser) {
      return {
        accepted: false,
        text: "Gantian dulu ya! Biarkan teman lain yang menyambung kata berikutnya.",
      };
    }

    session.usedWords.add(cleaned);
    session.currentWord = cleaned;
    session.chainCount += 1;
    session.lastPlayerJid = normUser;
    session.expiresAt = nowMs + SAMBUNG_KATA_TTL_MS;

    const isComboWin = session.chainCount >= SAMBUNG_KATA_COMBO_TARGET;
    const moneyReward = isComboWin
      ? SAMBUNG_KATA_REWARD_PER_WORD + SAMBUNG_KATA_COMBO_BONUS
      : SAMBUNG_KATA_REWARD_PER_WORD;
    const xpReward = isComboWin ? 120 : 25;
    const pointsReward = isComboWin ? 25 : 5;
    const correlationId = generateCorrelationId();

    await Promise.allSettled([
      this.economy.creditMoney({
        groupJid,
        userJid: normUser,
        amount: moneyReward,
        type: "GAME_REWARD",
        scaleByLevel: true,
        correlationId,
        note: isComboWin ? "sambungkata_combo" : "sambungkata_word",
      }),
      this.economy.creditPoints({
        groupJid,
        userJid: normUser,
        amount: pointsReward,
        type: "GAME_REWARD",
        correlationId,
        note: "sambungkata_points",
      }),
      this.economy.creditXp({
        groupJid,
        userJid: normUser,
        amount: xpReward,
        type: "GAME_REWARD",
        correlationId,
        note: "sambungkata_xp",
      }),
    ]);

    const tag = `@${normUser.split("@")[0] ?? normUser}`;
    if (isComboWin) {
      this.sessions.delete(groupJid);
      return {
        accepted: true,
        finished: true,
        mentions: [normUser],
        text: [
          "*── [ COMBO SAMBUNG KATA 10X! ] ──*",
          `${tag} menutup rantai dengan kata *${cleaned}*!`,
          `Hadiah Combo : *${formatRupiah(moneyReward)}* (xBonus Lv) + ${String(pointsReward)} Poin + ${String(xpReward)} XP`,
          "",
          "Ketik *.sambungkata* untuk mulai ronde baru!",
        ].join("\n"),
      };
    }

    const nextLetter = cleaned.slice(-1);
    return {
      accepted: true,
      finished: false,
      mentions: [normUser],
      text: [
        "*── [ SAMBUNG KATA ] ──*",
        `${tag}: *${cleaned}* (+${formatRupiah(moneyReward)} & +${String(xpReward)} XP)`,
        `Rantai : ${String(session.chainCount)} / ${String(SAMBUNG_KATA_COMBO_TARGET)}`,
        `Lanjut huruf: *${nextLetter}*`,
      ].join("\n"),
    };
  }

  private sweepExpired(nowMs: number): void {
    for (const [k, s] of this.sessions.entries()) {
      if (s.expiresAt <= nowMs) this.sessions.delete(k);
    }
  }
}

export const sambungKataService = new SambungKataService();
