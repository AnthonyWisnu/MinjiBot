import {
  customStickerCommandService,
  extractStickerFileSha256,
  MAX_STICKER_COMMANDS_PER_GROUP,
} from "../../services/group/customStickerCommand.service";
import { identityResolverService } from "../../services/identity/identityResolver.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatUserSafeError } from "../../utils/userSafeError";

async function canManageStickerCommands(context: CommandContext): Promise<boolean> {
  if (
    context.role === "SUPER_OWNER" ||
    context.role === "TENANT_OWNER" ||
    context.role === "TENANT_ADMIN"
  ) {
    return true;
  }
  return identityResolverService.isGroupAdmin(
    context.socket,
    context.chatJid,
    context.senderUserJid,
    context.senderAltJids,
  );
}

export function createCustomStickerCommands(
  isCommandRegistered: (cmdName: string) => boolean,
): CommandDefinition[] {
  return [
    {
      name: "setcmd",
      execute: async (context) => {
        if (!context.isGroup || !context.tenantGroup) {
          await context.reply("Perintah .setcmd hanya bisa digunakan di grup aktif.");
          return;
        }

        try {
          if (!(await canManageStickerCommands(context))) {
            await context.reply("Hanya Admin grup atau Tenant Owner yang bisa mengatur .setcmd.");
            return;
          }

          const stickerHash = extractStickerFileSha256(context.quoted?.message);
          if (!stickerHash) {
            await context.reply(
              "Reply stiker yang ingin dijadikan pintasan lalu ketik: *.setcmd <perintah>*\nContoh: *.setcmd .menu* atau *.setcmd .daily*",
            );
            return;
          }

          const createdBy = await identityResolverService.resolveCanonicalUserJid(
            context.socket,
            context.chatJid,
            context.senderUserJid,
            context.senderAltJids,
          );

          const saved = await customStickerCommandService.setCommand({
            groupJid: context.chatJid,
            stickerHash,
            rawCommandText: context.argsText,
            createdBy,
            isCommandRegistered,
          });

          await context.reply(
            [
              "*── [ STIKER COMMAND AKTIF ] ──*",
              `Perintah : *${saved.commandText}*`,
              `ID Hash  : ${saved.stickerHash.slice(0, 12)}...`,
              "",
              "Sekarang setiap kali member mengirim stiker itu di grup ini, bot otomatis menjalankan perintah tersebut!",
            ].join("\n"),
          );
        } catch (error: unknown) {
          await context.reply(formatUserSafeError(error, "Gagal menyimpan stiker command."));
        }
      },
    },
    {
      name: "delcmd",
      execute: async (context) => {
        if (!context.isGroup || !context.tenantGroup) {
          await context.reply("Perintah .delcmd hanya bisa digunakan di grup aktif.");
          return;
        }

        try {
          if (!(await canManageStickerCommands(context))) {
            await context.reply("Hanya Admin grup atau Tenant Owner yang bisa menghapus .setcmd.");
            return;
          }

          const stickerHash = extractStickerFileSha256(context.quoted?.message);
          if (!stickerHash) {
            await context.reply("Reply stiker yang ingin dihapus pintasannya lalu ketik *.delcmd*.");
            return;
          }

          const deleted = await customStickerCommandService.deleteCommand(
            context.chatJid,
            stickerHash,
          );

          if (!deleted) {
            await context.reply("Stiker tersebut tidak terdaftar sebagai stiker command di grup ini.");
            return;
          }

          await context.reply("Pintasan stiker command berhasil dihapus.");
        } catch (error: unknown) {
          await context.reply(formatUserSafeError(error, "Gagal menghapus stiker command."));
        }
      },
    },
    {
      name: "listcmd",
      execute: async (context) => {
        if (!context.isGroup || !context.tenantGroup) {
          await context.reply("Perintah .listcmd hanya bisa digunakan di grup aktif.");
          return;
        }

        try {
          const rows = await customStickerCommandService.listCommands(context.chatJid);
          if (rows.length === 0) {
            await context.reply(
              "Belum ada stiker command di grup ini.\nAdmin bisa menambahkan dengan reply stiker lalu ketik *.setcmd .menu*.",
            );
            return;
          }

          const lines = rows.map(
            (row, idx) =>
              `${String(idx + 1)}. *${row.commandText}* (${row.stickerHash.slice(0, 10)}...)`,
          );

          await context.reply(
            [
              "*── [ DAFTAR STIKER CMD ] ──*",
              `Slot : ${String(rows.length)} / ${String(MAX_STICKER_COMMANDS_PER_GROUP)}`,
              "",
              ...lines,
            ].join("\n"),
          );
        } catch (error: unknown) {
          await context.reply(formatUserSafeError(error, "Gagal membaca daftar stiker command."));
        }
      },
    },
  ];
}
