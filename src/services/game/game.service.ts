import { randomUUID } from "node:crypto";

import type { CommandContext } from "../../types/command";
import { getBotCanonicalJids, normalizeUserJid } from "../../utils/jid";
import { identityResolverService } from "../identity/identityResolver.service";
import { generateCorrelationId } from "../member/memberEconomy.service";
import {
  BOM_BOARD_SIZE,
  BOM_SAFE_TOTAL,
  type BomState,
  createBomState,
  formatBomBoard,
  pickBomCell,
} from "./bomEngine";
import {
  type KatlaBankData,
  type Question,
  type QuizBankData,
  ShuffleDeckManager,
  generateMixedMtkQuestion,
  loadDefaultQuizBank,
  normalizeFamily100Question,
  normalizeGameAnswer,
} from "./gameBank";
import { TICTACTOE_REWARD } from "./gameReward.constants";
import { type GameRewardService, gameRewardService } from "./gameReward.service";
import {
  KATLA_MAX_ATTEMPTS,
  type KatlaState,
  evaluateKatlaGuess,
  formatKatlaBoard,
  formatKatlaPatternHint,
  revealNextKatlaClueIndex,
  validateKatlaGuess,
} from "./katlaEngine";

export type QuizType =
  | "kuis"
  | "family100"
  | "tebakkata"
  | "tebakemoji"
  | "tebakangka"
  | "mtk"
  | "katla"
  | "caklontong"
  | "bom";

type TicTacToeCell = "X" | "O" | null;

export interface GameMessageResponse {
  text: string;
  mentions?: string[];
}

export type BankQuizOverride = Partial<
  Record<
    "kuis" | "family100" | "tebakkata" | "tebakemoji" | "caklontong",
    (Question | { prompt: string; answers: string[]; reason?: string })[]
  >
>;

interface QuizSession {
  type: QuizType;
  groupJid: string;
  startedBy: string;
  question: Question;
  answered: Set<string>;
  createdAt: number;
  roundId: string;
  correlationId: string;
  attemptsByUser: Map<string, number>;
  wrongParticipants: Set<string>;
  family100EarnedByUser: Map<string, { points: number; xp: number }>;
  family100AnswererByAnswer: Map<string, string>;
  clueCount: number;
  revealedCluePositions: Set<number>;
  numberTarget?: number;
  numberMax?: number;
  katlaState?: KatlaState;
  bomState?: BomState;
  messageId?: string;
}

interface TicTacToeSession {
  groupJid: string;
  player1Jid: string; // X -- who sent the challenge
  player2Jid: string; // O -- who was challenged
  currentTurn: "X" | "O";
  board: TicTacToeCell[];
  createdAt: number;
  lastMoveAt: number;
  roundId: string;
  correlationId: string;
  state: "waiting" | "active";
  messageId?: string;
}

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const SESSION_TTL_MS = 10 * 60 * 1000;
const WAITING_TTL_MS = 5 * 60 * 1000;
const MOVE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TEBAKANGKA_MAX = 100;
const MAX_QUIZ_CLUES = 2;

const DEFAULT_BANK = loadDefaultQuizBank();

export class GameService {
  private readonly quizSessions = new Map<string, QuizSession>();
  private readonly ticTacToeSessions = new Map<string, TicTacToeSession>();
  private readonly inFlightResolutions = new Set<string>();
  private readonly deckManager = new ShuffleDeckManager();
  private readonly quizBank: QuizBankData;
  private readonly katlaValidSet: ReadonlySet<string>;
  private lastSweepAt = 0;

  constructor(
    private readonly rewardService: GameRewardService = gameRewardService,
    private readonly randomInt: (min: number, max: number) => number = defaultRandomInt,
    quizBankOverride?: BankQuizOverride,
    katlaBankOverride?: KatlaBankData,
  ) {
    this.quizBank = {
      kuis: quizBankOverride?.kuis ?? DEFAULT_BANK.kuis,
      family100: quizBankOverride?.family100
        ? quizBankOverride.family100.map((q) => normalizeFamily100Question(q))
        : DEFAULT_BANK.family100,
      tebakkata: quizBankOverride?.tebakkata ?? DEFAULT_BANK.tebakkata,
      tebakemoji: quizBankOverride?.tebakemoji ?? DEFAULT_BANK.tebakemoji,
      caklontong: quizBankOverride?.caklontong ?? DEFAULT_BANK.caklontong,
      katla: katlaBankOverride ?? DEFAULT_BANK.katla,
    };

    this.katlaValidSet = new Set(
      [...this.quizBank.katla.targets, ...this.quizBank.katla.validWords].map((w) =>
        w.trim().toLowerCase(),
      ),
    );
  }

  // ---- Quiz / Trivia / Puzzle Entry Points ----

  async startOrAnswerQuiz(context: CommandContext, type: QuizType): Promise<string> {
    const result = await this.startOrAnswerQuizRich(context, type);
    return result.text;
  }

  async startOrAnswerQuizRich(
    context: CommandContext,
    type: QuizType,
  ): Promise<GameMessageResponse> {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const active = this.quizSessions.get(context.chatJid);
    const answerText = context.argsText.trim();

    if (answerText.length > 0) {
      // Khusus `.tebakangka <max>` saat belum ada sesi aktif mengizinkan batas kustom 10..1000
      if (type === "tebakangka" && !active && /^\d+$/.test(answerText)) {
        const parsedMax = Number(answerText);
        if (parsedMax >= 10 && parsedMax <= 1000) {
          return this.startNumberGuess(context, parsedMax);
        }
      }
      return this.answerQuizRich(context, type, answerText);
    }

    if (active) {
      return {
        text: `Masih ada game aktif di grup ini (${formatGameName(active.type)}). Jawab dulu atau ketik .nyerah.`,
      };
    }

    if (type === "tebakangka") {
      return this.startNumberGuess(context, DEFAULT_TEBAKANGKA_MAX);
    }

    if (type === "katla") {
      return this.startKatla(context);
    }

    if (type === "bom") {
      return this.startBom(context);
    }

    const question =
      type === "mtk"
        ? generateMixedMtkQuestion()
        : this.deckManager.draw(`${context.chatJid}:${type}`, this.getQuestionPool(type));

    const session: QuizSession = {
      type,
      groupJid: context.chatJid,
      startedBy: context.senderUserJid,
      question,
      answered: new Set(),
      createdAt: Date.now(),
      roundId: randomUUID(),
      correlationId: generateCorrelationId(),
      attemptsByUser: new Map(),
      wrongParticipants: new Set(),
      family100EarnedByUser: new Map(),
      family100AnswererByAnswer: new Map(),
      clueCount: 0,
      revealedCluePositions: new Set(),
    };
    this.quizSessions.set(context.chatJid, session);

    if (type === "family100") {
      const board = formatFamily100Board(session);
      return {
        text: [
          `Game dimulai: ${formatGameName(type)}`,
          "",
          question.prompt,
          "",
          board.text,
          "",
          answerHint(type),
        ].join("\n"),
        mentions: board.mentions,
      };
    }

    if (type === "caklontong") {
      const pattern = buildMaskedAnswerHint(question.answers[0] ?? "", new Set());
      return {
        text: [
          `Game dimulai: ${formatGameName(type)}`,
          "",
          question.prompt,
          "",
          `Pola jawaban: ${pattern}`,
          "",
          answerHint(type),
        ].join("\n"),
      };
    }

    return {
      text: [
        `Game dimulai: ${formatGameName(type)}`,
        "",
        question.prompt,
        "",
        answerHint(type),
      ].join("\n"),
    };
  }

