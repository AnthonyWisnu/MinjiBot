import type { TenantGroup } from "@prisma/client";

import {
  superOwnerTenantService,
  type TenantListFilter,
} from "../../services/tenant/superOwnerTenant.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatDateId, formatNullableText } from "../../utils/format";
import { normalizeUserJid } from "../../utils/jid";
import { formatUserSafeError } from "../../utils/userSafeError";

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

  const [selector, ownerNumber, durationText] = context.args;
  if (!selector || !ownerNumber || !durationText) {
    await context.reply(
      "Format command salah.\nGunakan: .activatetenant <nomorList/kode> <nomorOwner> <durasi>",
    );
    return;
  }

  const ownerJid = normalizeUserJid(ownerNumber);
  const result = await superOwnerTenantService.activateTenant({
    selector,
    ownerJid,
    durationText,
    actorJid: context.senderUserJid,
  });

  await context.reply(formatActivatedTenant(result.tenantGroup));
}

async function handleListTenant(context: CommandContext): Promise<void> {
  try {
    if (!(await ensureSuperOwner(context))) {
      return;
    }

    const filter = parseTenantListFilter(context.args[0]);
    const tenants = await superOwnerTenantService.listTenants(filter);
    if (tenants.length === 0) {
      await context.reply(getEmptyTenantListMessage(filter));
      return;
    }

    await context.reply(formatTenantList(tenants, getTenantListTitle(filter)));
  } catch (error: unknown) {
    await context.reply(formatTenantCommandError(error));
  }
}

async function handleTenantInfo(context: CommandContext): Promise<void> {
  try {
    if (!(await ensureSuperOwner(context))) {
      return;
    }

    const [tenantCode] = context.args;
    if (!tenantCode) {
      await context.reply("Format command salah.\nGunakan: .tenantinfo <kode>");
      return;
    }

    const result = await superOwnerTenantService.getTenantInfo(tenantCode);
    await context.reply(formatTenantInfo(result.tenantGroup));
  } catch (error: unknown) {
    await context.reply(formatTenantCommandError(error));
  }
}

async function handleExtendTenant(context: CommandContext): Promise<void> {
  try {
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
  } catch (error: unknown) {
    await context.reply(formatTenantCommandError(error));
  }
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
  try {
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
  } catch (error: unknown) {
    await context.reply(formatTenantCommandError(error));
  }
}

async function handleUnblockTenant(context: CommandContext): Promise<void> {
  try {
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
  } catch (error: unknown) {
    await context.reply(formatTenantCommandError(error));
  }
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

function parseTenantListFilter(value: string | undefined): TenantListFilter {
  if (!value) {
    return "visible";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "all" || normalized === "removed") {
    return normalized;
  }

  throw new Error("Format command salah.\nGunakan: .listtenant [all/removed]");
}

function getTenantListTitle(filter: TenantListFilter): string {
  if (filter === "all") {
    return "[DAFTAR SEMUA TENANT]";
  }

  if (filter === "removed") {
    return "[DAFTAR TENANT REMOVED]";
  }

  return "[DAFTAR TENANT]";
}

function getEmptyTenantListMessage(filter: TenantListFilter): string {
  if (filter === "removed") {
    return "Belum ada tenant removed.";
  }

  return "Belum ada tenant aktif/terdaftar.";
}

function formatTenantCommandError(error: unknown): string {
  return formatUserSafeError(error, "Command tenant gagal diproses. Silakan coba lagi.");
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

function formatTenantList(groups: TenantGroup[], title: string): string {
  const lines = [title, ""];

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

function formatActivatedTenant(tenantGroup: TenantGroup): string {
  return [
    "Tenant berhasil diaktifkan.",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Tenant Owner: ${formatNullableText(tenantGroup.ownerJid)}`,
    `Masa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
  ].join("\n");
}

function formatTenantInfo(tenantGroup: TenantGroup): string {
  return [
    "[INFO TENANT]",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Status: ${tenantGroup.status.toLowerCase()}`,
    `Diblokir: ${tenantGroup.isBlocked ? "ya" : "tidak"}`,
    `Tenant Owner: ${formatNullableText(tenantGroup.ownerJid)}`,
    `Masa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
  ].join("\n");
}
