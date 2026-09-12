import type { CommandContext, CommandDefinition } from "../../types/command";
import { interactiveMessageService } from "../../services/whatsapp/interactiveMessage.service";
import { youtubeSearchService } from "../../services/media/youtubeSearch.service";
import { playerSessionService } from "../../services/web/playerSession.service";
import { arcadeRewardService } from "../../services/game/arcadeReward.service";
import { webCardGeneratorService } from "../../services/web/webCardGenerator.service";
import { playAudioService } from "../../services/media/playAudio.service";
import { logger } from "../../config/logger";

export const webSuiteCommands: CommandDefinition[] = [
  {
    name: "spotify",
    aliases: ["ythtml", "ytweb", "playweb", "ytplayer"],
    execute: handleSpotify,
  },
  {
    name: "arcade",
    aliases: ["gamehub", "minigames"],
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

  if (!query) {
    // Tanpa parameter: sajikan katalog pencarian gaya Spotify
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

  await context.reply(`Mencari trek untuk '${query}'...`);
  try {
    const results = await youtubeSearchService.searchVideos(query, 1);
    const video = results[0];

    if (!video) {
      await context.reply(`Lagu atau video '${query}' tidak ditemukan di YouTube.`);
      return;
    }

    // Buat sesi pemutar audio/video
    const session = playerSessionService.createSession({
      videoId: video.videoId,
      videoUrl: video.url,
      title: video.title,
      channelTitle: video.channelTitle,
      durationSeconds: video.durationSeconds,
      thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      chatJid: context.chatJid,
      userJid: context.senderUserJid,
    });

    const playerUrl = `${baseUrl}/player/${session.sessionId}`;

    await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
      header: "SPOTIFY STREAM DECK // MINJIBOT",
      body: [
        `Judul: ${video.title}`,
        `Channel: ${video.channelTitle}`,
        `Durasi: ${Math.floor(video.durationSeconds / 60)}m ${video.durationSeconds % 60}s`,
        "",
        "Gunakan tombol di bawah untuk membuka pemutar web dengan seekbar, lirik lagu, dan visualizer.",
      ].join("\n"),
      buttonText: "Buka Web Player",
      url: playerUrl,
      quoted: context.message,
    });

    // Kirim stream audio langsung ke WhatsApp agar lagu bisa di-play langsung tanpa browser
    if (video.durationSeconds > 0 && video.durationSeconds <= 15 * 60) {
      let tempDir: string | undefined;
      try {
        const audioResult = await playAudioService.prepareMp3Audio(video.url);
        tempDir = audioResult.tempDir;
        await context.socket.sendMessage(
          context.chatJid,
          {
            audio: audioResult.buffer,
            mimetype: "audio/mpeg",
            ptt: false,
            fileName: `${video.title}.mp3`,
            contextInfo: {
              externalAdReply: {
                title: video.title,
                body: `${video.channelTitle} • Spotify Music`,
                mediaType: 1,
                thumbnailUrl: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
                sourceUrl: playerUrl,
                renderLargerThumbnail: true,
                showAdAttribution: true,
              },
            },
          },
          { quoted: context.message },
        );
      } catch (audioErr: unknown) {
        logger.warn(
          { audioErr, title: video.title },
          "Pengiriman audio in-chat WhatsApp gagal, pengguna tetap dapat membuka tautan web player",
        );
      } finally {
        if (tempDir) {
          await playAudioService.cleanup(tempDir);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Gagal memproses lagu";
    await context.reply(`Terjadi kesalahan: ${msg}`);
  }
}

async function handleArcade(context: CommandContext): Promise<void> {
  const baseUrl = interactiveMessageService.getBaseUrl();
  const url = `${baseUrl}/arcade?chat=${encodeURIComponent(context.chatJid)}&user=${encodeURIComponent(context.senderUserJid)}`;

  let cardImage: Buffer | undefined;
  try {
    cardImage = await webCardGeneratorService.generateArcadeCard();
  } catch {
    // ignore
  }

  await interactiveMessageService.sendCtaUrlMessage(context.socket, context.chatJid, {
    header: "RETRO ARCADE HUB // MINJIBOT",
    body: [
      "Selamat datang di Retro Arcade Hub MinjiBot!",
      "",
      "Daftar Game Tersedia:",
      "1. Dino Runner (Lompat & Merunduk)",
      "2. Snake Retro (Ular Klasik Neon)",
      "3. Block Blast (Puzzle Balok 8x8)",
      "4. 2048 Puzzle (Geser & Gabung Angka)",
      "5. Flappy Minji (Mengepak Lewati Pilar)",
      "",
      "Kumpulkan skor tertinggi dan dapatkan token reward untuk saldo Points & XP Anda.",
    ].join("\n"),
    buttonText: "Buka Arcade Zone",
    url,
    cardImage,
    quoted: context.message,
  });
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
