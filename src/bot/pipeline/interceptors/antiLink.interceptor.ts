import { antiLinkService } from "../../../services/moderation/antiLink.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class AntiLinkInterceptor implements MessageInterceptor {
  readonly name = "AntiLinkInterceptor";
  readonly priority = 50;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    await antiLinkService.handleIncomingMessage(context.socket, context.message);
    return null;
  }
}