  // ---- Clue / Hint ----

  getClue(context: CommandContext): GameMessageResponse {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const session = this.quizSessions.get(context.chatJid);
    if (!session) {
      return { text: "Belum ada game aktif di grup ini untuk dikasih petunjuk." };
    }

    if (session.type === "mtk" || session.type === "bom") {
      return {
        text: `Game ${formatGameName(session.type)} gak memakai .clue ya. Langsung hitung atau pilih kotaknya!`,
      };
    }

    if (session.type === "katla" && session.katlaState) {
      const revealedIdx = revealNextKatlaClueIndex(session.katlaState);
      if (revealedIdx === null) {
        return { text: "Batas petunjuk .katla ronde ini sudah maksimal atau hurufnya hampir terbuka semua." };
      }
      session.clueCount += 1;
      const pattern = formatKatlaPatternHint(session.katlaState);
      return {
        text: [
          `Petunjuk Katla (#${String(session.clueCount)}): huruf ke-${String(revealedIdx + 1)} adalah *${(session.katlaState.target[revealedIdx] ?? "").toUpperCase()}*`,
          `Pola saat ini: ${pattern}`,
        ].join("\n"),
      };
    }

    if (session.type === "tebakangka" && session.numberTarget !== undefined) {
      if (session.clueCount >= MAX_QUIZ_CLUES) {
        return { text: "Petunjuk tebak angka sudah maksimal untuk ronde ini." };
      }
      session.clueCount += 1;
      const maxRange = session.numberMax ?? DEFAULT_TEBAKANGKA_MAX;
      const span = session.clueCount === 1 ? Math.max(10, Math.round(maxRange * 0.3)) : Math.max(5, Math.round(maxRange * 0.14));
      const low = Math.max(1, session.numberTarget - Math.floor(span / 2));
      const high = Math.min(maxRange, low + span);
      const parityHint =
        session.clueCount >= 2
          ? ` (${session.numberTarget % 2 === 0 ? "angka GENAP" : "angka GANJIL"})`
          : "";
      return {
        text: `Petunjuk angka (#${String(session.clueCount)}): angka rahasia berada di kisaran *${String(low)} - ${String(high)}*${parityHint}.`,
      };
    }

    if (session.type === "family100") {
      const slots = session.question.familySlots ?? [];
      const unansweredIdx = slots.findIndex(
        (slot) => !session.answered.has(normalizeGameAnswer(slot.text)),
      );
      if (unansweredIdx < 0 || session.clueCount >= MAX_QUIZ_CLUES) {
        return { text: "Petunjuk Family 100 ronde ini sudah habis atau semua slot hampir terbuka." };
      }
      const targetSlot = slots[unansweredIdx];
      if (!targetSlot) {
        return { text: "Petunjuk tidak tersedia." };
      }
      session.clueCount += 1;
      const masked = buildMaskedAnswerHint(targetSlot.text, new Set([0]));
      return {
        text: `Petunjuk Family 100: jawaban nomor *${String(unansweredIdx + 1)}* berawalan seperti ini -> ${masked}`,
      };
    }

    // kuis / tebakkata / tebakemoji / caklontong
    const primaryAnswer = session.question.answers[0] ?? "";
    if (session.clueCount >= MAX_QUIZ_CLUES || primaryAnswer.length === 0) {
      return { text: "Petunjuk ronde ini sudah maksimal ya. Yuk tebak sekarang atau ketik .nyerah!" };
    }

    const candidateIndices: number[] = [];
    for (let i = 0; i < primaryAnswer.length; i++) {
      const ch = primaryAnswer[i];
      if (ch && ch !== " " && ch !== "-" && !session.revealedCluePositions.has(i)) {
        candidateIndices.push(i);
      }
    }

    if (candidateIndices.length <= 1) {
      return { text: "Huruf petunjuk sudah cukup terbuka, tinggal ditebak saja!" };
    }

    const pickIndex =
      session.clueCount === 0 && !session.revealedCluePositions.has(0)
        ? 0
        : (candidateIndices[Math.floor(Math.random() * candidateIndices.length)] ?? 0);

    session.revealedCluePositions.add(pickIndex);
    session.clueCount += 1;
    const masked = buildMaskedAnswerHint(primaryAnswer, session.revealedCluePositions);
    return {
      text: `Petunjuk (#${String(session.clueCount)}): ${masked}`,
    };
  }

  // ---- Surrender ----

  async surrender(context: CommandContext): Promise<string> {
    const result = await this.surrenderRich(context);
    return result.text;
  }

