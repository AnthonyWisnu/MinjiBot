import { AppUserError } from "../../errors/appUserError";
import { dataPrivacyService } from "../../services/privacy/dataPrivacy.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const privacyCommands: CommandDefinition[] = [
  {
    name: "deletemydata",
    execute: handleDeleteMyData,
  },
  {
    name: "purgetenant",
    execute: handlePurgeTenant,
  },
];

async function handleDeleteMyData(context: CommandContext): Promise<void> {
  const isConfirmed = context.args[0]?.toLowerCase() === "confirm";
  const replyMessage = await dataPrivacyService.deleteMyData(context, isConfirmed);
  await context.reply(replyMessage);
}

async function handlePurgeTenant(context: CommandContext): Promise<void> {
  if (context.role !== "SUPER_OWNER") {
    throw new AppUserError("Command ini hanya dapat digunakan oleh Super Owner.");
  }

  const tenantCode = context.args[0];
  if (!tenantCode) {
    throw new AppUserError("Format command salah. Gunakan: .purgetenant <kode_tenant>");
  }

  const replyMessage = await dataPrivacyService.purgeTenant(tenantCode, context.senderUserJid);
  await context.reply(replyMessage);
}
