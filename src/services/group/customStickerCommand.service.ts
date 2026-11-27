import { extractMessageContent, type WAMessageContent } from "@whiskeysockets/baileys";
import type { GroupStickerCommand } from "@prisma/client";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import { GroupStickerCommandRepository } from "../../repositories/groupStickerCommand.repository";

export const MAX_STICKER_COMMANDS_PER_GROUP = 30;
const MAX_COMMAND_TEXT_LENGTH = 120;
const GROUP_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHED_GROUPS = 200;

const FORBIDDEN_STICKER_COMMANDS = new Set([
  "setcmd",
  "delcmd",
  "listcmd",
  "activatetenant",
  "blocktenant",
  "removetenant",
  "purgetenant",
  "upsw",
  "deletemydata",
]);

interface StickerCommandStore {
  findByGroupAndHash(groupJid: string, stickerHash: string): Promise<GroupStickerCommand | null>;
  listByGroup(groupJid: string): Promise<GroupStickerCommand[]>;
  countByGroup(groupJid: string): Promise<number>;
  upsert(
    groupJid: string,
    stickerHash: string,
    commandText: string,
    createdBy: string,
  ): Promise<GroupStickerCommand>;
  deleteByGroupAndHash(groupJid: string, stickerHash: string): Promise<boolean>;
}

interface CachedGroupMap {
  entries: Map<string, string>; // stickerHash -> commandText
  cachedAt: number;
}

export function extractStickerFileSha256(
  content: WAMessageContent | null | undefined,
): string | null {
  if (!content) {
    return null;
  }

  const normalized = extractMessageContent(content);
  const sticker = normalized?.stickerMessage;
  if (!sticker?.fileSha256) {
    return null;
  }

  const raw = sticker.fileSha256 as unknown;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.length > 0 ? raw.toString("base64") : null;
  }
  if (raw instanceof Uint8Array) {
    return raw.byteLength > 0 ? Buffer.from(raw).toString("base64") : null;
  }
  return null;
}

export class CustomStickerCommandService {
  private readonly groupCache = new Map<string, CachedGroupMap>();

  constructor(
    private readonly repo: StickerCommandStore = new GroupStickerCommandRepository(),
  ) {}

  async setCommand(input: {
    groupJid: string;
    stickerHash: string;
    rawCommandText: string;
    createdBy: string;
    isCommandRegistered?: (cmdName: string) => boolean;
  }): Promise<GroupStickerCommand> {
    const hash = input.stickerHash.trim();
    if (!hash) {
      throw new AppUserError("Gagal membaca identitas stiker. Pastikan kamu me-reply stiker valid.");
    }

    const trimmed = input.rawCommandText.trim();
    if (!trimmed) {
      throw new AppUserError(
        "Format salah. Reply stiker lalu ketik: *.setcmd <perintah>*\nContoh: .setcmd .menu atau .setcmd .daily",
      );
    }

    const normalizedText = trimmed.startsWith(env.COMMAND_PREFIX)
      ? trimmed
      : `${env.COMMAND_PREFIX}${trimmed}`;

    if (normalizedText.length > MAX_COMMAND_TEXT_LENGTH) {
      throw new AppUserError(`Teks perintah maksimal ${String(MAX_COMMAND_TEXT_LENGTH)} karakter.`);
    }

    const body = normalizedText.slice(env.COMMAND_PREFIX.length).trim();
    const firstToken = (body.split(/\s+/)[0] ?? "").toLowerCase();
    if (!firstToken) {
      throw new AppUserError("Nama perintah tidak boleh kosong.");
    }
    if (FORBIDDEN_STICKER_COMMANDS.has(firstToken)) {
      throw new AppUserError(`Perintah *.${firstToken}* tidak diizinkan dipasang pada stiker.`);
    }
    if (input.isCommandRegistered && !input.isCommandRegistered(firstToken)) {
      throw new AppUserError(`Perintah *.${firstToken}* tidak terdaftar di bot.`);
    }

    const existing = await this.repo.findByGroupAndHash(input.groupJid, hash);
    if (!existing) {
      const count = await this.repo.countByGroup(input.groupJid);
      if (count >= MAX_STICKER_COMMANDS_PER_GROUP) {
        throw new AppUserError(
          `Batas maksimal custom sticker command grup ini sudah penuh (${String(MAX_STICKER_COMMANDS_PER_GROUP)} stiker). Hapus dulu yang lama dengan *.delcmd*.`,
        );
      }
    }

    const saved = await this.repo.upsert(input.groupJid, hash, normalizedText, input.createdBy);
    this.groupCache.delete(input.groupJid);
    return saved;
  }

  async deleteCommand(groupJid: string, stickerHash: string): Promise<boolean> {
    const deleted = await this.repo.deleteByGroupAndHash(groupJid, stickerHash.trim());
    this.groupCache.delete(groupJid);
    return deleted;
  }

  listCommands(groupJid: string): Promise<GroupStickerCommand[]> {
    return this.repo.listByGroup(groupJid);
  }

  async resolveMappedCommand(
    groupJid: string,
    stickerHash: string,
    nowMs = Date.now(),
  ): Promise<string | null> {
    const hash = stickerHash.trim();
    if (!hash) {
      return null;
    }

    let cached = this.groupCache.get(groupJid);
    if (!cached || nowMs - cached.cachedAt >= GROUP_CACHE_TTL_MS) {
      const rows = await this.repo.listByGroup(groupJid);
      const map = new Map<string, string>();
      for (const row of rows) {
        map.set(row.stickerHash, row.commandText);
      }
      cached = { entries: map, cachedAt: nowMs };
      this.groupCache.set(groupJid, cached);

      if (this.groupCache.size > MAX_CACHED_GROUPS) {
        for (const [k, v] of this.groupCache.entries()) {
          if (nowMs - v.cachedAt >= GROUP_CACHE_TTL_MS) {
            this.groupCache.delete(k);
          }
        }
        while (this.groupCache.size > MAX_CACHED_GROUPS) {
          const oldest = this.groupCache.keys().next().value;
          if (!oldest) break;
          this.groupCache.delete(oldest);
        }
      }
    }

    return cached.entries.get(hash) ?? null;
  }
}

export const customStickerCommandService = new CustomStickerCommandService();
