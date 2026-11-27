-- AlterTable
ALTER TABLE "TenantGroupSetting" ADD COLUMN "warnThreshold" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "TenantGroupSetting" ADD COLUMN "warnAction" TEXT NOT NULL DEFAULT 'KICK';

-- CreateTable
CREATE TABLE "GroupMemberWarning" (
    "id" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "issuerJid" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMemberWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupMemberWarning_groupJid_userJid_idx" ON "GroupMemberWarning"("groupJid", "userJid");

-- CreateIndex
CREATE INDEX "GroupMemberWarning_groupJid_createdAt_idx" ON "GroupMemberWarning"("groupJid", "createdAt");

-- AddForeignKey
ALTER TABLE "GroupMemberWarning" ADD CONSTRAINT "GroupMemberWarning_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;
