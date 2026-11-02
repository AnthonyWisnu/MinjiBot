import type { HeavyFeatureType } from "@prisma/client";

import { logger } from "../../config/logger";
import { heavyFeatureAccessService } from "../../services/quota/heavyFeatureAccess.service";
import {
  heavyFeatureLimitService,
  InsufficientLimitError,
} from "../../services/member/heavyFeatureLimit.service";
import type { CommandContext } from "../../types/command";

export interface LimitReservation {
  groupJid: string;
  userJid: string;
  feature: HeavyFeatureType;
  correlationId: string;
}

/**
 * Resolve akses member untuk sebuah fitur berat.
 *
 * Mengembalikan:
 * - null jika tidak diizinkan (sudah reply ke user)
 * - { skip: true } jika Super Owner atau Tenant Owner gratis
 * - { skip: false, reservation } jika perlu reserve/consume/refund
 */
export async function resolveFeatureAccess(
  context: CommandContext,
  feature: HeavyFeatureType,
): Promise<{ skip: true } | { skip: false; reservation: LimitReservation } | null> {
  const access = await heavyFeatureAccessService.resolveAccess(context);

  if (!access.allowed) {
    await context.reply(access.message);
    return null;
  }

  if (access.skipLimit) {
    return { skip: true };
  }

  let resolvedGroupJid = access.groupJid;

  // Private chat member biasa: resolve group dari profil dengan limit terbesar.
  if (resolvedGroupJid === "PRIVATE") {
    const bestGroupJid = await heavyFeatureLimitService.resolvePrivateChatGroupJid(
      access.userJid,
      feature,
    );
    if (!bestGroupJid) {
      await context.reply(heavyFeatureLimitService.getInsufficientLimitMessage());
      return null;
    }
    resolvedGroupJid = bestGroupJid;
  }

  return {
    skip: false,
    reservation: {
      groupJid: resolvedGroupJid,
      userJid: access.userJid,
      feature,
      correlationId: heavyFeatureLimitService.newCorrelationId(),
    },
  };
}

/**
 * Reserve limit dari member. Mengembalikan false dan reply ke user jika gagal.
 */
export async function reserveFeatureLimit(
  context: CommandContext,
  reservation: LimitReservation,
): Promise<boolean> {
  try {
    await heavyFeatureLimitService.reserve(reservation);
    return true;
  } catch (error: unknown) {
    if (error instanceof InsufficientLimitError) {
      await context.reply(heavyFeatureLimitService.getInsufficientLimitMessage());
    } else {
      await context.reply("Gagal memeriksa saldo limit. Silakan coba lagi.");
    }
    return false;
  }
}

/**
 * Consume limit setelah proses sukses (dengan 2x retry & delay 300ms).
 * Error consume tidak dilempar ke user (sudah berhasil, jangan ganggu UX).
 */
export async function consumeFeatureLimit(reservation: LimitReservation): Promise<void> {
  let attempts = 0;
  while (attempts < 3) {
    try {
      await heavyFeatureLimitService.consume(reservation);
      return;
    } catch (err: unknown) {
      attempts++;
      if (attempts >= 3) {
        logger.error(
          {
            err,
            correlationId: reservation.correlationId,
            groupJid: reservation.groupJid,
            userJid: reservation.userJid,
          },
          "Failed to settle heavy feature limit (consume)",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

/**
 * Refund limit setelah proses gagal (dengan 2x retry & delay 300ms).
 */
export async function refundFeatureLimit(reservation: LimitReservation): Promise<void> {
  let attempts = 0;
  while (attempts < 3) {
    try {
      await heavyFeatureLimitService.refund(reservation);
      return;
    } catch (err: unknown) {
      attempts++;
      if (attempts >= 3) {
        logger.error(
          {
            err,
            correlationId: reservation.correlationId,
            groupJid: reservation.groupJid,
            userJid: reservation.userJid,
          },
          "Failed to settle heavy feature limit (refund)",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

/**
 * Helper terpadu untuk mengeksekusi fitur berat secara aman:
 * Resolve -> Reserve -> Run Task -> Consume -> (Refund bila task gagal).
 */
export async function executeWithHeavyFeatureLimit<T>(
  context: CommandContext,
  feature: HeavyFeatureType,
  task: () => Promise<T>,
): Promise<T | null> {
  const access = await resolveFeatureAccess(context, feature);
  if (!access) {
    return null;
  }

  if (access.skip) {
    return await task();
  }

  const reserved = await reserveFeatureLimit(context, access.reservation);
  if (!reserved) {
    return null;
  }

  try {
    const result = await task();
    await consumeFeatureLimit(access.reservation);
    return result;
  } catch (err) {
    await refundFeatureLimit(access.reservation);
    throw err;
  }
}
