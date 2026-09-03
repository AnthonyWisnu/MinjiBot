import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { CommandContext } from "../../types/command";
import { type GameRewardService, gameRewardService } from "./gameReward.service";
import { generateCorrelationId } from "../member/memberEconomy.service";

type QuizType = "kuis" | "family100" | "tebakkata" | "tebakemoji" | "tebakangka";
type TicTacToeCell = "X" | "O" | null;

interface Question {
  prompt: string;
  answers: string[];
}

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
  numberTarget?: number;
}

interface TicTacToeSession {
  groupJid: string;
  player1Jid: string;   // X -- who sent the challenge
  player2Jid: string;   // O -- who was challenged
  currentTurn: "X" | "O";
  board: TicTacToeCell[];
  createdAt: number;
  lastMoveAt: number;
  roundId: string;
  correlationId: string;
  // "waiting" = challenge sent but not accepted; "active" = game in progress.
  state: "waiting" | "active";
}

function loadQuestions(fileName: string, fallback: Question[]): Question[] {
  const possiblePaths = [
    path.resolve(process.cwd(), "src/data/games", fileName),
    path.resolve(process.cwd(), "dist/data/games", fileName),
    path.resolve(__dirname, "../../data/games", fileName),
    path.resolve(__dirname, "../../../src/data/games", fileName),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as Question[];
        }
      } catch {
        // ignore and fallback
      }
    }
  }

  return fallback;
}

const FALLBACK_QUIZ: Record<Exclude<QuizType, "tebakangka">, Question[]> = {
  kuis: [
    { prompt: "Apa ibu kota Indonesia?", answers: ["jakarta"] },
    { prompt: "Planet apa yang paling dekat dengan matahari?", answers: ["merkurius", "mercury"] },
  ],
  family100: [
    { prompt: "Sebutkan sesuatu yang biasanya ada di dapur.", answers: ["kompor", "panci", "wajan", "pisau", "sendok", "piring"] },
    { prompt: "Sebutkan benda yang sering dibawa ke sekolah.", answers: ["tas", "buku", "pensil", "pulpen", "penghapus", "penggaris"] },
  ],
  tebakkata: [
    { prompt: "Aku punya kunci tapi tidak punya pintu. Apakah aku?", answers: ["keyboard"] },
    { prompt: "Kata acak: A M K A N. Susun menjadi kata yang benar.", answers: ["makan"] },
  ],
  tebakemoji: [
    { prompt: "Tebak frasa ini: hujan + uang.", answers: ["hujan uang"] },
    { prompt: "Tebak frasa ini: rumah + sakit.", answers: ["rumah sakit"] },
  ],
};

const QUIZ_BANK: Record<Exclude<QuizType, "tebakangka">, Question[]> = {
  kuis: loadQuestions("kuis.json", FALLBACK_QUIZ.kuis),
  family100: loadQuestions("family100.json", FALLBACK_QUIZ.family100),
  tebakkata: loadQuestions("tebakkata.json", FALLBACK_QUIZ.tebakkata),
  tebakemoji: loadQuestions("tebakemoji.json", FALLBACK_QUIZ.tebakemoji),
};

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

export class GameService {
  private readonly quizSessions = new Map<string, QuizSession>();
  private readonly ticTacToeSessions = new Map<string, TicTacToeSession>();
  private readonly quizBank: typeof QUIZ_BANK;

  constructor(
    private readonly rewardService: GameRewardService = gameRewardService,
    private readonly randomInt: (min: number, max: number) => number = defaultRandomInt,
    quizBankOverride?: Partial<typeof QUIZ_BANK>,
  ) {
    this.quizBank = quizBankOverride
      ? { ...QUIZ_BANK, ...quizBankOverride }
      : QUIZ_BANK;
  }

  // ---- Quiz ----

