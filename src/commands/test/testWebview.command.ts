import type { CommandContext } from "../../types/command";
import { interactiveMessageService } from "../../services/whatsapp/interactiveMessage.service";

export const handleTestWebview = async (context: CommandContext): Promise<void> => {
  const arg = context.args[0]?.trim();
  let stage: 1 | 2 | 3 | 4 = 1;

  if (arg === "2") stage = 2;
  else if (arg === "3") stage = 3;
  else if (arg === "4") stage = 4;
  else stage = 1;

  const stageDescriptions = {
    1: "Tahap 1: quick_reply paling sederhana (tanpa URL, tanpa WebView)",
    2: "Tahap 2: cta_url biasa (tanpa merchant_url & webview_presentation)",
    3: "Tahap 3: cta_url + merchant_url",
    4: "Tahap 4: cta_url + merchant_url + webview_presentation: 'full'",
  };

  await context.reply(
    `*PENGUJIAN POC NATIVE-FLOW TAHAP ${stage}*\n` +
    `Deskripsi: ${stageDescriptions[stage]}\n` +
    `Struktur: interactiveMessage + additionalNodes (biz/bot)\n\n` +
    `Sedang mengirim pesan kartu interaktif... Jika berhasil, tombol akan muncul di HP Android Anda.\n\n` +
    `_Ketik .poc 1, .poc 2, .poc 3, atau .poc 4 untuk beralih tahap._`,
  );

  await interactiveMessageService.sendPocStage(
    context.socket,
    context.chatJid,
    stage,
    context.message,
  );
};
