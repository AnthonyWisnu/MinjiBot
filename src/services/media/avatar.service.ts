import type { WASocket } from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../config/env";
import { fetchBufferWithLimit } from "../../utils/httpStream";
import { normalizeJid } from "../../utils/jid";
import { LruCache } from "../../utils/lruCache";

export class AvatarService {
  private fallbackAvatarBuffer: Buffer | null = null;
  private readonly userAvatarCache = new LruCache<string, Buffer>(300, 15 * 60 * 1000); // 15 minutes TTL

  getFallbackAvatar(): Buffer {
    if (this.fallbackAvatarBuffer) {
      return this.fallbackAvatarBuffer;
    }

    if (env.BOT_AVATAR_PATH && fs.existsSync(env.BOT_AVATAR_PATH)) {
      try {
        const buffer = fs.readFileSync(env.BOT_AVATAR_PATH);
        this.fallbackAvatarBuffer = buffer;
        return buffer;
      } catch {
        // continue to standard fallback
      }
    }

    const candidatePaths = [
      path.resolve(process.cwd(), "assets/minji.png"),
      path.resolve(process.cwd(), "assets/default-avatar.png"),
      path.resolve(__dirname, "../../assets/minji.png"),
      path.resolve(__dirname, "../../../assets/minji.png"),
      path.resolve(__dirname, "../../assets/default-avatar.png"),
      path.resolve(__dirname, "../../../assets/default-avatar.png"),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const buffer = fs.readFileSync(p);
          this.fallbackAvatarBuffer = buffer;
          return buffer;
        } catch {
          // continue
        }
      }
    }

    // Dynamic SVG fallback if file is somehow missing
    const fallbackSvg = Buffer.from(`
      <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
        <circle cx="128" cy="128" r="128" fill="#1e293b" />
        <circle cx="128" cy="100" r="48" fill="#94a3b8" />
        <path d="M 48 220 C 48 170, 208 170, 208 220" fill="#94a3b8" />
      </svg>
    `);

    this.fallbackAvatarBuffer = fallbackSvg;
    return fallbackSvg;
  }

  async fetchUserAvatar(
    socket: WASocket,
    userJid: string,
    altJids: string[] = [],
  ): Promise<Buffer | null> {
    if (!userJid) {
      return null;
    }

    const cleanJid = normalizeJid(userJid);
    const cached = this.userAvatarCache.get(cleanJid);
    if (cached) {
      return cached;
    }

    if (typeof socket.profilePictureUrl !== "function") {
      return null;
    }

    const candidates = [cleanJid, ...altJids.map((j) => normalizeJid(j))].filter(Boolean);

    for (const jid of candidates) {
      try {
        const url = await socket.profilePictureUrl(jid, "image");
        if (url) {
          try {
            const { buffer } = await fetchBufferWithLimit(url, {
              maxBytes: 5 * 1024 * 1024,
              timeoutMs: 6000,
            });
            if (buffer.byteLength > 0) {
              this.userAvatarCache.set(cleanJid, buffer);
              return buffer;
            }
          } catch {
            // Try next candidate or return null
          }
        }
      } catch {
        // Try next candidate or return null
      }
    }

    return null;
  }

  async getAvatarWithFallback(
    socket: WASocket,
    userJid: string,
    altJids: string[] = [],
  ): Promise<Buffer> {
    const userAvatar = await this.fetchUserAvatar(socket, userJid, altJids);
    if (userAvatar) {
      return userAvatar;
    }
    return this.getFallbackAvatar();
  }
}

export const avatarService = new AvatarService();
