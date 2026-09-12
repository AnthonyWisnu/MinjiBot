import { Router, type Request, type Response } from "express";

import { playerSessionService } from "../services/player-session.service";
import { lyricsService } from "../../services/media/lyrics.service";

export const playerRouter = Router();

// POST /api/player/session - Create a validated player session
playerRouter.post("/api/player/session", (req: Request, res: Response) => {
  try {
    const { videoId, videoUrl, title, channelTitle, durationSeconds, thumbnail, chatJid, userJid } = req.body;
    if (!videoId || !videoUrl || !title) {
      res.status(400).json({ error: "Properti videoId, videoUrl, dan title diperlukan." });
      return;
    }

    const session = playerSessionService.createSession({
      videoId,
      videoUrl,
      title,
      channelTitle: channelTitle || "YouTube",
      durationSeconds: Number(durationSeconds) || 0,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      chatJid,
      userJid,
    });

    res.json({ success: true, sessionId: session.sessionId, session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal membuat sesi player";
    res.status(500).json({ error: message });
  }
});

// GET /api/player/info/:sessionId - Get session metadata
playerRouter.get("/api/player/info/:sessionId", (req: Request, res: Response) => {
  const rawId = req.params.sessionId;
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!sessionId) {
    res.status(400).json({ error: "Session ID tidak valid." });
    return;
  }
  const session = playerSessionService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Sesi player tidak ditemukan atau sudah kadaluwarsa." });
    return;
  }
  res.json({ success: true, session });
});

// GET /api/player/lyrics - Search lyrics
playerRouter.get("/api/player/lyrics", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      res.status(400).json({ error: "Query diperlukan." });
      return;
    }
    const lyricsResult = await lyricsService.searchLyrics(query);
    res.json({ success: true, lyrics: lyricsResult?.plainLyrics || null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal mencari lirik";
    res.status(500).json({ error: message });
  }
});

