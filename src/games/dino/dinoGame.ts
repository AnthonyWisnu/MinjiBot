export function renderDinoGameHtml(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Dino Runner // MinjiBot Arcade</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body {
      background: #090a0f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
      touch-action: manipulation;
    }
    .game-container {
      width: 100%;
      max-width: 480px;
      padding: 16px;
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
    .brand { font-size: 14px; font-weight: 700; color: #10b981; letter-spacing: 1px; }
    .scores { font-size: 16px; font-weight: 700; font-family: monospace; }
    .hi-score { color: #64748b; margin-right: 12px; }
    .cur-score { color: #38bdf8; }
    canvas {
      background: #11141f;
      border: 2px solid #1e293b;
      border-radius: 12px;
      width: 100%;
      max-width: 440px;
      height: 220px;
      display: block;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .controls-hint {
      margin-top: 14px;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
    .btn-action {
      margin-top: 12px;
      width: 100%;
      max-width: 220px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      display: none;
    }
    .back-btn {
      margin-top: 10px;
      font-size: 12px;
      color: #64748b;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="game-container">
    <header>
      <div class="brand">DINO RUNNER // ARCADE</div>
      <div class="scores">
        <span class="hi-score">HI <span id="hiVal">00000</span></span>
        <span class="cur-score" id="scoreVal">00000</span>
      </div>
    </header>

    <canvas id="gameCanvas" width="600" height="300"></canvas>

    <button id="restartBtn" class="btn-action">MAIN LAGI</button>
    <div class="controls-hint">Tap layar atau tekan Spasi untuk lompat</div>
    <a href="/arcade" class="back-btn">&larr; Kembali ke Arcade Hub</a>
  </div>

  <script>
    const canvas = document.getElementById("gameCanvas");
    const ctx = canvas.getContext("2d");
    const scoreVal = document.getElementById("scoreVal");
    const hiVal = document.getElementById("hiVal");
    const restartBtn = document.getElementById("restartBtn");

    let highScore = parseInt(localStorage.getItem("minji_dino_hi") || "0", 10);
    hiVal.innerText = String(highScore).padStart(5, "0");

    let state = "PLAYING"; // PLAYING, GAMEOVER
    let score = 0;
    let speed = 5;
    let frame = 0;

    const dino = {
      x: 50,
      y: 210,
      w: 40,
      h: 46,
      vy: 0,
      gravity: 0.85,
      jumpForce: -13,
      groundY: 210,
      isGrounded: true
    };

    let obstacles = [];

    function spawnObstacle() {
      const h = Math.floor(Math.random() * 25) + 35;
      obstacles.push({
        x: canvas.width + 20,
        y: dino.groundY + dino.h - h,
        w: 22,
        h: h
      });
    }

    function jump() {
      if (state === "GAMEOVER") {
        restart();
        return;
      }
      if (dino.isGrounded) {
        dino.vy = dino.jumpForce;
        dino.isGrounded = false;
      }
    }

    function restart() {
      state = "PLAYING";
      score = 0;
      speed = 5;
      obstacles = [];
      dino.y = dino.groundY;
      dino.vy = 0;
      dino.isGrounded = true;
      restartBtn.style.display = "none";
      loop();
    }

    // Touch & keyboard events
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    });

    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      jump();
    }, { passive: false });

    canvas.addEventListener("mousedown", (e) => {
      e.preventDefault();
      jump();
    });

    restartBtn.addEventListener("click", restart);

    function update() {
      frame++;
      score += 1;
      scoreVal.innerText = String(Math.floor(score / 5)).padStart(5, "0");

      if (score % 300 === 0 && speed < 12) {
        speed += 0.5;
      }

      // Dino physics
      dino.y += dino.vy;
      dino.vy += dino.gravity;

      if (dino.y >= dino.groundY) {
        dino.y = dino.groundY;
        dino.vy = 0;
        dino.isGrounded = true;
      }

      // Obstacles
      if (frame % Math.max(50, 100 - Math.floor(speed * 3)) === 0 && Math.random() > 0.3) {
        if (obstacles.length === 0 || obstacles[obstacles.length - 1].x < canvas.width - 180) {
          spawnObstacle();
        }
      }

      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= speed;

        // Collision detection (AABB)
        const pad = 6;
        if (
          dino.x + pad < obs.x + obs.w &&
          dino.x + dino.w - pad > obs.x &&
          dino.y + pad < obs.y + obs.h &&
          dino.y + dino.h - pad > obs.y
        ) {
          gameOver();
          return;
        }

        if (obs.x + obs.w < -10) {
          obstacles.splice(i, 1);
        }
      }
    }

    function gameOver() {
      state = "GAMEOVER";
      const finalScore = Math.floor(score / 5);
      if (finalScore > highScore) {
        highScore = finalScore;
        localStorage.setItem("minji_dino_hi", highScore);
        hiVal.innerText = String(highScore).padStart(5, "0");
      }
      restartBtn.style.display = "block";
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Ground line
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, dino.groundY + dino.h);
      ctx.lineTo(canvas.width, dino.groundY + dino.h);
      ctx.stroke();

      // Moving ground dots
      ctx.fillStyle = "#475569";
      for (let i = 0; i < canvas.width; i += 40) {
        const x = (i - (frame * speed) % 40);
        ctx.fillRect(x, dino.groundY + dino.h + 6, 12, 2);
      }

      // Draw Dino (Modern Cyberpunk Polygon)
      ctx.fillStyle = "#10b981";
      ctx.fillRect(dino.x, dino.y + 10, dino.w - 10, dino.h - 15);
      // Head
      ctx.fillRect(dino.x + 14, dino.y, 22, 18);
      // Eye
      ctx.fillStyle = "#090a0f";
      ctx.fillRect(dino.x + 28, dino.y + 4, 4, 4);
      // Feet
      ctx.fillStyle = "#059669";
      if (dino.isGrounded && Math.floor(frame / 6) % 2 === 0) {
        ctx.fillRect(dino.x + 4, dino.y + dino.h - 6, 8, 6);
        ctx.fillRect(dino.x + 20, dino.y + dino.h - 8, 8, 6);
      } else {
        ctx.fillRect(dino.x + 4, dino.y + dino.h - 8, 8, 6);
        ctx.fillRect(dino.x + 20, dino.y + dino.h - 6, 8, 6);
      }

      // Obstacles (Cactus style)
      ctx.fillStyle = "#ef4444";
      for (const obs of obstacles) {
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
        ctx.fillRect(obs.x - 4, obs.y + 8, obs.w + 8, 6);
      }

      if (state === "GAMEOVER") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 10);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "14px sans-serif";
        ctx.fillText("Skor: " + Math.floor(score / 5), canvas.width / 2, canvas.height / 2 + 20);
      }
    }

    function loop() {
      if (state === "PLAYING") {
        update();
        draw();
        requestAnimationFrame(loop);
      }
    }

    loop();
  </script>
</body>
</html>`;
}
