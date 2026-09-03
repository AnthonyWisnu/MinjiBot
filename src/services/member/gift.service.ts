import { MemberTransactionAsset, MemberTransactionType } from "@prisma/client";
import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  DuplicateOperationError,
  InsufficientPointsError,
  InsufficientLimitError,
  InvalidAmountError,
} from "../../types/memberEconomy";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "./memberEconomy.service";

const SELF_TRANSFER_ERROR = "Tidak bisa mengirim ke diri sendiri.";
const BOT_TRANSFER_ERROR = "Tidak bisa mengirim ke bot.";
const NON_PARTICIPANT_ERROR = "Penerima bukan peserta grup ini.";

export interface GiftInput {
  groupJid: string;
  senderJid: string;
  recipientJid: string;
  amount: number;
  idempotencyKey?: string;
  /** Current participant JIDs from Baileys group metadata. */
  participantJids: readonly string[];
  botJid: string;
}

export interface GiftResult {
  amountSent: number;
  senderBalance: number;
  recipientBalance: number;
}

// Minimal interfaces for DI and testing.
interface GiftProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface GiftTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number;
      balanceBefore?: number;
      balanceAfter?: number;
      correlationId?: string;
      idempotencyKey?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
  findByIdempotencyKey(key: string): Promise<object | null>;
}

interface GiftDb {
  $transaction<T>(fn: (tx: GiftTx) => Promise<T>): Promise<T>;
}

interface GiftTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

export class GiftService {
  constructor(
    private readonly profileRepo: GiftProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: GiftTxStore = new GroupMemberTransactionRepository(),
    private readonly db: GiftDb = prisma,
  ) {}

  async giftPoints(input: GiftInput): Promise<GiftResult> {
    return this.transfer(input, MemberTransactionAsset.POINT, "pointsBalance");
  }

  async giftLimit(input: GiftInput): Promise<GiftResult> {
    return this.transfer(input, MemberTransactionAsset.LIMIT, "limitBalance");
  }

  private async transfer(
    input: GiftInput,
    asset: MemberTransactionAsset,
    balanceField: "pointsBalance" | "limitBalance",
  ): Promise<GiftResult> {
    const { groupJid, senderJid, recipientJid, amount, idempotencyKey, participantJids, botJid } =
      input;

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new InvalidAmountError("Jumlah harus bilangan bulat positif.");
    }

    const normalizedSender = normalizeUserJid(senderJid);
    const normalizedRecipient = normalizeUserJid(recipientJid);
    const normalizedBot = normalizeUserJid(botJid);

    if (normalizedSender === normalizedRecipient) {
      throw new InvalidAmountError(SELF_TRANSFER_ERROR);
    }

    if (normalizedRecipient === normalizedBot) {
      throw new InvalidAmountError(BOT_TRANSFER_ERROR);
    }

    const normalizedParticipants = participantJids.map((jid) => normalizeUserJid(jid));
    if (!normalizedParticipants.includes(normalizedRecipient)) {
      throw new InvalidAmountError(NON_PARTICIPANT_ERROR);
    }

    // Check idempotency before entering transaction.
    if (idempotencyKey) {
      const existing = await this.txRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        throw new DuplicateOperationError("Transfer ini sudah pernah dilakukan.");
      }
    }

    const correlationId = generateCorrelationId();
    const sentType =
      asset === MemberTransactionAsset.POINT
        ? MemberTransactionType.GIFT_SENT
        : MemberTransactionType.GIFT_SENT;
    const receivedType =
      asset === MemberTransactionAsset.POINT
        ? MemberTransactionType.GIFT_RECEIVED
        : MemberTransactionType.GIFT_RECEIVED;

    return this.db.$transaction(async (tx) => {
      const senderProfile = await this.profileRepo.findOrCreate(groupJid, normalizedSender, tx);
      const recipientProfile = await this.profileRepo.findOrCreate(
        groupJid,
        normalizedRecipient,
        tx,
      );

      // Atomic debit with balance predicate.
      const debitResult = await tx.groupMemberProfile.updateMany({
        where: { id: senderProfile.id, [balanceField]: { gte: amount } },
        data: { [balanceField]: { decrement: amount } },
      });

      if (debitResult.count === 0) {
        if (asset === MemberTransactionAsset.POINT) {
          throw new InsufficientPointsError("Poin tidak cukup untuk transfer.");
        }
        throw new InsufficientLimitError("Limit tidak cukup untuk transfer.");
      }

      // Credit recipient.
      const updatedRecipient = await tx.groupMemberProfile.update({
        where: { id: recipientProfile.id },
        data: { [balanceField]: { increment: amount } },
      });

      const updatedSender = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: senderProfile.id },
      });

      // Ledger: GIFT_SENT.
      await this.txRepo.create(
        {
          profileId: senderProfile.id,
          groupJid,
          userJid: normalizedSender,
          asset,
          type: sentType,
          amount,
          balanceBefore: senderProfile[balanceField],
          balanceAfter: updatedSender[balanceField],
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      // Ledger: GIFT_RECEIVED.
      await this.txRepo.create(
        {
          profileId: recipientProfile.id,
          groupJid,
          userJid: normalizedRecipient,
          asset,
          type: receivedType,
          amount,
          balanceBefore: recipientProfile[balanceField],
          balanceAfter: updatedRecipient[balanceField],
          correlationId,
        },
        tx,
      );

      return {
        amountSent: amount,
        senderBalance: updatedSender[balanceField],
        recipientBalance: updatedRecipient[balanceField],
      };
    });
  }
}

export const giftService = new GiftService();
