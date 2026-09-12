import type { CommandContext, CommandDefinition } from "../../types/command";
import { interactiveMessageService } from "../../services/whatsapp/interactiveMessage.service";
import { whatsAppWebViewService } from "../../services/whatsapp/whatsAppWebView.service";
import { youtubeSearchService } from "../../services/media/youtubeSearch.service";
import { arcadeRewardService } from "../../services/game/arcadeReward.service";
import { webCardGeneratorService } from "../../services/web/webCardGenerator.service";
import { logger } from "../../config/logger";

export const webSuiteCommands: CommandDefinition[] = [
  {
    name: "spotify",
    aliases: ["ythtml", "ytweb", "playweb", "ytplayer"],
    execute: handleSpotify,
  },
  {
    name: "arcade",
    aliases: ["gamehub", "minigames", "retro"],
    execute: handleArcade,
  },
  {
    name: "catur",
    aliases: ["chess", "danscatur"],
    execute: handleCatur,
  },
  {
    name: "soundboard",
    aliases: ["sb", "memesound"],
    execute: handleSoundboard,
  },
  {
    name: "spin",
    aliases: ["wheel", "luckydraw"],
    execute: handleSpin,
  },
  {
    name: "topweb",
    aliases: ["leaderboardweb", "halloffame"],
    execute: handleTopWeb,
  },
  {
    name: "claimreward",
    aliases: ["claimtoken", "klaim"],
    execute: handleClaim,
  },
];

async function handleSpotify(context: CommandContext): Promise<void> {
  const query = context.argsText.trim();
  const baseUrl = interactiveMessageService.getBaseUrl();
  const isSpotify = context.commandName.toLowerCase() === "spotify";

  if (!query) {
    if (isSpotify) {
      const url = `${baseUrl}/player/search`;
      await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
        header: "SPOTIFY SEARCH CATALOG // MINJIBOT",
        body: [
          "Akses antarmuka katalog musik Spotify Dark untuk mencari lagu dan streaming langsung di pemutar web.",
          "",
          "Gunakan: .spotify <judul lagu/link>",
        ].join("\n"),
        buttonText: "Buka Spotify Catalog",
        url,
        quoted: context.message,
      });
      return;
    }

    const url = `${baseUrl}/arcade`;
    await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
      header: "YOUTUBE WEBVIEW // MINJIBOT",
      body: [
        "Akses antarmuka WebView interaktif untuk memutar video atau audio YouTube langsung di WhatsApp.",
        "",
        "Gunakan: .ythtml <judul lagu/link>",
        "Contoh: .ythtml Alan Walker Faded",
      ].join("\n"),
      buttonText: "Buka Web Suite",
      url,
      quoted: context.message,
    });
    return;
  }

  await context.reply(`Mencari trek untuk '${query}'...`);
  try {
    const results = await youtubeSearchService.searchVideos(query, 1);
    const video = results[0];

    if (!video) {
      await context.reply(`Lagu atau video '${query}' tidak ditemukan di YouTube.`);
      return;
    }

    const header = isSpotify ? "SPOTIFY STREAM DECK // MINJIBOT" : "YOUTUBE WEBVIEW // MINJIBOT";

    await whatsAppWebViewService.openPlayer(context.socket, context.chatJid, {
      video: {
        videoId: video.videoId,
        url: video.url,
        title: video.title,
        channelTitle: video.channelTitle,
        durationSeconds: video.durationSeconds,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      },
      header,
      senderUserJid: context.senderUserJid,
      quoted: context.message,
      sendInChatAudio: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Gagal memproses lagu";
    logger.error({ err, query }, "Gagal handleSpotify/ythtml");
    await context.reply(`Terjadi kesalahan: ${msg}`);
  }
}

async function handleArcade(context: CommandContext): Promise<void> {
  const sub = (context.args[0] || "").toLowerCase().trim();
  let selectedGame: "dino" | "block-blast" | "chess" | undefined;

  if (sub === "dino") selectedGame = "dino";
  else if (sub === "block" || sub === "blockblast" || sub === "block-blast") selectedGame = "block-blast";
  else if (sub === "chess" || sub === "catur") selectedGame = "chess";

  try {
    await whatsAppWebViewService.openArcade(context.socket, context.chatJid, {
      game: selectedGame,
      senderUserJid: context.senderUserJid,
      quoted: context.message,
    });
  } catch (err: unknown) {
    logger.error({ err, sub }, "Gagal handleArcade");
    await context.reply("Gagal membuka MinjiBot Arcade.");
  }
}

async function handleCatur(context: CommandContext): Promise<void> {
  const baseUrl = interactiveMessageService.getBaseUrl();
  const url = `${baseUrl}/catur?chat=${encodeURIComponent(context.chatJid)}&user=${encodeURIComponent(context.senderUserJid)}`;

  let cardImage: Buffer | undefined;
  try {
    cardImage = await webCardGeneratorService.generateChessCard();
  } catch {
    // ignore
  }

  await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
    header: "DANS CATUR // STRATEGY ARENA",
    body: [
      "Papan catur interaktif dengan aturan resmi legal FIDE penuh.",
      "",
      "Mode Permainan:",
      "• Lawan MinjiBot AI (Minimax Engine, 3 tingkat kesulitan)",
      "• Duel 2 Pemain (Pass & Play)",
      "",
      "Menangkan pertandingan untuk mengklaim token reward +120 Points dan +250 XP.",
    ].join("\n"),
    buttonText: "Buka Dans Catur",
    url,
    cardImage,
    quoted: context.message,
  });
}

