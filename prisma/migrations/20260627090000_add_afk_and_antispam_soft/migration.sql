ALTER TYPE "AntiSpamMode" ADD VALUE 'SOFT';

CREATE TABLE "AfkStatus" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfkStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AfkStatus_groupJid_userJid_key" ON "AfkStatus"("groupJid", "userJid");

CREATE INDEX "AfkStatus_groupJid_idx" ON "AfkStatus"("groupJid");

CREATE INDEX "AfkStatus_userJid_idx" ON "AfkStatus"("userJid");

ALTER TABLE "AfkStatus" ADD CONSTRAINT "AfkStatus_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;
