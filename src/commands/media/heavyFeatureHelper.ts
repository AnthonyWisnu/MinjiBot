import type { HeavyFeatureType } from "@prisma/client";

import { heavyFeatureAccessService } from "../../services/quota/heavyFeatureAccess.service";
import { heavyFeatureLimitService, InsufficientLimitError } from "../../services/member/heavyFeatureLimit.service";
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
 * Consume limit setelah proses sukses.
 * Error consume tidak dilempar ke user (sudah berhasil, jangan ganggu UX).
 */
export async function consumeFeatureLimit(reservation: LimitReservation): Promise<void> {
  try {
    await heavyFeatureLimitService.consume(reservation);
  } catch {
    // Logged internally; tidak ganggu response user.
  }
}

/**
 * Refund limit setelah proses gagal.
 */
export async function refundFeatureLimit(reservation: LimitReservation): Promise<void> {
  try {
    await heavyFeatureLimitService.refund(reservation);
  } catch {
    // Logged internally.
  }
}
