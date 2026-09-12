import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface CtaUrlOptions {
  header: string;
  body: string;
  footer?: string;
  buttonText: string;
  url: string;
  quoted?: WAMessage;
}

export class InteractiveMessageService {
  getBaseUrl(): string {
    return env.WEB_BASE_URL.replace(/\/+$/, "");
  }

  /**
   * Mengirim pesan interaktif dengan tombol URL (cta_url) untuk WhatsApp mobile,
   * didampingi fallback link teks markdown rapi untuk desktop dan web.
   */
  async sendCtaUrlMessage(
    socket: WASocket,
    chatJid: string,
    options: CtaUrlOptions,
  ): Promise<void> {
    const footer = options.footer || "MinjiBot V2 // Web App Suite";
    const fallbackText = [
      `*${options.header}*`,
      "",
      options.body,
      "",
      `*Akses Web:* ${options.url}`,
      "",
      `_${footer}_`,
    ].join("\n");

    try {
      // Coba kirim format proto nativeFlowMessage untuk WhatsApp mobile
      await socket.sendMessage(
        chatJid,
        {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                header: {
                  title: options.header,
                  hasMediaAttachment: false,
                },
                body: {
                  text: `${options.body}\n\n*Akses Web:* ${options.url}`,
                },
                footer: {
                  text: footer,
                },
                nativeFlowMessage: {
                  buttons: [
                    {
                      name: "cta_url",
                      buttonParamsJson: JSON.stringify({
                        display_text: options.buttonText,
                        url: options.url,
                        merchant_url: options.url,
                      }),
                    },
                  ],
                },
              },
            },
          },
        } as any,
        { quoted: options.quoted },
      );
    } catch (err: unknown) {
      logger.warn(
        { err, chatJid, url: options.url },
        "Gagal mengirim nativeFlowMessage, mengirim fallback teks markdown",
      );

      // Fallback ke pesan teks markdown biasa
      await socket.sendMessage(
        chatJid,
        { text: fallbackText },
        { quoted: options.quoted },
      );
    }
  }
}

export const interactiveMessageService = new InteractiveMessageService();
