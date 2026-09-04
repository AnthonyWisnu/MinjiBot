import { afkService } from "../../../services/afk/afk.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class AfkInterceptor implements MessageInterceptor {
  readonly name = "AfkInterceptor";
  readonly priority = 40;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    await afkService.handleIncomingMessage(context.socket, context.message);
    return null;
  }
}
