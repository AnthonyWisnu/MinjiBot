import type { TenantGroup } from "@prisma/client";

import { tenantOwnerSessionService } from "../../services/tenant/tenantOwnerSession.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatDateId, formatNullableText } from "../../utils/format";

export const tenantOwnerCommands: CommandDefinition[] = [
  {
    name: "mytenant",
    execute: handleMyTenant,
  },
  {
    name: "usetenant",
    execute: handleUseTenant,
  },
  {
    name: "currenttenant",
    execute: handleCurrentTenant,
  },
  {
    name: "cleartenant",
    execute: handleClearTenant,
  },
];

async function handleMyTenant(context: CommandContext): Promise<void> {
  if (!(await ensureTenantOwnerPrivate(context))) {
    return;
  }

  const tenants = await tenantOwnerSessionService.listOwnedTenants(context.senderJid);
  if (tenants.length === 0) {
    await context.reply("Kamu belum memiliki tenant.");
    return;
  }

  await context.reply(formatOwnedTenants(tenants));
}

async function handleUseTenant(context: CommandContext): Promise<void> {
  if (!(await ensureTenantOwnerPrivate(context))) {
    return;
  }

  const [selector] = context.args;
  if (!selector) {
    await context.reply("Format command salah.\nGunakan: .usetenant <nomor/kode>");
    return;
  }

  const tenantGroup = await tenantOwnerSessionService.selectTenant(context.senderJid, selector);
  await context.reply(
    `Tenant aktif dipilih: ${formatNullableText(tenantGroup.name)}.\nCommand pengaturan berikutnya akan berlaku untuk tenant ini.`,
  );
}

async function handleCurrentTenant(context: CommandContext): Promise<void> {
  if (!(await ensureTenantOwnerPrivate(context))) {
    return;
  }

  const currentTenant = await tenantOwnerSessionService.getCurrentTenant(context.senderJid);
  if (!currentTenant.tenantGroup) {
    await context.reply(
      currentTenant.expired
        ? "Session tenant kamu sudah expired. Gunakan .mytenant lalu .usetenant <nomor/kode>."
        : "Belum ada tenant aktif dipilih. Gunakan .mytenant lalu .usetenant <nomor/kode>.",
    );
    return;
  }

  await context.reply(formatCurrentTenant(currentTenant.tenantGroup));
}

async function handleClearTenant(context: CommandContext): Promise<void> {
  if (!(await ensureTenantOwnerPrivate(context))) {
    return;
  }

  await tenantOwnerSessionService.clearCurrentTenant(context.senderJid);
  await context.reply("Tenant aktif berhasil dibersihkan.");
}

async function ensureTenantOwnerPrivate(context: CommandContext): Promise<boolean> {
  if (context.isGroup) {
    await context.reply("Command ini hanya dapat digunakan di private chat.");
    return false;
  }

  if (context.role === "TENANT_OWNER" || context.role === "SUPER_OWNER") {
    return true;
  }

  await context.reply("Command ini hanya dapat digunakan oleh Tenant Owner.");
  return false;
}

function formatOwnedTenants(tenants: TenantGroup[]): string {
  const lines = ["[TENANT KAMU]", ""];

  tenants.forEach((tenant, index) => {
    lines.push(`${String(index + 1)}. ${formatNullableText(tenant.name)}`);
    lines.push(`   Kode: ${tenant.tenantCode}`);
    lines.push(`   Status: ${tenant.status.toLowerCase()}`);
    lines.push(`   Masa aktif sampai: ${formatDateId(tenant.expiresAt)}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function formatCurrentTenant(tenant: TenantGroup): string {
  return [
    "[TENANT AKTIF]",
    "",
    `Grup: ${formatNullableText(tenant.name)}`,
    `Kode: ${tenant.tenantCode}`,
    `Status: ${tenant.status.toLowerCase()}`,
    `Masa aktif sampai: ${formatDateId(tenant.expiresAt)}`,
  ].join("\n");
}
