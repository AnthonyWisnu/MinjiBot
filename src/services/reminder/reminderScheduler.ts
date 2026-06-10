import type { WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { reminderService } from "./reminder.service";

export class ReminderScheduler {
  private socket: WASocket | null = null;
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(socket: WASocket): void {
    this.socket = socket;

    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.tick();
    }, env.REMINDER_POLL_MS);

    void this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.socket = null;
  }

  private async tick(): Promise<void> {
    if (this.isRunning || !this.socket) {
      return;
    }

    this.isRunning = true;

    try {
      const dueReminders = await reminderService.listDue();
      for (const reminder of dueReminders) {
        try {
          await reminderService.sendDueReminder(this.socket, reminder);
        } catch (error: unknown) {
          logger.error(
            {
              error,
              reminderId: reminder.id,
              groupJid: reminder.groupJid,
            },
            "Reminder gagal dikirim",
          );
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}

export const reminderScheduler = new ReminderScheduler();
