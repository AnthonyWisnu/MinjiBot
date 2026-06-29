import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  lyricsService,
  type LyricsResult,
  type LyricsService,
} from "../../services/media/lyrics.service";
import { lastPlayedService, type LastPlayedService } from "../../services/media/lastPlayed.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { formatUserSafeError } from "../../utils/userSafeError";

const MAX_TEXT_LYRICS_LENGTH = 3500;
const LYRICS_TEXT_MIMETYPE = "text/plain";

export function createLyricsCommands(deps: {
  lyricsService: LyricsService;
  lastPlayedService: LastPlayedService;
}): CommandDefinition[] {
  return [
    {
      name: "lirik",
      execute: (context) => handleLyrics(context, deps),
    },
  ];
}

export const lyricsCommands = createLyricsCommands({
  lyricsService,
  lastPlayedService,
});

async function handleLyrics(
  context: CommandContext,
  deps: {
    lyricsService: LyricsService;
    lastPlayedService: LastPlayedService;
  },
): Promise<void> {
  try {
    const { documentMode, query } = resolveLyricsRequest(context, deps.lastPlayedService);
    if (!query) {
      await context.reply("[ERROR] Judul lagu wajib diisi.\nContoh: .lirik rumah ke rumah hindia");
      return;
    }

    const lyrics = await deps.lyricsService.searchLyrics(query);
    if (!lyrics) {
      await context.reply(
        "[INFO] Lirik tidak ditemukan. Coba gunakan format: .lirik <judul> - <artis>",
      );
      return;
    }

    const text = formatLyricsText(lyrics);
    if (documentMode || text.length > MAX_TEXT_LYRICS_LENGTH) {
      await sendLyricsDocument(context, lyrics, text, query);
      return;
    }

    await context.reply(text);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "[ERROR] Lirik gagal diproses."));
  }
}

function resolveLyricsRequest(
  context: CommandContext,
  lastPlayed: LastPlayedService,
): { documentMode: boolean; query: string | null } {
  const [firstArg, ...restArgs] = context.args;
  const documentMode = firstArg?.toLowerCase() === "doc";
  const query = (documentMode ? restArgs.join(" ") : context.argsText).trim();
  if (query) {
    return { documentMode, query };
  }

  const song = lastPlayed.getLastPlayed(context.chatJid);
  if (!song) {
    return { documentMode, query: null };
  }

  const lastPlayedQuery = [song.title, song.artist].filter(Boolean).join(" - ");

  return { documentMode, query: lastPlayedQuery };
}

function formatLyricsText(lyrics: LyricsResult): string {
  return [
    "[LIRIK]",
    `Judul: ${lyrics.title}`,
    `Artis: ${lyrics.artistName}`,
    "",
    lyrics.plainLyrics,
  ].join("\n");
}

async function sendLyricsDocument(
  context: CommandContext,
  lyrics: LyricsResult,
  text: string,
  query: string,
): Promise<void> {
  const tempDir = await createTempDir("lyrics");
  const fileName = createLyricsFileName(`${lyrics.title} ${lyrics.artistName}`.trim() || query);
  const filePath = path.join(tempDir, fileName);

  try {
    await writeFile(filePath, text, "utf8");
    await context.socket.sendMessage(
      context.chatJid,
      {
        document: await readFile(filePath),
        mimetype: LYRICS_TEXT_MIMETYPE,
        fileName,
      },
      { quoted: context.message },
    );
  } finally {
    await removeTempDir(tempDir);
  }
}

function createLyricsFileName(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return `lirik-${slug || "lagu"}.txt`;
}
