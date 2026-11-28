import { env } from "../../../config/env";
import { chatMemoryService } from "../../../services/ai/chatMemory.service";
import { getMessageSenderJid } from "../../../utils/jid";
import { extractTextFromMessageContent } from "../../../utils/messageText";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class ChatMemoryInterceptor implements MessageInterceptor {
  readonly name = "ChatMemoryInterceptor";
  readonly priority = 38;

  intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    if (!context.isGroup || !context.remoteJid || context.message.key.fromMe) {
      return Promise.resolve(null);
    }

    const rawMsg = context.message.message;
    if (
      !rawMsg ||
      rawMsg.viewOnceMessage ||
      rawMsg.viewOnceMessageV2 ||
      (rawMsg as { viewOnceMessageV2Extension?: unknown }).viewOnceMessageV2Extension
    ) {
      return Promise.resolve(null);
    }

    const text = extractTextFromMessageContent(rawMsg).trim();
    if (!text || text.startsWith(env.COMMAND_PREFIX)) {
      return Promise.resolve(null);
    }

    const pushName = context.message.pushName?.trim();
    const senderJid = getMessageSenderJid(context.remoteJid, context.message.key.participant);
    const fallbackLabel = senderJid.split("@")[0]?.slice(-6) ?? "Member";
    const senderLabel = pushName && pushName.length > 0 ? pushName : `User-${fallbackLabel}`;

    chatMemoryService.recordMessage(context.remoteJid, senderLabel, text);
    return Promise.resolve(null);
  }
}
