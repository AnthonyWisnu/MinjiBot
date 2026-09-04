import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { groupStatsService } from "../../../services/stats/groupStats.service";
import { getMessageSenderJid, getPreferredUserJid, getUniqueNormalizedJids } from "../../../utils/jid";
import { extractTextFromMessageContent } from "../../../utils/messageText";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class ActivityTrackerInterceptor implements MessageInterceptor {
  readonly name = "ActivityTrackerInterceptor";
  readonly priority = 35;

  intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    const chatJid = context.remoteJid;
    if (!chatJid || !context.isGroup || context.message.key.fromMe) {
      return Promise.resolve(null);
    }

    const participant = context.message.key.participant;
    if (!participant) {
      return Promise.resolve(null);
    }

    const text = extractTextFromMessageContent(context.message.message).trim();
    if (text.startsWith(env.COMMAND_PREFIX)) {
      return Promise.resolve(null);
    }

    try {
      const senderJid = getMessageSenderJid(chatJid, participant);
      const senderAltJids = getUniqueNormalizedJids([
        chatJid,
        participant,
        context.message.key.senderPn,
        context.message.key.participantPn,
        context.message.key.senderLid,
        context.message.key.participantLid,
      ]);
      const senderUserJid = getPreferredUserJid(
        senderAltJids.includes(senderJid) ? senderAltJids : [senderJid, ...senderAltJids],
      );

      // Non-blocking fire-and-forget activity recording
      void groupStatsService.trackActivity(chatJid, senderUserJid).catch((error: unknown) => {
        logger.warn({ error, chatJid, senderUserJid }, "Gagal mencatat aktivitas member di ActivityTracker");
      });
    } catch (error: unknown) {
      logger.warn({ error, chatJid }, "Error resolving sender JID in ActivityTrackerInterceptor");
    }

    return Promise.resolve(null);
  }
}
