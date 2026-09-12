import crypto from "node:crypto";
import { logger } from "../../config/logger";

export interface PlayerSession {
  sessionId: string;
  videoId: string;
  videoUrl: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnail: string;
  chatJid?: string;
  userJid?: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreatePlayerSessionInput {
  videoId: string;
  videoUrl: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnail: string;
  chatJid?: string;
  userJid?: string;
  ttlMs?: number;
}

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 menit

export class PlayerSessionService {
  private sessions = new Map<string, PlayerSession>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startSweepTimer();
  }

  createSession(input: CreatePlayerSessionInput): PlayerSession {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const ttl = input.ttlMs ?? DEFAULT_SESSION_TTL_MS;

    const session: PlayerSession = {
      sessionId,
      videoId: input.videoId,
      videoUrl: input.videoUrl,
      title: input.title,
      channelTitle: input.channelTitle,
      durationSeconds: input.durationSeconds,
      thumbnail: input.thumbnail,
      chatJid: input.chatJid,
      userJid: input.userJid,
      createdAt: now,
      expiresAt: now + ttl,
    };

    this.sessions.set(sessionId, session);

    logger.debug(
      { sessionId, videoId: session.videoId, expiresAt: session.expiresAt },
      "Player session created",
    );

    return session;
  }

  getSession(sessionId: string): PlayerSession | null {
    if (!sessionId || typeof sessionId !== "string") {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      logger.debug({ sessionId }, "Player session expired and purged");
      return null;
    }

    return session;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  sweepExpiredSessions(): number {
    const now = Date.now();
    let purged = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        purged++;
      }
    }

    if (purged > 0) {
      logger.debug({ purgedCount: purged }, "Swept expired player sessions");
    }

    return purged;
  }

  getActiveSessionsCount(): number {
    this.sweepExpiredSessions();
    return this.sessions.size;
  }

  private startSweepTimer(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      this.sweepExpiredSessions();
    }, 5 * 60 * 1000);
    if (this.sweepTimer.unref) {
      this.sweepTimer.unref();
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.sessions.clear();
  }
}

export const playerSessionService = new PlayerSessionService();
