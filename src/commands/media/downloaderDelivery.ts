import { logger } from "../../config/logger";
import type { DownloadedMediaItem, ExtractedAudio } from "../../services/media/downloader.service";
import type { CommandContext } from "../../types/command";
import { mediaQueueService } from "../../utils/boundedQueue";
import { refundFeatureLimit, type LimitReservation } from "./heavyFeatureHelper";

const MB_100 = 100 * 1024 * 1024;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function handleDownloaderFailure(params: {
  context: CommandContext;
  commandName: string;
  label: string;
  url: string;
  error: unknown;
  reserved: boolean;
  reservation: LimitReservation | null;
  formatError: (err: unknown) => string;
}): Promise<void> {
  const { context, commandName, label, url, error, reserved, reservation, formatError } = params;
  logger.error(
    {
      err: error,
      commandName,
      url,
      chatJid: context.chatJid,
      senderJid: context.senderJid,
    },
    `Gagal memproses unduhan ${label}`,
  );
  if (reserved && reservation !== null) {
    await refundFeatureLimit(reservation);
    await context.reply(`${formatError(error)}\nLimit yang sudah direservasi telah dikembalikan.`);
  } else {
    await context.reply(formatError(error));
  }
}

export function notifyProcessingOrQueued(context: CommandContext, label: string): Promise<void> {
  const queue = mediaQueueService.heavySubprocessQueue;
  if (queue.activeCount >= queue.concurrency) {
    const pos = queue.pendingCount + 1;
    return context.reply(
      `Permintaan ${label} sedang dalam antrean (#${String(pos)}), mohon tunggu...`,
    );
  }
  return context.reply(`Permintaan ${label} sedang diproses, mohon tunggu...`);
}

export async function sendAudioMessage(
  context: CommandContext,
  audio: ExtractedAudio,
): Promise<void> {
  try {
    await context.socket.sendMessage(
      context.chatJid,
      {
        audio: audio.buffer,
        mimetype: audio.mimetype,
        ptt: false,
      },
      { quoted: context.message },
    );
  } catch (err: unknown) {
    logger.warn({ err, chatJid: context.chatJid }, "Gagal mengirim audio pengiring TikTok");
  }
}

export async function sendMediaItem(
  context: CommandContext,
  item: DownloadedMediaItem,
  caption?: string,
): Promise<void> {
  if (item.mediaType === "video") {
    if (item.buffer.byteLength <= MB_100) {
      await context.socket.sendMessage(
        context.chatJid,
        {
          video: item.buffer,
          mimetype: "video/mp4",
          fileName: item.fileName,
          caption,
        },
        { quoted: context.message },
      );
    } else {
      const sizeMb = (item.buffer.byteLength / (1024 * 1024)).toFixed(1);
      const docCaption = caption
        ? `${caption}\n\n_Ukuran video (${sizeMb} MB) di atas 100 MB, dikirim sebagai dokumen video HD._`
        : `_Ukuran video (${sizeMb} MB) di atas 100 MB, dikirim sebagai dokumen video HD._`;

      await context.socket.sendMessage(
        context.chatJid,
        {
          document: item.buffer,
          mimetype: "video/mp4",
          fileName: item.fileName.endsWith(".mp4") ? item.fileName : `${item.fileName}.mp4`,
          caption: docCaption,
        },
        { quoted: context.message },
      );
    }
  } else {
    await context.socket.sendMessage(
      context.chatJid,
      {
        image: item.buffer,
        mimetype: item.mimetype,
        caption,
      },
      { quoted: context.message },
    );
  }
}

export function formatTikTokError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media TikTok terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (
    message.includes("durasi") ||
    message.includes("duration") ||
    message.includes("match-filter")
  ) {
    return "Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).";
  }
  if (message.includes("gagal mengambil foto") || message.includes("tidak ada media")) {
    return "Konten foto slide TikTok gagal diambil. Pastikan link valid dan publik.";
  }
  return "Konten TikTok gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}

export function formatInstagramError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("login") ||
    message.includes("cookies") ||
    message.includes("private") ||
    message.includes("not available")
  ) {
    return "Media gagal diambil. Pastikan link masih aktif dan dapat diakses.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (
    message.includes("durasi") ||
    message.includes("duration") ||
    message.includes("match-filter")
  ) {
    return "Video Instagram melebihi batas durasi 30 menit.";
  }
  if (message.includes("tidak ada media")) {
    return "Tidak ada media yang berhasil diunduh. Pastikan link valid.";
  }
  return "Media gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}

export function formatYoutubeError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("durasi") ||
    message.includes("duration") ||
    message.includes("match-filter")
  ) {
    return "Video melebihi batas durasi 1 jam.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Video terlalu besar untuk dikirim (maks. 400 MB).";
  }
  return "Video YouTube gagal diambil. Pastikan link masih aktif dan dapat dibuka.";
}

export function formatTwitterError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("durasi") ||
    message.includes("duration") ||
    message.includes("match-filter")
  ) {
    return "Video X (Twitter) melebihi batas durasi 30 menit.";
  }
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media X (Twitter) terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (message.includes("hanya menerima link resmi")) {
    return "Format command salah.\nGunakan: .x <link tweet / x.com> atau .twt <link>";
  }
  return "Media X (Twitter) gagal diambil. Pastikan tweet bersifat publik dan berisi media.";
}

export function formatPinterestError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("max-filesize") || message.includes("maksimal")) {
    return "Media Pinterest terlalu besar untuk dikirim (maks. 400 MB).";
  }
  if (message.includes("kata kunci") && message.includes("tidak ditemukan")) {
    return "Gambar Pinterest untuk kata kunci tersebut tidak ditemukan. Coba kata kunci lain.";
  }
  if (message.includes("tidak ditemukan") || message.includes("tidak ada media")) {
    return "Media Pinterest tidak ditemukan. Pastikan kata kunci atau link valid.";
  }
  return "Media Pinterest gagal diambil. Pastikan kata kunci atau link masih aktif.";
}
