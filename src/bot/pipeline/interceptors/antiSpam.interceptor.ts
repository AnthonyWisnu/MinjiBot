import { antiSpamService } from "../../../services/moderation/antiSpam.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class AntiSpamInterceptor implements MessageInterceptor {
  readonly name = "AntiSpamInterceptor";
  readonly priority = 60;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    await antiSpamService.handleIncomingMessage(context.socket, context.message);
    return null;
  }
}
