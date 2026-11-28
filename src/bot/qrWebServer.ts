import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { logger } from "../config/logger";

interface QrCodeMatrixInstance {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

type QrCodeConstructor = new (typeNumber: number, errorCorrectLevel: number) => QrCodeMatrixInstance;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCodeLib = require("qrcode-terminal/vendor/QRCode") as QrCodeConstructor;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRErrorCorrectLevelLib = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel") as {
  L: number;
  M: number;
  Q: number;
  H: number;
};

export type QrPairingState =
  | "connecting"
  | "waiting_qr"
  | "open"
  | "logged_out"
  | "closed";

export interface QrWebServerStatusSnapshot {
  state: QrPairingState;
  qrSvg: string | null;
  qrUpdatedAtMs: number | null;
  connectedJid: string | null;
  statusMessage: string;
}

export interface QrWebServerOptions {
  host: string;
  port: number;
  token?: string;
  onResetSession?: () => Promise<void>;
}

const QR_QUIET_ZONE_MODULES = 4;

/**
 * Merender string data QR menjadi SVG hitam-putih kontras tinggi tanpa dependensi eksternal.
 */
export function renderQrSvg(data: string): string {
  const qr = new QRCodeLib(-1, QRErrorCorrectLevelLib.L);
  qr.addData(data);
  qr.make();

  const count = qr.getModuleCount();
  const totalSize = count + QR_QUIET_ZONE_MODULES * 2;
  const rects: string[] = [];

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        const x = col + QR_QUIET_ZONE_MODULES;
        const y = row + QR_QUIET_ZONE_MODULES;
        rects.push(`<rect x="${String(x)}" y="${String(y)}" width="1" height="1"/>`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(totalSize)} ${String(totalSize)}" shape-rendering="crispEdges" role="img" aria-label="WhatsApp Login QR Code">`,
    `<rect width="${String(totalSize)}" height="${String(totalSize)}" fill="#ffffff"/>`,
    `<g fill="#111827">${rects.join("")}</g>`,
    "</svg>",
  ].join("");
}

function hashTokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isQrTokenValid(providedToken: string | null | undefined, expectedToken: string): boolean {
  if (!providedToken || providedToken.length === 0) {
    return false;
  }

  const providedDigest = hashTokenDigest(providedToken);
  const expectedDigest = hashTokenDigest(expectedToken);
  return timingSafeEqual(providedDigest, expectedDigest);
}

function extractRequestToken(req: IncomingMessage, url: URL): string | null {
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

  const headerToken = req.headers["x-qr-token"];
  if (typeof headerToken === "string" && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice("Bearer ".length).trim();
    if (bearer.length > 0) {
      return bearer;
    }
  }

  return null;
}

