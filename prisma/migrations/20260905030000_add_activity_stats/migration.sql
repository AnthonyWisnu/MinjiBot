-- AlterTable
ALTER TABLE "GroupMemberProfile" ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GroupMemberProfile" ADD COLUMN "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "GroupMemberProfile_groupJid_messageCount_idx" ON "GroupMemberProfile"("groupJid", "messageCount");
