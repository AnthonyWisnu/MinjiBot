import { logger } from "../../config/logger";
import type { IncomingPipelineContext, MessageInterceptor } from "./types";

export class MessagePipeline {
  private readonly interceptors: MessageInterceptor[] = [];

  constructor(initialInterceptors: MessageInterceptor[] = []) {
    for (const interceptor of initialInterceptors) {
      this.use(interceptor);
    }
  }

  use(interceptor: MessageInterceptor): this {
    this.interceptors.push(interceptor);
    this.interceptors.sort((a, b) => a.priority - b.priority);
    return this;
  }

  getInterceptors(): readonly MessageInterceptor[] {
    return this.interceptors;
  }

  /**
   * Executes all interceptors in order of priority.
   * Returns true if the message was halted (i.e. handled by an interceptor),
   * or false if it should proceed to command parsing.
   */
  async execute(context: IncomingPipelineContext): Promise<boolean> {
    for (const interceptor of this.interceptors) {
      try {
        const result = await interceptor.intercept(context);
        if (result?.halt) {
          logger.debug(
            {
              interceptor: interceptor.name,
              remoteJid: context.remoteJid,
            },
            "Pesan dihentikan oleh interceptor pipeline",
          );
          return true;
        }
      } catch (error: unknown) {
        logger.error(
          {
            error,
            interceptor: interceptor.name,
            remoteJid: context.remoteJid,
          },
          "Error pada interceptor pipeline",
        );
      }
    }

    return false;
  }
}
