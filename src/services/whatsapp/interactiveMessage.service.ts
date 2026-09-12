import { prepareWAMessageMedia, type WAMessage, type WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface CtaUrlOptions {
  header: string;
  body: string;
  footer?: string;
  buttonText: string;
  url: string;
  cardImage?: Buffer;
  quoted?: WAMessage;
}

export class InteractiveMessageService {
  getBaseUrl(): string {
    return env.WEB_BASE_URL.replace(/\/+$/, "");
  }

  /**
   * Mengirim pesan interaktif dengan tombol URL (cta_url) dan gambar card visual
   * mengambang di chat WhatsApp, didampingi fallback gambar + caption teks.
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

    // 1. Jika ada gambar kartu visual (cardImage), coba kirim nativeFlowMessage dengan media attachment
    if (options.cardImage && typeof socket.waUploadToServer === "function") {
      try {
        const media = await prepareWAMessageMedia(
          { image: options.cardImage },
          { upload: socket.waUploadToServer },
        );

        await socket.sendMessage(
          chatJid,
          {
            viewOnceMessage: {
              message: {
                interactiveMessage: {
                  header: {
                    title: options.header,
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage,
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
        return;
      } catch (err: unknown) {
        logger.warn(
          { err, chatJid, url: options.url },
          "Gagal mengirim nativeFlowMessage dengan media, mencoba pengiriman gambar langsung",
        );
      }
    }

    // 2. Jika ada gambar (baik upload native flow gagal atau tidak didukung), kirim gambar card visual mengambang di WhatsApp
    if (options.cardImage) {
      try {
        await socket.sendMessage(
          chatJid,
          {
            image: options.cardImage,
            caption: fallbackText,
          },
          { quoted: options.quoted },
        );
        return;
      } catch (imgErr: unknown) {
        logger.warn(
          { err: imgErr, chatJid },
          "Gagal mengirim pesan gambar, beralih ke teks markdown",
        );
      }
    } else {
      // Tanpa cardImage: coba nativeFlow teks
      try {
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
        return;
      } catch (err: unknown) {
        logger.warn(
          { err, chatJid, url: options.url },
          "Gagal mengirim nativeFlowMessage teks, beralih ke teks markdown",
        );
      }
    }

    // Fallback terakhir: teks markdown
    await socket.sendMessage(
      chatJid,
      { text: fallbackText },
      { quoted: options.quoted },
    );
  }
}

export const interactiveMessageService = new InteractiveMessageService();
