-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'BLOCKED', 'REMOVED');

-- CreateEnum
CREATE TYPE "TenantQuotaTransactionType" AS ENUM ('ADD', 'SET', 'RESERVE', 'CONSUME', 'REFUND', 'CORRECTION');

-- CreateEnum
CREATE TYPE "TenantQuotaSource" AS ENUM ('SUPER_OWNER', 'GROUP_COMMAND', 'PRIVATE_COMMAND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "HeavyFeatureType" AS ENUM ('TIKTOK_DOWNLOAD', 'INSTAGRAM_REELS_DOWNLOAD', 'INSTAGRAM_STORY_DOWNLOAD', 'HD_AI_PHOTO', 'HD_AI_PHOTO_DOCUMENT');

-- CreateEnum
CREATE TYPE "TenantAuditAction" AS ENUM ('TENANT_REGISTERED', 'TENANT_ACTIVATED', 'TENANT_EXTENDED', 'TENANT_EXPIRED', 'TENANT_BLOCKED', 'TENANT_UNBLOCKED', 'TENANT_REMOVED', 'TENANT_OWNER_CHANGED', 'TENANT_ADMIN_ADDED', 'TENANT_ADMIN_REMOVED', 'FEATURE_UPDATED', 'QUOTA_ADDED', 'QUOTA_SET', 'QUOTA_RESERVED', 'QUOTA_CONSUMED', 'QUOTA_REFUNDED', 'WELCOME_UPDATED', 'MODERATION_UPDATED', 'REMINDER_CREATED', 'REMINDER_DELETED');

-- CreateEnum
CREATE TYPE "AntiSpamMode" AS ENUM ('NORMAL', 'STRICT');

-- CreateTable
CREATE TABLE "TenantGroup" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "name" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'PENDING',
    "ownerJid" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAdmin" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFeatureSetting" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "downloaderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hdEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hdAiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gameEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "antiLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "antiSpamEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tagAllEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFeatureSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantGroupSetting" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "welcomeMessage" TEXT,
    "antiLinkAutoKick" BOOLEAN NOT NULL DEFAULT false,
    "antiSpamMode" "AntiSpamMode" NOT NULL DEFAULT 'NORMAL',
    "tagAllCooldownSec" INTEGER NOT NULL DEFAULT 600,
    "remindAllCooldownSec" INTEGER NOT NULL DEFAULT 600,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantGroupSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantOwnerQuota" (
    "id" TEXT NOT NULL,
    "ownerJid" TEXT NOT NULL,
    "remainingQuota" INTEGER NOT NULL DEFAULT 0,
    "reservedQuota" INTEGER NOT NULL DEFAULT 0,
    "totalAddedQuota" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOwnerQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantQuotaTransaction" (
    "id" TEXT NOT NULL,
    "ownerJid" TEXT NOT NULL,
    "groupJid" TEXT,
    "actorJid" TEXT,
    "amount" INTEGER NOT NULL,
    "type" "TenantQuotaTransactionType" NOT NULL,
    "source" "TenantQuotaSource" NOT NULL,
    "feature" "HeavyFeatureType",
    "note" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantQuotaTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPrivateSession" (
    "id" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPrivateSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "mentionAll" BOOLEAN NOT NULL DEFAULT false,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAuditLog" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT,
    "actorJid" TEXT,
    "action" "TenantAuditAction" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantGroup_groupJid_key" ON "TenantGroup"("groupJid");

-- CreateIndex
CREATE UNIQUE INDEX "TenantGroup_tenantCode_key" ON "TenantGroup"("tenantCode");

-- CreateIndex
CREATE INDEX "TenantGroup_ownerJid_idx" ON "TenantGroup"("ownerJid");

-- CreateIndex
CREATE INDEX "TenantGroup_status_idx" ON "TenantGroup"("status");

-- CreateIndex
CREATE INDEX "TenantGroup_expiresAt_idx" ON "TenantGroup"("expiresAt");

-- CreateIndex
CREATE INDEX "TenantAdmin_groupJid_idx" ON "TenantAdmin"("groupJid");

-- CreateIndex
CREATE INDEX "TenantAdmin_userJid_idx" ON "TenantAdmin"("userJid");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAdmin_groupJid_userJid_key" ON "TenantAdmin"("groupJid", "userJid");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeatureSetting_groupJid_key" ON "TenantFeatureSetting"("groupJid");

-- CreateIndex
CREATE UNIQUE INDEX "TenantGroupSetting_groupJid_key" ON "TenantGroupSetting"("groupJid");

-- CreateIndex
CREATE UNIQUE INDEX "TenantOwnerQuota_ownerJid_key" ON "TenantOwnerQuota"("ownerJid");

-- CreateIndex
CREATE INDEX "TenantOwnerQuota_ownerJid_idx" ON "TenantOwnerQuota"("ownerJid");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_ownerJid_idx" ON "TenantQuotaTransaction"("ownerJid");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_groupJid_idx" ON "TenantQuotaTransaction"("groupJid");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_actorJid_idx" ON "TenantQuotaTransaction"("actorJid");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_type_idx" ON "TenantQuotaTransaction"("type");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_feature_idx" ON "TenantQuotaTransaction"("feature");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_createdAt_idx" ON "TenantQuotaTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "TenantQuotaTransaction_correlationId_idx" ON "TenantQuotaTransaction"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPrivateSession_userJid_key" ON "TenantPrivateSession"("userJid");

-- CreateIndex
CREATE INDEX "TenantPrivateSession_userJid_idx" ON "TenantPrivateSession"("userJid");

-- CreateIndex
CREATE INDEX "TenantPrivateSession_groupJid_idx" ON "TenantPrivateSession"("groupJid");

-- CreateIndex
CREATE INDEX "TenantPrivateSession_expiresAt_idx" ON "TenantPrivateSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Reminder_groupJid_remindAt_idx" ON "Reminder"("groupJid", "remindAt");

-- CreateIndex
CREATE INDEX "Reminder_isSent_remindAt_idx" ON "Reminder"("isSent", "remindAt");

-- CreateIndex
CREATE INDEX "Reminder_createdBy_groupJid_idx" ON "Reminder"("createdBy", "groupJid");

-- CreateIndex
CREATE INDEX "TenantAuditLog_groupJid_idx" ON "TenantAuditLog"("groupJid");

-- CreateIndex
CREATE INDEX "TenantAuditLog_actorJid_idx" ON "TenantAuditLog"("actorJid");

-- CreateIndex
CREATE INDEX "TenantAuditLog_action_idx" ON "TenantAuditLog"("action");

-- CreateIndex
CREATE INDEX "TenantAuditLog_createdAt_idx" ON "TenantAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "TenantAdmin" ADD CONSTRAINT "TenantAdmin_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeatureSetting" ADD CONSTRAINT "TenantFeatureSetting_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantGroupSetting" ADD CONSTRAINT "TenantGroupSetting_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantQuotaTransaction" ADD CONSTRAINT "TenantQuotaTransaction_ownerJid_fkey" FOREIGN KEY ("ownerJid") REFERENCES "TenantOwnerQuota"("ownerJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAuditLog" ADD CONSTRAINT "TenantAuditLog_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE SET NULL ON UPDATE CASCADE;
