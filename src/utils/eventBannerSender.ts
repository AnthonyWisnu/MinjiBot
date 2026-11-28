import { avatarService } from "../services/media/avatar.service";
import {
  eventBannerService,
  type EventBannerScene,
} from "../services/media/eventBanner.service";
import type { CommandContext } from "../types/command";

export interface SendEventBannerOptions {
  scene: EventBannerScene;
  headline: string;
  subjectName: string;
  details: string[];
  targetUserJid: string;
  caption: string;
  mentions?: string[];
  avatarAltJids?: string[];
}

export async function sendEventBannerOrReply(
  context: CommandContext,
  options: SendEventBannerOptions,
): Promise<void> {
  const rawSocket = (context as { socket?: unknown }).socket;
  const socket = (rawSocket ?? {}) as {
    sendMessage?: (
      chatJid: string,
      content: { image: Buffer; caption: string; mentions?: string[] },
      opts?: { quoted?: unknown },
    ) => Promise<unknown>;
  };

  if (typeof socket.sendMessage !== "function") {
    await context.reply(options.caption, { mentions: options.mentions });
    return;
  }

  try {
    const avatarBuffer = await avatarService
      .getAvatarWithFallback(context.socket, options.targetUserJid, options.avatarAltJids ?? [])
      .catch(() => null);

    const imageBuffer = await eventBannerService.renderEventBanner({
      scene: options.scene,
      headline: options.headline,
      subjectName: options.subjectName,
      details: options.details,
      avatarBuffer,
    });

    await socket.sendMessage(
      context.chatJid,
      {
        image: imageBuffer,
        caption: options.caption,
        mentions: options.mentions,
      },
      { quoted: context.message },
    );
    return;
  } catch {
    // Fallback halus ke teks apabila render atau pengiriman gambar gagal
  }

  await context.reply(options.caption, { mentions: options.mentions });
}
