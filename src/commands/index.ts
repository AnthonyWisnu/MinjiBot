import { logger } from "../config/logger";
import type { CommandContext, CommandDefinition } from "../types/command";
import { afkCommands } from "./afk/afk.command";
import { gameCommands } from "./game/game.command";
import { dailyCommand } from "./member/daily.command";
import { giftCommands } from "./member/gift.command";
import { leaderboardCommands } from "./member/leaderboard.command";
import { limitPurchaseCommand } from "./member/limitPurchase.command";
import { memberAdminCommands } from "./member/memberAdmin.command";
import { profileCommands } from "./member/profile.command";
import { downloaderCommands } from "./media/downloader.command";
import { hdCommands } from "./media/hd.command";
import { lyricsCommands } from "./media/lyrics.command";
import { playCommands } from "./media/play.command";
import { stickerCommands } from "./media/sticker.command";
import { quoteCardCommands } from "./media/quoteCard.command";
import { audioEffectCommands } from "./media/audioEffect.command";
import { menuCommands } from "./menu.command";
import { antiLinkCommands } from "./moderation/antiLink.command";
import { antiSpamCommands } from "./moderation/antiSpam.command";
import { antiDeleteCommands } from "./moderation/antiDelete.command";
import { antiViewOnceCommands } from "./moderation/antiViewOnce.command";
import { manualModerationCommands } from "./moderation/manualModeration.command";
import { warnCommands } from "./moderation/warn.command";
import { antiRaidCommands } from "./moderation/antiRaid.command";
import { reminderCommands } from "./reminder/reminder.command";
import { tagAllCommands } from "./tagall/tagAll.command";
import { tenantAdminCommands } from "./tenant/tenantAdmin.command";
import { tenantFeatureCommands } from "./tenant/tenantFeature.command";
import { tenantOwnerCommands } from "./tenant/tenantOwner.command";
import { tenantPanelCommands } from "./tenant/tenantPanel.command";
import { transferOwnerCommands } from "./tenant/transferOwner.command";
import { superOwnerTenantCommands } from "./tenant/superOwnerTenant.command";
import { welcomeCommands } from "./welcome/welcome.command";
import { groupStatsCommands } from "./stats/groupStats.command";

export class CommandRouter {
  private readonly commands = new Map<string, CommandDefinition>();

  constructor(definitions: CommandDefinition[]) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  async handle(context: CommandContext): Promise<void> {
    const command = this.commands.get(context.commandName);

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

    await command.execute(context);
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
  ...quoteCardCommands,
  ...audioEffectCommands,
  ...playCommands,
  ...lyricsCommands,
  ...downloaderCommands,
  ...welcomeCommands,
  ...antiLinkCommands,
  ...antiSpamCommands,
  ...antiDeleteCommands,
  ...antiViewOnceCommands,
  ...manualModerationCommands,
  ...warnCommands,
  ...antiRaidCommands,
  ...reminderCommands,
  ...tagAllCommands,
  ...gameCommands,
  dailyCommand,
  limitPurchaseCommand,
  ...giftCommands,
  ...memberAdminCommands,
  ...profileCommands,
  ...leaderboardCommands,
  ...groupStatsCommands,
]);
