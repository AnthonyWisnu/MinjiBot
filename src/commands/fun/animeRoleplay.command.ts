import {
  ANIME_ROLEPLAY_SPECS,
  animeRoleplayService,
  type AnimeRoleplaySpec,
} from "../../services/fun/animeRoleplay.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

function createRoleplayHandler(spec: AnimeRoleplaySpec) {
  return async (context: CommandContext): Promise<void> => {
    try {
      const actorJid = context.isGroup
        ? await identityResolverService.resolveCanonicalUserJid(
            context.socket,
            context.chatJid,
            context.senderUserJid,
            context.senderAltJids,
          )
        : context.senderUserJid;

      const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;
      let targetJid: string | null = null;
      if (rawTarget) {
        targetJid = context.isGroup
          ? await identityResolverService.resolveCanonicalUserJid(
              context.socket,
              context.chatJid,
              rawTarget,
            )
          : rawTarget;
      }

      const mentions = targetJid && targetJid !== actorJid ? [actorJid, targetJid] : [actorJid];
      const actionLine =
        targetJid && targetJid !== actorJid
          ? spec.withTarget(tagOf(actorJid), tagOf(targetJid))
          : spec.solo(tagOf(actorJid));

      const media = await animeRoleplayService.fetchReactionMedia(spec.endpoint);
      const creditLine =
        spec.category === "character" && media.artistName
          ? `_Artist: ${media.artistName}_`
          : `_${media.animeName}_`;
      const caption = `${actionLine}\n${creditLine}`;

      if (media.kind === "gifVideo") {
        await context.socket.sendMessage(
          context.chatJid,
          {
            video: media.buffer,
            mimetype: "video/mp4",
            gifPlayback: true,
            caption,
            mentions,
          },
          { quoted: context.message },
        );
        return;
      }

      await context.socket.sendMessage(
        context.chatJid,
        {
          image: media.buffer,
          mimetype: "image/png",
          caption,
          mentions,
        },
        { quoted: context.message },
      );
    } catch (error: unknown) {
      await context.reply(formatUserSafeError(error, `Gagal menjalankan aksi .${spec.command}.`));
    }
  };
}

export const animeRoleplayCommands: CommandDefinition[] = ANIME_ROLEPLAY_SPECS.map((spec) => ({
  name: spec.command,
  execute: createRoleplayHandler(spec),
}));
