import type { TenantAdmin, TenantGroup } from "@prisma/client";

import { tenantAdminService } from "../../services/tenant/tenantAdmin.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const tenantAdminCommands: CommandDefinition[] = [
  {
    name: "addtenantadmin",
    execute: handleAddTenantAdmin,
  },
  {
    name: "removetenantadmin",
    execute: handleRemoveTenantAdmin,
  },
  {
    name: "listtenantadmin",
    execute: handleListTenantAdmin,
  },
];

async function handleAddTenantAdmin(context: CommandContext): Promise<void> {
  try {
    const result = await tenantAdminService.addTenantAdmin(context);

    await context.reply(
      [
        "[ADMIN] Tenant admin berhasil ditambahkan.",
        `Grup: ${formatNullableText(result.tenantGroup.name)}`,
        `Admin: ${result.adminJid}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatTenantAdminError(error));
  }
}

async function handleRemoveTenantAdmin(context: CommandContext): Promise<void> {
  try {
    const result = await tenantAdminService.removeTenantAdmin(context);
    if (!result) {
      await context.reply("[INFO] User tersebut bukan tenant admin.");
      return;
    }

    await context.reply(
      [
        "[ADMIN] Tenant admin berhasil dihapus.",
        `Grup: ${formatNullableText(result.tenantGroup.name)}`,
        `Admin: ${result.adminJid}`,
      ].join("\n"),
    );
  } catch (error: unknown) {
    await context.reply(formatTenantAdminError(error));
  }
}

async function handleListTenantAdmin(context: CommandContext): Promise<void> {
  try {
    const result = await tenantAdminService.listTenantAdmins(context);
    if (result.admins.length === 0) {
      await context.reply("[INFO] Belum ada tenant admin.");
      return;
    }

    await context.reply(formatTenantAdminList(result.tenantGroup, result.admins));
  } catch (error: unknown) {
    await context.reply(formatTenantAdminError(error));
  }
}

function formatTenantAdminList(tenantGroup: TenantGroup, admins: TenantAdmin[]): string {
  const lines = [
    "[DAFTAR TENANT ADMIN]",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    "",
  ];

  admins.forEach((admin, index) => {
    lines.push(`${String(index + 1)}. ${admin.userJid}`);
  });

  return lines.join("\n");
}

function formatTenantAdminError(error: unknown): string {
  return formatUserSafeError(error, "[ERROR] Command tenant admin gagal diproses.");
}
