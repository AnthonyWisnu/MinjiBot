import {
  CASINO_DEFAULT_BET,
  CASINO_MAX_BET,
  casinoPackService,
  type SuitChoice,
} from "../../services/game/casinoPack.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import { memberEconomyService } from "../../services/member/memberEconomy.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRupiah, minBigInt, parseBigIntAmountOrAll } from "../../utils/currency";
import { isBotUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

function tagOf(jid: string): string {
  return `@${jid.split("@")[0] ?? jid}`;
}

async function resolveSender(context: CommandContext): Promise<string> {
  return identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

async function ensureGroup(context: CommandContext): Promise<boolean> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Permainan ini hanya bisa dimainkan di grup aktif.");
    return false;
  }
  return true;
}

async function resolveBetArg(
  groupJid: string,
  userJid: string,
  rawBet: string | undefined,
): Promise<bigint | null> {
  if (!rawBet?.trim()) return CASINO_DEFAULT_BET;
  const parsed = parseBigIntAmountOrAll(rawBet);
  if (parsed === "all") {
    const prof = await memberEconomyService.findOrCreateProfile(groupJid, userJid);
    return minBigInt(prof.moneyBalance, CASINO_MAX_BET);
  }
  return parsed;
}

function parseSuitChoice(raw: string | undefined): SuitChoice | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "batu" || s === "rock" || s === "b") return "batu";
  if (s === "gunting" || s === "scissors" || s === "g") return "gunting";
  if (s === "kertas" || s === "paper" || s === "k") return "kertas";
  return null;
}

async function handleBlackjack(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const arg0 = (context.args[0] ?? "").trim().toLowerCase();

    if (arg0 === "hit" || arg0 === "stand" || arg0 === "double") {
      const res = await casinoPackService.actionBlackjack(context.chatJid, sender, arg0);
      const sent = await context.socket.sendMessage(
        context.chatJid,
        { text: res.text },
        { quoted: context.message },
      );
      if (sent?.key.id && !res.finished) {
        casinoPackService.setBlackjackMessageId(context.chatJid, sender, sent.key.id);
      }
      return;
    }

    const bet = await resolveBetArg(context.chatJid, sender, context.args[0]);
    if (bet === null) {
      await context.reply("Format salah.\nGunakan: *.blackjack <taruhan|all>*\nContoh: *.bj 5000000*");
      return;
    }

    const started = await casinoPackService.startBlackjack(context.chatJid, sender, bet);
    const sent = await context.socket.sendMessage(
      context.chatJid,
      { text: started.text },
      { quoted: context.message },
    );
    if (sent?.key.id && !started.finished) {
      casinoPackService.setBlackjackMessageId(context.chatJid, sender, sent.key.id);
    }
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses Blackjack."));
  }
}

async function handleHiLow(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const arg0 = (context.args[0] ?? "").trim().toLowerCase();

    if (arg0 === "tinggi" || arg0 === "high" || arg0 === "rendah" || arg0 === "low") {
      const guess = arg0 === "tinggi" || arg0 === "high" ? "tinggi" : "rendah";
      const text = await casinoPackService.resolveHiLow(context.chatJid, sender, guess);
      await context.reply(text);
      return;
    }

    const bet = await resolveBetArg(context.chatJid, sender, context.args[0]);
    if (bet === null) {
      await context.reply("Format salah.\nGunakan: *.hilow <taruhan|all>*");
      return;
    }

    const started = await casinoPackService.startHiLow(context.chatJid, sender, bet);
    const sent = await context.socket.sendMessage(
      context.chatJid,
      { text: started.text },
      { quoted: context.message },
    );
    if (sent?.key.id) {
      casinoPackService.setHiLowMessageId(context.chatJid, sender, sent.key.id);
    }
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses Hi-Low."));
  }
}

