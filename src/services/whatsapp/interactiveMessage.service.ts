import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";

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
   * Mengirim pesan interaktif dengan tombol URL (cta_url) dan webview presentation
   * menggunakan generateWAMessageFromContent + relayMessage sesuai spesifikasi Baileys.
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

    // 1. Coba kirim via generateWAMessageFromContent + relayMessage (Interactive NativeFlow)
    try {
      let imageMessage: any;
      if (options.cardImage && typeof socket.waUploadToServer === "function") {
        try {
          const media = await prepareWAMessageMedia(
            { image: options.cardImage },
            { upload: socket.waUploadToServer },
          );
          if (media?.imageMessage) {
            imageMessage = media.imageMessage;
          }
        } catch (uploadErr) {
          logger.debug({ uploadErr }, "Upload thumbnail untuk interactiveMessage gagal");
        }
      }

      const interactiveContent = proto.Message.InteractiveMessage.fromObject({
        header: {
          title: options.header,
          hasMediaAttachment: !!imageMessage,
          imageMessage: imageMessage || undefined,
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
                webview_presentation: "full",
              }),
            },
          ],
        },
      });

      const messageContent: proto.IMessage = {
        viewOnceMessage: {
          message: {
            interactiveMessage: interactiveContent,
          },
        },
      };

      const msg = generateWAMessageFromContent(
        chatJid,
        messageContent,
        {
          userJid: socket.user?.id ?? "",
          quoted: options.quoted,
        },
      );

      if (typeof socket.relayMessage === "function" && msg.message && msg.key.id) {
        await socket.relayMessage(chatJid, msg.message, { messageId: msg.key.id });
        return;
      }
    } catch (relayErr: unknown) {
      logger.warn(
        { err: relayErr, chatJid, url: options.url },
        "Gagal mengirim interactive message via relayMessage, beralih ke image/text fallback",
      );
    }

    // 2. Jika ada cardImage, kirim gambar dengan caption
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
          "Gagal mengirim fallback gambar, beralih ke teks markdown",
        );
      }
    }

    // 3. Fallback terakhir: pesan teks markdown
    await socket.sendMessage(
      chatJid,
      { text: fallbackText },
      { quoted: options.quoted },
    );
  }
}

export const interactiveMessageService = new InteractiveMessageService();
