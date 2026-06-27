import { logger } from "../config/logger";
import type { CommandContext, CommandDefinition } from "../types/command";
import { afkCommands } from "./afk/afk.command";
import { gameCommands } from "./game/game.command";
import { downloaderCommands } from "./media/downloader.command";
import { hdAiCommands } from "./media/hdai.command";
import { hdCommands } from "./media/hd.command";
import { playCommands } from "./media/play.command";
import { stickerCommands } from "./media/sticker.command";
import { menuCommands } from "./menu.command";
import { antiLinkCommands } from "./moderation/antiLink.command";
import { antiSpamCommands } from "./moderation/antiSpam.command";
import { manualModerationCommands } from "./moderation/manualModeration.command";
import { quotaCommands } from "./quota/quota.command";
import { reminderCommands } from "./reminder/reminder.command";
import { tagAllCommands } from "./tagall/tagAll.command";
import { tenantFeatureCommands } from "./tenant/tenantFeature.command";
import { tenantOwnerCommands } from "./tenant/tenantOwner.command";
import { superOwnerTenantCommands } from "./tenant/superOwnerTenant.command";
import { welcomeCommands } from "./welcome/welcome.command";

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
  ...quotaCommands,
  ...tenantFeatureCommands,
  ...afkCommands,
  ...hdCommands,
  ...hdAiCommands,
  ...stickerCommands,
  ...playCommands,
  ...downloaderCommands,
  ...welcomeCommands,
  ...antiLinkCommands,
  ...antiSpamCommands,
  ...manualModerationCommands,
  ...reminderCommands,
  ...tagAllCommands,
  ...gameCommands,
]);
