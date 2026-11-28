export interface ChatMemoryEntry {
  senderLabel: string;
  text: string;
  timestampMs: number;
}

export const CHAT_MEMORY_MAX_PER_GROUP = 40;
const CHAT_MEMORY_MAX_GROUPS = 100;
const CHAT_MEMORY_MAX_LINE_CHARS = 180;
const CHAT_MEMORY_MAX_TRANSCRIPT_CHARS = 2_100;

/**
 * Ring-buffer memori obrolan teks ringan di RAM untuk .ringkas dan .tanyachat.
 * Hanya menyimpan teks murni (tanpa media), maks 40 pesan x 100 grup (~720 KB total RAM).
 */
export class ChatMemoryService {
  private readonly buffers = new Map<string, ChatMemoryEntry[]>();

  recordMessage(
    groupJid: string,
    senderLabel: string,
    rawText: string,
    timestampMs = Date.now(),
  ): void {
    const cleaned = rawText.replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length < 2) {
      return;
    }

    let list = this.buffers.get(groupJid);
    if (!list) {
      if (this.buffers.size >= CHAT_MEMORY_MAX_GROUPS) {
        const oldest = this.buffers.keys().next().value;
        if (oldest) this.buffers.delete(oldest);
      }
      list = [];
      this.buffers.set(groupJid, list);
    }

    const safeSender = senderLabel.replace(/[\r\n]+/g, " ").trim().slice(0, 24) || "Member";
    const safeText =
      cleaned.length > CHAT_MEMORY_MAX_LINE_CHARS
        ? `${cleaned.slice(0, CHAT_MEMORY_MAX_LINE_CHARS - 3)}...`
        : cleaned;

    list.push({ senderLabel: safeSender, text: safeText, timestampMs });
    if (list.length > CHAT_MEMORY_MAX_PER_GROUP) {
      list.splice(0, list.length - CHAT_MEMORY_MAX_PER_GROUP);
    }
  }

  getRecentEntries(groupJid: string, count = CHAT_MEMORY_MAX_PER_GROUP): ChatMemoryEntry[] {
    const list = this.buffers.get(groupJid);
    if (!list || list.length === 0) {
      return [];
    }
    const clamped = Math.max(1, Math.min(CHAT_MEMORY_MAX_PER_GROUP, Math.floor(count)));
    return list.slice(-clamped);
  }

  formatTranscript(groupJid: string, count = CHAT_MEMORY_MAX_PER_GROUP): {
    transcript: string;
    messageCount: number;
  } {
    const entries = this.getRecentEntries(groupJid, count);
    if (entries.length === 0) {
      return { transcript: "", messageCount: 0 };
    }

    const lines: string[] = [];
    let totalChars = 0;
    // Ambil dari terbaru mundur supaya pesan paling mutakhir selalu masuk
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry) continue;
      const line = `${entry.senderLabel}: ${entry.text}`;
      if (totalChars + line.length + 1 > CHAT_MEMORY_MAX_TRANSCRIPT_CHARS && lines.length > 0) {
        break;
      }
      lines.unshift(line);
      totalChars += line.length + 1;
    }

    return {
      transcript: lines.join("\n"),
      messageCount: lines.length,
    };
  }

  clearGroup(groupJid: string): void {
    this.buffers.delete(groupJid);
  }
}

export const chatMemoryService = new ChatMemoryService();
