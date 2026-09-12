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

export function getInteractiveAdditionalNodes(jid: string) {
  const isGroup = jid.endsWith("@g.us");
  const nodes: any[] = [
    {
      tag: "biz",
      attrs: {},
      content: [
        {
          tag: "interactive",
          attrs: { type: "native_flow", v: "1" },
          content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
        },
      ],
    },
  ];

  if (!isGroup) {
    nodes.push({ tag: "bot", attrs: { biz_bot: "1" } });
  }

  return nodes;
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

      // Direct interactive message (tanpa viewOnceMessage) dengan messageContextInfo
      const directMessageContent: proto.IMessage = {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
        },
        interactiveMessage: interactiveContent,
      };

      const msg = generateWAMessageFromContent(
        chatJid,
        directMessageContent,
        {
          userJid: socket.user?.id ?? "",
          quoted: options.quoted,
        },
      );

      const additionalNodes = getInteractiveAdditionalNodes(chatJid);

      if (typeof socket.relayMessage === "function" && msg.message && msg.key.id) {
        await socket.relayMessage(chatJid, msg.message, {
          messageId: msg.key.id,
          additionalNodes,
        });
        logger.info(
          { chatJid, messageId: msg.key.id, url: options.url },
          "Berhasil relay interactiveMessage via sendCtaUrlMessage",
        );
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

  /**
   * Eksperimen: Mengirim interactiveMessage TANPA wrapper viewOnceMessage
   * dan dilengkapi additionalNodes biz/bot untuk WhatsApp XMPP stanza.
   */
  async sendDirectInteractiveMessage(
    socket: WASocket,
    chatJid: string,
    options: CtaUrlOptions,
  ): Promise<{ messageId?: string; sentViaRelay: boolean }> {
    const footer = options.footer || "MinjiBot POC // WebView Verification";
    const fallbackText = [
      `*${options.header}*`,
      "",
      options.body,
      "",
      `*Akses Web:* ${options.url}`,
      "",
      `_${footer}_`,
    ].join("\n");

    // 1. Coba kirim via generateWAMessageFromContent + relayMessage LANGSUNG (tanpa viewOnceMessage)
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
          logger.debug({ uploadErr }, "Upload thumbnail untuk direct interactiveMessage gagal");
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

      // BUKAN di dalam viewOnceMessage! Sertakan messageContextInfo
      const directMessageContent: proto.IMessage = {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
        },
        interactiveMessage: interactiveContent,
      };

      const msg = generateWAMessageFromContent(
        chatJid,
        directMessageContent,
        {
          userJid: socket.user?.id ?? "",
          quoted: options.quoted,
        },
      );

      const additionalNodes = getInteractiveAdditionalNodes(chatJid);

      if (typeof socket.relayMessage === "function" && msg.message && msg.key.id) {
        await socket.relayMessage(chatJid, msg.message, {
          messageId: msg.key.id,
          additionalNodes,
        });
        logger.info(
          { chatJid, messageId: msg.key.id, url: options.url, additionalNodesCount: additionalNodes.length },
          "Berhasil relay direct interactiveMessage dengan additionalNodes biz/bot",
        );
        return { messageId: msg.key.id, sentViaRelay: true };
      }
    } catch (relayErr: unknown) {
      logger.warn(
        { err: relayErr, chatJid, url: options.url },
        "Gagal relay direct interactiveMessage, menggunakan fallback",
      );
    }

    // Fallback: Kirim teks markdown standar
    const sent = await socket.sendMessage(
      chatJid,
      { text: fallbackText },
      { quoted: options.quoted },
    );
    return { messageId: sent?.key?.id || undefined, sentViaRelay: false };
  }

  /**
   * Mengirim POC Native-Flow bertahap sesuai permintaan audit:
   * Tahap 1: interactiveMessage + quick_reply (tanpa URL, tanpa WebView, tanpa image)
   * Tahap 2: interactiveMessage + cta_url biasa (tanpa merchant_url & webview_presentation)
   * Tahap 3: interactiveMessage + cta_url + merchant_url
   * Tahap 4: interactiveMessage + cta_url + merchant_url + webview_presentation: "full"
   */
  async sendPocStage(
    socket: WASocket,
    chatJid: string,
    stage: 1 | 2 | 3 | 4,
    quoted?: WAMessage,
  ): Promise<{ messageId?: string; sentViaRelay: boolean; auditPayload: any }> {
    const baseUrl = this.getBaseUrl();
    const targetUrl = `${baseUrl}/webview-test/poc-stage-${stage}-${Date.now().toString(36)}`;
    let buttons: any[] = [];
    let title = "";
    let bodyText = "";

    if (stage === 1) {
      title = "POC 1: QUICK_REPLY";
      bodyText = "Uji coba primitive interactiveMessage native-flow paling sederhana dengan satu tombol quick_reply.";
      buttons = [
        {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: "Klik Respon POC",
            id: "poc_1_ack",
          }),
        },
      ];
    } else if (stage === 2) {
      title = "POC 2: CTA_URL BIASA";
      bodyText = "Uji coba primitive interactiveMessage dengan tombol cta_url biasa (tanpa merchant_url & webview_presentation).";
      buttons = [
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "Kunjungi URL Biasa",
            url: targetUrl,
          }),
        },
      ];
    } else if (stage === 3) {
      title = "POC 3: CTA_URL + MERCHANT_URL";
      bodyText = "Uji coba primitive interactiveMessage dengan tombol cta_url + merchant_url.";
      buttons = [
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "Kunjungi Merchant URL",
            url: targetUrl,
            merchant_url: targetUrl,
          }),
        },
      ];
    } else {
      title = "POC 4: CTA_URL + WEBVIEW_PRESENTATION";
      bodyText = "Uji coba primitive interactiveMessage dengan tombol cta_url + webview_presentation: 'full'.";
      buttons = [
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "Buka In-App WebView",
            url: targetUrl,
            merchant_url: targetUrl,
            webview_presentation: "full",
          }),
        },
      ];
    }

    const interactiveContent = proto.Message.InteractiveMessage.fromObject({
      header: {
        title,
        hasMediaAttachment: false,
      },
      body: {
        text: bodyText,
      },
      footer: {
        text: `MinjiBot POC Tahap ${stage}`,
      },
      nativeFlowMessage: {
        buttons,
      },
    });

    const directMessageContent: proto.IMessage = {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
      },
      interactiveMessage: interactiveContent,
    };

    const additionalNodes = getInteractiveAdditionalNodes(chatJid);

    const msg = generateWAMessageFromContent(
      chatJid,
      directMessageContent,
      {
        userJid: socket.user?.id ?? "",
        quoted,
      },
    );

    const auditPayload = {
      stage,
      chatJid,
      messageId: msg.key?.id,
      directMessageContent,
      additionalNodes,
      buttons,
    };

    logger.info({ auditPayload }, `Mengirim POC Tahap ${stage}`);

    if (typeof socket.relayMessage === "function" && msg.message && msg.key.id) {
      await socket.relayMessage(chatJid, msg.message, {
        messageId: msg.key.id,
        additionalNodes,
      });
      return { messageId: msg.key.id, sentViaRelay: true, auditPayload };
    }

    // Fallback jika relay tidak tersedia
    const fallbackText = `*${title}*\n\n${bodyText}\n\nURL: ${targetUrl}\n\n_MinjiBot POC Tahap ${stage}_`;
    const sent = await socket.sendMessage(chatJid, { text: fallbackText }, { quoted });
    return { messageId: sent?.key?.id || undefined, sentViaRelay: false, auditPayload };
  }
}

export const interactiveMessageService = new InteractiveMessageService();
