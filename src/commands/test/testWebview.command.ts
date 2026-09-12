import type { CommandContext } from "../../types/command";
import { interactiveMessageService } from "../../services/whatsapp/interactiveMessage.service";
import { env } from "../../config/env";

export const handleTestWebview = async (context: CommandContext): Promise<void> => {
  const sessionId = "poc-" + Date.now().toString(36);
  const baseUrl = env.WEB_BASE_URL.replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/webview-test/${sessionId}`;

  await context.reply(
    `*MENGUJI POC WEBVIEW MINIMAL*\n` +
    `Sedang mengirim kartu interaktif eksperimen (tanpa wrapper viewOnceMessage) ke chat ini...\n\n` +
    `Target: ${targetUrl}`,
  );

  await interactiveMessageService.sendDirectInteractiveMessage(
    context.socket,
    context.chatJid,
    {
      header: "POC EMBEDDED WEBVIEW // TEST",
      body: [
        "Pengujian Primitive WhatsApp Interactive Message.",
        "",
        "Tekan tombol di bawah untuk membuktikan apakah halaman terbuka di dalam WebView internal WhatsApp atau di browser eksternal.",
      ].join("\n"),
      buttonText: "Buka Test WebView",
      url: targetUrl,
      quoted: context.message,
    },
  );
};
