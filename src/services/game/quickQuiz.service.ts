import { normalizeUserJid } from "../../utils/jid";
import { formatRupiah } from "../../utils/currency";
import { generateCorrelationId, MemberEconomyService } from "../member/memberEconomy.service";
import {
  drawQuickQuizQuestion,
  QUICK_QUIZ_LABELS,
  type QuickQuizKind,
  type QuickQuizQuestion,
} from "./quickQuizBank";

export interface QuickQuizSession {
  groupJid: string;
  kind: QuickQuizKind;
  question: QuickQuizQuestion;
  createdAt: number;
  expiresAt: number;
  messageId?: string;
}

export interface QuickQuizAnswerResult {
  matched: boolean;
  correct: boolean;
  text: string;
  mentions?: string[];
}

export const QUICK_QUIZ_TTL_MS = 5 * 60 * 1000;
export const QUICK_QUIZ_REWARD_MONEY = 2_000_000n;
export const QUICK_QUIZ_REWARD_POINTS = 20;
export const QUICK_QUIZ_REWARD_XP = 60;
const MAX_QUICK_QUIZ_ROOMS = 80;

interface QuickQuizEconomy {
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

function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class QuickQuizService {
  private readonly sessions = new Map<string, QuickQuizSession>();

  constructor(
    private readonly economy: QuickQuizEconomy = new MemberEconomyService(),
    private readonly drawer: (kind: QuickQuizKind) => QuickQuizQuestion = drawQuickQuizQuestion,
  ) {}

  getActiveSession(groupJid: string, nowMs = Date.now()): QuickQuizSession | null {
    this.sweepExpired(nowMs);
    return this.sessions.get(groupJid) ?? null;
  }

  setMessageId(groupJid: string, messageId: string): void {
    const s = this.sessions.get(groupJid);
    if (s) s.messageId = messageId;
  }

  startQuiz(
    groupJid: string,
    kind: QuickQuizKind,
    nowMs = Date.now(),
  ): { alreadyActive: boolean; session: QuickQuizSession; text: string } {
    this.sweepExpired(nowMs);
    const existing = this.sessions.get(groupJid);
    if (existing) {
      return {
        alreadyActive: true,
        session: existing,
        text: [
          `*── [ ${QUICK_QUIZ_LABELS[existing.kind]} MASIH AKTIF ] ──*`,
          existing.question.prompt,
          "",
          "_Swipe/reply pesan ini untuk menjawab, atau ketik .nyerah / .<game> skip._",
        ].join("\n"),
      };
    }

    if (this.sessions.size >= MAX_QUICK_QUIZ_ROOMS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }

    const question = this.drawer(kind);
    const session: QuickQuizSession = {
      groupJid,
      kind,
      question,
      createdAt: nowMs,
      expiresAt: nowMs + QUICK_QUIZ_TTL_MS,
    };
    this.sessions.set(groupJid, session);

    const text = [
      `*── [ ${QUICK_QUIZ_LABELS[kind]} ] ──*`,
      question.prompt,
      "",
      `Hadiah: *${formatRupiah(QUICK_QUIZ_REWARD_MONEY)}* (xBonus Lv) + ${String(QUICK_QUIZ_REWARD_POINTS)} Poin + ${String(QUICK_QUIZ_REWARD_XP)} XP`,
      "_Swipe/reply pesan ini langsung dengan jawabanmu!_",
    ].join("\n");

    return { alreadyActive: false, session, text };
  }

  giveUp(groupJid: string, nowMs = Date.now()): { text: string } | null {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) return null;
    this.sessions.delete(groupJid);
    return {
      text: [
        `*── [ ${QUICK_QUIZ_LABELS[session.kind]} SELESAI ] ──*`,
        `Jawaban yang benar: *${session.question.answers[0] ?? "-"}*`,
      ].join("\n"),
    };
  }

  async submitAnswer(
    groupJid: string,
    userJid: string,
    rawGuess: string,
    nowMs = Date.now(),
  ): Promise<QuickQuizAnswerResult> {
    this.sweepExpired(nowMs);
    const session = this.sessions.get(groupJid);
    if (!session) {
      return { matched: false, correct: false, text: "" };
    }

    const guess = normalizeAnswer(rawGuess);
    if (!guess) {
      return { matched: false, correct: false, text: "" };
    }

    const isCorrect = session.question.answers.some((ans) => normalizeAnswer(ans) === guess);
    if (!isCorrect) {
      return {
        matched: true,
        correct: false,
        text: "Belum tepat! Coba lagi atau ketik *.nyerah* jika menyerah.",
      };
    }

    this.sessions.delete(groupJid);
    const normUser = normalizeUserJid(userJid);
    const correlationId = generateCorrelationId();

    await Promise.allSettled([
      this.economy.creditMoney({
        groupJid,
        userJid: normUser,
        amount: QUICK_QUIZ_REWARD_MONEY,
        type: "GAME_REWARD",
        scaleByLevel: true,
        correlationId,
        note: `quick_quiz_${session.kind}`,
      }),
      this.economy.creditPoints({
        groupJid,
        userJid: normUser,
        amount: QUICK_QUIZ_REWARD_POINTS,
        type: "GAME_REWARD",
        correlationId,
        note: `quick_quiz_${session.kind}`,
      }),
      this.economy.creditXp({
        groupJid,
        userJid: normUser,
        amount: QUICK_QUIZ_REWARD_XP,
        type: "GAME_REWARD",
        correlationId,
        note: `quick_quiz_${session.kind}`,
      }),
    ]);

    const tag = `@${normUser.split("@")[0] ?? normUser}`;
    return {
      matched: true,
      correct: true,
      mentions: [normUser],
      text: [
        `*── [ BENAR! ${QUICK_QUIZ_LABELS[session.kind]} ] ──*`,
        `Pemenang : ${tag}`,
        `Jawaban  : *${session.question.answers[0] ?? rawGuess}*`,
        `Hadiah   : ${formatRupiah(QUICK_QUIZ_REWARD_MONEY)} (xBonus Lv) + ${String(QUICK_QUIZ_REWARD_POINTS)} Poin + ${String(QUICK_QUIZ_REWARD_XP)} XP`,
      ].join("\n"),
    };
  }

  private sweepExpired(nowMs: number): void {
    for (const [k, s] of this.sessions.entries()) {
      if (s.expiresAt <= nowMs) this.sessions.delete(k);
    }
  }
}

export const quickQuizService = new QuickQuizService();