async function handleSuit(context: CommandContext): Promise<void> {
  try {
    // DM mode -> pilih batu/gunting/kertas untuk tantangan PvP
    if (!context.isGroup) {
      const choice = parseSuitChoice(context.args[0]);
      if (!choice) {
        await context.reply("Kirim pilihanmu di DM: *.suit batu*, *.suit gunting*, atau *.suit kertas*");
        return;
      }
      const candidates = [context.senderUserJid, context.senderJid, ...context.senderAltJids].filter(
        Boolean,
      );
      const res = await casinoPackService.submitSuitPvpChoice(candidates, choice);
      await context.reply(res.dmReply);
      if (res.groupBroadcast) {
        await context.socket.sendMessage(res.groupBroadcast.groupJid, {
          text: res.groupBroadcast.text,
          mentions: res.groupBroadcast.mentions,
        });
      }
      return;
    }

    if (!context.tenantGroup) {
      await context.reply("Game .suit hanya bisa dimainkan di grup aktif.");
      return;
    }

    const sender = await resolveSender(context);
    const rawTarget = context.mentionedJids[0] ?? context.quoted?.participantJid;

    if (rawTarget) {
      const opponent = await identityResolverService.resolveCanonicalUserJid(
        context.socket,
        context.chatJid,
        rawTarget,
      );
      if (isBotUserJid(context.socket, rawTarget, opponent)) {
        await context.reply(
          "Untuk suit melawan bot, langsung ketik *.suit batu*, *.suit gunting*, atau *.suit kertas* tanpa tag bot ya!",
        );
        return;
      }
      const nonTagArgs = context.args.filter((a) => !a.startsWith("@"));
      const bet = await resolveBetArg(context.chatJid, sender, nonTagArgs[0]);
      if (bet === null) {
        await context.reply("Nominal taruhan tidak valid. Contoh: *.suit @lawan 5000000*");
        return;
      }

      const ch = await casinoPackService.createSuitPvp(context.chatJid, sender, opponent, bet);
      await context.reply(
        [
          "*── [ TANTANGAN SUIT PVP ] ──*",
          `${tagOf(ch.challengerJid)} menantang ${tagOf(ch.opponentJid)}!`,
          `Taruhan : *${formatRupiah(ch.bet)}*`,
          "",
          "Kedua pemain silakan kirim DM rahasia ke bot: *.suit batu* / *.suit gunting* / *.suit kertas*!",
        ].join("\n"),
        { mentions: [ch.challengerJid, ch.opponentJid] },
      );
      return;
    }

    const choice = parseSuitChoice(context.args[0]);
    if (!choice) {
      await context.reply(
        [
          "*── [ CARA MAIN SUIT ] ──*",
          "• Lawan Bot : *.suit <batu|gunting|kertas> [taruhan]*",
          "• Lawan Teman: *.suit @lawan [taruhan]* (pilih rahasia via DM bot)",
        ].join("\n"),
      );
      return;
    }

    const bet = await resolveBetArg(context.chatJid, sender, context.args[1]);
    if (bet === null) {
      await context.reply("Nominal taruhan tidak valid. Contoh: *.suit batu 2000000*");
      return;
    }

    const out = await casinoPackService.playSuitVsBot(context.chatJid, sender, choice, bet);
    await context.reply(out);
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses game Suit."));
  }
}

async function handleDice(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    const bet = await resolveBetArg(context.chatJid, sender, context.args[0]);
    if (bet === null) {
      await context.reply("Format salah. Contoh: *.dadu 2000000* atau *.dadu all*");
      return;
    }
    await context.reply(await casinoPackService.playDice(context.chatJid, sender, bet));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses dadu."));
  }
}

async function handleCoinflip(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const pickRaw = (context.args[0] ?? "").trim().toLowerCase();
    const pick =
      pickRaw === "gambar" || pickRaw === "head" || pickRaw === "kepala"
        ? "gambar"
        : pickRaw === "angka" || pickRaw === "tail" || pickRaw === "ekor"
          ? "angka"
          : null;
    if (!pick) {
      await context.reply("Format salah.\nGunakan: *.koin <gambar|angka> [taruhan]*\nContoh: *.koin gambar 2000000*");
      return;
    }
    const sender = await resolveSender(context);
    const bet = await resolveBetArg(context.chatJid, sender, context.args[1]);
    if (bet === null) {
      await context.reply("Nominal taruhan tidak valid.");
      return;
    }
    await context.reply(await casinoPackService.playCoinflip(context.chatJid, sender, pick, bet));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses koin."));
  }
}

async function handleTebakDadu(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const guess = Number.parseInt(context.args[0] ?? "", 10);
    if (!Number.isInteger(guess)) {
      await context.reply("Format salah.\nGunakan: *.tebakdadu <1-6> [taruhan]*\nContoh: *.tebakdadu 6 1000000*");
      return;
    }
    const sender = await resolveSender(context);
    const bet = await resolveBetArg(context.chatJid, sender, context.args[1]);
    if (bet === null) {
      await context.reply("Nominal taruhan tidak valid.");
      return;
    }
    await context.reply(await casinoPackService.playGuessDie(context.chatJid, sender, guess, bet));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses tebak dadu."));
  }
}

async function handleRoulette(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const choice = context.args[0]?.trim() ?? "";
    if (!choice) {
      await context.reply(
        "Format salah.\nGunakan: *.roulette <merah|hitam|hijau|genap|ganjil|0-36> [taruhan]*\nContoh: *.roulette merah 5000000*",
      );
      return;
    }
    const sender = await resolveSender(context);
    const bet = await resolveBetArg(context.chatJid, sender, context.args[1]);
    if (bet === null) {
      await context.reply("Nominal taruhan tidak valid.");
      return;
    }
    await context.reply(await casinoPackService.playRoulette(context.chatJid, sender, choice, bet));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses roulette."));
  }
}

async function handleRussian(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    await context.reply(await casinoPackService.playRussianRoulette(context.chatJid, sender));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memproses Russian Roulette."));
  }
}

async function handleSpin(context: CommandContext): Promise<void> {
  if (!(await ensureGroup(context))) return;
  try {
    const sender = await resolveSender(context);
    await context.reply(await casinoPackService.playDailySpin(context.chatJid, sender));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal memutar roda keberuntungan."));
  }
}

export const casinoPackCommands: CommandDefinition[] = [
  { name: "blackjack", aliases: ["bj"], execute: handleBlackjack },
  { name: "suit", execute: handleSuit },
  { name: "dadu", execute: handleDice },
  { name: "koin", execute: handleCoinflip },
  { name: "roulette", execute: handleRoulette },
  { name: "tebakdadu", execute: handleTebakDadu },
  { name: "hilow", execute: handleHiLow },
  { name: "russian", execute: handleRussian },
  { name: "spin", aliases: ["wheel"], execute: handleSpin },
];
