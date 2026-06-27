import { tenantOwnerTransferService } from "../../services/tenant/tenantOwnerTransfer.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const transferOwnerCommands: CommandDefinition[] = [
  {
    name: "transferowner",
    execute: handleTransferOwner,
  },
];

async function handleTransferOwner(context: CommandContext): Promise<void> {
  try {
    const result = await tenantOwnerTransferService.transferOwner(context);

    await context.reply(
      [
        "[ADMIN] Tenant owner berhasil dipindahkan.",
        `Owner lama: ${formatNullableText(result.oldOwnerJid)}`,
        `Owner baru: ${result.newOwnerJid}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "[ERROR] Target owner baru tidak valid."));
  }
}
