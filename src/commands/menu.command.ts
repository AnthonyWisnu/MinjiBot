import { menuService } from "../services/menu/menu.service";
import type { CommandContext, CommandDefinition } from "../types/command";

export const menuCommands: CommandDefinition[] = [
  {
    name: "menu",
    execute: handleMenu,
  },
  {
    name: "ownermenu",
    execute: handleOwnerMenu,
  },
  {
    name: "tenantmenu",
    execute: handleTenantMenu,
  },
  {
    name: "featuremenu",
    execute: handleFeatureMenu,
  },
  {
    name: "quotamenu",
    execute: handleQuotaMenu,
  },
  {
    name: "whoami",
    execute: handleWhoami,
  },
];

async function handleMenu(context: CommandContext): Promise<void> {
  await context.reply(await menuService.buildMenu(context));
}

async function handleOwnerMenu(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  await context.reply(menuService.buildOwnerMenu());
}

async function handleTenantMenu(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  await context.reply(menuService.buildTenantOwnerMenu());
}

async function handleFeatureMenu(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  await context.reply(menuService.buildFeatureMenu());
}

async function handleQuotaMenu(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  await context.reply(menuService.buildQuotaMenu());
}

async function handleWhoami(context: CommandContext): Promise<void> {
  await context.reply(
    [
      "[DEBUG AKUN]",
      "",
      `Chat JID: ${context.chatJid}`,
      `Sender JID: ${context.senderJid}`,
      `Role: ${context.role}`,
      `Grup: ${context.isGroup ? "ya" : "tidak"}`,
    ].join("\n"),
  );
}

async function ensureSuperOwner(context: CommandContext): Promise<boolean> {
  if (context.role === "SUPER_OWNER") {
    return true;
  }

  await context.reply("Command ini hanya dapat digunakan oleh Super Owner.");
  return false;
}
