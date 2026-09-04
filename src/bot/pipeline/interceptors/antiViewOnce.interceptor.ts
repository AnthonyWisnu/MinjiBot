import { antiViewOnceService } from "../../../services/moderation/antiViewOnce.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class AntiViewOnceInterceptor implements MessageInterceptor {
  readonly name = "AntiViewOnceInterceptor";
  readonly priority = 30;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    await antiViewOnceService.handleViewOnce(context.socket, context.message);
    return null;
  }
}
