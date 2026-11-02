import { avatarService } from "../../services/media/avatar.service";
import { quoteCardService } from "../../services/media/quoteCard.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { isMediaCommandAllowed } from "../../utils/dmAccess";
import { normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

export const quoteCardCommands: CommandDefinition[] = [
  {
    name: "quote",
    aliases: ["q", "quotasi"],
    execute: handleQuote,
  },
  {
    name: "tweet",
    aliases: ["twit", "twitter"],
    execute: handleTweet,
  },
];

async function handleQuote(context: CommandContext): Promise<void> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply(
      "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
    );
    return;
  }

  const isSticker = context.args.some(
    (arg) => arg.toLowerCase() === "-s" || arg.toLowerCase() === "sticker",
  );

  // Filter out flag from arguments
  const filteredArgs = context.args.filter(
    (arg) => arg.toLowerCase() !== "-s" && arg.toLowerCase() !== "sticker",
  );
  const rawArgText = filteredArgs.join(" ").trim();

  let quoteText = "";
  let authorJid = "";

  if (context.quoted?.text && context.quoted.text.trim().length > 0) {
    quoteText = context.quoted.text.trim();
    authorJid = context.quoted.participantJid ?? context.chatJid;
  } else if (rawArgText.length > 0) {
    quoteText = rawArgText;
    authorJid = context.senderUserJid;
  } else {
    await context.reply(
      "Format command salah.\nBalas (reply) chat yang ingin dikutip, atau ketik: .quote <teks>\nTambahkan -s untuk mengirim sebagai stiker (contoh: .quote -s).",
    );
    return;
  }

  const cleanAuthorJid = normalizeUserJid(authorJid);
  const authorPhone = cleanAuthorJid.split("@")[0] ?? "Anonymous";
  const authorName = `@${authorPhone}`;

  // Fetch avatar buffer
  const avatarBuffer = await avatarService.fetchUserAvatar(
    context.socket,
    cleanAuthorJid,
    context.senderAltJids,
  );

  try {
    const cardBuffer = await quoteCardService.generateQuoteCard({
      text: quoteText,
      authorName,
      authorSub: "MinjiBot Official Quote",
      avatarBuffer,
    });

    if (isSticker) {
      const stickerBuffer = await quoteCardService.generateQuoteSticker(cardBuffer);
      await context.socket.sendMessage(
        context.chatJid,
        { sticker: stickerBuffer },
        { quoted: context.message },
      );
    } else {
      await context.socket.sendMessage(
        context.chatJid,
        {
          image: cardBuffer,
          caption: `✨ _Quote by ${authorName}_`,
          mentions: [cleanAuthorJid],
        },
        { quoted: context.message },
      );
    }
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat kartu quote."));
  }
}

async function handleTweet(context: CommandContext): Promise<void> {
  if (!(await isMediaCommandAllowed(context))) {
    await context.reply(
      "Fitur ini hanya tersedia di grup tenant aktif atau private chat pengguna tenant aktif.",
    );
    return;
  }

  // UXL-03: Tolak impersonasi via mention demi mencegah fitnah/hoax
  if (context.mentionedJids.length > 0) {
    await context.reply(
      "Demi mencegah fitnah dan impersonasi (anti-hoax), dilarang membuat tweet palsu atas nama orang lain via mention. Gunakan .tweet <teks> untuk akun sendiri, atau reply pesan orang lain dengan .tweet tanpa teks tambahan.",
    );
    return;
  }

  let targetJid = context.senderUserJid;
  let text = "";

  if (context.quoted?.text && context.quoted.text.trim().length > 0) {
    if (context.argsText.trim().length > 0) {
      await context.reply(
        "Saat me-reply pesan orang lain, dilarang mengubah isi teks pesan tersebut demi mencegah fitnah/hoax. Cukup ketik .tweet tanpa teks tambahan.",
      );
      return;
    }
    targetJid = normalizeUserJid(context.quoted.participantJid ?? context.chatJid);
    text = context.quoted.text.trim();
  } else {
    text = context.argsText.trim();
  }

  if (text.length === 0) {
    await context.reply(
      "Format command salah.\nGunakan: .tweet <teks>\nAtau reply pesan dengan: .tweet",
    );
    return;
  }

  const cleanTargetJid = normalizeUserJid(targetJid);
  const phone = cleanTargetJid.split("@")[0] ?? "user";
  const authorName = phone;
  const authorHandle = phone;

  const avatarBuffer = await avatarService.fetchUserAvatar(context.socket, cleanTargetJid);

  try {
    const tweetBuffer = await quoteCardService.generateTweetCard({
      text,
      authorName,
      authorHandle,
      avatarBuffer,
    });

    await context.socket.sendMessage(
      context.chatJid,
      {
        image: tweetBuffer,
        caption: `🐦 _Postingan 𝕏 dari @${phone}_`,
        mentions: [cleanTargetJid],
      },
      { quoted: context.message },
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal membuat tweet mockup."));
  }
}
