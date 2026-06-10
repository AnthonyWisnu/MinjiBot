import type { CommandContext } from "../../types/command";

type QuizType = "kuis" | "family100" | "tebakkata" | "tebakemoji" | "tebakangka";
type TicTacToeCell = "X" | "O" | null;

interface Question {
  prompt: string;
  answers: string[];
  reward: number;
}

interface QuizSession {
  type: QuizType;
  groupJid: string;
  startedBy: string;
  question: Question;
  answered: Set<string>;
  createdAt: number;
  numberTarget?: number;
}

interface TicTacToeSession {
  groupJid: string;
  playerJid: string;
  board: TicTacToeCell[];
  createdAt: number;
}

interface PlayerProfile {
  points: number;
  wins: number;
  gamesPlayed: number;
  lastDailyKey?: string;
}

const QUIZ_BANK: Record<Exclude<QuizType, "tebakangka">, Question[]> = {
  kuis: [
    {
      prompt: "Apa ibu kota Indonesia?",
      answers: ["jakarta"],
      reward: 10,
    },
    {
      prompt: "Planet apa yang paling dekat dengan matahari?",
      answers: ["merkurius", "mercury"],
      reward: 10,
    },
  ],
  family100: [
    {
      prompt: "Sebutkan sesuatu yang biasanya ada di dapur.",
      answers: ["kompor", "panci", "wajan", "pisau", "sendok", "piring"],
      reward: 5,
    },
    {
      prompt: "Sebutkan benda yang sering dibawa ke sekolah.",
      answers: ["tas", "buku", "pensil", "pulpen", "penghapus", "penggaris"],
      reward: 5,
    },
  ],
  tebakkata: [
    {
      prompt: "Aku punya kunci tapi tidak punya pintu. Apakah aku?",
      answers: ["keyboard"],
      reward: 10,
    },
    {
      prompt: "Kata acak: A M K A N. Susun menjadi kata yang benar.",
      answers: ["makan"],
      reward: 10,
    },
  ],
  tebakemoji: [
    {
      prompt: "Tebak frasa ini: hujan + uang.",
      answers: ["hujan uang"],
      reward: 10,
    },
    {
      prompt: "Tebak frasa ini: rumah + sakit.",
      answers: ["rumah sakit"],
      reward: 10,
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

const DAILY_REWARD = 15;
const SESSION_TTL_MS = 10 * 60 * 1000;

export class GameService {
  private readonly quizSessions = new Map<string, QuizSession>();
  private readonly ticTacToeSessions = new Map<string, TicTacToeSession>();
  private readonly profilesByGroup = new Map<string, Map<string, PlayerProfile>>();

  startOrAnswerQuiz(context: CommandContext, type: QuizType): string {
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

    const question = pickRandom(QUIZ_BANK[type]);
    this.quizSessions.set(context.chatJid, {
      type,
      groupJid: context.chatJid,
      startedBy: context.senderJid,
      question,
      answered: new Set(),
      createdAt: Date.now(),
    });

    return [
      `Game dimulai: ${formatGameName(type)}`,
      "",
      question.prompt,
      "",
      answerHint(type),
    ].join("\n");
  }

  surrender(context: CommandContext): string {
    this.assertGroup(context);
    this.cleanupExpired(context.chatJid);

    const quiz = this.quizSessions.get(context.chatJid);
    if (quiz) {
      this.quizSessions.delete(context.chatJid);
      return `Game dihentikan.\nJawaban: ${quiz.question.answers.join(", ")}`;
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
        playerJid: context.senderJid,
        board: Array<TicTacToeCell>(9).fill(null),
        createdAt: Date.now(),
      };
      this.ticTacToeSessions.set(context.chatJid, session);
      this.addGamesPlayed(context.chatJid, context.senderJid);

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

    if (session.playerJid !== context.senderJid) {
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

  claimDaily(context: CommandContext): string {
    this.assertGroup(context);

    const profile = this.getProfile(context.chatJid, context.senderJid);
    const dailyKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Makassar",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (profile.lastDailyKey === dailyKey) {
      return "Bonus harian sudah diambil hari ini.";
    }

    profile.lastDailyKey = dailyKey;
    profile.points += DAILY_REWARD;

    return `Bonus harian berhasil diambil.\nPoin bertambah: ${String(DAILY_REWARD)}\nTotal poin: ${String(profile.points)}`;
  }

  getPoints(context: CommandContext): string {
    this.assertGroup(context);

    const profile = this.getProfile(context.chatJid, context.senderJid);
    return formatProfile(context.senderJid, profile);
  }

  getProfileText(context: CommandContext): string {
    return this.getPoints(context);
  }

  getRank(context: CommandContext): string {
    this.assertGroup(context);

    const profiles = this.profilesByGroup.get(context.chatJid);
    if (!profiles || profiles.size === 0) {
      return "Belum ada poin game di grup ini.";
    }

    const lines = ["[RANK GAME]", ""];
    [...profiles.entries()]
      .sort(([, left], [, right]) => right.points - left.points)
      .slice(0, 10)
      .forEach(([jid, profile], index) => {
        lines.push(`${String(index + 1)}. ${jid}`);
        lines.push(`   Poin: ${String(profile.points)}`);
        lines.push(`   Menang: ${String(profile.wins)}`);
      });

    return lines.join("\n");
  }

  private answerQuiz(context: CommandContext, type: QuizType, answerText: string): string {
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
      return "Jawaban belum benar. Coba lagi.";
    }

    if (session.answered.has(normalizedAnswer)) {
      return "Jawaban itu sudah ditemukan.";
    }

    session.answered.add(normalizedAnswer);
    this.awardWin(context.chatJid, context.senderJid, session.question.reward);

    if (session.type !== "family100" || session.answered.size >= session.question.answers.length) {
      this.quizSessions.delete(context.chatJid);
      return `Benar.\nPoin bertambah: ${String(session.question.reward)}\nGame selesai.`;
    }

    return [
      "Benar.",
      `Poin bertambah: ${String(session.question.reward)}`,
      `Terjawab: ${String(session.answered.size)}/${String(session.question.answers.length)}`,
    ].join("\n");
  }

  private startNumberGuess(context: CommandContext): string {
    const target = Math.floor(Math.random() * 20) + 1;
    this.quizSessions.set(context.chatJid, {
      type: "tebakangka",
      groupJid: context.chatJid,
      startedBy: context.senderJid,
      question: {
        prompt: "Tebak angka dari 1 sampai 20.",
        answers: [String(target)],
        reward: 10,
      },
      answered: new Set(),
      createdAt: Date.now(),
      numberTarget: target,
    });

    return "Game dimulai: tebak angka.\nTebak angka dari 1 sampai 20.\nGunakan .tebakangka <angka>.";
  }

  private answerNumberGuess(
    context: CommandContext,
    session: QuizSession,
    answerText: string,
  ): string {
    const guess = Number(answerText);
    const target = session.numberTarget;
    if (!Number.isInteger(guess) || !target) {
      return "Jawaban harus berupa angka.";
    }

    if (guess !== target) {
      return guess < target ? "Terlalu kecil." : "Terlalu besar.";
    }

    this.quizSessions.delete(context.chatJid);
    this.awardWin(context.chatJid, context.senderJid, session.question.reward);

    return `Benar. Angkanya ${String(target)}.\nPoin bertambah: ${String(session.question.reward)}`;
  }

  private resolveTicTacToeResult(
    context: CommandContext,
    session: TicTacToeSession,
    mark: Exclude<TicTacToeCell, null>,
  ): string | null {
    if (hasWinner(session.board, mark)) {
      this.ticTacToeSessions.delete(context.chatJid);

      if (mark === "X") {
        this.awardWin(context.chatJid, context.senderJid, 15);
        return ["Kamu menang.", "Poin bertambah: 15", "", formatBoard(session.board)].join("\n");
      }

      return ["Bot menang.", "", formatBoard(session.board)].join("\n");
    }

    if (session.board.every(Boolean)) {
      this.ticTacToeSessions.delete(context.chatJid);
      return ["Hasil seri.", "", formatBoard(session.board)].join("\n");
    }

    return null;
  }

  private awardWin(groupJid: string, userJid: string, points: number): void {
    const profile = this.getProfile(groupJid, userJid);
    profile.points += points;
    profile.wins += 1;
    profile.gamesPlayed += 1;
  }

  private addGamesPlayed(groupJid: string, userJid: string): void {
    const profile = this.getProfile(groupJid, userJid);
    profile.gamesPlayed += 1;
  }

  private getProfile(groupJid: string, userJid: string): PlayerProfile {
    let groupProfiles = this.profilesByGroup.get(groupJid);
    if (!groupProfiles) {
      groupProfiles = new Map();
      this.profilesByGroup.set(groupJid, groupProfiles);
    }

    let profile = groupProfiles.get(userJid);
    if (!profile) {
      profile = {
        points: 0,
        wins: 0,
        gamesPlayed: 0,
      };
      groupProfiles.set(userJid, profile);
    }

    return profile;
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

function formatProfile(userJid: string, profile: PlayerProfile): string {
  return [
    "[PROFIL GAME]",
    "",
    `User: ${userJid}`,
    `Poin: ${String(profile.points)}`,
    `Menang: ${String(profile.wins)}`,
    `Main: ${String(profile.gamesPlayed)}`,
  ].join("\n");
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

export const gameService = new GameService();
