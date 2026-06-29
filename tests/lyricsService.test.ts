import { test } from "node:test";
import assert from "node:assert/strict";

import type { WASocket } from "@whiskeysockets/baileys";

import type { CommandContext } from "../src/types/command";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/minjibot_test";
process.env.COMMAND_PREFIX = ".";
process.env.SUPER_OWNER_JIDS = "62895366009208@s.whatsapp.net";
process.env.SESSION_DIR = "./sessions-test";
process.env.TEMP_DIR = "./tmp-test";
process.env.LOG_LEVEL = "silent";
process.env.BOT_BROWSER_NAME = "MinjiBot Test";
process.env.RECONNECT_INITIAL_MS = "100";
process.env.RECONNECT_MAX_MS = "1000";
process.env.MAX_DOWNLOAD_FILE_MB = "50";
process.env.DOWNLOADER_BIN = "yt-dlp";
process.env.DOWNLOADER_TIMEOUT_MS = "300000";
process.env.HD_MAX_INPUT_MB = "7";
process.env.HD_AI_MAX_CONCURRENT_JOBS = "1";
process.env.TENANT_SESSION_TTL_DAYS = "7";
process.env.REMINDER_POLL_MS = "30000";

void test("Lyrics command returns error without query and last played", async () => {
  const { createLyricsCommands } = await import("../src/commands/media/lyrics.command");
  const { LastPlayedService } = await import("../src/services/media/lastPlayed.service");
  const replies: string[] = [];
  const command = createLyricsCommands({
    lyricsService: createFakeLyricsService(),
    lastPlayedService: new LastPlayedService(),
  })[0];

  await command.execute(createLyricsContext({ replies }));

  assert.match(replies[0] ?? "", /Judul lagu wajib diisi/);
});

void test("Lyrics command calls lyrics service with query", async () => {
  const { createLyricsCommands } = await import("../src/commands/media/lyrics.command");
  const { LastPlayedService } = await import("../src/services/media/lastPlayed.service");
  const queries: string[] = [];
  const replies: string[] = [];
  const command = createLyricsCommands({
    lyricsService: createFakeLyricsService({ queries }),
    lastPlayedService: new LastPlayedService(),
  })[0];

  await command.execute(
    createLyricsContext({
      args: ["rumah", "ke", "rumah", "hindia"],
      argsText: "rumah ke rumah hindia",
      replies,
    }),
  );

  assert.deepEqual(queries, ["rumah ke rumah hindia"]);
  assert.match(replies[0] ?? "", /\[LIRIK\]/);
  assert.match(replies[0] ?? "", /Judul: Rumah ke Rumah/);
});

void test("LyricsService chooses first result with plainLyrics", async () => {
  const { LyricsService } = await import("../src/services/media/lyrics.service");
  const service = new LyricsService(
    createFetch([
      { title: "Instrumental", artistName: "A", plainLyrics: null },
      { title: "Rumah ke Rumah", artistName: "Hindia", duration: 240, plainLyrics: "Lirik" },
    ]),
  );

  const result = await service.searchLyrics("rumah ke rumah hindia");

  assert.ok(result);
  assert.equal(result.title, "Rumah ke Rumah");
  assert.equal(result.artistName, "Hindia");
  assert.equal(result.plainLyrics, "Lirik");
});

void test("Lyrics command sends long lyrics as document", async () => {
  const { createLyricsCommands } = await import("../src/commands/media/lyrics.command");
  const { LastPlayedService } = await import("../src/services/media/lastPlayed.service");
  const sentMessages: SentMessage[] = [];
  const command = createLyricsCommands({
    lyricsService: createFakeLyricsService({ plainLyrics: "a".repeat(3600) }),
    lastPlayedService: new LastPlayedService(),
  })[0];

  await command.execute(
    createLyricsContext({
      args: ["lagu"],
      argsText: "lagu",
      sentMessages,
    }),
  );

  assert.equal(sentMessages.length, 1);
  const sentMessage = sentMessages[0];
  assert.ok(sentMessage);
  assert.equal(sentMessage.content.mimetype, "text/plain");
  assert.match(sentMessage.content.fileName ?? "", /^lirik-/);
});

