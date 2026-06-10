import type { TenantOwnerQuota } from "@prisma/client";

import { tenantQuotaService } from "../../services/quota/tenantQuota.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { normalizeUserJid } from "../../utils/jid";

export const quotaCommands: CommandDefinition[] = [
  {
    name: "addquota",
    execute: handleAddQuota,
  },
  {
    name: "setownerquota",
    execute: handleSetOwnerQuota,
  },
  {
    name: "ownerquota",
    execute: handleOwnerQuota,
  },
  {
    name: "listownerquota",
    execute: handleListOwnerQuota,
  },
  {
    name: "quota",
    execute: handleQuota,
  },
];

async function handleAddQuota(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [ownerNumber, amountText] = context.args;
  if (!ownerNumber || !amountText) {
    await context.reply("Format command salah.\nGunakan: .addquota <nomorOwner> <jumlah>");
    return;
  }

  const amount = parsePositiveInteger(amountText, "Jumlah kuota");
  const ownerJid = normalizeUserJid(ownerNumber);
  const ownerQuota = await tenantQuotaService.addOwnerQuota({
    ownerJid,
    actorJid: context.senderUserJid,
    amount,
  });

  await context.reply(
    ["Kuota owner berhasil ditambahkan.", "", formatOwnerQuota(ownerQuota)].join("\n"),
  );
}

async function handleSetOwnerQuota(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [ownerNumber, amountText] = context.args;
  if (!ownerNumber || !amountText) {
    await context.reply("Format command salah.\nGunakan: .setownerquota <nomorOwner> <jumlah>");
    return;
  }

  const amount = parseNonNegativeInteger(amountText, "Jumlah kuota");
  const ownerJid = normalizeUserJid(ownerNumber);
  const ownerQuota = await tenantQuotaService.setOwnerQuota({
    ownerJid,
    actorJid: context.senderUserJid,
    amount,
  });

  await context.reply(
    ["Kuota owner berhasil diatur.", "", formatOwnerQuota(ownerQuota)].join("\n"),
  );
}

async function handleOwnerQuota(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const [ownerNumber] = context.args;
  if (!ownerNumber) {
    await context.reply("Format command salah.\nGunakan: .ownerquota <nomorOwner>");
    return;
  }

  const ownerJid = normalizeUserJid(ownerNumber);
  const ownerQuota = await tenantQuotaService.getOwnerQuota(ownerJid);
  if (!ownerQuota) {
    await context.reply("Kuota owner belum terdaftar.");
    return;
  }

  await context.reply(formatOwnerQuota(ownerQuota));
}

async function handleListOwnerQuota(context: CommandContext): Promise<void> {
  if (!(await ensureSuperOwner(context))) {
    return;
  }

  const quotaList = await tenantQuotaService.listOwnerQuota();
  if (quotaList.length === 0) {
    await context.reply("Belum ada kuota owner terdaftar.");
    return;
  }

  await context.reply(formatOwnerQuotaList(quotaList));
}

async function handleQuota(context: CommandContext): Promise<void> {
  if (context.isGroup) {
    await handleGroupQuota(context);
    return;
  }

  await handlePrivateQuota(context);
}

async function handleGroupQuota(context: CommandContext): Promise<void> {
  if (!context.tenantGroup) {
    await context.reply("Grup ini belum terdaftar sebagai tenant.");
    return;
  }

  const ownerQuota = await tenantQuotaService.getGroupQuota(context.tenantGroup);
  if (!ownerQuota) {
    await context.reply("Kuota fitur berat grup ini belum terdaftar.");
    return;
  }

  await context.reply(["[KUOTA GRUP]", "", formatOwnerQuota(ownerQuota)].join("\n"));
}

async function handlePrivateQuota(context: CommandContext): Promise<void> {
  if (context.role !== "TENANT_OWNER" && context.role !== "SUPER_OWNER") {
    await context.reply("Kuota private chat hanya tersedia untuk Tenant Owner.");
    return;
  }

  const ownerQuota = await tenantQuotaService.getOwnerQuota(context.senderUserJid);
  if (!ownerQuota) {
    await context.reply("Kuota fitur berat kamu belum terdaftar.");
    return;
  }

  await context.reply(["[KUOTA KAMU]", "", formatOwnerQuota(ownerQuota)].join("\n"));
}

async function ensureSuperOwner(context: CommandContext): Promise<boolean> {
  if (context.role === "SUPER_OWNER") {
    return true;
  }

  await context.reply("Command ini hanya dapat digunakan oleh Super Owner.");
  return false;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} harus berupa angka lebih dari nol.`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} harus berupa angka nol atau lebih.`);
  }

  return parsed;
}

function formatOwnerQuota(ownerQuota: TenantOwnerQuota): string {
  return [
    `Owner: ${ownerQuota.ownerJid}`,
    `Kuota tersisa: ${String(ownerQuota.remainingQuota)}`,
    `Kuota direservasi: ${String(ownerQuota.reservedQuota)}`,
    `Total kuota ditambahkan: ${String(ownerQuota.totalAddedQuota)}`,
  ].join("\n");
}

function formatOwnerQuotaList(quotaList: TenantOwnerQuota[]): string {
  const lines = ["[DAFTAR KUOTA OWNER]", ""];

  quotaList.forEach((ownerQuota, index) => {
    lines.push(`${String(index + 1)}. ${ownerQuota.ownerJid}`);
    lines.push(`   Tersisa: ${String(ownerQuota.remainingQuota)}`);
    lines.push(`   Direservasi: ${String(ownerQuota.reservedQuota)}`);
    lines.push(`   Total ditambahkan: ${String(ownerQuota.totalAddedQuota)}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}
