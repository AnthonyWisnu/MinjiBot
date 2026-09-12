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
});
