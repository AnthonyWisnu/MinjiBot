import { TenantAuditAction, TenantStatus, type Reminder, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { prisma } from "../../repositories/prismaClient";
import { ReminderRepository } from "../../repositories/reminder.repository";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import type { CommandContext } from "../../types/command";
import type { Role } from "../../types/role";
import { parseReminderTime } from "../../utils/time";

export interface CreateReminderResult {
  reminder: Reminder;
  tenantGroup: TenantGroup;
}

export class ReminderService {
  constructor(
    private readonly reminderRepository = new ReminderRepository(),
    private readonly tenantGroupRepository = new TenantGroupRepository(),
  ) {}

  async createReminder(
    context: CommandContext,
    timeText: string,
    message: string,
    mentionAll: boolean,
  ): Promise<CreateReminderResult> {
    if (!context.isGroup || !context.tenantGroup) {
      throw new Error("Reminder hanya dapat dibuat di grup tenant aktif.");
    }
    const tenantGroup = context.tenantGroup;

    if (mentionAll) {
      this.assertCanMentionAll(context.role);
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      throw new Error("Pesan reminder tidak boleh kosong.");
    }

    const remindAt = parseReminderTime(new Date(), timeText);
    if (remindAt.getTime() <= Date.now()) {
      throw new Error("Waktu reminder harus di masa depan.");
    }

    return prisma.$transaction(async (tx) => {
      const reminderRepository = new ReminderRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const reminder = await reminderRepository.create({
        groupJid: context.tenantGroup?.groupJid ?? context.chatJid,
        message: trimmedMessage,
        remindAt,
        createdBy: context.senderUserJid,
        mentionAll,
      });

      await tenantAuditRepository.create({
        groupJid: reminder.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.REMINDER_CREATED,
        metadata: {
          reminderId: reminder.id,
          remindAt: reminder.remindAt.toISOString(),
          mentionAll,
        },
      });

      return {
        reminder,
        tenantGroup,
      };
    });
  }

  async listGroupReminders(context: CommandContext): Promise<Reminder[]> {
    if (!context.isGroup || !context.tenantGroup) {
      throw new Error("List reminder hanya tersedia di grup tenant.");
    }

    return this.reminderRepository.listByGroupJid(context.tenantGroup.groupJid);
  }

  async deleteReminderByListNumber(
    context: CommandContext,
    listNumberText: string,
  ): Promise<Reminder> {
    if (!context.isGroup || !context.tenantGroup) {
      throw new Error("Hapus reminder hanya tersedia di grup tenant.");
    }

    const listNumber = Number(listNumberText);
    if (!Number.isInteger(listNumber) || listNumber <= 0) {
      throw new Error("Nomor reminder tidak valid.");
    }

    const reminders = await this.reminderRepository.listByGroupJid(context.tenantGroup.groupJid);
    const reminder = reminders[listNumber - 1];
    if (!reminder) {
      throw new Error("Reminder tidak ditemukan.");
    }

    if (reminder.createdBy !== context.senderUserJid) {
      this.assertCanManageReminder(context.role);
    }

    return prisma.$transaction(async (tx) => {
      const reminderRepository = new ReminderRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const deletedReminder = await reminderRepository.deleteByIdAndGroupJid(
        reminder.id,
        reminder.groupJid,
      );

      await tenantAuditRepository.create({
        groupJid: deletedReminder.groupJid,
        actorJid: context.senderUserJid,
        action: TenantAuditAction.REMINDER_DELETED,
        metadata: {
          reminderId: deletedReminder.id,
        },
      });

      return deletedReminder;
    });
  }

  async sendDueReminder(socket: WASocket, reminder: Reminder): Promise<void> {
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(reminder.groupJid);
    if (!this.isTenantActive(tenantGroup)) {
      await this.reminderRepository.markSent(reminder.id);
      logger.info(
        { reminderId: reminder.id, groupJid: reminder.groupJid },
        "Reminder dilewati dan ditandai selesai karena tenant tidak aktif atau masa sewa habis",
      );
      return;
    }

    const mentions = reminder.mentionAll
      ? await this.loadGroupParticipantMentions(socket, reminder.groupJid)
      : [];

    await socket.sendMessage(reminder.groupJid, {
      text: reminder.message,
      mentions,
    });
    await this.reminderRepository.markSent(reminder.id);
  }

  async listDue(now = new Date()): Promise<Reminder[]> {
    return this.reminderRepository.listDue(now);
  }

  private async loadGroupParticipantMentions(
    socket: WASocket,
    groupJid: string,
  ): Promise<string[]> {
    try {
      const metadata = await socket.groupMetadata(groupJid);
      return metadata.participants.map((participant) => participant.id);
    } catch (error: unknown) {
      logger.warn({ error, groupJid }, "Gagal membaca participant untuk remindall");
      return [];
    }
  }

  private isTenantActive(tenantGroup: TenantGroup | null): tenantGroup is TenantGroup {
    return Boolean(
      tenantGroup?.expiresAt &&
      tenantGroup.status === TenantStatus.ACTIVE &&
      !tenantGroup.isBlocked &&
      tenantGroup.expiresAt.getTime() > Date.now(),
    );
  }

  private assertCanMentionAll(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Remindall hanya dapat digunakan oleh pengelola tenant.");
  }

  private assertCanManageReminder(role: Role): void {
    if (role === "SUPER_OWNER" || role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
      return;
    }

    throw new Error("Kamu hanya dapat menghapus reminder yang kamu buat.");
  }
}

export const reminderService = new ReminderService();
