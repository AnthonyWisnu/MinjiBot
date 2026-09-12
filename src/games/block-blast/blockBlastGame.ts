export function renderBlockBlastGameHtml(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Block Blast // MinjiBot Arcade</title>
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
      overflow: hidden;
      touch-action: manipulation;
    }
    .game-box {
      width: 100%;
      max-width: 400px;
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
    .brand { font-size: 14px; font-weight: 800; color: #f59e0b; letter-spacing: 1px; }
    .score-board {
      font-family: monospace;
      font-size: 16px;
      font-weight: 800;
    }
    .score-val { color: #38bdf8; }
    .board-container {
      background: #11141f;
      border: 3px solid #1e293b;
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      width: 100%;
      aspect-ratio: 1;
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
      gap: 4px;
    }
    .cell {
      background: #1e293b;
      border-radius: 4px;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    .cell.filled {
      background: #3b82f6;
      box-shadow: inset 0 2px 4px rgba(255,255,255,0.3);
    }
    .cell.preview {
      background: #0ea5e9;
      opacity: 0.65;
    }
    .cell.clearing {
      animation: pulseClear 0.25s ease-out;
    }
    @keyframes pulseClear {
      0% { transform: scale(1); background: #f59e0b; }
      50% { transform: scale(1.15); background: #ffffff; }
      100% { transform: scale(0); opacity: 0; }
    }
    .dock {
      width: 100%;
      margin-top: 16px;
      display: flex;
      justify-content: space-around;
      align-items: center;
      background: #11141f;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 10px;
      min-height: 90px;
    }
    .piece-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      transition: background 0.15s;
    }
    .piece-slot.selected {
      background: rgba(56, 189, 248, 0.2);
      outline: 2px solid #38bdf8;
    }
    .mini-grid {
      display: grid;
      gap: 2px;
    }
    .mini-cell {
      width: 14px;
      height: 14px;
      border-radius: 2px;
      background: transparent;
    }
    .mini-cell.block {
      background: #38bdf8;
      box-shadow: inset 0 1px 2px rgba(255,255,255,0.4);
    }
    .status-msg {
      margin-top: 10px;
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
      min-height: 18px;
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }
    .modal-card {
      background: #11141f;
      border: 2px solid #ef4444;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      max-width: 300px;
      width: 90%;
    }
    .btn-restart {
      margin-top: 16px;
      width: 100%;
      padding: 12px;
      background: #3b82f6;
      color: #fff;
      font-weight: 700;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    .back-btn { margin-top: 10px; font-size: 12px; color: #64748b; text-decoration: none; }
  </style>
</head>
<body>
  <div class="game-box">
    <header>
      <div class="brand">BLOCK BLAST // ARCADE</div>
      <div class="score-board">SKOR: <span class="score-val" id="score">0</span></div>
    </header>

    <div class="board-container" id="board"></div>

    <div class="dock" id="dock"></div>
    <div class="status-msg" id="status">Pilih balok di bawah, lalu ketuk petak di papan</div>
    <a href="/arcade" class="back-btn">&larr; Kembali ke Arcade Hub</a>
  </div>

  <div class="modal-overlay" id="gameOverModal">
    <div class="modal-card">
      <h2 style="color: #ef4444; margin-bottom: 8px;">GAME OVER</h2>
      <p style="color: #94a3b8; font-size: 14px;">Tidak ada ruang lagi untuk balok.</p>
      <p style="font-size: 20px; font-weight: 800; margin-top: 12px;">Skor: <span id="finalScore" style="color: #38bdf8;">0</span></p>
      <button class="btn-restart" id="btnRestart">MAIN LAGI</button>
    </div>
  </div>

  <script>
    const GRID_SIZE = 8;
    const boardEl = document.getElementById("board");
    const dockEl = document.getElementById("dock");
    const scoreEl = document.getElementById("score");
    const statusEl = document.getElementById("status");
    const modalEl = document.getElementById("gameOverModal");
    const finalScoreEl = document.getElementById("finalScore");
    const btnRestart = document.getElementById("btnRestart");

    let grid = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));
    let score = 0;
    let selectedPieceIndex = null;

    const SHAPES = [
      [[1]], // Dot
      [[1, 1]], // 2-H
      [[1], [1]], // 2-V
      [[1, 1, 1]], // 3-H
      [[1], [1], [1]], // 3-V
      [[1, 1], [1, 1]], // 2x2 square
      [[1, 1, 1], [1, 1, 1], [1, 1, 1]], // 3x3 square (rare)
      [[1, 0], [1, 1]], // L small
      [[0, 1], [1, 1]], // J small
      [[1, 1, 1], [0, 1, 0]], // T shape
    ];

    let currentPieces = [];

    function initBoard() {
      boardEl.innerHTML = "";
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const cell = document.createElement("div");
          cell.className = "cell";
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.addEventListener("click", () => handleCellClick(r, c));
          boardEl.appendChild(cell);
        }
      }
      renderBoard();
      spawnPieces();
    }

    function renderBoard() {
      const cells = boardEl.children;
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const idx = r * GRID_SIZE + c;
          cells[idx].className = "cell" + (grid[r][c] === 1 ? " filled" : "");
        }
      }
      scoreEl.innerText = score;
    }

    function spawnPieces() {
      currentPieces = [];
      for (let i = 0; i < 3; i++) {
        const randIdx = Math.floor(Math.random() * (SHAPES.length - 1)); // skip 3x3 most of time
        currentPieces.push(JSON.parse(JSON.stringify(SHAPES[randIdx])));
      }
      renderDock();
      checkGameOver();
    }

    function renderDock() {
      dockEl.innerHTML = "";
      currentPieces.forEach((piece, idx) => {
        if (!piece) return;
        const slot = document.createElement("div");
        slot.className = "piece-slot" + (selectedPieceIndex === idx ? " selected" : "");
        slot.addEventListener("click", () => {
          selectedPieceIndex = idx;
          renderDock();
          statusEl.innerText = "Ketuk petak kiri atas di papan untuk meletakkan balok";
        });

        const miniGrid = document.createElement("div");
        miniGrid.className = "mini-grid";
        miniGrid.style.gridTemplateColumns = \`repeat(\${piece[0].length}, 14px)\`;
        miniGrid.style.gridTemplateRows = \`repeat(\${piece.length}, 14px)\`;

        for (let r = 0; r < piece.length; r++) {
          for (let c = 0; c < piece[0].length; c++) {
            const miniCell = document.createElement("div");
            miniCell.className = "mini-cell" + (piece[r][c] ? " block" : "");
            miniGrid.appendChild(miniCell);
          }
        }

        slot.appendChild(miniGrid);
        dockEl.appendChild(slot);
      });
    }

    function canPlace(piece, startR, startC) {
      if (!piece) return false;
      const rows = piece.length;
      const cols = piece[0].length;
      if (startR + rows > GRID_SIZE || startC + cols > GRID_SIZE) return false;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (piece[r][c] === 1 && grid[startR + r][startC + c] === 1) {
            return false;
          }
        }
      }
      return true;
    }

    function handleCellClick(startR, startC) {
      if (selectedPieceIndex === null || !currentPieces[selectedPieceIndex]) {
        statusEl.innerText = "Pilih balok di dock bawah terlebih dahulu";
        return;
      }

      const piece = currentPieces[selectedPieceIndex];
      if (!canPlace(piece, startR, startC)) {
        statusEl.innerText = "Posisi tidak valid atau terhalang!";
        return;
      }

      // Place piece
      let placedBlocks = 0;
      for (let r = 0; r < piece.length; r++) {
        for (let c = 0; c < piece[0].length; c++) {
          if (piece[r][c] === 1) {
            grid[startR + r][startC + c] = 1;
            placedBlocks++;
          }
        }
      }

      score += placedBlocks * 10;
      currentPieces[selectedPieceIndex] = null;
      selectedPieceIndex = null;

      clearFullLines();
      renderBoard();
      renderDock();

      // Check if dock is empty
      if (currentPieces.every(p => p === null)) {
        spawnPieces();
      } else {
        checkGameOver();
      }
    }

    function clearFullLines() {
      const fullRows = [];
      const fullCols = [];

      for (let r = 0; r < GRID_SIZE; r++) {
        if (grid[r].every(val => val === 1)) fullRows.push(r);
      }

      for (let c = 0; c < GRID_SIZE; c++) {
        let isFull = true;
        for (let r = 0; r < GRID_SIZE; r++) {
          if (grid[r][c] !== 1) { isFull = false; break; }
        }
        if (isFull) fullCols.push(c);
      }

      fullRows.forEach(r => {
        for (let c = 0; c < GRID_SIZE; c++) grid[r][c] = 0;
      });

      fullCols.forEach(c => {
        for (let r = 0; r < GRID_SIZE; r++) grid[r][c] = 0;
      });

      const clearedLines = fullRows.length + fullCols.length;
      if (clearedLines > 0) {
        score += clearedLines * 100 * clearedLines;
        statusEl.innerText = "COMBO " + clearedLines + "X! +" + (clearedLines * 100 * clearedLines);
      } else {
        statusEl.innerText = "Bagus! Pilih balok berikutnya.";
      }
    }

    function checkGameOver() {
      const availablePieces = currentPieces.filter(p => p !== null);
      if (availablePieces.length === 0) return;

      let canFitAny = false;
      for (const piece of availablePieces) {
        for (let r = 0; r < GRID_SIZE; r++) {
          for (let c = 0; c < GRID_SIZE; c++) {
            if (canPlace(piece, r, c)) {
              canFitAny = true;
              break;
            }
          }
          if (canFitAny) break;
        }
        if (canFitAny) break;
      }

      if (!canFitAny) {
        finalScoreEl.innerText = score;
        modalEl.style.display = "flex";
      }
    }

    btnRestart.addEventListener("click", () => {
      grid = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));
      score = 0;
      selectedPieceIndex = null;
      modalEl.style.display = "none";
      initBoard();
    });

    initBoard();
  </script>
</body>
</html>`;
}
