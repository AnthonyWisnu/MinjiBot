import {
  generateWAMessageContent,
  generateWAMessageFromContent,
  type AnyMessageContent,
  type WASocket,
} from "@whiskeysockets/baileys";

import { AppUserError } from "../../errors/appUserError";
import { formatRemainingDuration } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";

const GROUP_STATUS_COOLDOWN_MS = 30 * 1000;

const STATUS_BG_COLORS = [
  "#0F172A",
  "#1E3A8A",
  "#065F46",
  "#7C2D12",
  "#581C87",
  "#881337",
  "#134E4A",
] as const;

export interface GroupStatusInput {
  socket: WASocket;
  groupJid: string;
  senderUserJid: string;
  content: AnyMessageContent;
  bypassCooldown?: boolean;
  backgroundColor?: string;
}

export interface BotStatusInput {
  socket: WASocket;
  statusJidList: string[];
  content: AnyMessageContent;
  backgroundColor?: string;
}

export interface GroupStatusDeps {
  buildContent: typeof generateWAMessageContent;
  buildFromContent: typeof generateWAMessageFromContent;
}

export class GroupStatusService {
  private readonly lastPostByGroup = new Map<string, number>();

  constructor(
    private readonly deps: GroupStatusDeps = {
      buildContent: generateWAMessageContent,
      buildFromContent: generateWAMessageFromContent,
    },
  ) {}

  pickBackgroundColor(customHex?: string): string {
    if (customHex && /^#[0-9a-f]{6}$/i.test(customHex.trim())) {
      return customHex.trim().toUpperCase();
    }
    const idx = Math.floor(Math.random() * STATUS_BG_COLORS.length);
    return STATUS_BG_COLORS[idx] ?? STATUS_BG_COLORS[0];
  }

  async postGroupStatus(input: GroupStatusInput, nowMs = Date.now()): Promise<string> {
    if (!input.bypassCooldown) {
      const lastAt = this.lastPostByGroup.get(input.groupJid) ?? 0;
      const elapsed = nowMs - lastAt;
      if (lastAt > 0 && elapsed < GROUP_STATUS_COOLDOWN_MS) {
        const remaining = GROUP_STATUS_COOLDOWN_MS - elapsed;
        throw new AppUserError(
          `Cooldown .sw aktif. Tunggu *${formatRemainingDuration(remaining)}* lagi sebelum membuat status grup baru.`,
        );
      }
    }

    const bgColor = this.pickBackgroundColor(input.backgroundColor);
    const innerContent = await this.deps.buildContent(input.content, {
      upload: input.socket.waUploadToServer,
      backgroundColor: bgColor,
      font: 1,
    });

    const botUserJid = normalizeUserJid(input.socket.user?.id ?? input.senderUserJid);
    const wrapped = this.deps.buildFromContent(
      input.groupJid,
      {
        groupStatusMessageV2: {
          message: innerContent,
        },
      },
      {
        userJid: botUserJid,
      },
    );

    if (!wrapped.message) {
      throw new AppUserError("Gagal menyusun konten status grup.");
    }

    await input.socket.relayMessage(input.groupJid, wrapped.message, {
      messageId: wrapped.key.id ?? undefined,
    });

    this.lastPostByGroup.set(input.groupJid, nowMs);
    return wrapped.key.id ?? "ok";
  }

  async postBotStatus(input: BotStatusInput): Promise<void> {
    if (input.statusJidList.length === 0) {
      throw new AppUserError("Daftar penerima status tidak boleh kosong.");
    }

    const bgColor = this.pickBackgroundColor(input.backgroundColor);
    await input.socket.sendMessage("status@broadcast", input.content, {
      backgroundColor: bgColor,
      font: 1,
      statusJidList: input.statusJidList,
    });
  }
}

export const groupStatusService = new GroupStatusService();
