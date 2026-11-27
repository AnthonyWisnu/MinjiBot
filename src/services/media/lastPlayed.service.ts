import { LruCache } from "../../utils/lruCache";

const LAST_PLAYED_TTL_MS = 30 * 60 * 1000; // 30 menit TTL

export interface LastPlayedSong {
  chatJid: string;
  title: string;
  artist?: string;
  createdAt: Date;
}

export class LastPlayedService {
  // LruCache berkapasitas 500 entri untuk mencegah kebocoran memori (PERF-03)
  private readonly songs = new LruCache<string, LastPlayedSong>(500, LAST_PLAYED_TTL_MS);

  setLastPlayed(input: { chatJid: string; title: string; artist?: string }): void {
    this.songs.set(input.chatJid, {
      chatJid: input.chatJid,
      title: input.title,
      artist: input.artist,
      createdAt: new Date(),
    });
  }

  getLastPlayed(chatJid: string, now = new Date()): LastPlayedSong | null {
    const song = this.songs.get(chatJid);
    if (!song) {
      return null;
    }

    if (now.getTime() - song.createdAt.getTime() > LAST_PLAYED_TTL_MS) {
      this.songs.delete(chatJid);
      return null;
    }

    return song;
  }

  clear(): void {
    this.songs.clear();
  }
}

export const lastPlayedService = new LastPlayedService();
