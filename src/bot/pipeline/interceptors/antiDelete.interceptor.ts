import { antiDeleteService } from "../../../services/moderation/antiDelete.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class AntiDeleteInterceptor implements MessageInterceptor {
  readonly name = "AntiDeleteInterceptor";
  readonly priority = 20;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    await antiDeleteService.cacheMessage(context.message);
    return null;
  }
}
