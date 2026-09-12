import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { WASocket } from "@whiskeysockets/baileys";

import type { CommandContext } from "../src/types/command";
import { webSuiteCommands } from "../src/commands/web/webSuite.command";
import { interactiveMessageService } from "../src/services/whatsapp/interactiveMessage.service";
import { youtubeSearchService } from "../src/services/media/youtubeSearch.service";
import { playerSessionService } from "../src/services/web/playerSession.service";
import { arcadeRewardService } from "../src/services/game/arcadeReward.service";

describe("WebSuiteCommands & InteractiveMessageService", () => {
  interface CapturedMessage {
    jid: string;
    content: any;
    options?: any;
  }

  let capturedMessages: CapturedMessage[];
  let replies: string[];
  let mockSocket: WASocket;

  beforeEach(() => {
    capturedMessages = [];
    replies = [];
    mockSocket = {
      sendMessage: async (jid: string, content: any, options?: any) => {
        capturedMessages.push({ jid, content, options });
        return undefined as any;
      },
      waUploadToServer: async () => ({
        url: "https://mmg.whatsapp.net/m1",
        directPath: "/v/t62.7118-24/m1",
        handle: "test-handle",
        fileEncSha256: Buffer.from("enc"),
        fileSha256: Buffer.from("sha"),
        fileLength: 1234,
        mediaKey: Buffer.from("key"),
      }),
    } as unknown as WASocket;
  });

  function createContext(options: {
    commandName: string;
    args?: string[];
    argsText?: string;
  }): CommandContext {
    return {
      socket: mockSocket,
      message: {
        key: {
          remoteJid: "120363001@g.us",
          participant: "628951234567@s.whatsapp.net",
          fromMe: false,
        },
        message: {
          conversation: `.${options.commandName} ${options.argsText || ""}`.trim(),
        },
      } as any,
      chatJid: "120363001@g.us",
      senderJid: "628951234567@s.whatsapp.net",
      senderUserJid: "628951234567@s.whatsapp.net",
      senderAltJids: ["628951234567@s.whatsapp.net"],
      isGroup: true,
      commandName: options.commandName,
      args: options.args ?? [],
      argsText: options.argsText ?? "",
      text: `.${options.commandName} ${options.argsText || ""}`.trim(),
      mentionedJids: [],
      role: "SUPER_OWNER",
      tenantGroup: {
        id: "tg-test",
        groupJid: "120363001@g.us",
        ownerJid: "628951234567@s.whatsapp.net",
        status: "ACTIVE",
      } as any,
      reply: async (text: string) => {
        replies.push(text);
        return undefined as any;
      },
    };
  }

  function getCommand(name: string) {
    const cmd = webSuiteCommands.find(
      (c) => c.name === name || c.aliases?.includes(name),
    );
    if (!cmd) throw new Error(`Command ${name} tidak ditemukan`);
    return cmd;
  }

  it("harus mendaftarkan semua 7 perintah web suite beserta aliasnya", () => {
    const commandNames = webSuiteCommands.map((c) => c.name);
    assert.deepStrictEqual(commandNames, [
      "spotify",
      "arcade",
      "catur",
      "soundboard",
      "spin",
      "topweb",
      "claimreward",
    ]);

    assert.ok(getCommand("spotify"));
    assert.ok(getCommand("ythtml"));
    assert.ok(getCommand("ytweb"));
    assert.ok(getCommand("playweb"));
    assert.ok(getCommand("ytplayer"));
    assert.ok(getCommand("gamehub"));
    assert.ok(getCommand("minigames"));
    assert.ok(getCommand("chess"));
    assert.ok(getCommand("danscatur"));
    assert.ok(getCommand("sb"));
    assert.ok(getCommand("memesound"));
    assert.ok(getCommand("wheel"));
    assert.ok(getCommand("luckydraw"));
    assert.ok(getCommand("leaderboardweb"));
    assert.ok(getCommand("halloffame"));
    assert.ok(getCommand("claimtoken"));
    assert.ok(getCommand("klaim"));
  });

  it("handleSpotify tanpa argumen: mengirim katalog pencarian gaya Spotify", async () => {
    const cmd = getCommand("spotify");
    const ctx = createContext({ commandName: "spotify", argsText: "" });

    await cmd.execute(ctx);

    assert.strictEqual(capturedMessages.length, 1);
    const msg = capturedMessages[0];
    assert.strictEqual(msg.jid, "120363001@g.us");

    const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
    assert.ok(interactive);
    assert.strictEqual(interactive.header?.title, "SPOTIFY SEARCH CATALOG // MINJIBOT");
    assert.ok(interactive.body?.text.includes("/player/search"));

    const btn = interactive.nativeFlowMessage?.buttons?.[0];
    assert.strictEqual(btn?.name, "cta_url");
    const params = JSON.parse(btn.buttonParamsJson);
    assert.strictEqual(params.display_text, "Buka Spotify Catalog");
    assert.ok(params.url.includes("/player/search"));
  });

  it("handleSpotify dengan query: mencari lagu dan membuat player session stream deck", async () => {
    // Mock searchVideos
    const originalSearch = youtubeSearchService.searchVideos;
    youtubeSearchService.searchVideos = async () => [
      {
        videoId: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        channelTitle: "Rick Astley",
        durationSeconds: 213,
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      },
    ];

    try {
      const cmd = getCommand("spotify");
      const ctx = createContext({
        commandName: "spotify",
        argsText: "rick astley never gonna give you up",
      });

      await cmd.execute(ctx);

      // Reply "Mencari trek..." harus terpanggil
      assert.ok(replies.some((r) => r.includes("Mencari trek")));

      assert.strictEqual(capturedMessages.length, 1);
      const msg = capturedMessages[0];
      const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
      assert.ok(interactive);
      assert.strictEqual(interactive.header?.title, "SPOTIFY STREAM DECK // MINJIBOT");
      assert.ok(interactive.body?.text.includes("Never Gonna Give You Up"));
      assert.ok(interactive.body?.text.includes("Rick Astley"));

      const btn = interactive.nativeFlowMessage?.buttons?.[0];
      const params = JSON.parse(btn.buttonParamsJson);
      assert.strictEqual(params.display_text, "Buka Web Player");
      assert.ok(params.url.includes("/player/"));
    } finally {
      youtubeSearchService.searchVideos = originalSearch;
    }
  });

  it("handleArcade: mengirim tombol cta_url menuju Retro Arcade Hub", async () => {
    const cmd = getCommand("arcade");
    const ctx = createContext({ commandName: "arcade" });

    await cmd.execute(ctx);

    assert.strictEqual(capturedMessages.length, 1);
    const msg = capturedMessages[0];
    const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
    assert.strictEqual(interactive.header?.title, "RETRO ARCADE HUB // MINJIBOT");
    assert.ok(interactive.body?.text.includes("Dino Runner"));
    assert.ok(interactive.body?.text.includes("Snake Retro"));
    assert.ok(interactive.body?.text.includes("Block Blast"));

    const btn = interactive.nativeFlowMessage?.buttons?.[0];
    const params = JSON.parse(btn.buttonParamsJson);
    assert.strictEqual(params.display_text, "Buka Arcade Zone");
    assert.ok(params.url.includes("/arcade?chat="));
  });

  it("handleCatur: mengirim tombol cta_url menuju Dans Catur Arena", async () => {
    const cmd = getCommand("catur");
    const ctx = createContext({ commandName: "catur" });

    await cmd.execute(ctx);

    assert.strictEqual(capturedMessages.length, 1);
    const msg = capturedMessages[0];
    const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
    assert.strictEqual(interactive.header?.title, "DANS CATUR // STRATEGY ARENA");

    const btn = interactive.nativeFlowMessage?.buttons?.[0];
    const params = JSON.parse(btn.buttonParamsJson);
    assert.strictEqual(params.display_text, "Buka Dans Catur");
    assert.ok(params.url.includes("/catur?chat="));
  });

  it("handleSoundboard: mengirim tombol cta_url menuju Meme Soundboard", async () => {
    const cmd = getCommand("soundboard");
    const ctx = createContext({ commandName: "soundboard" });

    await cmd.execute(ctx);

    assert.strictEqual(capturedMessages.length, 1);
    const msg = capturedMessages[0];
    const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
    assert.strictEqual(interactive.header?.title, "MEME SOUNDBOARD // VN DISPATCHER");

    const btn = interactive.nativeFlowMessage?.buttons?.[0];
    const params = JSON.parse(btn.buttonParamsJson);
    assert.strictEqual(params.display_text, "Buka Soundboard");
    assert.ok(params.url.includes("/soundboard?chat="));
  });

  it("handleSpin: mengirim tombol cta_url menuju Lucky Spin Wheel", async () => {
    const cmd = getCommand("spin");
    const ctx = createContext({ commandName: "spin" });

    await cmd.execute(ctx);

    assert.strictEqual(capturedMessages.length, 1);
    const msg = capturedMessages[0];
    const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
    assert.strictEqual(interactive.header?.title, "LUCKY SPIN WHEEL // COMMUNITY");

    const btn = interactive.nativeFlowMessage?.buttons?.[0];
    const params = JSON.parse(btn.buttonParamsJson);
    assert.strictEqual(params.display_text, "Putar Roda Hoki");
    assert.ok(params.url.includes("/community/spin?group="));
  });

  it("handleTopWeb: mengirim tombol cta_url menuju Hall of Fame Leaderboard", async () => {
    const cmd = getCommand("topweb");
    const ctx = createContext({ commandName: "topweb" });

    await cmd.execute(ctx);

    assert.strictEqual(capturedMessages.length, 1);
    const msg = capturedMessages[0];
    const interactive = msg.content?.viewOnceMessage?.message?.interactiveMessage;
    assert.strictEqual(interactive.header?.title, "HALL OF FAME LEADERBOARD // MINJIBOT");

    const btn = interactive.nativeFlowMessage?.buttons?.[0];
    const params = JSON.parse(btn.buttonParamsJson);
    assert.strictEqual(params.display_text, "Lihat Peringkat");
    assert.ok(params.url.includes("/community/leaderboard?group="));
  });

  it("handleClaim: memvalidasi format input dan mengklaim token reward", async () => {
    const cmd = getCommand("claimreward");

    // Case 1: Tanpa token
    const ctxEmpty = createContext({ commandName: "claimreward", argsText: "" });
    await cmd.execute(ctxEmpty);
    assert.ok(replies[0]?.includes("Format command salah"));

    // Case 2: Token valid
    replies = [];
    const ctxValid = createContext({
      commandName: "claimreward",
      argsText: "ARCADE-FLAPPY-160-TST789",
    });
    await cmd.execute(ctxValid);
    assert.ok(replies.some((r) => r.includes("KLAIM TOKEN BERHASIL")));
    assert.ok(replies.some((r) => r.includes("Points: +40"))); // 160 / 4 = 40
    assert.ok(replies.some((r) => r.includes("XP: +80"))); // 160 / 2 = 80

    // Case 3: Token sudah diklaim (duplicate anti-abuse)
    replies = [];
    await cmd.execute(ctxValid);
    assert.ok(replies.some((r) => r.includes("Gagal mengklaim token")));
  });

  it("interactiveMessageService: melakukan fallback ke markdown teks biasa jika nativeFlowMessage gagal", async () => {
    let callCount = 0;
    const failingSocket = {
      sendMessage: async (jid: string, content: any) => {
        callCount++;
        if (content.viewOnceMessage) {
          throw new Error("Protocol buffer unsupported");
        }
        return undefined as any;
      },
    } as unknown as WASocket;

    await interactiveMessageService.sendCtaUrlMessage(
      failingSocket,
      "test@g.us",
      {
        header: "FALLBACK TEST",
        body: "Deskripsi pesan uji coba",
        buttonText: "Klik Disini",
        url: "http://localhost:3004/test",
      },
    );

    // Call 1 failed with viewOnceMessage, Call 2 succeeded with text fallback
    assert.strictEqual(callCount, 2);
  });
});
