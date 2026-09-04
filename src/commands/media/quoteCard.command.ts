import { quoteCardService } from "../../services/media/quoteCard.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { normalizeUserJid } from "../../utils/jid";

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
  const avatarBuffer = await fetchUserAvatar(context, cleanAuthorJid);

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
    const message = error instanceof Error ? error.message : "Gagal membuat kartu quote.";
    await context.reply(message);
  }
}

async function handleTweet(context: CommandContext): Promise<void> {
  let targetJid = context.senderUserJid;
  let text = "";

  if (context.mentionedJids.length > 0 && context.mentionedJids[0]) {
    targetJid = normalizeUserJid(context.mentionedJids[0]);
    // Filter out mention token from argsText
    text = context.argsText.replace(/@\d+/g, "").trim();
  } else if (context.quoted?.text && context.quoted.text.trim().length > 0) {
    targetJid = normalizeUserJid(context.quoted.participantJid ?? context.chatJid);
    text = context.argsText.trim().length > 0 ? context.argsText.trim() : context.quoted.text.trim();
  } else {
    text = context.argsText.trim();
  }

  if (text.length === 0) {
    await context.reply("Format command salah.\nGunakan: .tweet <teks>\nAtau: .tweet @user <teks>");
    return;
  }

  const cleanTargetJid = normalizeUserJid(targetJid);
  const phone = cleanTargetJid.split("@")[0] ?? "user";
  const authorName = phone;
  const authorHandle = phone;

  const avatarBuffer = await fetchUserAvatar(context, cleanTargetJid);

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
    const message = error instanceof Error ? error.message : "Gagal membuat tweet mockup.";
    await context.reply(message);
  }
}

async function fetchUserAvatar(context: CommandContext, userJid: string): Promise<Buffer | null> {
  const socket = context.socket;

  try {
    const url = await socket.profilePictureUrl(userJid, "image");
    if (url) {
      const res = await fetch(url);
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    }
  } catch {
    // ignore
  }

  return null;
}
