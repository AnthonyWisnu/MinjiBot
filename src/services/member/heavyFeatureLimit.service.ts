import type { GroupMemberProfile, HeavyFeatureType } from "@prisma/client";

import { getFeatureCost } from "./heavyFeatureCost";
import { MemberEconomyService, generateCorrelationId } from "./memberEconomy.service";
import { InsufficientLimitError } from "../../types/memberEconomy";

export interface HeavyFeatureReservation {
  groupJid: string;
  userJid: string;
  feature: HeavyFeatureType;
  correlationId: string;
}

// Minimal interfaces for DI and testing.
interface LimitEconomyService {
  findBestLimitProfileForPrivateChat(userJid: string, minLimit: number): Promise<GroupMemberProfile | null>;
  reserveLimit(input: { groupJid: string; userJid: string; amount: number; feature: HeavyFeatureType; correlationId: string }): Promise<GroupMemberProfile>;
  consumeLimit(input: { groupJid: string; userJid: string; amount: number; feature: HeavyFeatureType; correlationId: string }): Promise<GroupMemberProfile>;
  refundLimit(input: { groupJid: string; userJid: string; amount: number; feature: HeavyFeatureType; correlationId: string }): Promise<GroupMemberProfile>;
}

export class HeavyFeatureLimitService {
  constructor(
    private readonly economyService: LimitEconomyService = new MemberEconomyService(),
  ) {}

  /**
   * Generates a stable correlation ID for a feature execution cycle.
   * All three operations (reserve/consume/refund) should share this ID.
   */
  newCorrelationId(): string {
    return generateCorrelationId();
  }

  /**
   * Reserve limit for a feature. Throws InsufficientLimitError if balance insufficient.
   * For private chat resolution: groupJid is the group with highest available limit.
   */
  async reserve(reservation: HeavyFeatureReservation): Promise<void> {
    const cost = getFeatureCost(reservation.feature);
    if (cost === 0) return;

    await this.economyService.reserveLimit({
      groupJid: reservation.groupJid,
      userJid: reservation.userJid,
      amount: cost,
      feature: reservation.feature,
      correlationId: reservation.correlationId,
    });
  }

  /**
   * Consume the reserved limit (permanent deduction after success).
   */
  async consume(reservation: HeavyFeatureReservation): Promise<void> {
    const cost = getFeatureCost(reservation.feature);
    if (cost === 0) return;

    await this.economyService.consumeLimit({
      groupJid: reservation.groupJid,
      userJid: reservation.userJid,
      amount: cost,
      feature: reservation.feature,
      correlationId: reservation.correlationId,
    });
  }

  /**
   * Refund the reserved limit back to available balance (on failure).
   */
  async refund(reservation: HeavyFeatureReservation): Promise<void> {
    const cost = getFeatureCost(reservation.feature);
    if (cost === 0) return;

    await this.economyService.refundLimit({
      groupJid: reservation.groupJid,
      userJid: reservation.userJid,
      amount: cost,
      feature: reservation.feature,
      correlationId: reservation.correlationId,
    });
  }

  /**
   * For private chat: resolve groupJid from the profile with highest limit balance
   * that can cover the feature cost.
   * Returns null if no eligible profile found.
   */
  async resolvePrivateChatGroupJid(
    userJid: string,
    feature: HeavyFeatureType,
  ): Promise<string | null> {
    const cost = getFeatureCost(feature);
    if (cost === 0) return null;

    const profile = await this.economyService.findBestLimitProfileForPrivateChat(userJid, cost);
    return profile?.groupJid ?? null;
  }

  /**
   * Returns insufficient balance message for commands.
   */
  getInsufficientLimitMessage(): string {
    return [
      "Limit kamu tidak cukup untuk menggunakan fitur ini.",
      "Gunakan .daily, beli melalui .belilimit, atau terima gift limit dari member lain.",
    ].join("\n");
  }

  getRefundedMessage(): string {
    return "Proses gagal. Limit yang sudah direservasi telah dikembalikan.";
  }
}

export { InsufficientLimitError };
export const heavyFeatureLimitService = new HeavyFeatureLimitService();
