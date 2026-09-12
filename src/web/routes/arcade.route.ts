import { Router, type Request, type Response } from "express";

import { renderDinoGameHtml } from "../../games/dino/dinoGame";
import { renderBlockBlastGameHtml } from "../../games/block-blast/blockBlastGame";
import { renderChessGameHtml } from "../../games/chess/chessGame";

import path from "node:path";
import fs from "node:fs";

export const arcadeRouter = Router();

// GET /arcade & /arcade/ - Arcade Hub (Game Launcher)
arcadeRouter.get(["/arcade", "/arcade/"], (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Arcade Hub // MinjiBot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090a0f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .hub-card {
      width: 100%;
      max-width: 420px;
      background: #11141f;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.6);
      text-align: center;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      color: #10b981;
      letter-spacing: 1.5px;
      margin-bottom: 8px;
    }
    h1 { font-size: 22px; font-weight: 800; color: #ffffff; margin-bottom: 6px; }
    p { font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
    .game-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    }
    .game-item {
      display: flex;
      align-items: center;
      padding: 14px 16px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      text-decoration: none;
      color: #f8fafc;
      transition: transform 0.1s, border-color 0.15s, background 0.15s;
    }
    .game-item:active { transform: scale(0.98); background: #243046; }
    .game-icon {
      font-size: 24px;
      margin-right: 14px;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      border-radius: 10px;
    }
    .game-meta { text-align: left; flex: 1; }
    .game-name { font-size: 15px; font-weight: 700; color: #ffffff; }
    .game-desc { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .arrow { color: #64748b; font-size: 16px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="hub-card">
    <div class="badge">MINJIBOT RETRO ARCADE</div>
    <h1>Arcade Arena</h1>
    <p>Pilih game HTML5 interaktif untuk dimainkan langsung di WebView WhatsApp.</p>

    <div class="game-list">
      <a href="/arcade/dino" class="game-item">
        <div class="game-icon">&#129430;</div>
        <div class="game-meta">
          <div class="game-name">Dino Runner</div>
          <div class="game-desc">Lompat lewati rintangan kaktus dengan kontrol sentuh cepat.</div>
        </div>
        <div class="arrow">&rarr;</div>
      </a>

      <a href="/arcade/block-blast" class="game-item">
        <div class="game-icon">&#129521;</div>
        <div class="game-meta">
          <div class="game-name">Block Blast</div>
          <div class="game-desc">Puzzle balok 8x8 klasik dengan penghancur baris & kolom.</div>
        </div>
        <div class="arrow">&rarr;</div>
      </a>

        <a href="/arcade/chess" class="game-item">
        <div class="game-icon">&#9812;</div>
        <div class="game-meta">
          <div class="game-name">Royal Chess (PvP)</div>
          <div class="game-desc">Permainan catur legal dengan engine validasi chess.js.</div>
        </div>
        <div class="arrow">&rarr;</div>
      </a>

      <a href="/arcade/flappy" class="game-item">
        <div class="game-icon">&#128038;</div>
        <div class="game-meta">
          <div class="game-name">Flappy Minji</div>
          <div class="game-desc">Terbangkan burung lewati pipa dan menangkan token reward.</div>
        </div>
        <div class="arrow">&rarr;</div>
      </a>
    </div>
  </div>
</body>
</html>`);
});

// GET /arcade/flappy - Flappy Bird Game
arcadeRouter.get("/arcade/flappy", (_req: Request, res: Response) => {
  const flappyPath = path.resolve(process.cwd(), "public/arcade/index.html");
  if (fs.existsSync(flappyPath)) {
    res.sendFile(flappyPath);
  } else {
    res.redirect("/arcade");
  }
});

// GET /arcade/dino - Dino Runner Game
arcadeRouter.get("/arcade/dino", (_req: Request, res: Response) => {
  res.send(renderDinoGameHtml());
});

// GET /arcade/block-blast - Block Blast Game
arcadeRouter.get("/arcade/block-blast", (_req: Request, res: Response) => {
  res.send(renderBlockBlastGameHtml());
});

// GET /arcade/chess - Royal Chess Game
arcadeRouter.get("/arcade/chess", (_req: Request, res: Response) => {
  res.send(renderChessGameHtml());
});

// GET /catur - Backward compatible alias for chess
arcadeRouter.get("/catur", (_req: Request, res: Response) => {
  res.send(renderChessGameHtml());
});
