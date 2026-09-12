import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ArcadeRewardService, type EconomyStore } from "../src/services/game/arcadeReward.service";
import { webServerService } from "../src/services/web/webServer.service";

describe("CommunityGamification & ArcadeRewardService", () => {
  const mockEconomy: EconomyStore = {
    creditPoints: async () => ({ count: 1 }),
    creditXp: async () => ({ count: 1 }),
  };

  let rewardService: ArcadeRewardService;

  beforeEach(() => {
    rewardService = new ArcadeRewardService(mockEconomy);
  });

  it("harus menyediakan semua file HTML antarmuka Community", () => {
    const lbPath = path.resolve(process.cwd(), "public", "community", "leaderboard.html");
    const spinPath = path.resolve(process.cwd(), "public", "community", "spin.html");

    assert.strictEqual(existsSync(lbPath), true, "community/leaderboard.html harus ada");
    assert.strictEqual(existsSync(spinPath), true, "community/spin.html harus ada");

    const lbHtml = readFileSync(lbPath, "utf-8");
    assert.ok(lbHtml.includes("Papan Peringkat"));
    assert.ok(lbHtml.includes("id=\"podium-area\""));

    const spinHtml = readFileSync(spinPath, "utf-8");
    assert.ok(spinHtml.includes("Roda Keberuntungan"));
    assert.ok(spinHtml.includes("id=\"wheel-canvas\""));
  });

  it("harus dapat memvalidasi dan mengklaim token reward game arcade", async () => {
    const token = "ARCADE-DINO-240-ABC123";
    const result = await rewardService.claimToken(token, "group@g.us", "user@s.whatsapp.net");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pointsAwarded, 60); // 240 / 4 = 60
    assert.strictEqual(result.xpAwarded, 120); // 240 / 2 = 120
    assert.ok(result.message.includes("berhasil diklaim"));
  });

  it("harus menolak klaim berulang pada token yang sama (anti-abuse)", async () => {
    const token = "ARCADE-SNAKE-100-DUP123";
    const firstClaim = await rewardService.claimToken(token, "group@g.us", "user@s.whatsapp.net");
    assert.strictEqual(firstClaim.success, true);

    const secondClaim = await rewardService.claimToken(token, "group@g.us", "user@s.whatsapp.net");
    assert.strictEqual(secondClaim.success, false);
    assert.ok(secondClaim.message.includes("sudah pernah diklaim"));
  });

  it("harus menolak token dengan format tidak valid", async () => {
    const invalidToken = "INVALIDTOKEN";
    const result = await rewardService.claimToken(invalidToken, "group@g.us", "user@s.whatsapp.net");
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("tidak valid"));
  });

  it("harus dapat memproses klaim token kemenangan catur dan lucky spin jackpot", async () => {
    const caturToken = "CATUR-WIN-XYZ888";
    const caturRes = await rewardService.claimToken(caturToken, "group@g.us", "user@s.whatsapp.net");
    assert.strictEqual(caturRes.success, true);
    assert.strictEqual(caturRes.pointsAwarded, 120);
    assert.strictEqual(caturRes.xpAwarded, 250);

    const jackpotToken = "SPIN-JACKPOT-WIN999";
    const spinRes = await rewardService.claimToken(jackpotToken, "group@g.us", "user@s.whatsapp.net");
    assert.strictEqual(spinRes.success, true);
    assert.strictEqual(spinRes.pointsAwarded, 500);
    assert.strictEqual(spinRes.xpAwarded, 500);
  });

  it("harus menyajikan endpoint API /api/community/leaderboard dan /api/arcade/claim-reward", async () => {
    const app = webServerService.getApp();
    const server = app.listen(3096);

    try {
      // Test leaderboard API (fallback mode when DB is offline)
      const lbRes = await fetch("http://localhost:3096/api/community/leaderboard?type=xp");
      assert.strictEqual(lbRes.status, 200);
      const lbData = (await lbRes.json()) as { success: boolean; type: string };
      assert.strictEqual(lbData.success, true);
      assert.strictEqual(lbData.type, "xp");

      // Test claim reward API
      const claimRes = await fetch("http://localhost:3096/api/arcade/claim-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "ARCADE-BLOCK-200-API123",
          groupJid: "test@g.us",
          userJid: "user@s.whatsapp.net",
        }),
      });
      assert.strictEqual(claimRes.status, 200);
      const claimData = (await claimRes.json()) as { success: boolean; pointsAwarded: number };
      assert.strictEqual(claimData.success, true);
      assert.strictEqual(claimData.pointsAwarded, 50); // 200 / 4 = 50

      // Test pages return HTTP 200
      const lbPage = await fetch("http://localhost:3096/community/leaderboard");
      assert.strictEqual(lbPage.status, 200);

      const spinPage = await fetch("http://localhost:3096/community/spin");
      assert.strictEqual(spinPage.status, 200);
    } finally {
      server.close();
    }
  });
});
