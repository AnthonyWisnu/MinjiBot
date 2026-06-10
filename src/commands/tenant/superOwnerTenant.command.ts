import type { TenantGroup, TenantOwnerQuota } from "@prisma/client";

import { superOwnerTenantService } from "../../services/tenant/superOwnerTenant.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatDateId, formatNullableText } from "../../utils/format";
import { normalizeUserJid } from "../../utils/jid";

export const superOwnerTenantCommands: CommandDefinition[] = [
  {
    name: "pendinggroup",
    execute: handlePendingGroup,
  },
  {
    name: "activatetenant",
    execute: handleActivateTenant,
  },
  {
    name: "listtenant",
    execute: handleListTenant,
  },
  {
    name: "tenantinfo",
    execute: handleTenantInfo,
  },
  {
    name: "extendtenant",
    execute: handleExtendTenant,
  },
  {
    name: "settenantexpire",
    execute: handleSetTenantExpire,
  },
  {
    name: "blocktenant",
    execute: handleBlockTenant,
  },
  {
    name: "unblocktenant",
    execute: handleUnblockTenant,
  },
  {
    name: "removetenant",
    execute: handleRemoveTenant,
  },
];

async function handlePendingGroup(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const pendingGroups = await superOwnerTenantService.listPendingGroups();
  if (pendingGroups.length === 0) {
    await context.reply("Tidak ada grup yang menunggu persetujuan.");
    return;
  }

  await context.reply(formatPendingGroups(pendingGroups));
}

async function handleActivateTenant(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  if (context.isGroup) {
    await context.reply("Command aktivasi tenant hanya dapat digunakan di private chat.");
    return;
  }

  const [selector, ownerNumber, durationText, quotaText] = context.args;
  if (!selector || !ownerNumber || !durationText || !quotaText) {
    await context.reply(
      "Format command salah.\nGunakan: .activatetenant <nomorList/kode> <nomorOwner> <durasi> <quota>",
    );
    return;
  }

  const initialQuota = parseNonNegativeInteger(quotaText, "Kuota awal");
  const ownerJid = normalizeUserJid(ownerNumber);
  const result = await superOwnerTenantService.activateTenant({
    selector,
    ownerJid,
    durationText,
    initialQuota,
    actorJid: context.senderUserJid,
  });

  await context.reply(formatActivatedTenant(result.tenantGroup, result.ownerQuota));
}

async function handleListTenant(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const tenants = await superOwnerTenantService.listTenants();
  if (tenants.length === 0) {
    await context.reply("Belum ada tenant terdaftar.");
    return;
  }

  await context.reply(formatTenantList(tenants));
}

async function handleTenantInfo(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [tenantCode] = context.args;
  if (!tenantCode) {
    await context.reply("Format command salah.\nGunakan: .tenantinfo <kode>");
    return;
  }

  const result = await superOwnerTenantService.getTenantInfo(tenantCode);
  await context.reply(formatTenantInfo(result.tenantGroup, result.ownerQuota));
}

async function handleExtendTenant(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [tenantCode, durationText] = context.args;
  if (!tenantCode || !durationText) {
    await context.reply("Format command salah.\nGunakan: .extendtenant <kode> <durasi>");
    return;
  }

  const tenantGroup = await superOwnerTenantService.extendTenant(
    tenantCode,
    durationText,
    context.senderUserJid,
  );

  await context.reply(
    `Tenant berhasil diperpanjang.\n\nGrup: ${formatNullableText(tenantGroup.name)}\nKode: ${tenantGroup.tenantCode}\nMasa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
  );
}

async function handleSetTenantExpire(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [tenantCode, dateText] = context.args;
  if (!tenantCode || !dateText) {
    await context.reply("Format command salah.\nGunakan: .settenantexpire <kode> <YYYY-MM-DD>");
    return;
  }

  const tenantGroup = await superOwnerTenantService.setTenantExpire(
    tenantCode,
    dateText,
    context.senderUserJid,
  );

  await context.reply(
    `Masa aktif tenant berhasil diatur.\n\nGrup: ${formatNullableText(tenantGroup.name)}\nKode: ${tenantGroup.tenantCode}\nMasa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
  );
}

