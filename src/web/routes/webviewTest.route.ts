import { Router, type Request, type Response } from "express";

export const webviewTestRouter = Router();

// GET /webview-test - Minimal POC WebView Test Page
webviewTestRouter.get(["/webview-test", "/webview-test/:sessionId"], (req: Request, res: Response) => {
  const sessionId = req.params.sessionId || "test-session-" + Date.now();
  const timestamp = new Date().toISOString();

  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>POC WebView // MinjiBot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0b0f19;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 24px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      color: #10b981;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid #10b981;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 12px;
    }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 16px; }
    .meta-box {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
      text-align: left;
      font-size: 11px;
      color: #cbd5e1;
      font-family: monospace;
      word-break: break-all;
    }
    .btn {
      width: 100%;
      padding: 12px;
      background: #2563eb;
      color: #fff;
      font-weight: 600;
      font-size: 14px;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:active { background: #1d4ed8; }
    #log {
      margin-top: 14px;
      font-size: 12px;
      color: #38bdf8;
      font-weight: 600;
      min-height: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">WHATSAPP WEBVIEW POC</div>
    <h1>WebView POC Verification</h1>
    <p>Halaman ini digunakan untuk menguji apakah tautan WhatsApp terbuka di dalam embedded in-app browser atau browser eksternal.</p>

    <div class="meta-box">
      <div><strong>SESSION:</strong> ${sessionId}</div>
      <div><strong>TIME:</strong> ${timestamp}</div>
      <div id="env-detect"><strong>ENV:</strong> Mendeteksi...</div>
    </div>

    <button class="btn" onclick="testAction()">Uji Interaksi JavaScript</button>
    <div id="log"></div>
  </div>

  <script>
    const isWhatsApp = /WhatsApp/i.test(navigator.userAgent);
    const envBox = document.getElementById('env-detect');
    envBox.innerHTML = '<strong>CLIENT:</strong> ' + (isWhatsApp ? 'WhatsApp In-App WebView (Terdeteksi)' : 'Standard Browser / WebView');

    let count = 0;
    function testAction() {
      count++;
      document.getElementById('log').innerText = 'Interaksi DOM Berhasil! Klik ke-' + count + ' pada ' + new Date().toLocaleTimeString();
    }
  </script>
</body>
</html>`);
});