  async surrenderRich(context: CommandContext): Promise<GameMessageResponse> {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const quiz = this.quizSessions.get(context.chatJid);
    if (quiz) {
      this.quizSessions.delete(context.chatJid);

      if (quiz.type === "katla" && quiz.katlaState) {
        const participants = [...quiz.wrongParticipants];
        if (participants.length > 0) {
          await Promise.allSettled(
            participants.map((userJid) =>
              this.rewardService.awardKatlaParticipation(
                context.chatJid,
                userJid,
                quiz.roundId,
                quiz.correlationId,
              ),
            ),
          );
        }
        return {
          text: [
            "Game dihentikan.",
            `Kata rahasia: *${quiz.katlaState.target.toUpperCase()}*`,
            ...(quiz.katlaState.guesses.length > 0 ? ["", formatKatlaBoard(quiz.katlaState)] : []),
          ].join("\n"),
        };
      }

      if (quiz.type === "bom" && quiz.bomState) {
        return {
          text: [
            "Game dihentikan.",
            `Posisi bom tadi berada di kotak nomor *${String(quiz.bomState.bombIndex + 1)}*.`,
            "",
            formatBomBoard(quiz.bomState, true),
          ].join("\n"),
        };
      }

      const surrenderLines: string[] = [
        "Game dihentikan.",
        `Jawaban: ${quiz.question.answers.join(", ")}`,
      ];

      if (quiz.question.reason) {
        surrenderLines.push(`Penjelasan: ${quiz.question.reason}`);
      }

      if (quiz.type === "tebakkata" || quiz.type === "tebakemoji" || quiz.type === "caklontong") {
        const xpReceivers = [...quiz.wrongParticipants];
        if (xpReceivers.length > 0) {
          await Promise.allSettled(
            xpReceivers.map((userJid) => {
              if (quiz.type === "tebakkata") {
                return this.rewardService.awardTebakKataSurrender(
                  context.chatJid,
                  userJid,
                  quiz.roundId,
                  quiz.correlationId,
                );
              }
              if (quiz.type === "tebakemoji") {
                return this.rewardService.awardTebakEmojiSurrender(
                  context.chatJid,
                  userJid,
                  quiz.roundId,
                  quiz.correlationId,
                );
              }
              return this.rewardService.awardCakLontongSurrender(
                context.chatJid,
                userJid,
                quiz.roundId,
                quiz.correlationId,
              );
            }),
          );
        }
      }

      if (quiz.type === "family100") {
        const participants = [...quiz.family100EarnedByUser.keys()];
        await Promise.allSettled(
          participants.map((userJid) =>
            this.rewardService.recordFamily100GamePlayed(
              context.chatJid,
              userJid,
              quiz.roundId,
              quiz.correlationId,
            ),
          ),
        );
      }

      return { text: surrenderLines.join("\n") };
    }

    const tictactoe = this.ticTacToeSessions.get(context.chatJid);
    if (tictactoe) {
      const candidateSet = identityResolverService.getCanonicalCandidateSet(
        context.senderUserJid,
        context.senderAltJids,
      );
      const isPlayer1 = candidateSet.has(normalizeUserJid(tictactoe.player1Jid));
      const isPlayer2 = candidateSet.has(normalizeUserJid(tictactoe.player2Jid));

      if (!isPlayer1 && !isPlayer2) {
        return { text: "Kamu bukan pemain dalam sesi ini." };
      }

      this.ticTacToeSessions.delete(context.chatJid);

      if (tictactoe.state === "waiting") {
        return { text: "Tantangan dibatalkan." };
      }

      const loserJid = isPlayer1 ? tictactoe.player1Jid : tictactoe.player2Jid;
      const winnerJid = isPlayer1 ? tictactoe.player2Jid : tictactoe.player1Jid;

      await Promise.allSettled([
        this.rewardService.awardTicTacToeLoss(
          context.chatJid,
          loserJid,
          tictactoe.roundId,
          tictactoe.correlationId,
        ),
        this.rewardService.awardTicTacToeWin(
          context.chatJid,
          winnerJid,
          tictactoe.roundId,
          tictactoe.correlationId,
        ),
      ]);

      const winnerMention = formatMention(winnerJid);
      return {
        text: [
          "Menyerah. Game selesai.",
          `Pemenang: ${winnerMention.tag}`,
          `Poin menang: ${String(TICTACTOE_REWARD.WIN_POINTS)} | XP: ${String(TICTACTOE_REWARD.WIN_XP)}`,
        ].join("\n"),
        mentions: [winnerMention.jid],
      };
    }

    return { text: "Tidak ada game aktif di grup ini." };
  }

  // ---- TicTacToe PvP ----

  async playTicTacToe(context: CommandContext): Promise<string> {
    const result = await this.playTicTacToeRich(context);
    return result.text;
  }

  async playTicTacToeRich(context: CommandContext): Promise<GameMessageResponse> {
    this.assertGroup(context);

    const positionText = context.args[0];
    const hasMention = context.mentionedJids.length > 0;

    const timeoutResult = await this.checkTicTacToeTimeout(context.chatJid);
    if (timeoutResult !== null) {
      return timeoutResult;
    }

    if (hasMention) {
      return this.handleChallenge(context);
    }

    if (positionText && /^\d+$/.test(positionText)) {
      return this.handleMove(context, positionText);
    }

    return this.handleAccept(context);
  }

  // ---- Private: TicTacToe PvP helpers ----

  private handleChallenge(context: CommandContext): GameMessageResponse {
    const challengedJid = context.mentionedJids[0];

    if (!challengedJid) {
      return { text: "Mention pemain yang ingin ditantang. Contoh: .tictactoe @pemain" };
    }

    const botJids = getBotCanonicalJids(context.socket);
    const challengedNorm = normalizeUserJid(challengedJid);
    if (botJids.has(challengedNorm)) {
      return { text: "Tidak bisa menantang bot bermain TicTacToe." };
    }

    const senderCandidateSet = identityResolverService.getCanonicalCandidateSet(
      context.senderUserJid,
      context.senderAltJids,
    );
    if (senderCandidateSet.has(challengedNorm)) {
      return { text: "Tidak bisa menantang diri sendiri." };
    }

    if (this.ticTacToeSessions.has(context.chatJid)) {
      return { text: "Sudah ada sesi tic tac toe aktif di grup ini." };
    }

    const session: TicTacToeSession = {
      groupJid: context.chatJid,
      player1Jid: normalizeUserJid(context.senderUserJid),
      player2Jid: challengedNorm,
      currentTurn: "X",
      board: Array.from<TicTacToeCell>({ length: 9 }).fill(null),
      createdAt: Date.now(),
      lastMoveAt: Date.now(),
      roundId: randomUUID(),
      correlationId: generateCorrelationId(),
      state: "waiting",
    };

    this.ticTacToeSessions.set(context.chatJid, session);
    const challengerM = formatMention(session.player1Jid);
    const challengedTag = formatMention(challengedJid).tag;
    const challengedM = formatMention(session.player2Jid);

    return {
      text: [
        `Tantangan dikirim ke ${challengedTag}!`,
        `Penantang: ${challengerM.tag} (X)`,
        "",
        "Balas/reply pesan ini untuk menerima tantangan, atau ketik .tictactoe.",
      ].join("\n"),
      mentions: [challengedM.jid, challengerM.jid],
    };
  }

