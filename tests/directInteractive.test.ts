import assert from "node:assert";
import { describe, it } from "node:test";
import { generateWAMessageFromContent, proto } from "@whiskeysockets/baileys";

describe("Direct InteractiveMessage Test", () => {
  it("dapat membuat dan meng-encode interactiveMessage tanpa viewOnceMessage wrapper", () => {
    const interactiveContent = proto.Message.InteractiveMessage.fromObject({
      header: {
        title: "TEST POC WEBVIEW",
        hasMediaAttachment: false,
      },
      body: {
        text: "Tes buka WebView minimal tanpa wrapper viewOnceMessage.",
      },
      footer: {
        text: "MinjiBot POC Test",
      },
      nativeFlowMessage: {
        buttons: [
          {
            name: "cta_url",
            buttonParamsJson: JSON.stringify({
              display_text: "Buka Test WebView",
              url: "https://play.anthonywj.my.id/webview-test",
              merchant_url: "https://play.anthonywj.my.id/webview-test",
              webview_presentation: "full",
            }),
          },
        ],
      },
    });

    const directContent: proto.IMessage = {
      interactiveMessage: interactiveContent,
    };

    const msg = generateWAMessageFromContent(
      "6281234567890@s.whatsapp.net",
      directContent,
      {
        userJid: "bot@s.vwhatsapp.net",
      },
    );

    assert.ok(msg.message?.interactiveMessage, "Harus memiliki interactiveMessage");
    assert.ok(!msg.message?.viewOnceMessage, "Tidak boleh memiliki viewOnceMessage");

    const encoded = proto.Message.encode(msg.message!).finish();
    assert.ok(encoded.length > 0, "Panjang byte harus > 0");

    const decoded = proto.Message.decode(encoded);
    assert.ok(decoded.interactiveMessage, "Decoded message harus memiliki interactiveMessage");
    assert.strictEqual(
      decoded.interactiveMessage.header?.title,
      "TEST POC WEBVIEW",
      "Header title harus sesuai",
    );
    assert.strictEqual(
      decoded.interactiveMessage.nativeFlowMessage?.buttons?.[0]?.name,
      "cta_url",
      "Tombol harus bertipe cta_url",
    );
  });

  it("sendPocStage Tahap 1 menghasilkan quick_reply tanpa URL", async () => {
    const { interactiveMessageService } = await import(
      "../src/services/whatsapp/interactiveMessage.service"
    );
    let captured: any = null;
    const mockSocket: any = {
      user: { id: "bot@s.whatsapp.net" },
      relayMessage: async (jid: string, message: any, options: any) => {
        captured = { jid, message, options };
        return "msg-1";
      },
    };

    const res = await interactiveMessageService.sendPocStage(
      mockSocket,
      "628123456789@s.whatsapp.net",
      1,
    );

    assert.ok(res.sentViaRelay);
    assert.strictEqual(captured.message.interactiveMessage.nativeFlowMessage.buttons[0].name, "quick_reply");
    assert.strictEqual(captured.options.additionalNodes.length, 2, "Harus memiliki biz dan bot nodes");
    assert.strictEqual(captured.options.additionalNodes[1].attrs.biz_bot, "1");
  });

  it("sendPocStage Tahap 2, 3, 4 menghasilkan cta_url dengan parameter bertahap", async () => {
    const { interactiveMessageService } = await import(
      "../src/services/whatsapp/interactiveMessage.service"
    );
    let captured: any = null;
    const mockSocket: any = {
      user: { id: "bot@s.whatsapp.net" },
      relayMessage: async (jid: string, message: any, options: any) => {
        captured = { jid, message, options };
        return "msg-x";
      },
    };

    // Stage 2
    await interactiveMessageService.sendPocStage(mockSocket, "12345@g.us", 2);
    const params2 = JSON.parse(captured.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson);
    assert.ok(params2.url);
    assert.strictEqual(params2.merchant_url, undefined);
    assert.strictEqual(params2.webview_presentation, undefined);
    // Grup tidak memerlukan node bot
    assert.strictEqual(captured.options.additionalNodes.length, 1);

    // Stage 3
    await interactiveMessageService.sendPocStage(mockSocket, "628123@s.whatsapp.net", 3);
    const params3 = JSON.parse(captured.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson);
    assert.ok(params3.merchant_url);
    assert.strictEqual(params3.webview_presentation, undefined);

    // Stage 4
    await interactiveMessageService.sendPocStage(mockSocket, "628123@s.whatsapp.net", 4);
    const params4 = JSON.parse(captured.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson);
    assert.strictEqual(params4.webview_presentation, "full");
  });
});
