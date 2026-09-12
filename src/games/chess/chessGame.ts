import { Chess } from "chess.js";

export class ChessGameEngine {
  private game: Chess;

  constructor(fen?: string) {
    this.game = new Chess(fen);
  }

  getFen(): string {
    return this.game.fen();
  }

  isGameOver(): boolean {
    return this.game.isGameOver();
  }

  isCheck(): boolean {
    return this.game.inCheck();
  }

  isCheckmate(): boolean {
    return this.game.isCheckmate();
  }

  isStalemate(): boolean {
    return this.game.isStalemate();
  }

  turn(): "w" | "b" {
    return this.game.turn();
  }

  getLegalMoves(square?: string) {
    if (square) {
      return this.game.moves({ square: square as any, verbose: true });
    }
    return this.game.moves({ verbose: true });
  }

  makeMove(from: string, to: string, promotion: string = "q"): boolean {
    try {
      const move = this.game.move({ from, to, promotion });
      return !!move;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.game.reset();
  }
}

export function renderChessGameHtml(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Royal Chess // MinjiBot Arcade</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body {
      background: #090a0f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 12px;
      overflow-x: hidden;
      touch-action: manipulation;
    }
    .chess-box {
      width: 100%;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    header {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .brand { font-size: 14px; font-weight: 800; color: #10b981; letter-spacing: 1px; }
    .turn-badge {
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      background: #1e293b;
      color: #38bdf8;
    }
    .board-wrapper {
      width: 100%;
      aspect-ratio: 1;
      background: #1e293b;
      border: 3px solid #334155;
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.6);
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
    }
    .sq {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: min(8vw, 36px);
      cursor: pointer;
      position: relative;
      transition: background 0.12s ease;
    }
    .sq.light { background: #e2e8f0; color: #0f172a; }
    .sq.dark { background: #475569; color: #f8fafc; }
    .sq.selected {
      background: #38bdf8 !important;
    }
    .sq.legal-target::after {
      content: "";
      width: 14px;
      height: 14px;
      background: rgba(16, 185, 129, 0.75);
      border-radius: 50%;
      position: absolute;
    }
    .sq.check {
      background: #ef4444 !important;
    }
    .info-bar {
      margin-top: 14px;
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn-reset {
      padding: 8px 16px;
      background: #1e293b;
      border: 1px solid #475569;
      color: #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .status-text {
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
    }
    .back-btn { margin-top: 12px; font-size: 12px; color: #64748b; text-decoration: none; }
  </style>
</head>
<body>
  <div class="chess-box">
    <header>
      <div class="brand">ROYAL CHESS // ARCADE</div>
      <div class="turn-badge" id="turnBadge">Giliran: Putih</div>
    </header>

    <div class="board-wrapper" id="chessBoard"></div>

    <div class="info-bar">
      <div class="status-text" id="statusText">Pilih bidak untuk melangkah</div>
      <button class="btn-reset" id="resetBtn">RESET PAPAN</button>
    </div>

    <a href="/arcade" class="back-btn">&larr; Kembali ke Arcade Hub</a>
  </div>

  <script>
    // Embedded Lightweight Mini Chess Engine for 100% offline responsive mobile client
    // Pieces: P, N, B, R, Q, K (White) | p, n, b, r, q, k (Black)
    const PIECE_SYMBOLS = {
      P: "\u2659", N: "\u2658", B: "\u2657", R: "\u2656", Q: "\u2655", K: "\u2654",
      p: "\u265F", n: "\u265E", b: "\u265D", r: "\u265C", q: "\u265B", k: "\u265A"
    };

    let board = [
      ["r","n","b","q","k","b","n","r"],
      ["p","p","p","p","p","p","p","p"],
      ["","","","","","","",""],
      ["","","","","","","",""],
      ["","","","","","","",""],
      ["","","","","","","",""],
      ["P","P","P","P","P","P","P","P"],
      ["R","N","B","Q","K","B","N","R"]
    ];

    let currentTurn = "w"; // 'w' | 'b'
    let selectedSquare = null; // {r, c}
    let legalTargets = []; // [{r, c}]

    const boardEl = document.getElementById("chessBoard");
    const turnBadge = document.getElementById("turnBadge");
    const statusText = document.getElementById("statusText");
    const resetBtn = document.getElementById("resetBtn");

    function isWhite(piece) { return piece && piece === piece.toUpperCase(); }
    function isBlack(piece) { return piece && piece === piece.toLowerCase(); }

    function getLegalMovesForSquare(r, c) {
      const piece = board[r][c];
      if (!piece) return [];
      if (currentTurn === "w" && !isWhite(piece)) return [];
      if (currentTurn === "b" && !isBlack(piece)) return [];

      const moves = [];
      const type = piece.toLowerCase();
      const isW = isWhite(piece);

      const addMove = (tr, tc) => {
        if (tr < 0 || tr >= 8 || tc < 0 || tc >= 8) return false;
        const target = board[tr][tc];
        if (!target) {
          moves.push({ r: tr, c: tc });
          return true; // continue ray
        }
        if ((isW && isBlack(target)) || (!isW && isWhite(target))) {
          moves.push({ r: tr, c: tc });
        }
        return false; // hit piece, stop ray
      };

      // Pawn
      if (type === "p") {
        const dir = isW ? -1 : 1;
        const startRow = isW ? 6 : 1;
        // forward 1
        if (r + dir >= 0 && r + dir < 8 && !board[r + dir][c]) {
          moves.push({ r: r + dir, c });
          // forward 2
          if (r === startRow && !board[r + dir * 2][c]) {
            moves.push({ r: r + dir * 2, c });
          }
        }
        // captures
        [-1, 1].forEach(dc => {
          const tc = c + dc;
          const tr = r + dir;
          if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
            const target = board[tr][tc];
            if (target && ((isW && isBlack(target)) || (!isW && isWhite(target)))) {
              moves.push({ r: tr, c: tc });
            }
          }
        });
      }

      // Knight
      if (type === "n") {
        const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        jumps.forEach(([dr, dc]) => addMove(r + dr, c + dc));
      }

      // King
      if (type === "k") {
        const steps = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        steps.forEach(([dr, dc]) => addMove(r + dr, c + dc));
      }

      // Rook / Queen
      if (type === "r" || type === "q") {
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        dirs.forEach(([dr, dc]) => {
          let step = 1;
          while (addMove(r + dr * step, c + dc * step)) step++;
        });
      }

      // Bishop / Queen
      if (type === "b" || type === "q") {
        const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
        dirs.forEach(([dr, dc]) => {
          let step = 1;
          while (addMove(r + dr * step, c + dc * step)) step++;
        });
      }

      return moves;
    }

    function renderBoard() {
      boardEl.innerHTML = "";
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const sq = document.createElement("div");
          const isLight = (r + c) % 2 === 0;
          sq.className = "sq " + (isLight ? "light" : "dark");

          if (selectedSquare && selectedSquare.r === r && selectedSquare.c === c) {
            sq.classList.add("selected");
          }

          if (legalTargets.some(t => t.r === r && t.c === c)) {
            sq.classList.add("legal-target");
          }

          const piece = board[r][c];
          if (piece) {
            sq.innerText = PIECE_SYMBOLS[piece] || piece;
          }

          sq.addEventListener("click", () => handleSquareClick(r, c));
          boardEl.appendChild(sq);
        }
      }

      turnBadge.innerText = currentTurn === "w" ? "Giliran: Putih" : "Giliran: Hitam";
    }

    function handleSquareClick(r, c) {
      // 1. If clicking a legal target, move!
      if (selectedSquare && legalTargets.some(t => t.r === r && t.c === c)) {
        makeMove(selectedSquare.r, selectedSquare.c, r, c);
        selectedSquare = null;
        legalTargets = [];
        renderBoard();
        return;
      }

      // 2. Otherwise select piece
      const piece = board[r][c];
      if (piece && ((currentTurn === "w" && isWhite(piece)) || (currentTurn === "b" && isBlack(piece)))) {
        selectedSquare = { r, c };
        legalTargets = getLegalMovesForSquare(r, c);
        statusText.innerText = "Bidak terpilih (" + (legalTargets.length) + " langkah legal)";
      } else {
        selectedSquare = null;
        legalTargets = [];
        statusText.innerText = "Pilih bidak Anda";
      }
      renderBoard();
    }

    function makeMove(fromR, fromC, toR, toC) {
      const piece = board[fromR][fromC];
      board[fromR][fromC] = "";

      // Simple pawn promotion
      if (piece === "P" && toR === 0) board[toR][toC] = "Q";
      else if (piece === "p" && toR === 7) board[toR][toC] = "q";
      else board[toR][toC] = piece;

      currentTurn = currentTurn === "w" ? "b" : "w";
      statusText.innerText = "Langkah selesai. " + (currentTurn === "w" ? "Putih" : "Hitam") + " melangkah.";
    }

    resetBtn.addEventListener("click", () => {
      board = [
        ["r","n","b","q","k","b","n","r"],
        ["p","p","p","p","p","p","p","p"],
        ["","","","","","","",""],
        ["","","","","","","",""],
        ["","","","","","","",""],
        ["","","","","","","",""],
        ["P","P","P","P","P","P","P","P"],
        ["R","N","B","Q","K","B","N","R"]
      ];
      currentTurn = "w";
      selectedSquare = null;
      legalTargets = [];
      statusText.innerText = "Papan direset.";
      renderBoard();
    });

    renderBoard();
  </script>
</body>
</html>`;
}
