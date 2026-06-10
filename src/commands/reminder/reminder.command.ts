import type { Reminder } from "@prisma/client";

import { reminderService } from "../../services/reminder/reminder.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatDateId } from "../../utils/format";

export const reminderCommands: CommandDefinition[] = [
  {
    name: "remind",
    execute: handleRemind,
  },
  {
    name: "remindall",
    execute: handleRemindAll,
  },
  {
    name: "listreminder",
    execute: handleListReminder,
  },
  {
    name: "delreminder",
    execute: handleDeleteReminder,
  },
];

async function handleRemind(context: CommandContext): Promise<void> {
  const [timeText] = context.args;
  const message = getMessageAfterFirstArg(context);
  if (!timeText || message.length === 0) {
    await context.reply("Format command salah.\nGunakan: .remind <waktu> <pesan>");
    return;
  }

  const result = await reminderService.createReminder(context, timeText, message, false);
  await context.reply(formatReminderCreated(result.reminder));
}

async function handleRemindAll(context: CommandContext): Promise<void> {
  const [timeText] = context.args;
  const message = getMessageAfterFirstArg(context);
  if (!timeText || message.length === 0) {
    await context.reply("Format command salah.\nGunakan: .remindall <waktu> <pesan>");
    return;
  }

  const result = await reminderService.createReminder(context, timeText, message, true);
  await context.reply(formatReminderCreated(result.reminder));
}

async function handleListReminder(context: CommandContext): Promise<void> {
  const reminders = await reminderService.listGroupReminders(context);
  if (reminders.length === 0) {
    await context.reply("Tidak ada reminder aktif di grup ini.");
    return;
  }

  await context.reply(formatReminderList(reminders));
}

async function handleDeleteReminder(context: CommandContext): Promise<void> {
  const [listNumberText] = context.args;
  if (!listNumberText) {
    await context.reply("Format command salah.\nGunakan: .delreminder <nomor>");
    return;
  }

  const deletedReminder = await reminderService.deleteReminderByListNumber(context, listNumberText);
  await context.reply(`Reminder berhasil dihapus.\n\nPesan: ${deletedReminder.message}`);
}

function getMessageAfterFirstArg(context: CommandContext): string {
  const firstSpaceIndex = context.argsText.indexOf(" ");
  if (firstSpaceIndex < 0) {
    return "";
  }

  return context.argsText.slice(firstSpaceIndex + 1).trim();
}

function formatReminderCreated(reminder: Reminder): string {
  return [
    "Reminder berhasil dibuat.",
    "",
    `Waktu: ${formatReminderDate(reminder.remindAt)}`,
    `Mention semua: ${reminder.mentionAll ? "ya" : "tidak"}`,
    `Pesan: ${reminder.message}`,
  ].join("\n");
}

function formatReminderList(reminders: Reminder[]): string {
  const lines = ["[DAFTAR PENGINGAT]", ""];

  reminders.forEach((reminder, index) => {
    lines.push(`${String(index + 1)}. ${formatReminderDate(reminder.remindAt)}`);
    lines.push(`   Mention semua: ${reminder.mentionAll ? "ya" : "tidak"}`);
    lines.push(`   Pesan: ${reminder.message}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function formatReminderDate(date: Date): string {
  const time = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return `${formatDateId(date)} ${time}`;
}
