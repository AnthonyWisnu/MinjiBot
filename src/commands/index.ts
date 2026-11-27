import { logger } from "../config/logger";
import { formatUserSafeError } from "../utils/userSafeError";
import type { CommandContext, CommandDefinition } from "../types/command";
import { afkCommands } from "./afk/afk.command";
import { funCommands } from "./fun/fun.command";
import { gameCommands } from "./game/game.command";
import { dailyCommand } from "./member/daily.command";
import { giftCommands } from "./member/gift.command";
import { leaderboardCommands } from "./member/leaderboard.command";
import { limitPurchaseCommands } from "./member/limitPurchase.command";
import { memberAdminCommands } from "./member/memberAdmin.command";
import { profileCommands } from "./member/profile.command";
import { privacyCommands } from "./member/privacy.command";
import { walletCommands } from "./member/wallet.command";
import { downloaderCommands } from "./media/downloader.command";
import { groupStatusCommands } from "./media/groupStatus.command";
import { hdCommands } from "./media/hd.command";
import { lyricsCommands } from "./media/lyrics.command";
import { playCommands } from "./media/play.command";
import { stickerCommands } from "./media/sticker.command";
import { videoNoteCommands } from "./media/videoNote.command";
import { quoteCardCommands } from "./media/quoteCard.command";
import { audioEffectCommands } from "./media/audioEffect.command";
import { menuCommands } from "./menu.command";
import { antiLinkCommands } from "./moderation/antiLink.command";
import { antiSpamCommands } from "./moderation/antiSpam.command";
import { antiDeleteCommands } from "./moderation/antiDelete.command";
import { manualModerationCommands } from "./moderation/manualModeration.command";
import { warnCommands } from "./moderation/warn.command";
import { antiRaidCommands } from "./moderation/antiRaid.command";
import { reminderCommands } from "./reminder/reminder.command";
import { rpgCommands } from "./rpg/rpg.command";
import { tagAllCommands } from "./tagall/tagAll.command";
import { tenantAdminCommands } from "./tenant/tenantAdmin.command";
import { tenantFeatureCommands } from "./tenant/tenantFeature.command";
import { tenantOwnerCommands } from "./tenant/tenantOwner.command";
import { tenantPanelCommands } from "./tenant/tenantPanel.command";
import { transferOwnerCommands } from "./tenant/transferOwner.command";
import { superOwnerTenantCommands } from "./tenant/superOwnerTenant.command";
import { groupToolCommands } from "./tools/tools.command";
import { welcomeCommands } from "./welcome/welcome.command";
import { groupStatsCommands } from "./stats/groupStats.command";

export class CommandRouter {
  private readonly commands = new Map<string, CommandDefinition>();

  constructor(definitions: CommandDefinition[]) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  has(commandName: string): boolean {
    return this.commands.has(commandName.toLowerCase());
  }

  async handle(context: CommandContext): Promise<void> {
    const command = this.commands.get(context.commandName.toLowerCase());

    if (!command) {
      logger.debug(
        {
          commandName: context.commandName,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
          isGroup: context.isGroup,
        },
        "Command tidak terdaftar",
      );
      return;
    }

    try {
      await command.execute(context);
    } catch (error: unknown) {
      logger.error(
        {
          error,
          commandName: context.commandName,
          chatJid: context.chatJid,
          senderJid: context.senderJid,
        },
        "Command gagal diproses",
      );

      await context.reply(formatUserSafeError(error, "Terjadi kendala saat memproses perintah."));
    }
  }

  private register(definition: CommandDefinition): void {
    const names = [definition.name, ...(definition.aliases ?? [])].map((name) =>
      name.toLowerCase(),
    );

    for (const name of names) {
      if (this.commands.has(name)) {
        throw new Error(`Command duplikat: ${name}`);
      }

      this.commands.set(name, definition);
    }
  }
}

export const commandRouter = new CommandRouter([
  ...menuCommands,
  ...superOwnerTenantCommands,
  ...tenantOwnerCommands,
  ...tenantPanelCommands,
  ...transferOwnerCommands,
  ...tenantAdminCommands,
  ...tenantFeatureCommands,
  ...afkCommands,
  ...hdCommands,
  ...stickerCommands,
  ...groupStatusCommands,
  ...videoNoteCommands,
  ...quoteCardCommands,
  ...audioEffectCommands,
  ...playCommands,
  ...lyricsCommands,
  ...downloaderCommands,
  ...welcomeCommands,
  ...antiLinkCommands,
  ...antiSpamCommands,
  ...antiDeleteCommands,
  ...manualModerationCommands,
  ...warnCommands,
  ...antiRaidCommands,
  ...reminderCommands,
  ...tagAllCommands,
  ...gameCommands,
  ...funCommands,
  ...rpgCommands,
  dailyCommand,
  ...limitPurchaseCommands,
  ...walletCommands,
  ...giftCommands,
  ...memberAdminCommands,
  ...profileCommands,
  ...privacyCommands,
  ...leaderboardCommands,
  ...groupStatsCommands,
  ...groupToolCommands,
]);
