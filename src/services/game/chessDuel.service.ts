import crypto from "node:crypto";
import { Chess, type Square, type PieceSymbol, type Color } from "chess.js";

import { logger } from "../../config/logger";

export type ChessGameMode = "ai" | "pvp";
export type ChessDifficulty = "easy" | "medium" | "hard";

export interface ChessRoomState {
  roomId: string;
  fen: string;
  turn: "w" | "b";
  mode: ChessGameMode;
  playerColor: "w" | "b";
  difficulty: ChessDifficulty;
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  isStalemate: boolean;
  isGameOver: boolean;
  winner: "w" | "b" | "draw" | null;
  moveHistory: Array<{ from: string; to: string; san: string; color: string }>;
  captured: {
    w: string[];
    b: string[];
  };
  lastMove: { from: string; to: string } | null;
  createdAt: number;
  lastActivityAt: number;
}

export interface MakeMoveResult {
  success: boolean;
  error?: string;
  state: ChessRoomState;
  botMove?: { from: string; to: string; san: string } | null;
}

// ─── Piece-Square Tables for Positional Evaluation ─────────────────────────

const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];

const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];

const KING_PST = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

export class ChessDuelService {
  private rooms: Map<
    string,
    {
      chess: Chess;
      mode: ChessGameMode;
      playerColor: "w" | "b";
      difficulty: ChessDifficulty;
      moveHistory: Array<{ from: string; to: string; san: string; color: string }>;
      lastMove: { from: string; to: string } | null;
      createdAt: number;
      lastActivityAt: number;
    }
  > = new Map();

  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      this.sweepExpiredRooms();
    }, 15 * 60 * 1000); // Sweep every 15 minutes
    this.cleanupInterval.unref();
  }

  sweepExpiredRooms(maxAgeMs = 60 * 60 * 1000): number {
    const now = Date.now();
    let count = 0;
    for (const [id, room] of this.rooms.entries()) {
      if (now - room.lastActivityAt > maxAgeMs) {
        this.rooms.delete(id);
        count++;
      }
    }
    if (count > 0) {
      logger.info({ count }, "Chess rooms expired and swept");
    }
    return count;
  }

  createRoom(options?: {
    mode?: ChessGameMode;
    playerColor?: "w" | "b";
    difficulty?: ChessDifficulty;
    roomId?: string;
  }): ChessRoomState {
    const roomId = options?.roomId || crypto.randomUUID();
    const mode = options?.mode || "ai";
    const playerColor = options?.playerColor || "w";
    const difficulty = options?.difficulty || "medium";

    const chess = new Chess();
    const now = Date.now();

    this.rooms.set(roomId, {
      chess,
      mode,
      playerColor,
      difficulty,
      moveHistory: [],
      lastMove: null,
      createdAt: now,
      lastActivityAt: now,
    });

    // If player is black in AI mode, bot makes the first move (w)
    if (mode === "ai" && playerColor === "b") {
      this.executeBotMove(roomId);
    }

    return this.getRoomState(roomId)!;
  }

  getRoomState(roomId: string): ChessRoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const { chess, mode, playerColor, difficulty, moveHistory, lastMove, createdAt, lastActivityAt } = room;
    const isGameOver = chess.isGameOver();
    const isCheckmate = chess.isCheckmate();
    const isDraw = chess.isDraw();
    const isStalemate = chess.isStalemate();

    let winner: "w" | "b" | "draw" | null = null;
    if (isCheckmate) {
      // If white to move and checkmated, black won
      winner = chess.turn() === "w" ? "b" : "w";
    } else if (isDraw) {
      winner = "draw";
    }

    const captured = this.calculateCapturedPieces(chess);

    return {
      roomId,
      fen: chess.fen(),
      turn: chess.turn(),
      mode,
      playerColor,
      difficulty,
      isCheck: chess.inCheck(),
      isCheckmate,
      isDraw,
      isStalemate,
      isGameOver,
      winner,
      moveHistory,
      captured,
      lastMove,
      createdAt,
      lastActivityAt,
    };
  }

  makeMove(
    roomId: string,
    from: string,
    to: string,
    promotion: string = "q",
  ): MakeMoveResult {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        success: false,
        error: "Room catur tidak ditemukan atau sudah kadaluwarsa.",
        state: null as any,
      };
    }

    const { chess } = room;
    if (chess.isGameOver()) {
      return {
        success: false,
        error: "Permainan catur telah selesai.",
        state: this.getRoomState(roomId)!,
      };
    }

    try {
      const move = chess.move({
        from: from as Square,
        to: to as Square,
        promotion: promotion.toLowerCase() as PieceSymbol,
      });

      if (!move) {
        return {
          success: false,
          error: "Langkah tidak legal.",
          state: this.getRoomState(roomId)!,
        };
      }

      room.moveHistory.push({
        from: move.from,
        to: move.to,
        san: move.san,
        color: move.color,
      });
      room.lastMove = { from: move.from, to: move.to };
      room.lastActivityAt = Date.now();

      let botMoveResult: { from: string; to: string; san: string } | null = null;

      // In AI mode, if the player just moved and game is not over, make bot move
      if (room.mode === "ai" && !chess.isGameOver()) {
        const isBotTurn = chess.turn() !== room.playerColor;
        if (isBotTurn) {
          botMoveResult = this.executeBotMove(roomId);
        }
      }

      return {
        success: true,
        state: this.getRoomState(roomId)!,
        botMove: botMoveResult,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal memproses langkah catur";
      return {
        success: false,
        error: msg,
        state: this.getRoomState(roomId)!,
      };
    }
  }

  resign(roomId: string, resigningColor: "w" | "b"): ChessRoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Load custom FEN or force game over
    const winner = resigningColor === "w" ? "b" : "w";
    room.lastActivityAt = Date.now();

    const state = this.getRoomState(roomId)!;
    state.isGameOver = true;
    state.winner = winner;
    return state;
  }

  getLegalMoves(roomId: string, square?: string): Array<{ from: string; to: string; san: string }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const moves = room.chess.moves({
      square: square as Square | undefined,
      verbose: true,
    });

    return moves.map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
    }));
  }

  // ─── AI Engine: Minimax with Alpha-Beta Pruning ───────────────────────────

  executeBotMove(roomId: string): { from: string; to: string; san: string } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.chess.isGameOver()) return null;

    const { chess, difficulty } = room;
    const botColor = chess.turn();

    let depth = 2;
    if (difficulty === "easy") depth = 1;
    if (difficulty === "hard") depth = 3;

    const bestMove = this.findBestMove(chess, depth, botColor);
    if (!bestMove) return null;

    const executed = chess.move(bestMove);
    if (!executed) return null;

    const moveEntry = {
      from: executed.from,
      to: executed.to,
      san: executed.san,
    };

    room.moveHistory.push({
      ...moveEntry,
      color: executed.color,
    });
    room.lastMove = { from: executed.from, to: executed.to };
    room.lastActivityAt = Date.now();

    return moveEntry;
  }

  private findBestMove(
    chess: Chess,
    depth: number,
    botColor: Color,
  ): { from: Square; to: Square; promotion?: PieceSymbol } | null {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    // Shuffle moves for variety in equal positions
    moves.sort(() => Math.random() - 0.5);

    // Sort moves to prioritize captures (quicker alpha-beta cutoffs)
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

    let bestScore = -Infinity;
    let bestMove = moves[0]!;

    for (const move of moves) {
      chess.move(move);
      const score = -this.minimax(chess, depth - 1, -Infinity, Infinity, botColor === "w" ? "b" : "w");
      chess.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return {
      from: bestMove.from,
      to: bestMove.to,
      promotion: bestMove.promotion,
    };
  }

  private minimax(
    chess: Chess,
    depth: number,
    alpha: number,
    beta: number,
    turnColor: Color,
  ): number {
    if (depth === 0 || chess.isGameOver()) {
      return this.evaluateBoard(chess, turnColor);
    }

    const moves = chess.moves({ verbose: true });
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

    let maxScore = -Infinity;

    for (const move of moves) {
      chess.move(move);
      const score = -this.minimax(chess, depth - 1, -beta, -alpha, turnColor === "w" ? "b" : "w");
      chess.undo();

      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) {
        break; // Beta cutoff
      }
    }

    return maxScore;
  }

  private evaluateBoard(chess: Chess, turnColor: Color): number {
    if (chess.isCheckmate()) {
      // If current side to move is in checkmate, it lost
      return -99999;
    }
    if (chess.isDraw()) {
      return 0;
    }

    let score = 0;
    const board = chess.board();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r]?.[c];
        if (!piece) continue;

        const value = PIECE_VALUES[piece.type] || 0;
        const squareIdx = piece.color === "w" ? r * 8 + c : (7 - r) * 8 + c;

        let pstVal = 0;
        switch (piece.type) {
          case "p": pstVal = PAWN_PST[squareIdx] ?? 0; break;
          case "n": pstVal = KNIGHT_PST[squareIdx] ?? 0; break;
          case "b": pstVal = BISHOP_PST[squareIdx] ?? 0; break;
          case "r": pstVal = ROOK_PST[squareIdx] ?? 0; break;
          case "q": pstVal = QUEEN_PST[squareIdx] ?? 0; break;
          case "k": pstVal = KING_PST[squareIdx] ?? 0; break;
        }

        const totalPieceScore = value + pstVal;
        if (piece.color === turnColor) {
          score += totalPieceScore;
        } else {
          score -= totalPieceScore;
        }
      }
    }

    return score;
  }

  private calculateCapturedPieces(chess: Chess): { w: string[]; b: string[] } {
    const startingCounts: Record<string, number> = {
      p: 8, n: 2, b: 2, r: 2, q: 1,
    };

    const currentCounts: { w: Record<string, number>; b: Record<string, number> } = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    };

    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r]?.[c];
        if (p && p.type !== "k") {
          currentCounts[p.color][p.type] = (currentCounts[p.color][p.type] || 0) + 1;
        }
      }
    }

    const capturedW: string[] = [];
    const capturedB: string[] = [];

    for (const [type, count] of Object.entries(startingCounts)) {
      const diffW = count - (currentCounts.w[type] || 0);
      for (let i = 0; i < diffW; i++) capturedW.push(type.toUpperCase());

      const diffB = count - (currentCounts.b[type] || 0);
      for (let i = 0; i < diffB; i++) capturedB.push(type.toLowerCase());
    }

    return { w: capturedW, b: capturedB };
  }
}

export const chessDuelService = new ChessDuelService();
