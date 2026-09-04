import { interactiveReplyService } from "../../../services/interactiveSession/interactiveReply.service";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class InteractiveReplyInterceptor implements MessageInterceptor {
  readonly name = "InteractiveReplyInterceptor";
  readonly priority = 70;

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    const handled = await interactiveReplyService.handleIncomingReply(
      context.socket,
      context.message,
    );

    if (handled) {
      return { halt: true };
    }

    return null;
  }
}