  private handleAccept(context: CommandContext): GameMessageResponse {
    const session = this.ticTacToeSessions.get(context.chatJid);
    if (!session) {
      return { text: "Belum ada tantangan tic tac toe. Gunakan .tictactoe @user untuk mulai." };
    }

    if (session.state === "active") {
      const turnJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;
      const turnM = formatMention(turnJid);
      return {
        text: [
          `Game sedang berjalan. Giliran: ${turnM.tag} (${session.currentTurn})`,
          "",
          formatBoard(session.board),
          "",
          "Balas/reply pesan ini dengan angka 1-9 untuk melangkah.",
        ].join("\n"),
        mentions: [turnM.jid],
      };
    }

    const candidateSet = identityResolverService.getCanonicalCandidateSet(
      context.senderUserJid,
      context.senderAltJids,
    );
    if (!candidateSet.has(normalizeUserJid(session.player2Jid))) {
      return { text: "Tantangan ini bukan untukmu." };
    }

    session.player2Jid = normalizeUserJid(context.senderUserJid);
    session.state = "active";
    session.lastMoveAt = Date.now();
    const p1M = formatMention(session.player1Jid);

    return {
      text: [
        "Game dimulai: Tic Tac Toe.",
        `Giliran pertama: ${p1M.tag} (X)`,
        "",
        formatBoard(session.board),
        "",
        "Balas/reply pesan ini dengan angka 1-9 untuk melangkah, atau ketik .tictactoe <1-9>.",
      ].join("\n"),
      mentions: [p1M.jid],
    };
  }

  private async handleMove(
    context: CommandContext,
    positionText: string,
  ): Promise<GameMessageResponse> {
    const session = this.ticTacToeSessions.get(context.chatJid);
    if (!session) {
      return { text: "Belum ada tantangan tic tac toe. Gunakan .tictactoe @user untuk mulai." };
    }

    if (session.state === "waiting") {
      return { text: "Tantangan belum diterima. Tunggu pemain kedua menerimanya terlebih dahulu." };
    }

    const candidateSet = identityResolverService.getCanonicalCandidateSet(
      context.senderUserJid,
      context.senderAltJids,
    );
    const isPlayer1 = candidateSet.has(normalizeUserJid(session.player1Jid));
    const isPlayer2 = candidateSet.has(normalizeUserJid(session.player2Jid));

    if (!isPlayer1 && !isPlayer2) {
      return { text: "Kamu bukan pemain dalam sesi ini." };
    }

    const playerMark: "X" | "O" = isPlayer1 ? "X" : "O";
    if (playerMark !== session.currentTurn) {
      return { text: `Bukan giliranmu. Saat ini giliran ${session.currentTurn}.` };
    }

    const position = Number(positionText);
    if (!Number.isInteger(position) || position < 1 || position > 9) {
      return { text: "Pilih posisi angka 1 sampai 9." };
    }

    const index = position - 1;
    if (session.board[index] !== null) {
      return { text: "Kotak tersebut sudah diisi." };
    }

    session.board[index] = session.currentTurn;
    session.lastMoveAt = Date.now();

    if (hasWinner(session.board, session.currentTurn)) {
      this.ticTacToeSessions.delete(context.chatJid);
      const winnerJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;
      const loserJid = session.currentTurn === "X" ? session.player2Jid : session.player1Jid;

      await Promise.allSettled([
        this.rewardService.awardTicTacToeWin(
          context.chatJid,
          winnerJid,
          session.roundId,
          session.correlationId,
        ),
        this.rewardService.awardTicTacToeLoss(
          context.chatJid,
          loserJid,
          session.roundId,
          session.correlationId,
        ),
      ]);

      const winM = formatMention(winnerJid);
      const loseM = formatMention(loserJid);

      return {
        text: [
          `Pemenang: ${winM.tag} (${session.currentTurn}) menang!`,
          `Kalah: ${loseM.tag}`,
          `Hadiah menang: +${String(TICTACTOE_REWARD.WIN_POINTS)} Poin & +${String(TICTACTOE_REWARD.WIN_XP)} XP`,
          "",
          formatBoard(session.board),
        ].join("\n"),
        mentions: [winM.jid, loseM.jid],
      };
    }

    if (session.board.every((cell) => cell !== null)) {
      this.ticTacToeSessions.delete(context.chatJid);

      await Promise.allSettled([
        this.rewardService.awardTicTacToeDraw(
          context.chatJid,
          session.player1Jid,
          session.roundId,
          session.correlationId,
        ),
        this.rewardService.awardTicTacToeDraw(
          context.chatJid,
          session.player2Jid,
          session.roundId,
          `${session.correlationId}-p2`,
        ),
      ]);

      const p1M = formatMention(session.player1Jid);
      const p2M = formatMention(session.player2Jid);

      return {
        text: [
          "Permainan berakhir seri.",
          `${p1M.tag} & ${p2M.tag} masing-masing dapat +${String(TICTACTOE_REWARD.DRAW_POINTS)} Poin dan +${String(TICTACTOE_REWARD.DRAW_XP)} XP!`,
          "",
          formatBoard(session.board),
        ].join("\n"),
        mentions: [p1M.jid, p2M.jid],
      };
    }

    session.currentTurn = session.currentTurn === "X" ? "O" : "X";
    const nextPlayerJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;
    const nextM = formatMention(nextPlayerJid);

    return {
      text: [
        "Langkah diterima.",
        `Giliran: ${nextM.tag} (${session.currentTurn})`,
        "",
        formatBoard(session.board),
        "",
        "Balas/reply pesan ini dengan angka 1-9 untuk melangkah, atau ketik .tictactoe <1-9>.",
      ].join("\n"),
      mentions: [nextM.jid],
    };
  }

  private async checkTicTacToeTimeout(groupJid: string): Promise<GameMessageResponse | null> {
    const now = Date.now();
    const session = this.ticTacToeSessions.get(groupJid);
    if (!session) return null;

    if (session.state === "waiting" && now - session.createdAt > WAITING_TTL_MS) {
      this.ticTacToeSessions.delete(groupJid);
      return { text: "Tantangan tic tac toe sudah kedaluwarsa dan dibatalkan." };
    }

    if (session.state === "active" && now - session.lastMoveAt > MOVE_TTL_MS) {
      this.ticTacToeSessions.delete(groupJid);
      const timedOutJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;
      const winnerJid = session.currentTurn === "X" ? session.player2Jid : session.player1Jid;

      await Promise.allSettled([
        this.rewardService.recordTicTacToeTimeout(
          groupJid,
          timedOutJid,
          session.roundId,
          session.correlationId,
        ),
        this.rewardService.awardTicTacToeWin(
          groupJid,
          winnerJid,
          session.roundId,
          session.correlationId,
        ),
      ]);

      const toM = formatMention(timedOutJid);
      const winM = formatMention(winnerJid);
      return {
        text: [
          `${toM.tag} habis waktu. ${winM.tag} menang!`,
          `Pemenang mendapat +${String(TICTACTOE_REWARD.WIN_POINTS)} poin dan +${String(TICTACTOE_REWARD.WIN_XP)} XP.`,
        ].join("\n"),
        mentions: [toM.jid, winM.jid],
      };
    }

    return null;
  }

