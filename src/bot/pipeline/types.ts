import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

export interface IncomingPipelineContext {
  readonly socket: WASocket;
  readonly message: WAMessage;
  readonly remoteJid?: string | null;
  readonly isGroup: boolean;
}

export interface InterceptorResult {
  /**
   * If true, the message has been fully consumed/handled (e.g. game reply)
   * and should NOT continue down the pipeline or reach command parsing.
   */
  halt: boolean;
}

export type InterceptorOutput = InterceptorResult | null;

export interface MessageInterceptor {
  readonly name: string;
  readonly priority: number; // lower numbers run earlier
  intercept(context: IncomingPipelineContext): Promise<InterceptorOutput>;
}