const PAIRING_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MinjiBot — WhatsApp QR Pairing</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #182235 0%, #0b1120 65%);
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      text-align: center;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      color: #f8fafc;
    }
    .subtitle {
      margin: 0 0 18px;
      font-size: 13px;
      color: #94a3b8;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 18px;
      background: rgba(56, 189, 248, 0.14);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .badge.open {
      background: rgba(34, 197, 94, 0.14);
      color: #4ade80;
      border-color: rgba(34, 197, 94, 0.35);
    }
    .badge.warn {
      background: rgba(245, 158, 11, 0.14);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.35);
    }
    .qr-box {
      background: #ffffff;
      border-radius: 16px;
      padding: 16px;
      margin: 0 auto 16px;
      width: 288px;
      height: 288px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #475569;
      font-size: 14px;
    }
    .qr-box svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .meta {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.5;
      margin-bottom: 16px;
      min-height: 40px;
    }
    .steps {
      text-align: left;
      font-size: 12.5px;
      color: #94a3b8;
      background: rgba(30, 41, 59, 0.65);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 16px;
      line-height: 1.55;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      background: #2563eb;
      color: #ffffff;
      transition: background 0.15s ease;
    }
    button:hover { background: #1d4ed8; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main class="card">
    <h1>MinjiBot WhatsApp Pairing</h1>
    <p class="subtitle">Portal QR Code aman dengan auto-refresh otomatis</p>
    <div id="badge" class="badge">Memuat status...</div>
    <div id="qrBox" class="qr-box">Menunggu QR dari WhatsApp...</div>
    <div id="meta" class="meta">Memeriksa koneksi WhatsApp...</div>
    <div class="steps">
      <strong>Cara Scan:</strong><br />
      1. Buka WhatsApp di HP &rarr; <strong>Perangkat Tertaut</strong><br />
      2. Ketuk <strong>Tautkan Perangkat</strong><br />
      3. Arahkan kamera ke QR di atas (QR otomatis diperbarui bila kadaluarsa)
    </div>
    <button id="resetBtn" class="hidden" type="button">Reset Sesi &amp; Buat QR Baru</button>
  </main>
  <script>
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const badgeEl = document.getElementById("badge");
    const qrBoxEl = document.getElementById("qrBox");
    const metaEl = document.getElementById("meta");
    const resetBtnEl = document.getElementById("resetBtn");
    let lastQrSignature = "";
    let pollingTimer = null;

    function applyState(payload) {
      if (payload.state === "open") {
        badgeEl.textContent = "Terhubung (Online)";
        badgeEl.className = "badge open";
        qrBoxEl.innerHTML = "<div style='color:#15803d;font-weight:700;font-size:16px'>WhatsApp Terhubung!</div>";
        metaEl.textContent = (payload.connectedJid ? "Akun: " + payload.connectedJid + " — " : "") + payload.statusMessage;
        resetBtnEl.classList.add("hidden");
        return;
      }

      if (payload.state === "waiting_qr" && payload.qrSvg) {
        badgeEl.textContent = "Siap Di-Scan";
        badgeEl.className = "badge";
        if (lastQrSignature !== payload.qrSvg) {
          qrBoxEl.innerHTML = payload.qrSvg;
          lastQrSignature = payload.qrSvg;
        }
        const ageSec = payload.qrUpdatedAtMs ? Math.max(0, Math.floor((Date.now() - payload.qrUpdatedAtMs) / 1000)) : 0;
        metaEl.textContent = payload.statusMessage + " (" + ageSec + " detik lalu)";
        resetBtnEl.classList.remove("hidden");
        return;
      }

      badgeEl.textContent = payload.state === "logged_out" ? "Logout (401)" : "Menghubungkan...";
      badgeEl.className = payload.state === "logged_out" ? "badge warn" : "badge";
      qrBoxEl.textContent = payload.state === "logged_out"
        ? "Sesi sebelumnya logout (401). Klik tombol di bawah untuk membuat QR baru."
        : "Menunggu QR dari WhatsApp...";
      metaEl.textContent = payload.statusMessage;
      resetBtnEl.classList.toggle("hidden", payload.state === "connecting" && !payload.qrSvg);
    }

    async function pollQr() {
      try {
        const res = await fetch("/api/qr", {
          headers: { "x-qr-token": token },
          cache: "no-store",
        });
        if (!res.ok) {
          badgeEl.textContent = "Akses Ditolak (" + res.status + ")";
          badgeEl.className = "badge warn";
          metaEl.textContent = "Token tidak valid atau sudah berubah.";
          return;
        }
        const data = await res.json();
        applyState(data);
        if (data.state === "open" && pollingTimer) {
          clearInterval(pollingTimer);
          pollingTimer = null;
        }
      } catch (_err) {
        metaEl.textContent = "Menunggu respons server lokal MinjiBot...";
      }
    }

    resetBtnEl.addEventListener("click", async () => {
      resetBtnEl.disabled = true;
      metaEl.textContent = "Mereset sesi lama dan meminta QR baru...";
      try {
        await fetch("/api/reset-session", {
          method: "POST",
          headers: { "x-qr-token": token },
        });
        lastQrSignature = "";
        await pollQr();
      } finally {
        resetBtnEl.disabled = false;
      }
    });

    void pollQr();
    pollingTimer = setInterval(() => void pollQr(), 1500);
  </script>
</body>
</html>`;

export class QrWebServer {
  readonly token: string;
  private server: Server | null = null;
  private state: QrPairingState = "connecting";
  private qrSvg: string | null = null;
  private qrUpdatedAtMs: number | null = null;
  private connectedJid: string | null = null;
  private statusMessage = "Menyiapkan koneksi WhatsApp...";
  private isResetting = false;

  constructor(private readonly options: QrWebServerOptions) {
    this.token =
      options.token && options.token.trim().length > 0
        ? options.token.trim()
        : randomBytes(24).toString("hex");
  }

  getSnapshot(): QrWebServerStatusSnapshot {
    return {
      state: this.state,
      qrSvg: this.state === "open" ? null : this.qrSvg,
      qrUpdatedAtMs: this.qrUpdatedAtMs,
      connectedJid: this.connectedJid,
      statusMessage: this.statusMessage,
    };
  }

  setConnecting(message = "Menghubungkan ke server WhatsApp..."): void {
    this.state = "connecting";
    this.connectedJid = null;
    this.qrSvg = null;
    this.qrUpdatedAtMs = null;
    this.statusMessage = message;
  }

  setQr(qrData: string): void {
    this.state = "waiting_qr";
    this.connectedJid = null;
    this.qrSvg = renderQrSvg(qrData);
    this.qrUpdatedAtMs = Date.now();
    this.statusMessage = "QR aktif siap di-scan dari WhatsApp HP";
  }

  setOpen(userJid?: string | null): void {
    this.state = "open";
    this.qrSvg = null;
    this.qrUpdatedAtMs = null;
    this.connectedJid = userJid ?? null;
    this.statusMessage = "Bot terhubung ke WhatsApp dan siap menerima perintah.";
  }

  setLoggedOut(message = "Sesi WhatsApp ter-logout (401). Silakan reset sesi untuk QR baru."): void {
    this.state = "logged_out";
    this.qrSvg = null;
    this.qrUpdatedAtMs = null;
    this.connectedJid = null;
    this.statusMessage = message;
  }

  setClosed(message = "Koneksi WhatsApp terputus, menjadwalkan reconnect..."): void {
    if (this.state === "logged_out") {
      return;
    }
    this.state = "closed";
    this.qrSvg = null;
    this.qrUpdatedAtMs = null;
    this.statusMessage = message;
  }

  async start(): Promise<{ host: string; port: number; pairingUrl: string }> {
    if (this.server) {
      return {
        host: this.options.host,
        port: this.options.port,
        pairingUrl: `http://${this.options.host}:${String(this.options.port)}/?token=${this.token}`,
      };
    }

    const server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((error: unknown) => {
        logger.error({ err: error }, "Unhandled error pada QR Web Server");
        if (!res.headersSent) {
          this.sendJson(res, 500, { error: "Internal Server Error" });
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    this.server = server;
    const address = server.address();
    const resolvedPort =
      address && typeof address === "object" ? address.port : this.options.port;

    return {
      host: this.options.host,
      port: resolvedPort,
      pairingUrl: `http://${this.options.host}:${String(resolvedPort)}/?token=${this.token}`,
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reqUrl = new URL(req.url ?? "/", `http://${this.options.host}:${String(this.options.port)}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "GET" && reqUrl.pathname === "/health") {
      this.sendJson(res, 200, { ok: true, state: this.state });
      return;
    }

    const providedToken = extractRequestToken(req, reqUrl);
    if (!isQrTokenValid(providedToken, this.token)) {
      this.sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:",
      });
      res.end(PAIRING_HTML);
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/qr") {
      this.sendJson(res, 200, this.getSnapshot());
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/reset-session") {
      if (!this.options.onResetSession) {
        this.sendJson(res, 501, { error: "Reset session tidak tersedia" });
        return;
      }

      if (this.isResetting) {
        this.sendJson(res, 409, { error: "Proses reset sesi sedang berjalan" });
        return;
      }

      this.isResetting = true;
      try {
        await this.options.onResetSession();
        this.sendJson(res, 202, { ok: true });
      } finally {
        this.isResetting = false;
      }
      return;
    }

    this.sendJson(res, 404, { error: "Not Found" });
  }

  private sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }
}
