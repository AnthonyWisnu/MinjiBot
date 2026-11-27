import { logger } from "../../../config/logger";
import { pendingTenantRegistrationService } from "../../../services/tenant/pendingTenantRegistration.service";
import { getMessageSenderJid, isGroupJid, isStatusBroadcastJid } from "../../../utils/jid";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class PendingTenantInterceptor implements MessageInterceptor {
  readonly name = "PendingTenantInterceptor";
  readonly priority = 10;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    const chatJid = context.remoteJid;
    if (!chatJid || !isGroupJid(chatJid) || isStatusBroadcastJid(chatJid)) {
      return null;
    }

    try {
      await pendingTenantRegistrationService.registerIfNeeded({
        socket: context.socket,
        groupJid: chatJid,
        actorJid: getMessageSenderJid(chatJid, context.message.key.participant),
      });
    } catch (error: unknown) {
      logger.error(
        {
          error,
          groupJid: chatJid,
        },
        "Registrasi tenant pending gagal",
      );
    }

    return null;
  }
}