  // ---- Private: Game Start & Answer Handlers ----

  private startKatla(context: CommandContext): GameMessageResponse {
    const byLength = new Map<number, string[]>([
      [5, this.quizBank.katla.targets.filter((w) => w.length === 5)],
      [6, this.quizBank.katla.targets.filter((w) => w.length === 6)],
      [7, this.quizBank.katla.targets.filter((w) => w.length === 7)],
    ]);
    const availableLengths = [5, 6, 7].filter((len) => (byLength.get(len)?.length ?? 0) > 0);
    const pickedLength =
      availableLengths[Math.floor(Math.random() * availableLengths.length)] ?? 5;
    const pool = byLength.get(pickedLength) ?? this.quizBank.katla.targets;
    const targetWord = this.deckManager
      .draw(`${context.chatJid}:katla:${String(pickedLength)}`, pool)
      .toLowerCase();

    const katlaState: KatlaState = {
      target: targetWord,
      length: targetWord.length,
      maxAttempts: KATLA_MAX_ATTEMPTS,
      guesses: [],
      revealedIndices: [],
    };

    const prompt = `Tebak kata rahasia *${String(targetWord.length)} huruf* dalam maksimal ${String(KATLA_MAX_ATTEMPTS)} percobaan bersama.`;

    this.quizSessions.set(context.chatJid, {
      type: "katla",
      groupJid: context.chatJid,
      startedBy: context.senderUserJid,
      question: {
        prompt,
        answers: [targetWord],
      },
      answered: new Set(),
      createdAt: Date.now(),
      roundId: randomUUID(),
      correlationId: generateCorrelationId(),
      attemptsByUser: new Map(),
      wrongParticipants: new Set(),
      family100EarnedByUser: new Map(),
      family100AnswererByAnswer: new Map(),
      clueCount: 0,
      revealedCluePositions: new Set(),
      katlaState,
    });

    return {
      text: [
        "Game dimulai: Katla.",
        prompt,
        "",
        `Pola: ${formatKatlaPatternHint(katlaState)} (${String(targetWord.length)} huruf)`,
        "🟩 = posisi tepat | 🟨 = huruf ada tapi salah posisi | ⬛ = gak ada",
        "",
        answerHint("katla"),
      ].join("\n"),
    };
  }

  private startBom(context: CommandContext): GameMessageResponse {
    const rawRand = this.randomInt(0, BOM_BOARD_SIZE - 1);
    const bomState = createBomState(rawRand);
    const prompt = `Pilih kotak aman bernomor 1-${String(BOM_BOARD_SIZE)} dan hindari 1 bom tersembunyi!`;

    this.quizSessions.set(context.chatJid, {
      type: "bom",
      groupJid: context.chatJid,
      startedBy: context.senderUserJid,
      question: {
        prompt,
        answers: [String(bomState.bombIndex + 1)],
      },
      answered: new Set(),
      createdAt: Date.now(),
      roundId: randomUUID(),
      correlationId: generateCorrelationId(),
      attemptsByUser: new Map(),
      wrongParticipants: new Set(),
      family100EarnedByUser: new Map(),
      family100AnswererByAnswer: new Map(),
      clueCount: 0,
      revealedCluePositions: new Set(),
      bomState,
    });

    return {
      text: [
        "Game dimulai: Tebak Bom.",
        prompt,
        "Aman kena poin bertingkat; kena bom tetap aman *0 minus poin* (+5 XP hiburan).",
        "",
        formatBomBoard(bomState, false),
        "",
        answerHint("bom"),
      ].join("\n"),
    };
  }

  private async answerQuizRich(
    context: CommandContext,
    type: QuizType,
    answerText: string,
  ): Promise<GameMessageResponse> {
    if (this.inFlightResolutions.has(context.chatJid)) {
      return { text: "Jawaban sedang diproses. Silakan coba sesaat lagi." };
    }
    this.inFlightResolutions.add(context.chatJid);

    try {
      const session = this.quizSessions.get(context.chatJid);
      if (!session) {
        return { text: `Belum ada ${formatGameName(type)} aktif. Gunakan .${type} untuk mulai.` };
      }

      if (session.type !== type) {
        return { text: `Game aktif saat ini adalah ${formatGameName(session.type)}.` };
      }

      if (type === "tebakangka") {
        return await this.answerNumberGuess(context, session, answerText);
      }

      if (type === "katla" && session.katlaState) {
        return await this.answerKatla(context, session, session.katlaState, answerText);
      }

      if (type === "bom" && session.bomState) {
        return await this.answerBom(context, session, session.bomState, answerText);
      }

      if (type === "family100") {
        return await this.answerFamily100(context, session, answerText);
      }

      const normalizedAnswer = normalizeGameAnswer(answerText);
      const matchedAnswer = session.question.answers.find(
        (answer) => normalizeGameAnswer(answer) === normalizedAnswer,
      );

      if (!matchedAnswer) {
        if (!session.wrongParticipants.has(context.senderUserJid)) {
          session.wrongParticipants.add(context.senderUserJid);
          if (type === "kuis") {
            await this.rewardService.awardKuisWrongParticipation(
              context.chatJid,
              context.senderUserJid,
              session.roundId,
              session.correlationId,
            );
          } else if (type === "mtk") {
            await this.rewardService.awardMtkWrongParticipation(
              context.chatJid,
              context.senderUserJid,
              session.roundId,
              session.correlationId,
            );
          }
        }
        return { text: "Belum pas nih, coba lagi!" };
      }

      if (session.answered.has(normalizedAnswer)) {
        return { text: "Jawaban itu sudah ditemukan." };
      }

      session.answered.add(normalizedAnswer);

      let reward: { points: number; xp: number };
      if (type === "kuis") {
        reward = await this.rewardService.awardKuisCorrect(
          context.chatJid,
          context.senderUserJid,
          session.roundId,
          session.correlationId,
          session.clueCount,
        );
      } else if (type === "mtk") {
        reward = await this.rewardService.awardMtkCorrect(
          context.chatJid,
          context.senderUserJid,
          session.roundId,
          session.correlationId,
        );
      } else if (type === "tebakkata") {
        reward = await this.rewardService.awardTebakKataCorrect(
          context.chatJid,
          context.senderUserJid,
          session.roundId,
          session.correlationId,
          session.clueCount,
        );
      } else if (type === "caklontong") {
        reward = await this.rewardService.awardCakLontongCorrect(
          context.chatJid,
          context.senderUserJid,
          session.roundId,
          session.correlationId,
          session.clueCount,
        );
      } else {
        reward = await this.rewardService.awardTebakEmojiCorrect(
          context.chatJid,
          context.senderUserJid,
          session.roundId,
          session.correlationId,
          session.clueCount,
        );
      }

      this.quizSessions.delete(context.chatJid);
      const winnerM = formatMention(context.senderUserJid);

      const lines = [
        `Benar! Selamat ${winnerM.tag}!`,
        `Jawaban: *${matchedAnswer}*`,
        ...(session.question.reason ? [`Alasan: ${session.question.reason}`] : []),
        `Poin bertambah: +${String(reward.points)} | XP bertambah: +${String(reward.xp)}`,
        "Game selesai.",
      ];

      return {
        text: lines.join("\n"),
        mentions: [winnerM.jid],
      };
    } finally {
      this.inFlightResolutions.delete(context.chatJid);
    }
  }