void test("Lyrics command uses last played when query is empty", async () => {
  const { createLyricsCommands } = await import("../src/commands/media/lyrics.command");
  const { LastPlayedService } = await import("../src/services/media/lastPlayed.service");
  const lastPlayed = new LastPlayedService();
  const queries: string[] = [];
  const replies: string[] = [];
  lastPlayed.setLastPlayed({
    chatJid: "120@g.us",
    title: "Rumah ke Rumah",
    artist: "Hindia",
  });
  const command = createLyricsCommands({
    lyricsService: createFakeLyricsService({ queries }),
    lastPlayedService: lastPlayed,
  })[0];

  await command.execute(createLyricsContext({ replies }));

  assert.deepEqual(queries, ["Rumah ke Rumah - Hindia"]);
  assert.match(replies[0] ?? "", /Rumah ke Rumah/);
});

void test("LastPlayedService returns null after expiry", async () => {
  const { LastPlayedService } = await import("../src/services/media/lastPlayed.service");
  const service = new LastPlayedService();
  service.setLastPlayed({
    chatJid: "120@g.us",
    title: "Lagu",
  });

  const result = service.getLastPlayed("120@g.us", new Date(Date.now() + 31 * 60 * 1000));

  assert.equal(result, null);
});

void test("Lyrics command handles network error safely", async () => {
  const { createLyricsCommands } = await import("../src/commands/media/lyrics.command");
  const { LastPlayedService } = await import("../src/services/media/lastPlayed.service");
  const replies: string[] = [];
  const command = createLyricsCommands({
    lyricsService: {
      searchLyrics: () =>
        Promise.reject(
          new Error("[ERROR] Layanan lirik sedang tidak tersedia. Silakan coba lagi nanti."),
        ),
    } as never,
    lastPlayedService: new LastPlayedService(),
  })[0];

  await command.execute(
    createLyricsContext({
      args: ["lagu"],
      argsText: "lagu",
      replies,
    }),
  );

  assert.match(replies[0] ?? "", /Layanan lirik sedang tidak tersedia/);
});

interface SentMessage {
  jid: string;
  content: {
    text?: string;
    document?: Buffer;
    mimetype?: string;
    fileName?: string;
  };
}

function createFakeLyricsService(
  options: {
    queries?: string[];
    plainLyrics?: string;
  } = {},
) {
  return {
    searchLyrics: (query: string) => {
      options.queries?.push(query);

      return Promise.resolve({
        title: "Rumah ke Rumah",
        artistName: "Hindia",
        duration: 240,
        plainLyrics: options.plainLyrics ?? "Baris lirik",
      });
    },
  } as never;
}

function createFetch(payload: unknown): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    })) as typeof fetch;
}

function createLyricsContext(options: {
  args?: string[];
  argsText?: string;
  replies?: string[];
  sentMessages?: SentMessage[];
}): CommandContext {
  const replies = options.replies ?? [];
  const sentMessages = options.sentMessages ?? [];
  const socket = {
    sendMessage: (jid: string, content: SentMessage["content"]) => {
      sentMessages.push({ jid, content });
      return Promise.resolve(undefined);
    },
  } as unknown as WASocket;

  return {
    socket,
    message: {
      key: {
        remoteJid: "120@g.us",
        participant: "6281@s.whatsapp.net",
        fromMe: false,
      },
      message: {
        conversation: ".lirik",
      },
    },
    chatJid: "120@g.us",
    senderJid: "6281@s.whatsapp.net",
    senderUserJid: "6281@s.whatsapp.net",
    senderAltJids: ["6281@s.whatsapp.net"],
    isGroup: true,
    commandName: "lirik",
    args: options.args ?? [],
    argsText: options.argsText ?? "",
    text: ".lirik",
    mentionedJids: [],
    role: "MEMBER",
    reply: (text: string) => {
      replies.push(text);
      return Promise.resolve(undefined);
    },
  };
}