async function handleSoundboard(context: CommandContext): Promise<void> {
  const baseUrl = interactiveMessageService.getBaseUrl();
  const url = `${baseUrl}/soundboard?chat=${encodeURIComponent(context.chatJid)}`;

  let cardImage: Buffer | undefined;
  try {
    cardImage = await webCardGeneratorService.generateSoundboardCard();
  } catch {
    // ignore
  }

  await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
    header: "MEME SOUNDBOARD // VN DISPATCHER",
    body: [
      "Koleksi 11 efek suara meme viral & gaming siap pakai:",
      "Vine Boom, Airhorn, Ba-Dum-Tss, Bruh, Taco Bell, dsb.",
      "",
      "Putar preview instan di browser dan tekan tombol 'KIRIM VN' untuk mengirimkan audio langsung sebagai Voice Note (PTT) ke obrolan grup ini.",
    ].join("\n"),
    buttonText: "Buka Soundboard",
    url,
    cardImage,
    quoted: context.message,
  });
}

async function handleSpin(context: CommandContext): Promise<void> {
  const baseUrl = interactiveMessageService.getBaseUrl();
  const url = `${baseUrl}/community/spin?group=${encodeURIComponent(context.chatJid)}&user=${encodeURIComponent(context.senderUserJid)}`;

  await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
    header: "LUCKY SPIN WHEEL // COMMUNITY",
    body: [
      "Uji keberuntungan Anda di Roda Keberuntungan MinjiBot!",
      "",
      "Hadiah Tersedia:",
      "• 50, 150, 300 Points Saldo",
      "• 100, 200, 250 XP Leveling",
      "• GRAND JACKPOT 500 PTS & XP",
      "",
      "Putar roda dan klaim hadiah instan ke akun Anda.",
    ].join("\n"),
    buttonText: "Putar Roda Hoki",
    url,
    quoted: context.message,
  });
}

async function handleTopWeb(context: CommandContext): Promise<void> {
  const baseUrl = interactiveMessageService.getBaseUrl();
  const url = `${baseUrl}/community/leaderboard?group=${encodeURIComponent(context.chatJid)}&user=${encodeURIComponent(context.senderUserJid)}`;

  await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
    header: "HALL OF FAME LEADERBOARD // MINJIBOT",
    body: [
      "Lihat posisi peringkat anggota grup teratas dalam tampilan visual mewah.",
      "",
      "Kategori:",
      "• Top XP & Level (Podium Emas, Perak, Perunggu)",
      "• Top Points Balance Ekonomi",
    ].join("\n"),
    buttonText: "Lihat Peringkat",
    url,
    quoted: context.message,
  });
}

async function handleClaim(context: CommandContext): Promise<void> {
  const token = context.argsText.trim();
  if (!token) {
    await context.reply([
      "Format command salah.",
      "Gunakan: .claimreward <token-reward>",
      "Contoh: .claimreward ARCADE-DINO-240-ABC123",
      "",
      "Dapatkan token reward dari bermain di .arcade, .catur, atau memutar .spin.",
    ].join("\n"));
    return;
  }

  const result = await arcadeRewardService.claimToken(
    token,
    context.chatJid,
    context.senderUserJid,
  );

  if (!result.success) {
    await context.reply(`Gagal mengklaim token: ${result.message}`);
    return;
  }

  await context.reply([
    "*KLAIM TOKEN BERHASIL*",
    "",
    result.message,
    `Game: ${result.game || "Arcade"}`,
    `Points: +${result.pointsAwarded}`,
    `XP: +${result.xpAwarded}`,
  ].join("\n"));
}