  private async answerKatla(
    context: CommandContext,
    session: QuizSession,
    katlaState: KatlaState,
    answerText: string,
  ): Promise<GameMessageResponse> {
    const validation = validateKatlaGuess(answerText, katlaState.length, this.katlaValidSet);
    if (!validation.valid) {
      return { text: validation.reason };
    }

    const marks = evaluateKatlaGuess(validation.word, katlaState.target);
    katlaState.guesses.push({
      guess: validation.word,
      marks,
      byUserJid: context.senderUserJid,
    });
    session.wrongParticipants.add(context.senderUserJid);

    if (validation.word === katlaState.target) {
      this.quizSessions.delete(context.chatJid);
      const reward = await this.rewardService.awardKatlaWin(
        context.chatJid,
        context.senderUserJid,
        session.roundId,
        katlaState.guesses.length,
        session.correlationId,
        session.clueCount,
      );
      const winM = formatMention(context.senderUserJid);

      return {
        text: [
          `Benar! ${winM.tag} berhasil menebak kata *${katlaState.target.toUpperCase()}* pada percobaan ke-${String(katlaState.guesses.length)}!`,
          "",
          formatKatlaBoard(katlaState),
          "",
          `Poin bertambah: +${String(reward.points)} | XP bertambah: +${String(reward.xp)}`,
          "Game selesai.",
        ].join("\n"),
        mentions: [winM.jid],
      };
    }

    if (katlaState.guesses.length >= katlaState.maxAttempts) {
      this.quizSessions.delete(context.chatJid);
      const participants = [...session.wrongParticipants];
      await Promise.allSettled(
        participants.map((userJid) =>
          this.rewardService.awardKatlaParticipation(
            context.chatJid,
            userJid,
            session.roundId,
            session.correlationId,
          ),
        ),
      );

      return {
        text: [
          `Kesempatan habis (${String(katlaState.maxAttempts)}/${String(katlaState.maxAttempts)}). Kata rahasianya adalah *${katlaState.target.toUpperCase()}*.`,
          "",
          formatKatlaBoard(katlaState),
          "",
          "Semua peserta mendapat +10 XP hiburan. Game selesai.",
        ].join("\n"),
      };
    }

    const remaining = katlaState.maxAttempts - katlaState.guesses.length;
    return {
      text: [
        formatKatlaBoard(katlaState),
        "",
        `Pola huruf aman: ${formatKatlaPatternHint(katlaState)}`,
        `Sisa kesempatan: ${String(remaining)}/${String(katlaState.maxAttempts)}`,
      ].join("\n"),
    };
  }

  private async answerBom(
    context: CommandContext,
    session: QuizSession,
    bomState: BomState,
    answerText: string,
  ): Promise<GameMessageResponse> {
    if (!/^\d+$/.test(answerText.trim())) {
      return { text: "Pilih nomor kotak 1 sampai 9 ya (contoh: .bom 4 atau reply dengan angka 1-9)." };
    }

    const cellNumber = Number(answerText.trim());
    const outcome = pickBomCell(bomState, cellNumber, context.senderUserJid);

    if (outcome.status === "invalid") {
      return { text: "Nomor kotak harus 1 sampai 9." };
    }

    if (outcome.status === "already_open") {
      return {
        text: [
          `Kotak ${String(outcome.cell)} sudah aman dibuka sebelumnya.`,
          "",
          formatBomBoard(bomState, false),
        ].join("\n"),
      };
    }

    const actorM = formatMention(context.senderUserJid);

    if (outcome.status === "bomb") {
      this.quizSessions.delete(context.chatJid);
      await this.rewardService.recordBomHit(
        context.chatJid,
        context.senderUserJid,
        session.roundId,
        session.correlationId,
      );

      return {
        text: [
          `BOOM! ${actorM.tag} membuka kotak *${String(outcome.cell)}* dan mengenai bom!`,
          "Tenang, saldo poin kamu aman (*0 minus*), dan kamu dapat +5 XP hiburan.",
          "",
          formatBomBoard(bomState, true, outcome.cell),
          "",
          "Game selesai.",
        ].join("\n"),
        mentions: [actorM.jid],
      };
    }

    const stepReward = await this.rewardService.awardBomSafeStep(
      context.chatJid,
      context.senderUserJid,
      session.roundId,
      outcome.cell,
      outcome.steps,
      session.correlationId,
    );

    if (outcome.cleanSweep) {
      this.quizSessions.delete(context.chatJid);
      const bonus = await this.rewardService.awardBomCleanSweepBonus(
        context.chatJid,
        context.senderUserJid,
        session.roundId,
        session.correlationId,
      );

      return {
        text: [
          `SAPU BERSIH! ${actorM.tag} membuka kotak terakhir aman (*${String(outcome.cell)}*)!`,
          `Bom tadi bersembunyi di kotak nomor *${String(bomState.bombIndex + 1)}*.`,
          "",
          formatBomBoard(bomState, true),
          "",
          `Hadiah kotak: +${String(stepReward.points)} Poin, +${String(stepReward.xp)} XP`,
          `Bonus sapu bersih: +${String(bonus.points)} Poin, +${String(bonus.xp)} XP`,
          "Game selesai.",
        ].join("\n"),
        mentions: [actorM.jid],
      };
    }

    return {
      text: [
        `Aman! ${actorM.tag} membuka kotak *${String(outcome.cell)}*.`,
        `+${String(stepReward.points)} Poin | +${String(stepReward.xp)} XP`,
        "",
        formatBomBoard(bomState, false),
        "",
        `Kotak aman tersisa: ${String(outcome.remainingSafe)}/${String(BOM_SAFE_TOTAL)}`,
      ].join("\n"),
      mentions: [actorM.jid],
    };
  }

