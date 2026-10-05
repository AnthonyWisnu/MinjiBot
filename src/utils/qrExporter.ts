import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const QRCode = require("qrcode-terminal/vendor/QRCode");

export async function exportQrToWeb(qrText: string): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const qr = new QRCode(0, 1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    qr.addData(qrText);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    qr.make();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const count = Number(qr.getModuleCount());
    const size = 400;
    const padding = 4;
    const totalModules = count + padding * 2;
    const cellSize = size / totalModules;

    let rects = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        if (qr.isDark(r, c)) {
          const x = (c + padding) * cellSize;
          const y = (r + padding) * cellSize;
          rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="#111827"/>`;
        }
      }
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#ffffff" rx="16"/>
  ${rects}
</svg>`;

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="15">
  <title>MinjiBot WhatsApp Login QR</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
      box-sizing: border-box;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 1.5rem;
      padding: 2rem;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.5rem; margin-top: 0; margin-bottom: 0.5rem; color: #38bdf8; }
    p { font-size: 0.95rem; color: #94a3b8; line-height: 1.5; margin-bottom: 1.5rem; }
    .qr-box {
      background: white;
      border-radius: 1rem;
      padding: 1rem;
      display: inline-block;
      margin-bottom: 1.5rem;
    }
    .qr-box svg { display: block; max-width: 100%; height: auto; }
    .steps { text-align: left; font-size: 0.85rem; color: #cbd5e1; background: #0f172a; padding: 1rem; border-radius: 0.75rem; }
    .steps ol { margin: 0; padding-left: 1.25rem; }
    .steps li { margin-bottom: 0.25rem; }
    .auto-refresh { font-size: 0.75rem; color: #64748b; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Login MinjiBot WhatsApp</h1>
    <p>Buka WhatsApp di HP Anda dan scan QR code di bawah ini.</p>
    <div class="qr-box">
      ${svg}
    </div>
    <div class="steps">
      <ol>
        <li>Buka aplikasi WhatsApp di HP</li>
        <li>Buka menu titik tiga / Pengaturan</li>
        <li>Pilih <strong>Perangkat Tertaut (Linked Devices)</strong></li>
        <li>Ketuk <strong>Tautkan Perangkat</strong> dan arahkan kamera ke QR ini</li>
      </ol>
    </div>
    <div class="auto-refresh">Halaman ini otomatis me-refresh jika QR diperbarui.</div>
  </div>
</body>
</html>`;

    const publicDirs = [
      "/home/anthony/portofolio/public",
      "/var/www/void-downloader/frontend/dist"
    ];

    const generatedUrls: string[] = [];

    for (const dir of publicDirs) {
      if (existsSync(dir)) {
        const htmlPath = path.join(dir, "minji-qr.html");
        const pngPath = path.join(dir, "minji-qr.png");
        writeFileSync(htmlPath, html, "utf8");
        const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
        writeFileSync(pngPath, pngBuffer);
        if (dir.includes("portofolio")) {
          generatedUrls.push("https://anthonywj.my.id/minji-qr.html");
        }
      }
    }

    return generatedUrls;
  } catch {
    return [];
  }
}

export function cleanupQrFromWeb(): void {
  const targets = [
    "/home/anthony/portofolio/public/minji-qr.html",
    "/home/anthony/portofolio/public/minji-qr.png",
    "/var/www/void-downloader/frontend/dist/minji-qr.html",
    "/var/www/void-downloader/frontend/dist/minji-qr.png"
  ];
  for (const t of targets) {
    try {
      if (existsSync(t)) {
        unlinkSync(t);
      }
    } catch {
      // ignore
    }
  }
}