// GET /player/:sessionId - Interactive Mobile-first Web Player UI (Section 6)
playerRouter.get("/player/:sessionId", (req: Request, res: Response) => {
  const rawId = req.params.sessionId;
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;
  const session = sessionId ? playerSessionService.getSession(sessionId) : null;

  if (!session) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sesi Kadaluwarsa // MinjiBot</title>
        <style>
          body { background: #090a0f; color: #e2e8f0; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .card { background: #11141f; padding: 24px; border-radius: 12px; border: 1px solid #334155; max-width: 320px; }
          h2 { color: #ef4444; margin-top: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Sesi Kadaluwarsa</h2>
          <p>Tautan pemutar ini sudah tidak aktif atau tidak ditemukan. Silakan kirim kembali perintah <code>.ythtml &lt;lagu&gt;</code> di WhatsApp.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  const streamUrl = `/api/player/stream/${session.sessionId}`;
  const minutes = Math.floor(session.durationSeconds / 60);
  const seconds = session.durationSeconds % 60;
  const formattedDuration = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;

  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(session.title)} // MinjiBot Player</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      background: #090a0f;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow-x: hidden;
    }
    .player-card {
      width: 100%;
      max-width: 420px;
      background: #11141f;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.7);
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      color: #10b981;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 14px;
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .badge::before {
      content: "";
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      display: inline-block;
      box-shadow: 0 0 8px #10b981;
    }
    .cover-container {
      width: 100%;
      aspect-ratio: 16/9;
      border-radius: 12px;
      overflow: hidden;
      position: relative;
      background: #1e293b;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .cover-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
      display: none;
    }
    .buffering-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: none;
      align-items: center;
      justify-content: center;
      color: #38bdf8;
      font-size: 13px;
      font-weight: 600;
    }
    .track-info {
      width: 100%;
      margin-top: 16px;
      text-align: left;
    }
    .track-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
      color: #ffffff;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .track-channel {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .visualizer-box {
      width: 100%;
      height: 28px;
      margin-top: 14px;
      display: flex;
      align-items: flex-end;
      gap: 3px;
      justify-content: center;
    }
    .v-bar {
      width: 4px;
      height: 4px;
      background: #38bdf8;
      border-radius: 2px;
      transition: height 0.1s ease;
    }
    .seek-container {
      width: 100%;
      margin-top: 12px;
    }
    .seek-bar {
      width: 100%;
      -webkit-appearance: none;
      appearance: none;
      height: 5px;
      border-radius: 3px;
      background: #334155;
      outline: none;
    }
    .seek-bar::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #10b981;
      cursor: pointer;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
    }
    .time-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
      margin-top: 4px;
      font-family: monospace;
    }
    .controls-row {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-around;
      margin-top: 16px;
    }
    .btn-ctrl {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 18px;
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, transform 0.1s;
    }
    .btn-ctrl:active { transform: scale(0.92); }
    .btn-play-pause {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #ffffff;
      border-radius: 50%;
      font-size: 22px;
      box-shadow: 0 6px 18px rgba(16, 185, 129, 0.4);
    }
    .volume-row {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 14px;
      padding: 0 4px;
    }
    .volume-slider {
      flex: 1;
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      border-radius: 2px;
      background: #334155;
      outline: none;
    }
    .volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #38bdf8;
      cursor: pointer;
    }
    .conn-status {
      margin-top: 12px;
      font-size: 11px;
      color: #64748b;
      text-align: center;
    }
    .status-active { color: #10b981; }
    .status-error { color: #ef4444; }
  </style>
</head>
<body>
  <div class="player-card">
    <div class="badge">MINJIBOT WEBVIEW STREAM</div>

    <div class="cover-container" id="mediaBox">
      <img src="${escapeHtml(session.thumbnail)}" class="cover-img" id="coverImg" alt="Thumbnail">
      <video id="playerMedia" playsinline preload="metadata">
        <source src="${streamUrl}" type="video/mp4">
      </video>
      <div class="buffering-overlay" id="bufOverlay">Memuat Stream...</div>
    </div>

    <div class="track-info">
      <div class="track-title">${escapeHtml(session.title)}</div>
      <div class="track-channel">${escapeHtml(session.channelTitle)}</div>
    </div>

    <div class="visualizer-box" id="vizBox"></div>

    <div class="seek-container">
      <input type="range" class="seek-bar" id="seekBar" min="0" max="${session.durationSeconds}" value="0">
      <div class="time-row">
        <span id="curTime">0:00</span>
        <span id="totTime">${formattedDuration}</span>
      </div>
    </div>

    <div class="controls-row">
      <button class="btn-ctrl" id="btnRw10" title="Mundur 10s">&#9194;</button>
      <button class="btn-ctrl btn-play-pause" id="btnPlay" title="Play / Pause">&#9654;</button>
      <button class="btn-ctrl" id="btnFw10" title="Maju 10s">&#9193;</button>
      <button class="btn-ctrl" id="btnToggleVideo" title="Tampilkan Video">&#128250;</button>
    </div>

    <div class="volume-row">
      <button class="btn-ctrl" id="btnMute" style="padding:0; font-size:14px;">&#128266;</button>
      <input type="range" class="volume-slider" id="volSlider" min="0" max="1" step="0.05" value="1">
    </div>

    <div class="conn-status" id="connStatus">
      Koneksi: <span class="status-active">Siap Memutar</span> (Session: ${session.sessionId.slice(0, 8)})
    </div>
  </div>

  <script>
    const media = document.getElementById("playerMedia");
    const coverImg = document.getElementById("coverImg");
    const bufOverlay = document.getElementById("bufOverlay");
    const btnPlay = document.getElementById("btnPlay");
    const btnRw10 = document.getElementById("btnRw10");
    const btnFw10 = document.getElementById("btnFw10");
    const btnToggleVideo = document.getElementById("btnToggleVideo");
    const btnMute = document.getElementById("btnMute");
    const volSlider = document.getElementById("volSlider");
    const seekBar = document.getElementById("seekBar");
    const curTime = document.getElementById("curTime");
    const connStatus = document.getElementById("connStatus");
    const vizBox = document.getElementById("vizBox");

    // Generate visualizer bars
    const BAR_COUNT = 24;
    const bars = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const b = document.createElement("div");
      b.className = "v-bar";
      vizBox.appendChild(b);
      bars.push(b);
    }

    let isPlaying = false;
    let showVideo = false;

    function formatTime(s) {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return m + ":" + (sec < 10 ? "0" : "") + sec;
    }

    btnPlay.addEventListener("click", () => {
      if (media.paused) {
        media.play().then(() => {
          btnPlay.innerHTML = "&#10074;&#10074;";
          isPlaying = true;
          bufOverlay.style.display = "none";
        }).catch(err => {
          console.warn("Play error", err);
          bufOverlay.style.display = "flex";
          bufOverlay.innerText = "Buffering Stream...";
        });
      } else {
        media.pause();
        btnPlay.innerHTML = "&#9654;";
        isPlaying = false;
      }
    });

    media.addEventListener("timeupdate", () => {
      if (!isSeeking) {
        seekBar.value = media.currentTime;
        curTime.innerText = formatTime(media.currentTime);
      }
      // Animate visualizer
      if (isPlaying) {
        bars.forEach(b => {
          b.style.height = (Math.random() * 22 + 4) + "px";
        });
      }
    });

    media.addEventListener("waiting", () => {
      bufOverlay.style.display = "flex";
      bufOverlay.innerText = "Buffering...";
    });

    media.addEventListener("playing", () => {
      bufOverlay.style.display = "none";
      btnPlay.innerHTML = "&#10074;&#10074;";
      isPlaying = true;
    });

    media.addEventListener("error", () => {
      bufOverlay.style.display = "flex";
      bufOverlay.innerText = "Gagal memuat stream";
      connStatus.innerHTML = "Status: <span class='status-error'>Koneksi Terputus (Error)</span>";
    });

    let isSeeking = false;
    seekBar.addEventListener("input", () => {
      isSeeking = true;
      curTime.innerText = formatTime(seekBar.value);
    });
    seekBar.addEventListener("change", () => {
      media.currentTime = seekBar.value;
      isSeeking = false;
    });

    btnRw10.addEventListener("click", () => { media.currentTime = Math.max(0, media.currentTime - 10); });
    btnFw10.addEventListener("click", () => { media.currentTime = Math.min(media.duration || 9999, media.currentTime + 10); });

    btnToggleVideo.addEventListener("click", () => {
      showVideo = !showVideo;
      media.style.display = showVideo ? "block" : "none";
      coverImg.style.display = showVideo ? "none" : "block";
      btnToggleVideo.style.color = showVideo ? "#10b981" : "#94a3b8";
    });

    volSlider.addEventListener("input", () => {
      media.volume = volSlider.value;
      btnMute.innerHTML = media.volume === 0 ? "&#128263;" : "&#128266;";
    });

    btnMute.addEventListener("click", () => {
      media.muted = !media.muted;
      btnMute.innerHTML = media.muted ? "&#128263;" : "&#128266;";
    });
  </script>
</body>
</html>`);
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