  async startOrAnswerQuiz(context: CommandContext, type: QuizType): Promise<string> {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const answerText = context.argsText.trim();
    if (answerText.length > 0) {
      return this.answerQuiz(context, type, answerText);
    }

    if (this.quizSessions.has(context.chatJid)) {
      return "Masih ada game aktif di grup ini. Jawab dulu atau gunakan .nyerah.";
    }

    if (type === "tebakangka") {
      return this.startNumberGuess(context);
    }

    const question = pickRandom(this.quizBank[type]);
    this.quizSessions.set(context.chatJid, {
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
    });

    return [
      `Game dimulai: ${formatGameName(type)}`,
      "",
      question.prompt,
      "",
      answerHint(type),
    ].join("\n");
  }

  // ---- Surrender ----

  async surrender(context: CommandContext): Promise<string> {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const quiz = this.quizSessions.get(context.chatJid);
    if (quiz) {
      this.quizSessions.delete(context.chatJid);
      const surrenderLines: string[] = [
        "Game dihentikan.",
        `Jawaban: ${quiz.question.answers.join(", ")}`,
      ];

      if (quiz.type === "tebakkata" || quiz.type === "tebakemoji") {
        const xpReceivers = [...quiz.wrongParticipants];
        if (xpReceivers.length > 0) {
          await Promise.allSettled(
            xpReceivers.map((userJid) => {
              if (quiz.type === "tebakkata") {
                return this.rewardService.awardTebakKataSurrender(
                  context.chatJid, userJid, quiz.roundId, quiz.correlationId,
                );
              }
              return this.rewardService.awardTebakEmojiSurrender(
                context.chatJid, userJid, quiz.roundId, quiz.correlationId,
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
              context.chatJid, userJid, quiz.roundId, quiz.correlationId,
            ),
          ),
        );
      }

      return surrenderLines.join("\n");
    }

    const tictactoe = this.ticTacToeSessions.get(context.chatJid);
    if (tictactoe) {
      this.ticTacToeSessions.delete(context.chatJid);

      if (tictactoe.state === "waiting") {
        return "Tantangan dibatalkan.";
      }

      const senderJid = context.senderUserJid;
      const isSurrender1 = senderJid === tictactoe.player1Jid;
      const isSurrender2 = senderJid === tictactoe.player2Jid;

      if (!isSurrender1 && !isSurrender2) {
        return "Kamu bukan pemain dalam sesi ini.";
      }

      const loserJid = senderJid;
      const winnerJid = isSurrender1 ? tictactoe.player2Jid : tictactoe.player1Jid;

      await Promise.allSettled([
        this.rewardService.awardTicTacToeLoss(context.chatJid, loserJid, tictactoe.roundId, tictactoe.correlationId),
        this.rewardService.awardTicTacToeWin(context.chatJid, winnerJid, tictactoe.roundId, tictactoe.correlationId),
      ]);

      return [
        "Menyerah. Game selesai.",
        `Pemenang: ${winnerJid}`,
        `Poin menang: ${String(250)} | XP: ${String(100)}`,
      ].join("\n");
    }

    return "Tidak ada game aktif di grup ini.";
  }

  // ---- TicTacToe PvP ----

  async playTicTacToe(context: CommandContext): Promise<string> {
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

  private handleChallenge(context: CommandContext): string {
    const challengedJid = context.mentionedJids[0];

    if (!challengedJid) {
      return "Mention pemain yang ingin ditantang. Contoh: .tictactoe @pemain";
    }

    if (challengedJid === context.senderUserJid) {
      return "Tidak bisa menantang diri sendiri.";
    }

    if (this.ticTacToeSessions.has(context.chatJid)) {
      return "Sudah ada sesi tic tac toe aktif di grup ini.";
    }

    const session: TicTacToeSession = {
      groupJid: context.chatJid,
      player1Jid: context.senderUserJid,
      player2Jid: challengedJid,
      currentTurn: "X",
      board: Array<TicTacToeCell>(9).fill(null),
      createdAt: Date.now(),
      lastMoveAt: Date.now(),
      roundId: randomUUID(),
      correlationId: generateCorrelationId(),
      state: "waiting",
    };

    this.ticTacToeSessions.set(context.chatJid, session);

    return [
      `Tantangan dikirim ke ${challengedJid}.`,
      "Ketik .tictactoe untuk menerima. Tantangan berlaku 5 menit.",
    ].join("\n");
  }

  private handleAccept(context: CommandContext): string {
    const session = this.ticTacToeSessions.get(context.chatJid);

    if (!session) {
      return "Belum ada tantangan tic tac toe di grup ini. Tantang pemain dengan .tictactoe @pemain.";
    }

    if (session.state === "active") {
      const currentPlayerJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;
      return [
        "Tic tac toe sedang berlangsung.",
        `Giliran: ${currentPlayerJid} (${session.currentTurn})`,
        "",
        formatBoard(session.board),
        "",
        "Gunakan .tictactoe <1-9> untuk melangkah.",
      ].join("\n");
    }

    if (session.player2Jid !== context.senderUserJid) {
      return "Tantangan ini bukan untukmu.";
    }

    session.state = "active";
    session.lastMoveAt = Date.now();

    return [
      "Tantangan diterima. Game dimulai.",
      `${session.player1Jid} (X) vs ${session.player2Jid} (O)`,
      `Giliran pertama: ${session.player1Jid} (X)`,
      "",
      formatBoard(session.board),
      "",
      "Gunakan .tictactoe <1-9> untuk melangkah.",
    ].join("\n");
  }

  private async handleMove(context: CommandContext, positionText: string): Promise<string> {
    const session = this.ticTacToeSessions.get(context.chatJid);

    if (!session || session.state === "waiting") {
      return "Belum ada tic tac toe aktif. Terima tantangan dulu atau tantang pemain dengan .tictactoe @pemain.";
    }

    const currentPlayerJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;

    if (context.senderUserJid !== currentPlayerJid) {
      return `Bukan giliranmu. Giliran: ${currentPlayerJid} (${session.currentTurn})`;
    }

    const position = Number(positionText);
    if (!Number.isInteger(position) || position < 1 || position > 9) {
      return "Pilih kotak dengan angka 1 sampai 9.";
    }

    const index = position - 1;
    if (session.board[index]) {
      return "Kotak itu sudah terisi. Pilih kotak lain.";
    }

    session.board[index] = session.currentTurn;
    session.lastMoveAt = Date.now();

    const mark = session.currentTurn;

    if (hasWinner(session.board, mark)) {
      this.ticTacToeSessions.delete(context.chatJid);
      const winnerJid = mark === "X" ? session.player1Jid : session.player2Jid;
      const loserJid = mark === "X" ? session.player2Jid : session.player1Jid;

      const [winResult, lossResult] = await Promise.allSettled([
        this.rewardService.awardTicTacToeWin(context.chatJid, winnerJid, session.roundId, session.correlationId),
        this.rewardService.awardTicTacToeLoss(context.chatJid, loserJid, session.roundId, session.correlationId),
      ]);

      const winPts = winResult.status === "fulfilled" ? winResult.value.points : 250;
      const lossPts = lossResult.status === "fulfilled" ? lossResult.value.points : 50;

      return [
        `${winnerJid} menang.`,
        `Poin menang: ${String(winPts)} | Poin kalah: ${String(lossPts)}`,
        "",
        formatBoard(session.board),
      ].join("\n");
    }

    if (session.board.every(Boolean)) {
      this.ticTacToeSessions.delete(context.chatJid);

      await Promise.allSettled([
        this.rewardService.awardTicTacToeDraw(context.chatJid, session.player1Jid, session.roundId, session.correlationId),
        this.rewardService.awardTicTacToeDraw(context.chatJid, session.player2Jid, session.roundId, session.correlationId),
      ]);

      return [
        "Hasil seri.",
        `Poin seri: ${String(100)} | XP: ${String(50)}`,
        "",
        formatBoard(session.board),
      ].join("\n");
    }

    session.currentTurn = session.currentTurn === "X" ? "O" : "X";
    const nextPlayerJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;

    return [
      "Langkah diterima.",
      `Giliran: ${nextPlayerJid} (${session.currentTurn})`,
      "",
      formatBoard(session.board),
    ].join("\n");
  }

  private async checkTicTacToeTimeout(groupJid: string): Promise<string | null> {
    const now = Date.now();
    const session = this.ticTacToeSessions.get(groupJid);
    if (!session) return null;

    if (session.state === "waiting" && now - session.createdAt > WAITING_TTL_MS) {
      this.ticTacToeSessions.delete(groupJid);
      return "Tantangan tic tac toe sudah kedaluwarsa dan dibatalkan.";
    }

    if (session.state === "active" && now - session.lastMoveAt > MOVE_TTL_MS) {
      this.ticTacToeSessions.delete(groupJid);
      const timedOutJid = session.currentTurn === "X" ? session.player1Jid : session.player2Jid;
      const winnerJid = session.currentTurn === "X" ? session.player2Jid : session.player1Jid;

      await Promise.allSettled([
        this.rewardService.recordTicTacToeTimeout(groupJid, timedOutJid, session.roundId, session.correlationId),
        this.rewardService.awardTicTacToeWin(groupJid, winnerJid, session.roundId, session.correlationId),
      ]);

      return [
        `${timedOutJid} habis waktu. ${winnerJid} menang.`,
        `Pemenang mendapat ${String(250)} poin dan ${String(100)} XP.`,
      ].join("\n");
    }

    return null;
  }

  // ---- Private: Quiz helpers ----

  private async answerQuiz(context: CommandContext, type: QuizType, answerText: string): Promise<string> {
    const session = this.quizSessions.get(context.chatJid);
    if (!session) {
      return `Belum ada ${formatGameName(type)} aktif. Gunakan .${type} untuk mulai.`;
    }

    if (session.type !== type) {
      return `Game aktif saat ini adalah ${formatGameName(session.type)}.`;
    }

    if (type === "tebakangka") {
      return this.answerNumberGuess(context, session, answerText);
    }

    const normalizedAnswer = normalizeAnswer(answerText);
    const matchedAnswer = session.question.answers.find(
      (answer) => normalizeAnswer(answer) === normalizedAnswer,
    );

    if (!matchedAnswer) {
      if (!session.wrongParticipants.has(context.senderUserJid)) {
        session.wrongParticipants.add(context.senderUserJid);
        if (type === "kuis") {
          await this.rewardService.awardKuisWrongParticipation(
            context.chatJid, context.senderUserJid, session.roundId, session.correlationId,
          );
        }
      }
      return "Jawaban belum benar. Coba lagi.";
    }

    if (type === "family100") {
      return this.answerFamily100(context, session, normalizedAnswer);
    }

    if (session.answered.has(normalizedAnswer)) {
      return "Jawaban itu sudah ditemukan.";
    }

    session.answered.add(normalizedAnswer);

    let reward: { points: number; xp: number };
    if (type === "kuis") {
      reward = await this.rewardService.awardKuisCorrect(
        context.chatJid, context.senderUserJid, session.roundId, session.correlationId,
      );
    } else if (type === "tebakkata") {
      reward = await this.rewardService.awardTebakKataCorrect(
        context.chatJid, context.senderUserJid, session.roundId, session.correlationId,
      );
    } else {
      reward = await this.rewardService.awardTebakEmojiCorrect(
        context.chatJid, context.senderUserJid, session.roundId, session.correlationId,
      );
    }

    this.quizSessions.delete(context.chatJid);

    return [
      "Benar.",
      `Poin bertambah: ${String(reward.points)}`,
      `XP bertambah: ${String(reward.xp)}`,
      "Game selesai.",
    ].join("\n");
  }

  private async answerFamily100(
    context: CommandContext,
    session: QuizSession,
    normalizedAnswer: string,
  ): Promise<string> {
    if (session.answered.has(normalizedAnswer)) {
      return "Jawaban itu sudah ditemukan.";
    }

    session.answered.add(normalizedAnswer);
    session.family100AnswererByAnswer.set(normalizedAnswer, context.senderUserJid);

    const earned = session.family100EarnedByUser.get(context.senderUserJid) ?? { points: 0, xp: 0 };
    const result = await this.rewardService.awardFamily100Answer(
      context.chatJid,
      context.senderUserJid,
      session.roundId,
      normalizedAnswer,
      session.correlationId,
      earned.points,
      earned.xp,
    );

    session.family100EarnedByUser.set(context.senderUserJid, {
      points: earned.points + result.points,
      xp: earned.xp + result.xp,
    });

    const isLastAnswer = session.answered.size >= session.question.answers.length;

    if (isLastAnswer) {
      const updatedEarned = session.family100EarnedByUser.get(context.senderUserJid) ?? { points: 0, xp: 0 };
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
            context.chatJid, userJid, session.roundId, session.correlationId,
          ),
        ),
      );

      this.quizSessions.delete(context.chatJid);

      const bonusLines = bonusResult.capped
        ? ["Bonus jawaban terakhir tidak diterima (cap sudah penuh)."]
        : [`Bonus jawaban terakhir: ${String(bonusResult.points)} poin, ${String(bonusResult.xp)} XP`];

      return [
        "Benar.",
        result.capped
          ? "Reward tidak diterima (cap sudah penuh)."
          : `Poin bertambah: ${String(result.points)}, XP: ${String(result.xp)}`,
        ...bonusLines,
        `Terjawab: ${String(session.answered.size)}/${String(session.question.answers.length)}`,
        "Game selesai.",
      ].join("\n");
    }

    return [
      "Benar.",
      result.capped
        ? "Reward tidak diterima (cap sudah penuh)."
        : `Poin bertambah: ${String(result.points)}, XP: ${String(result.xp)}`,
      `Terjawab: ${String(session.answered.size)}/${String(session.question.answers.length)}`,
    ].join("\n");
  }