async function handleBlockTenant(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const tenantGroup = await updateBlockedTenantFromCommand(context, true);
  if (!tenantGroup) {
    return;
  }

  await context.reply(
    `Tenant berhasil diblokir.\n\nGrup: ${formatNullableText(tenantGroup.name)}\nKode: ${tenantGroup.tenantCode}`,
  );
}

async function handleUnblockTenant(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const tenantGroup = await updateBlockedTenantFromCommand(context, false);
  if (!tenantGroup) {
    return;
  }

  await context.reply(
    `Tenant berhasil dibuka blokirnya.\n\nGrup: ${formatNullableText(tenantGroup.name)}\nKode: ${tenantGroup.tenantCode}`,
  );
}

async function handleRemoveTenant(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [tenantCode] = context.args;
  if (!tenantCode) {
    await context.reply("Format command salah.\nGunakan: .removetenant <kode>");
    return;
  }

  const tenantGroup = await superOwnerTenantService.removeTenant(tenantCode, context.senderUserJid);
  await context.reply(
    `Tenant berhasil dihapus dari manajemen.\n\nGrup: ${formatNullableText(tenantGroup.name)}\nKode: ${tenantGroup.tenantCode}`,
  );
}

async function updateBlockedTenantFromCommand(
  context: CommandContext,
  blocked: boolean,
): Promise<TenantGroup | null> {
  const [tenantCode] = context.args;
  if (!tenantCode) {
    await context.reply(
      blocked
        ? "Format command salah.\nGunakan: .blocktenant <kode>"
        : "Format command salah.\nGunakan: .unblocktenant <kode>",
    );
    return null;
  }

  return blocked
    ? superOwnerTenantService.blockTenant(tenantCode, context.senderUserJid)
    : superOwnerTenantService.unblockTenant(tenantCode, context.senderUserJid);
}

async function ensureSuperOwner(context: CommandContext): Promise<boolean> {
  if (context.role === "SUPER_OWNER") {
    return true;
  }

  await context.reply("Command ini hanya dapat digunakan oleh Super Owner.");
  return false;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} harus berupa angka nol atau lebih.`);
  }

  return parsed;
}

function formatPendingGroups(groups: TenantGroup[]): string {
  const lines = ["[GRUP MENUNGGU PERSETUJUAN]", ""];

  groups.forEach((group, index) => {
    lines.push(`${String(index + 1)}. ${formatNullableText(group.name)}`);
    lines.push(`   Kode: ${group.tenantCode}`);
    lines.push("   Status: pending");
    lines.push("");
  });

  return lines.join("\n").trim();
}

function formatTenantList(groups: TenantGroup[]): string {
  const lines = ["[DAFTAR TENANT]", ""];

  groups.forEach((group, index) => {
    lines.push(`${String(index + 1)}. ${formatNullableText(group.name)}`);
    lines.push(`   Kode: ${group.tenantCode}`);
    lines.push(`   Status: ${group.status.toLowerCase()}`);
    lines.push(`   Owner: ${formatNullableText(group.ownerJid)}`);
    lines.push(`   Masa aktif sampai: ${formatDateId(group.expiresAt)}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function formatActivatedTenant(tenantGroup: TenantGroup, ownerQuota: TenantOwnerQuota): string {
  return [
    "Tenant berhasil diaktifkan.",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Tenant Owner: ${formatNullableText(tenantGroup.ownerJid)}`,
    `Masa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
    `Kuota fitur berat owner: ${String(ownerQuota.remainingQuota)}`,
  ].join("\n");
}

function formatTenantInfo(tenantGroup: TenantGroup, ownerQuota: TenantOwnerQuota | null): string {
  return [
    "[INFO TENANT]",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Status: ${tenantGroup.status.toLowerCase()}`,
    `Diblokir: ${tenantGroup.isBlocked ? "ya" : "tidak"}`,
    `Tenant Owner: ${formatNullableText(tenantGroup.ownerJid)}`,
    `Masa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
    `Kuota tersisa owner: ${ownerQuota ? String(ownerQuota.remainingQuota) : "-"}`,
    `Kuota direservasi owner: ${ownerQuota ? String(ownerQuota.reservedQuota) : "-"}`,
  ].join("\n");
}
