import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { chessDuelService } from "../src/services/game/chessDuel.service";

describe("ChessDuelService & Strategy Arena", () => {
  it("harus menyediakan semua file HTML antarmuka Strategy Arena", () => {
    const caturPath = path.resolve(process.cwd(), "public", "catur", "index.html");
    const connect4Path = path.resolve(process.cwd(), "public", "duel", "connect4.html");
    const tttPath = path.resolve(process.cwd(), "public", "duel", "tictactoe.html");
    const duelHubPath = path.resolve(process.cwd(), "public", "duel", "index.html");

    assert.strictEqual(existsSync(caturPath), true, "catur/index.html harus ada");
    assert.strictEqual(existsSync(connect4Path), true, "duel/connect4.html harus ada");
    assert.strictEqual(existsSync(tttPath), true, "duel/tictactoe.html harus ada");
    assert.strictEqual(existsSync(duelHubPath), true, "duel/index.html harus ada");

    const caturHtml = readFileSync(caturPath, "utf-8");
    assert.ok(caturHtml.includes("DANS CATUR"));
    assert.ok(caturHtml.includes("id=\"board\""));
  });

  it("harus dapat membuat room catur baru dengan state awal legal FIDE", () => {
    const room = chessDuelService.createRoom({ mode: "pvp", playerColor: "w" });
    assert.ok(room.roomId);
    assert.strictEqual(room.turn, "w");
    assert.strictEqual(room.isGameOver, false);
    assert.strictEqual(room.isCheck, false);
    assert.strictEqual(room.fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  });

  it("harus dapat memvalidasi dan mengeksekusi langkah legal catur", () => {
    const room = chessDuelService.createRoom({ mode: "pvp", playerColor: "w" });
    const result = chessDuelService.makeMove(room.roomId, "e2", "e4");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.state.turn, "b");
    assert.strictEqual(result.state.lastMove?.from, "e2");
    assert.strictEqual(result.state.lastMove?.to, "e4");
    assert.ok(result.state.fen.includes("4P3"));
  });

  it("harus menolak langkah yang tidak legal secara aturan FIDE", () => {
    const room = chessDuelService.createRoom({ mode: "pvp", playerColor: "w" });
    const result = chessDuelService.makeMove(room.roomId, "e2", "e5"); // Pion tidak bisa lompat 3 petak

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.strictEqual(result.state.turn, "w"); // Giliran tetap Putih
  });

  it("harus memicu respons Minimax AI bot secara otomatis pada mode AI", () => {
    const room = chessDuelService.createRoom({ mode: "ai", playerColor: "w", difficulty: "easy" });
    const result = chessDuelService.makeMove(room.roomId, "e2", "e4");

    assert.strictEqual(result.success, true);
    assert.ok(result.botMove, "Bot harus membalas langkah pemain");
    assert.ok(result.botMove.from);
    assert.ok(result.botMove.to);
    // Setelah bot melangkah, giliran kembali ke Putih (pemain)
    assert.strictEqual(result.state.turn, "w");
    assert.strictEqual(result.state.moveHistory.length, 2);
  });

  it("harus dapat mengambil daftar langkah legal untuk bidak tertentu", () => {
    const room = chessDuelService.createRoom({ mode: "pvp", playerColor: "w" });
    const legalMovesE2 = chessDuelService.getLegalMoves(room.roomId, "e2");

    assert.ok(Array.isArray(legalMovesE2));
    assert.strictEqual(legalMovesE2.length, 2);
    const dests = legalMovesE2.map((m) => m.to);
    assert.ok(dests.includes("e3"));
    assert.ok(dests.includes("e4"));
  });

  it("harus dapat memproses pemain menyerah (resign) dengan penetapan pemenang yang benar", () => {
    const room = chessDuelService.createRoom({ mode: "pvp", playerColor: "w" });
    const resigned = chessDuelService.resign(room.roomId, "w");

    assert.ok(resigned);
    assert.strictEqual(resigned.isGameOver, true);
    assert.strictEqual(resigned.winner, "b");
  });
});
