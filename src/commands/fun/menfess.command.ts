import { MENFESS_COOLDOWN_MS, menfessService } from "../../services/fun/menfess.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatRemainingDuration } from "../../utils/currency";
import { extractContactCandidateJids, type ParticipantOrContactLike } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

function parseMenfessArgs(args: readonly string[]): {
  tenantCode: string;
  targetPhoneDigits: string | null;
  messageBody: string;
} | null {
  const tenantCode = args[0]?.trim();
  if (!tenantCode) {
    return null;
  }

  const second = args[1]?.trim() ?? "";
  const targetMatch = /^@(\d{8,16})$/.exec(second);
  if (targetMatch?.[1] && args.length >= 3) {
    return {
      tenantCode,
      targetPhoneDigits: targetMatch[1],
      messageBody: args.slice(2).join(" ").trim(),
    };
  }

  return {
    tenantCode,
    targetPhoneDigits: null,
    messageBody: args.slice(1).join(" ").trim(),
  };
}

async function handleMenfess(context: CommandContext): Promise<void> {
  if (context.isGroup) {
    const code = context.tenantGroup?.tenantCode ?? "<KODE_GRUP>";
    await context.reply(
      [
        "*── [ MENFESS ANONIM GRUP ] ──*",
        "Demi menjaga kerahasiaan pengirim, kirim menfess lewat *Private Chat (DM)* ke bot ya!",
        "",
        "*Format di DM Bot:*",
        `• *.menfess ${code} <pesan>*`,
        `• *.menfess ${code} @628xxx <pesan>* (opsional tag target)`,
        "",
        `Kode Grup ini: *${code}*`,
        `_Identitas pengirim 100% dirahasiakan. Cooldown ${formatRemainingDuration(MENFESS_COOLDOWN_MS)} & anti-link aktif._`,
      ].join("\n"),
    );
    return;
  }

  try {
    const parsed = parseMenfessArgs(context.args);
    if (!parsed?.messageBody) {
      await context.reply(
        [
          "*── [ CARA KIRIM MENFESS ] ──*",
          "Format: *.menfess <kodeGrup> <pesan>*",
          "Tag target: *.menfess <kodeGrup> @628xxx <pesan>*",
          "",
          "_Cek kode grup dengan mengetik .menfess di dalam grup tujuan._",
        ].join("\n"),
      );
      return;
    }

    const senderCandidateJids = [
      context.senderUserJid,
      context.senderJid,
      ...context.senderAltJids,
    ].filter(Boolean);

    const plan = await menfessService.prepareGroupMenfess({
      senderCandidateJids,
      isSuperOwner: context.role === "SUPER_OWNER",
      tenantCode: parsed.tenantCode,
      rawMessage: parsed.messageBody,
      targetPhoneDigits: parsed.targetPhoneDigits,
      resolveGroupParticipants: async (groupJid) => {
        const meta = await identityResolverService.getGroupMetadata(context.socket, groupJid);
        if (!meta?.participants) {
          return [];
        }
        return meta.participants.flatMap((p) =>
          extractContactCandidateJids(p as ParticipantOrContactLike),
        );
      },
    });

    await context.socket.sendMessage(plan.tenantGroup.groupJid, {
      text: plan.formattedGroupCard,
      mentions: plan.mentions.length > 0 ? plan.mentions : undefined,
    });

    menfessService.recordSent(context.senderUserJid);

    await context.reply(
      `Menfess rahasiamu berhasil dikirim ke grup *${plan.tenantGroup.name ?? plan.tenantGroup.tenantCode}*! Identitasmu tetap aman.`,
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Gagal mengirim menfess anonim."));
  }
}

export const menfessCommands: CommandDefinition[] = [
  {
    name: "menfess",
    aliases: ["confess"],
    execute: handleMenfess,
  },
];
