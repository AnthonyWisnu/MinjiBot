import { extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessageContent } from "@whiskeysockets/baileys";

export function extractTextFromMessageContent(
  content: WAMessageContent | null | undefined,
): string {
  const normalizedContent = extractMessageContent(content) ?? undefined;

  return (
    normalizedContent?.conversation ??
    normalizedContent?.extendedTextMessage?.text ??
    normalizedContent?.imageMessage?.caption ??
    normalizedContent?.videoMessage?.caption ??
    normalizedContent?.documentMessage?.caption ??
    normalizedContent?.buttonsResponseMessage?.selectedButtonId ??
    normalizedContent?.templateButtonReplyMessage?.selectedId ??
    normalizedContent?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    normalizedContent?.interactiveResponseMessage?.nativeFlowResponseMessage?.name ??
    ""
  );
}
