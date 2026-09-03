import { randomUUID } from "node:crypto";

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
  // Set of normalized answers already found (for family100 dedup and others).
  answered: Set<string>;
  createdAt: number;
  roundId: string;
  correlationId: string;
  // Tebak angka: attempt count per user.
  attemptsByUser: Map<string, number>;
  // Wrong participation tracking: userJid -> XP already awarded.
  wrongParticipants: Set<string>;
  // Family100: per-user earned totals for cap enforcement.
  family100EarnedByUser: Map<string, { points: number; xp: number }>;
  // Track who answered which answer in family100 (for multi-answer tracking).
  family100AnswererByAnswer: Map<string, string>;
  numberTarget?: number;
}

interface TicTacToeSession {
  groupJid: string;
  playerJid: string;
  board: TicTacToeCell[];
  createdAt: number;
  roundId: string;
}

const QUIZ_BANK: Record<Exclude<QuizType, "tebakangka">, Question[]> = {
  kuis: [
    {
      prompt: "Apa ibu kota Indonesia?",
      answers: ["jakarta"],
    },
    {
      prompt: "Planet apa yang paling dekat dengan matahari?",
      answers: ["merkurius", "mercury"],
    },
  ],
  family100: [
    {
      prompt: "Sebutkan sesuatu yang biasanya ada di dapur.",
      answers: ["kompor", "panci", "wajan", "pisau", "sendok", "piring"],
    },
    {
      prompt: "Sebutkan benda yang sering dibawa ke sekolah.",
      answers: ["tas", "buku", "pensil", "pulpen", "penghapus", "penggaris"],
    },
  ],
  tebakkata: [
    {
      prompt: "Aku punya kunci tapi tidak punya pintu. Apakah aku?",
      answers: ["keyboard"],
    },
    {
      prompt: "Kata acak: A M K A N. Susun menjadi kata yang benar.",
      answers: ["makan"],
    },
  ],
  tebakemoji: [
    {
      prompt: "Tebak frasa ini: hujan + uang.",
      answers: ["hujan uang"],
    },
    {
      prompt: "Tebak frasa ini: rumah + sakit.",
      answers: ["rumah sakit"],
    },
  ],
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

      // Award surrender XP to wrong participants only (not family100 — their rewards already given).
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
        // Record game-played for all participants who earned anything.
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
      return "Tic tac toe dihentikan.";
    }

    return "Tidak ada game aktif di grup ini.";
  }

  playTicTacToe(context: CommandContext): string {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const positionText = context.args[0];
    if (!positionText) {
      if (this.ticTacToeSessions.has(context.chatJid)) {
        return "Tic tac toe sedang aktif. Gunakan .tictactoe <1-9> untuk memilih kotak.";
      }

      const session: TicTacToeSession = {
        groupJid: context.chatJid,
        playerJid: context.senderUserJid,
        board: Array<TicTacToeCell>(9).fill(null),
        createdAt: Date.now(),
        roundId: randomUUID(),
      };
      this.ticTacToeSessions.set(context.chatJid, session);

      return [
        "Tic tac toe dimulai.",
        "Kamu memakai X. Bot memakai O.",
        "",
        formatBoard(session.board),
        "",
        "Gunakan .tictactoe <1-9>.",
      ].join("\n");
    }

    const session = this.ticTacToeSessions.get(context.chatJid);
    if (!session) {
      return "Belum ada tic tac toe aktif. Gunakan .tictactoe untuk mulai.";
    }

    if (session.playerJid !== context.senderUserJid) {
      return "Tic tac toe ini sedang dimainkan oleh member lain.";
    }

    const position = Number(positionText);
    if (!Number.isInteger(position) || position < 1 || position > 9) {
      return "Pilih kotak dengan angka 1 sampai 9.";
    }

    const index = position - 1;
    if (session.board[index]) {
      return "Kotak itu sudah terisi. Pilih kotak lain.";
    }

    session.board[index] = "X";
    const playerResult = this.resolveTicTacToeResult(context, session, "X");
    if (playerResult) {
      return playerResult;
    }

    const botMove = chooseBotMove(session.board);
    if (botMove >= 0) {
      session.board[botMove] = "O";
    }

    const botResult = this.resolveTicTacToeResult(context, session, "O");
    if (botResult) {
      return botResult;
    }

    return ["Langkah diterima.", "", formatBoard(session.board)].join("\n");
  }

  // ---- Private: quiz answer dispatch ----

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
      // Wrong answer: award XP once per user per round.
      if (!session.wrongParticipants.has(context.senderUserJid)) {
        session.wrongParticipants.add(context.senderUserJid);
        if (type === "kuis") {
          await this.rewardService.awardKuisWrongParticipation(
            context.chatJid, context.senderUserJid, session.roundId, session.correlationId,
          );
        }
        // tebakkata and tebakemoji wrong XP given at surrender/end, tracked via wrongParticipants.
      }
      return "Jawaban belum benar. Coba lagi.";
    }

    // Family100 allows multiple correct answers.
    if (type === "family100") {
      return this.answerFamily100(context, session, normalizedAnswer);
    }

    // Single-answer quiz: answer already found by someone else?
    if (session.answered.has(normalizedAnswer)) {
      return "Jawaban itu sudah ditemukan.";
    }

    session.answered.add(normalizedAnswer);

    // Award correct answer.
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
      // Award final bonus to this user.
      const updatedEarned = session.family100EarnedByUser.get(context.senderUserJid) ?? { points: 0, xp: 0 };
      const bonusResult = await this.rewardService.awardFamily100FinalBonus(
        context.chatJid,
        context.senderUserJid,
        session.roundId,
        session.correlationId,
        updatedEarned.points,
        updatedEarned.xp,
      );

      // Record game-played for all participants.
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

    // Track attempts for this user.
    const prev = session.attemptsByUser.get(context.senderUserJid) ?? 0;
    const attempts = prev + 1;
    session.attemptsByUser.set(context.senderUserJid, attempts);
    session.wrongParticipants.add(context.senderUserJid);

    if (guess !== target) {
      return guess < target ? "Terlalu kecil." : "Terlalu besar.";
    }

    // Correct: award tiered reward.
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

  private resolveTicTacToeResult(
    context: CommandContext,
    session: TicTacToeSession,
    mark: Exclude<TicTacToeCell, null>,
  ): string | null {
    if (hasWinner(session.board, mark)) {
      this.ticTacToeSessions.delete(context.chatJid);

      if (mark === "X") {
        return ["Kamu menang.", "", formatBoard(session.board)].join("\n");
      }

      return ["Bot menang.", "", formatBoard(session.board)].join("\n");
    }

    if (session.board.every(Boolean)) {
      this.ticTacToeSessions.delete(context.chatJid);
      return ["Hasil seri.", "", formatBoard(session.board)].join("\n");
    }

    return null;
  }

  private cleanupExpired(groupJid: string): void {
    const now = Date.now();
    const quiz = this.quizSessions.get(groupJid);
    if (quiz && now - quiz.createdAt > SESSION_TTL_MS) {
      this.quizSessions.delete(groupJid);
    }

    const ticTacToe = this.ticTacToeSessions.get(groupJid);
    if (ticTacToe && now - ticTacToe.createdAt > SESSION_TTL_MS) {
      this.ticTacToeSessions.delete(groupJid);
    }
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

function chooseBotMove(board: TicTacToeCell[]): number {
  return board.findIndex((cell) => cell === null);
}

function hasWinner(board: TicTacToeCell[], mark: Exclude<TicTacToeCell, null>): boolean {
  return WIN_LINES.some((line) => line.every((index) => board[index] === mark));
}

function defaultRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const gameService = new GameService();
