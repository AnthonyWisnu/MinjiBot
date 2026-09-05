import { proto } from "@whiskeysockets/baileys";
import { antiDeleteService } from "../../../services/moderation/antiDelete.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class AntiDeleteInterceptor implements MessageInterceptor {
  readonly name = "AntiDeleteInterceptor";
  readonly priority = 20;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    const rawMsg = context.message.message;
    const protocolMsg =
      rawMsg?.protocolMessage ??
      rawMsg?.ephemeralMessage?.message?.protocolMessage;

    if (
      protocolMsg?.type === proto.Message.ProtocolMessage.Type.REVOKE &&
      protocolMsg.key
    ) {
      await antiDeleteService.handleMessageRevoke(context.socket, protocolMsg.key);
      return null;
    }

    await antiDeleteService.cacheMessage(context.message, context.socket.user?.id);
    return null;
  }
}
