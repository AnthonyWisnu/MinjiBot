import type { CommandContext, CommandDefinition } from "../../types/command";
import { youtubeSearchService } from "../../services/media/youtubeSearch.service";
import { whatsAppWebViewService } from "../../services/whatsapp/whatsAppWebView.service";
import { logger } from "../../config/logger";

export const ythtmlCommand: CommandDefinition = {
  name: "ythtml",
  aliases: ["ytplayer", "playhtml"],
  async execute(context: CommandContext): Promise<void> {
    const query = context.args.join(" ").trim();
    if (!query) {
      await context.reply("Masukkan judul lagu atau link YouTube.\n\nContoh:\n.ythtml Alan Walker Faded\n.ythtml https://youtube.com/watch?v=...");
      return;
    }

    await context.reply(`Mencari media untuk '${query}'...`);

    try {
      const results = await youtubeSearchService.searchVideos(query, 1);
      const video = results[0];

      if (!video) {
        await context.reply(`Media untuk '${query}' tidak ditemukan di YouTube.`);
        return;
      }

      await whatsAppWebViewService.openPlayer(context.socket, context.chatJid, {
        video: {
          videoId: video.videoId,
          url: video.url,
          title: video.title,
          channelTitle: video.channelTitle,
          durationSeconds: video.durationSeconds,
          thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
        },
        senderUserJid: context.senderUserJid,
        quoted: context.message,
        sendInChatAudio: true,
      });
    } catch (err: unknown) {
      logger.error({ err, query }, "Error pada command .ythtml");
      const message = err instanceof Error ? err.message : "Terjadi kesalahan saat memproses media";
      await context.reply(`Gagal memproses .ythtml: ${message}`);
    }
  },
};
