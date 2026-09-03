import type { HeavyFeatureType } from "@prisma/client";

// Domain errors

export class MemberProfileNotFoundError extends Error {
  constructor(groupJid: string, userJid: string) {
    super(`Profil member tidak ditemukan: ${groupJid}/${userJid}`);
    this.name = "MemberProfileNotFoundError";
  }
}

export class InsufficientPointsError extends Error {
  constructor(message = "Poin tidak cukup") {
    super(message);
    this.name = "InsufficientPointsError";
  }
}

export class InsufficientLimitError extends Error {
  constructor(message = "Limit tidak cukup") {
    super(message);
    this.name = "InsufficientLimitError";
  }
}

export class InsufficientReservedLimitError extends Error {
  constructor(message = "Limit yang direservasi tidak cukup") {
    super(message);
    this.name = "InsufficientReservedLimitError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message = "Jumlah harus berupa bilangan bulat positif") {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export class DuplicateOperationError extends Error {
  constructor(message = "Operasi sudah pernah dilakukan") {
    super(message);
    this.name = "DuplicateOperationError";
  }
}

// Base input

interface BaseInput {
  groupJid: string;
  userJid: string;
  actorJid?: string;
}

// Point inputs

export interface CreditPointsInput extends BaseInput {
  amount: number;
  type:
    | "DAILY_REWARD"
    | "GAME_REWARD"
    | "GIFT_RECEIVED"
    | "SUPER_OWNER_ADD"
    | "CORRECTION";
  idempotencyKey?: string;
  correlationId?: string;
  note?: string;
  targetUserJid?: string;
}

export interface DebitPointsInput extends BaseInput {
  amount: number;
  type:
    | "LIMIT_PURCHASE_POINT_DEBIT"
    | "GIFT_SENT"
    | "CORRECTION";
  idempotencyKey?: string;
  correlationId?: string;
  note?: string;
  targetUserJid?: string;
}

export interface SetPointsInput extends BaseInput {
  amount: number;
  note?: string;
}

// Limit inputs

export interface CreditLimitInput extends BaseInput {
  amount: number;
  type:
    | "DAILY_REWARD"
    | "LIMIT_PURCHASE_LIMIT_CREDIT"
    | "GIFT_RECEIVED"
    | "SUPER_OWNER_ADD"
    | "CORRECTION";
  idempotencyKey?: string;
  correlationId?: string;
  note?: string;
  targetUserJid?: string;
}

export interface ReserveLimitInput extends BaseInput {
  amount: number;
  feature: HeavyFeatureType;
  correlationId: string;
}

export interface ConsumeLimitInput extends BaseInput {
  amount: number;
  feature: HeavyFeatureType;
  correlationId: string;
}

export interface RefundLimitInput extends BaseInput {
  amount: number;
  feature: HeavyFeatureType;
  correlationId: string;
}

export interface SetLimitInput extends BaseInput {
  amount: number;
  note?: string;
}

// XP inputs

export interface CreditXpInput extends BaseInput {
  amount: number;
  type:
    | "DAILY_REWARD"
    | "GAME_REWARD"
    | "SUPER_OWNER_ADD"
    | "CORRECTION";
  idempotencyKey?: string;
  correlationId?: string;
  note?: string;
}

export interface SetXpInput extends BaseInput {
  amount: number;
  note?: string;
}

// Game stats

export interface RecordGameResultInput extends BaseInput {
  won: boolean;
  idempotencyKey?: string;
  correlationId?: string;
}
