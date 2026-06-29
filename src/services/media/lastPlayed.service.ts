const LAST_PLAYED_TTL_MS = 30 * 60 * 1000;

export interface LastPlayedSong {
  chatJid: string;
  title: string;
  artist?: string;
  createdAt: Date;
}

export class LastPlayedService {
  private readonly songs = new Map<string, LastPlayedSong>();

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
