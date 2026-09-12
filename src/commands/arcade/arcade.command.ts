import type { CommandContext, CommandDefinition } from "../../types/command";
import { whatsAppWebViewService } from "../../services/whatsapp/whatsAppWebView.service";
import { logger } from "../../config/logger";

export const arcadeCommand: CommandDefinition = {
  name: "arcade",
  aliases: ["gamehub", "retro"],
  async execute(context: CommandContext): Promise<void> {
    const sub = (context.args[0] || "").toLowerCase().trim();
    let selectedGame: "dino" | "block-blast" | "chess" | undefined;

    if (sub === "dino") selectedGame = "dino";
    else if (sub === "block" || sub === "blockblast" || sub === "block-blast") selectedGame = "block-blast";
    else if (sub === "chess" || sub === "catur") selectedGame = "chess";

    try {
      await whatsAppWebViewService.openArcade(context.socket, context.chatJid, {
        game: selectedGame,
        senderUserJid: context.senderUserJid,
        quoted: context.message,
      });
    } catch (err: unknown) {
      logger.error({ err, sub }, "Error pada command .arcade");
      const message = err instanceof Error ? err.message : "Terjadi kesalahan saat membuka Arcade";
      await context.reply(`Gagal membuka Arcade: ${message}`);
    }
  },
};
