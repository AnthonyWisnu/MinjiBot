import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { playerSessionService } from "../web/playerSession.service";
import { playAudioService } from "../media/playAudio.service";
import { interactiveMessageService } from "./interactiveMessage.service";

export interface OpenPlayerOptions {
  video: {
    videoId: string;
    url: string;
    title: string;
    channelTitle: string;
    durationSeconds: number;
    thumbnail: string;
  };
  header?: string;
  senderUserJid?: string;
  quoted?: WAMessage;
  sendInChatAudio?: boolean;
}

export interface OpenArcadeOptions {
  game?: "dino" | "block-blast" | "chess";
  senderUserJid?: string;
  quoted?: WAMessage;
}

export class WhatsAppWebViewService {
  getBaseUrl(): string {
    return env.WEB_BASE_URL.replace(/\/+$/, "");
  }

  /**
   * Membuka YouTube Web Player melalui interactive WebView message.
   * Dilengkapi pengiriman streaming audio MP3 langsung ke chat WhatsApp
   * sebagai in-chat playback seamless.
   */
  async openPlayer(
    socket: WASocket,
    chatJid: string,
    options: OpenPlayerOptions,
  ): Promise<{ sessionId: string; playerUrl: string }> {
    const { video, senderUserJid, quoted } = options;
    const baseUrl = this.getBaseUrl();
    const header = options.header || "YOUTUBE WEBVIEW // MINJIBOT";

    // 1. Buat sesi pemutar aman dengan UUID v4 opaque
    const session = playerSessionService.createSession({
      videoId: video.videoId,
      videoUrl: video.url,
      title: video.title,
      channelTitle: video.channelTitle,
      durationSeconds: video.durationSeconds,
      thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      chatJid,
      userJid: senderUserJid,
    });

    const playerUrl = `${baseUrl}/player/${session.sessionId}`;
    const minutes = Math.floor(video.durationSeconds / 60);
    const seconds = video.durationSeconds % 60;
    const durationFormatted = `${minutes}m ${seconds < 10 ? "0" : ""}${seconds}s`;

    // 2. Kirim interactive message dengan Webview CTA ke WhatsApp
    await interactiveMessageService.sendCtaUrlMessage(socket, chatJid, {
      header,
      body: [
        `Judul: ${video.title}`,
        `Channel: ${video.channelTitle}`,
        `Durasi: ${durationFormatted}`,
        "",
        "Tekan tombol di bawah untuk membuka Web Player di dalam WhatsApp dengan seekbar, lirik lagu, dan visualizer.",
      ].join("\n"),
      buttonText: "Buka Web Player",
      url: playerUrl,
      quoted,
    });

    // 3. Jika audio in-chat diaktifkan dan durasi wajar (<= 15 menit), kirim audio langsung
    const shouldSendAudio = options.sendInChatAudio !== false;
    if (shouldSendAudio && video.durationSeconds > 0 && video.durationSeconds <= 15 * 60) {
      let tempDir: string | undefined;
      try {
        const audioResult = await playAudioService.prepareMp3Audio(video.url);
        tempDir = audioResult.tempDir;
        await socket.sendMessage(
          chatJid,
          {
            audio: audioResult.buffer,
            mimetype: "audio/mpeg",
            ptt: false,
          },
          { quoted },
        );
      } catch (audioErr: unknown) {
        logger.warn(
          { audioErr, title: video.title },
          "Pengiriman audio in-chat WhatsApp gagal, pengguna tetap dapat memutar via WebView",
        );
      } finally {
        if (tempDir) {
          await playAudioService.cleanup(tempDir);
        }
      }
    }

    return { sessionId: session.sessionId, playerUrl };
  }

  /**
   * Membuka Arcade Hub atau Game spesifik (Dino, Block Blast, Chess) via WebView.
   */
  async openArcade(
    socket: WASocket,
    chatJid: string,
    options: OpenArcadeOptions,
  ): Promise<{ arcadeUrl: string }> {
    const { game, quoted } = options;
    const baseUrl = this.getBaseUrl();
    const targetPath = game ? `/arcade/${game}` : "/arcade";
    const queryParams = `?chat=${encodeURIComponent(chatJid)}&user=${encodeURIComponent(options.senderUserJid || "")}`;
    const arcadeUrl = `${baseUrl}${targetPath}${queryParams}`;

    const gameTitles: Record<string, string> = {
      dino: "Dino Runner",
      "block-blast": "Block Blast",
      chess: "Royal Chess (PvP)",
    };

    const title = game ? gameTitles[game] || "Arcade Game" : "MinjiBot Arcade Arena";
    const header = game ? `ARCADE WEBVIEW // ${title.toUpperCase()}` : "RETRO ARCADE HUB // MINJIBOT";
    const body = game
      ? `Mainkan ${title} langsung di dalam pengalaman WebView WhatsApp.`
      : [
          "Selamat datang di MinjiBot Retro Arcade Hub!",
          "",
          "Daftar Game Tersedia:",
          "- Dino Runner (Canvas Jump & Obstacles)",
          "- Snake Retro (Ular Klasik Neon)",
          "- Block Blast (8x8 Puzzle Grid)",
          "- Royal Chess (Validasi Aturan chess.js)",
          "",
          "Pilih game melalui tombol di bawah.",
        ].join("\n");

    await interactiveMessageService.sendCtaUrlMessage(socket, chatJid, {
      header,
      body,
      buttonText: game ? `Mainkan ${title}` : "Buka Arcade Zone",
      url: arcadeUrl,
      quoted,
    });

    return { arcadeUrl };
  }
}

export const whatsAppWebViewService = new WhatsAppWebViewService();
