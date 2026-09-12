import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { webServerService } from "../src/services/web/webServer.service";

describe("ArcadeHubService & Routes", () => {
  it("harus menyediakan file antarmuka web arcade/index.html", () => {
    const filePath = path.resolve(process.cwd(), "public", "arcade", "index.html");
    assert.strictEqual(existsSync(filePath), true);

    const htmlContent = readFileSync(filePath, "utf-8");
    assert.ok(htmlContent.includes("id=\"game-canvas\""));
    assert.ok(htmlContent.includes("data-game=\"dino\""));
    assert.ok(htmlContent.includes("data-game=\"snake\""));
    assert.ok(htmlContent.includes("data-game=\"block\""));
    assert.ok(htmlContent.includes("data-game=\"2048\""));
    assert.ok(htmlContent.includes("data-game=\"flappy\""));
  });

  it("harus menyajikan metadata 5 game arcade pada API /api/arcade/games", async () => {
    const app = webServerService.getApp();
    const server = app.listen(3098);

    try {
      const res = await fetch("http://localhost:3098/api/arcade/games");
      assert.strictEqual(res.status, 200);

      const data = (await res.json()) as { success: boolean; games: Array<{ key: string; name: string }> };
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.games.length, 5);

      const keys = data.games.map((g) => g.key);
      assert.deepStrictEqual(keys, ["dino", "snake", "block", "2048", "flappy"]);

      const pageRes = await fetch("http://localhost:3098/arcade");
      assert.strictEqual(pageRes.status, 200);
    } finally {
      server.close();
    }
  });
});
