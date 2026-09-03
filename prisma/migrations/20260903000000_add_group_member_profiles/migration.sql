-- CreateEnum
CREATE TYPE "MemberTransactionAsset" AS ENUM ('POINT', 'LIMIT', 'EXPERIENCE');

-- CreateEnum
CREATE TYPE "MemberTransactionType" AS ENUM ('INITIAL_BALANCE', 'DAILY_REWARD', 'GAME_REWARD', 'LIMIT_PURCHASE_POINT_DEBIT', 'LIMIT_PURCHASE_LIMIT_CREDIT', 'GIFT_SENT', 'GIFT_RECEIVED', 'FEATURE_RESERVE', 'FEATURE_CONSUME', 'FEATURE_REFUND', 'SUPER_OWNER_ADD', 'SUPER_OWNER_SET', 'CORRECTION');

-- AlterEnum
ALTER TYPE "HeavyFeatureType" ADD VALUE 'PLAY_SONG';
ALTER TYPE "HeavyFeatureType" ADD VALUE 'SONG_LYRICS';

-- CreateTable
CREATE TABLE "GroupMemberProfile" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "limitBalance" INTEGER NOT NULL DEFAULT 3,
    "reservedLimit" INTEGER NOT NULL DEFAULT 0,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "totalPointsEarned" INTEGER NOT NULL DEFAULT 0,
    "totalLimitsEarned" INTEGER NOT NULL DEFAULT 3,
    "totalGamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "totalGamesWon" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastDailyClaimAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMemberProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMemberTransaction" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "actorJid" TEXT,
    "targetUserJid" TEXT,
    "asset" "MemberTransactionAsset" NOT NULL,
    "type" "MemberTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER,
    "balanceAfter" INTEGER,
    "feature" "HeavyFeatureType",
    "correlationId" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMemberTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupMemberProfile_groupJid_userJid_key" ON "GroupMemberProfile"("groupJid", "userJid");

-- CreateIndex
CREATE INDEX "GroupMemberProfile_groupJid_experience_idx" ON "GroupMemberProfile"("groupJid", "experience");

-- CreateIndex
CREATE INDEX "GroupMemberProfile_groupJid_pointsBalance_idx" ON "GroupMemberProfile"("groupJid", "pointsBalance");

-- CreateIndex
CREATE INDEX "GroupMemberProfile_userJid_idx" ON "GroupMemberProfile"("userJid");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMemberTransaction_idempotencyKey_key" ON "GroupMemberTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GroupMemberTransaction_groupJid_userJid_idx" ON "GroupMemberTransaction"("groupJid", "userJid");

-- CreateIndex
CREATE INDEX "GroupMemberTransaction_profileId_createdAt_idx" ON "GroupMemberTransaction"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupMemberTransaction_correlationId_idx" ON "GroupMemberTransaction"("correlationId");

-- CreateIndex
CREATE INDEX "GroupMemberTransaction_createdAt_idx" ON "GroupMemberTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "GroupMemberProfile" ADD CONSTRAINT "GroupMemberProfile_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMemberTransaction" ADD CONSTRAINT "GroupMemberTransaction_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GroupMemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
