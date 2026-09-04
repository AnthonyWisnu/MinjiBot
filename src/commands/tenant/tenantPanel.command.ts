import { tenantPanelService } from "../../services/tenant/tenantPanel.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const tenantPanelCommands: CommandDefinition[] = [
  {
    name: "panel",
    aliases: ["tenantstatus", "infosewa"],
    execute: handlePanel,
  },
];

async function handlePanel(context: CommandContext): Promise<void> {
  try {
    const result = await tenantPanelService.renderPanel(context);
    await context.reply(result.message, { mentions: result.mentions });
  } catch (error: unknown) {
    await context.reply(formatPanelError(error));
  }
}

function formatPanelError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("[")) {
    return error.message;
  }
  return "[ERROR] Terjadi kesalahan saat memuat dashboard tenant.";
}