  private async answerFamily100(
    context: CommandContext,
    session: QuizSession,
    rawAnswerText: string,
  ): Promise<GameMessageResponse> {
    const normalizedInput = normalizeGameAnswer(rawAnswerText);
    const slots = session.question.familySlots ?? [];

    const matchedIndex = slots.findIndex((slot) =>
      slot.aliases.some((alias) => normalizeGameAnswer(alias) === normalizedInput),
    );

    if (matchedIndex < 0) {
      return { text: "Belum ada di papan jawaban nih, coba jawaban lain!" };
    }

    const matchedSlot = slots[matchedIndex];
    if (!matchedSlot) {
      return { text: "Belum ada di papan jawaban nih, coba jawaban lain!" };
    }

    const canonicalKey = normalizeGameAnswer(matchedSlot.text);
    if (session.answered.has(canonicalKey)) {
      return { text: "Jawaban itu sudah ditemukan!" };
    }

    session.answered.add(canonicalKey);
    session.family100AnswererByAnswer.set(canonicalKey, context.senderUserJid);

    const earned = session.family100EarnedByUser.get(context.senderUserJid) ?? { points: 0, xp: 0 };
    const result = await this.rewardService.awardFamily100Answer(
      context.chatJid,
      context.senderUserJid,
      session.roundId,
      canonicalKey,
      session.correlationId,
      earned.points,
      earned.xp,
    );

    session.family100EarnedByUser.set(context.senderUserJid, {
      points: earned.points + result.points,
      xp: earned.xp + result.xp,
    });

    const isLastAnswer = session.answered.size >= slots.length;
    const answerNumber = matchedIndex + 1;
    const actorM = formatMention(context.senderUserJid);
    const board = formatFamily100Board(session);

    if (isLastAnswer) {
      const updatedEarned = session.family100EarnedByUser.get(context.senderUserJid) ?? {
        points: 0,
        xp: 0,
      };
      const bonusResult = await this.rewardService.awardFamily100FinalBonus(
        context.chatJid,
        context.senderUserJid,
        session.roundId,
        session.correlationId,
        updatedEarned.points,
        updatedEarned.xp,
      );

      const participants = [...session.family100EarnedByUser.keys()];
      await Promise.allSettled(
        participants.map((userJid) =>
          this.rewardService.recordFamily100GamePlayed(
            context.chatJid,
            userJid,
            session.roundId,
            session.correlationId,
          ),
        ),
      );

      this.quizSessions.delete(context.chatJid);

      const bonusLines = bonusResult.capped
        ? ["• Bonus jawaban terakhir tidak diterima (cap sudah penuh)."]
        : [
            `• Bonus jawaban terakhir: +${String(bonusResult.points)} Poin, +${String(bonusResult.xp)} XP`,
          ];

      return {
        text: [
          `Benar! ${actorM.tag}`,
          `Jawaban nomor ${String(answerNumber)}: *${matchedSlot.text}*`,
          result.capped
            ? "Reward tidak diterima (cap sudah penuh)."
            : `• Poin bertambah: +${String(result.points)}, XP: +${String(result.xp)}`,
          ...bonusLines,
          "",
          board.text,
          "",
          `Terjawab: ${String(session.answered.size)}/${String(slots.length)}`,
          "Game selesai.",
        ].join("\n"),
        mentions: uniqueMentions([actorM.jid, ...board.mentions]),
      };
    }

    const remaining = slots.length - session.answered.size;
    return {
      text: [
        `Benar! ${actorM.tag}`,
        `Jawaban nomor ${String(answerNumber)}: *${matchedSlot.text}*`,
        result.capped
          ? "Reward tidak diterima (cap sudah penuh)."
          : `• Poin bertambah: +${String(result.points)}, XP: +${String(result.xp)}`,
        "",
        board.text,
        "",
        `Terjawab: ${String(session.answered.size)}/${String(slots.length)} (Sisa ${String(remaining)} slot)`,
      ].join("\n"),
      mentions: uniqueMentions([actorM.jid, ...board.mentions]),
    };
  }

  private startNumberGuess(context: CommandContext, maxRange: number): GameMessageResponse {
    const target = this.randomInt(1, maxRange);
    const prompt = `Tebak angka dari 1 sampai ${String(maxRange)}.`;

    this.quizSessions.set(context.chatJid, {
      type: "tebakangka",
      groupJid: context.chatJid,
      startedBy: context.senderUserJid,
      question: {
        prompt,
        answers: [String(target)],
      },
      answered: new Set(),
      createdAt: Date.now(),
      roundId: randomUUID(),
      correlationId: generateCorrelationId(),
      attemptsByUser: new Map(),
      wrongParticipants: new Set(),
      family100EarnedByUser: new Map(),
      family100AnswererByAnswer: new Map(),
      clueCount: 0,
      revealedCluePositions: new Set(),
      numberTarget: target,
      numberMax: maxRange,
    });

    return {
      text: [
        "Game dimulai: tebak angka.",
        prompt,
        answerHint("tebakangka"),
      ].join("\n"),
    };
  }

  private async answerNumberGuess(
    context: CommandContext,
    session: QuizSession,
    answerText: string,
  ): Promise<GameMessageResponse> {
    const guess = Number(answerText);
    const target = session.numberTarget;
    if (!Number.isInteger(guess) || !target) {
      return { text: "Jawaban harus berupa angka." };
    }

    const prev = session.attemptsByUser.get(context.senderUserJid) ?? 0;
    const attempts = prev + 1;
    session.attemptsByUser.set(context.senderUserJid, attempts);
    session.wrongParticipants.add(context.senderUserJid);

    if (guess !== target) {
      const diff = Math.abs(guess - target);
      const direction = guess < target ? "Terlalu kecil" : "Terlalu besar";
      if (diff <= 3) {
        return { text: `${direction}, tapi udah panas banget (selisih dekat)!` };
      }
      if (diff <= 10) {
        return { text: `${direction}, sudah dekat!` };
      }
      return { text: `${direction}, masih lumayan jauh.` };
    }

    this.quizSessions.delete(context.chatJid);
    const reward = await this.rewardService.awardTebakAngkaCorrect(
      context.chatJid,
      context.senderUserJid,
      session.roundId,
      attempts,
      session.correlationId,
      session.clueCount,
    );
    const winnerM = formatMention(context.senderUserJid);

    return {
      text: [
        `Benar! Selamat ${winnerM.tag}, angkanya *${String(target)}*.`,
        `Percobaan ke-${String(attempts)}.`,
        `Poin bertambah: +${String(reward.points)} | XP bertambah: +${String(reward.xp)}`,
      ].join("\n"),
      mentions: [winnerM.jid],
    };
  }