  private startNumberGuess(context: CommandContext): string {
    const target = this.randomInt(1, 20);
    this.quizSessions.set(context.chatJid, {
      type: "tebakangka",
      groupJid: context.chatJid,
      startedBy: context.senderUserJid,
      question: {
        prompt: "Tebak angka dari 1 sampai 20.",
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
      numberTarget: target,
    });

    return "Game dimulai: tebak angka.\nTebak angka dari 1 sampai 20.\nGunakan .tebakangka <angka>.";
  }

  private async answerNumberGuess(
    context: CommandContext,
    session: QuizSession,
    answerText: string,
  ): Promise<string> {
    const guess = Number(answerText);
    const target = session.numberTarget;
    if (!Number.isInteger(guess) || !target) {
      return "Jawaban harus berupa angka.";
    }

    const prev = session.attemptsByUser.get(context.senderUserJid) ?? 0;
    const attempts = prev + 1;
    session.attemptsByUser.set(context.senderUserJid, attempts);
    session.wrongParticipants.add(context.senderUserJid);

    if (guess !== target) {
      return guess < target ? "Terlalu kecil." : "Terlalu besar.";
    }

    this.quizSessions.delete(context.chatJid);
    const reward = await this.rewardService.awardTebakAngkaCorrect(
      context.chatJid, context.senderUserJid, session.roundId, attempts, session.correlationId,
    );

    return [
      `Benar. Angkanya ${String(target)}.`,
      `Percobaan ke-${String(attempts)}.`,
      `Poin bertambah: ${String(reward.points)}`,
      `XP bertambah: ${String(reward.xp)}`,
    ].join("\n");
  }

  private cleanupExpired(groupJid: string): void {
    const now = Date.now();
    const quiz = this.quizSessions.get(groupJid);
    if (quiz && now - quiz.createdAt > SESSION_TTL_MS) {
      this.quizSessions.delete(groupJid);
    }
    // TicTacToe expiry handled in checkTicTacToeTimeout (async, awards rewards).
  }

  private assertGroup(context: CommandContext): void {
    if (!context.isGroup) {
      throw new Error("Game hanya bisa digunakan di grup tenant aktif.");
    }
  }
}

// ---- Pure helpers (no side effects) ----

function pickRandom<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (!item) {
    throw new Error("Data game belum tersedia.");
  }

  return item;
}

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatGameName(type: QuizType): string {
  return {
    kuis: "kuis",
    family100: "family 100",
    tebakkata: "tebak kata",
    tebakemoji: "tebak emoji",
    tebakangka: "tebak angka",
  }[type];
}

function answerHint(type: QuizType): string {
  if (type === "family100") {
    return "Jawab dengan .family100 <jawaban>.";
  }

  return `Jawab dengan .${type} <jawaban>.`;
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