  hasActiveQuiz(groupJid: string): boolean {
    this.cleanupExpired(groupJid);
    return this.quizSessions.has(groupJid);
  }

  getActiveQuiz(groupJid: string): QuizSession | undefined {
    this.cleanupExpired(groupJid);
    return this.quizSessions.get(groupJid);
  }

  setQuizMessageId(groupJid: string, messageId: string): void {
    const session = this.quizSessions.get(groupJid);
    if (session) {
      session.messageId = messageId;
    }
  }

  getActiveTicTacToe(groupJid: string): TicTacToeSession | undefined {
    return this.ticTacToeSessions.get(groupJid);
  }

  setTicTacToeMessageId(groupJid: string, messageId: string): void {
    const session = this.ticTacToeSessions.get(groupJid);
    if (session) {
      session.messageId = messageId;
    }
  }

  async answerQuizFromDirectText(
    context: CommandContext,
    answerText: string,
  ): Promise<string | null> {
    const result = await this.answerQuizFromDirectTextRich(context, answerText);
    return result?.text ?? null;
  }

  async answerQuizFromDirectTextRich(
    context: CommandContext,
    answerText: string,
  ): Promise<GameMessageResponse | null> {
    this.cleanupExpired(context.chatJid);
    const session = this.quizSessions.get(context.chatJid);
    if (!session) return null;

    return this.answerQuizRich(context, session.type, answerText);
  }

  sweepExpiredSessions(): void {
    const now = Date.now();
    for (const [groupJid, quiz] of this.quizSessions.entries()) {
      if (now - quiz.createdAt > SESSION_TTL_MS) {
        this.quizSessions.delete(groupJid);
      }
    }

    for (const [groupJid, ttt] of this.ticTacToeSessions.entries()) {
      const ttl = ttt.state === "waiting" ? WAITING_TTL_MS : MOVE_TTL_MS;
      const lastActivity = ttt.state === "waiting" ? ttt.createdAt : ttt.lastMoveAt;
      if (now - lastActivity > ttl * 2) {
        this.ticTacToeSessions.delete(groupJid);
      }
    }
  }

  private getQuestionPool(
    type: "kuis" | "family100" | "tebakkata" | "tebakemoji" | "caklontong",
  ): Question[] {
    return this.quizBank[type];
  }

  private cleanupExpired(groupJid: string): void {
    const now = Date.now();
    if (now - this.lastSweepAt > 60_000) {
      this.lastSweepAt = now;
      this.sweepExpiredSessions();
    }

    const quiz = this.quizSessions.get(groupJid);
    if (quiz && now - quiz.createdAt > SESSION_TTL_MS) {
      this.quizSessions.delete(groupJid);
    }
  }

  private assertGroup(context: CommandContext): void {
    if (!context.isGroup) {
      throw new Error("Game hanya bisa digunakan di grup tenant aktif.");
    }
  }
}

// ---- Pure helpers ----

function formatMention(userJid: string): { tag: string; jid: string } {
  const candidate = userJid.split("@")[0]?.trim();
  const local = candidate && candidate.length > 0 ? candidate : userJid;
  return { tag: `@${local}`, jid: userJid };
}

function uniqueMentions(jids: readonly string[]): string[] {
  return [...new Set(jids)];
}

function formatFamily100Board(session: QuizSession): { text: string; mentions: string[] } {
  const slots = session.question.familySlots ?? [];
  const mentions: string[] = [];

  const lines = slots.map((slot, idx) => {
    const normalized = normalizeGameAnswer(slot.text);
    if (session.answered.has(normalized)) {
      const answererJid = session.family100AnswererByAnswer.get(normalized);
      if (answererJid) {
        const m = formatMention(answererJid);
        mentions.push(m.jid);
        return `${String(idx + 1)}. ${slot.text} (${m.tag})`;
      }
      return `${String(idx + 1)}. ${slot.text}`;
    }
    return `${String(idx + 1)}. ...............`;
  });

  return { text: lines.join("\n"), mentions: uniqueMentions(mentions) };
}

function buildMaskedAnswerHint(answer: string, revealedIndices: ReadonlySet<number>): string {
  const chars: string[] = [];
  for (let idx = 0; idx < answer.length; idx++) {
    const ch = answer[idx] ?? "";
    if (ch === " ") {
      chars.push("  ");
    } else if (ch === "-") {
      chars.push("-");
    } else if (revealedIndices.has(idx)) {
      chars.push(ch.toUpperCase());
    } else {
      chars.push("_");
    }
  }
  const letterCount = answer.replace(/[^a-z0-9]/gi, "").length;
  return `${chars.join(" ")} (${String(letterCount)} huruf)`;
}

function formatGameName(type: QuizType): string {
  return {
    kuis: "kuis",
    family100: "family 100",
    tebakkata: "tebak kata",
    tebakemoji: "tebak emoji",
    tebakangka: "tebak angka",
    mtk: "matematika cepat",
    katla: "katla",
    caklontong: "cak lontong",
    bom: "tebak bom",
  }[type];
}

function answerHint(type: QuizType): string {
  if (type === "katla") {
    return "Balas/reply pesan ini 1 kata saja atau ketik .katla <kata>. Pakai .clue untuk bantu huruf.";
  }
  if (type === "bom") {
    return "Balas/reply pesan ini dengan angka 1-9 atau ketik .bom <1-9>.";
  }
  if (type === "tebakangka") {
    return "Balas/reply pesan ini dengan angka tebakanmu, ketik .tebakangka <angka>, atau .clue.";
  }
  if (type === "mtk") {
    return "Balas/reply pesan ini untuk menjawab, atau ketik .mtk <jawaban>.";
  }
  return `Balas/reply pesan ini untuk menjawab, ketik .${type} <jawaban>, atau .clue untuk petunjuk.`;
}

function formatBoard(board: TicTacToeCell[]): string {
  const cells = board.map((cell, index) => cell ?? String(index + 1));

  return [
    `${getBoardCell(cells, 0)} | ${getBoardCell(cells, 1)} | ${getBoardCell(cells, 2)}`,
    `${getBoardCell(cells, 3)} | ${getBoardCell(cells, 4)} | ${getBoardCell(cells, 5)}`,
    `${getBoardCell(cells, 6)} | ${getBoardCell(cells, 7)} | ${getBoardCell(cells, 8)}`,
  ].join("\n");
}

function getBoardCell(cells: string[], index: number): string {
  return cells[index] ?? String(index + 1);
}

function hasWinner(board: TicTacToeCell[], mark: Exclude<TicTacToeCell, null>): boolean {
  return WIN_LINES.some((line) => line.every((index) => board[index] === mark));
}

function defaultRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const gameService = new GameService();
