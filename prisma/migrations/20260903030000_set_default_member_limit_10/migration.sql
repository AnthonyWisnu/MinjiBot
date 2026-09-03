-- AlterTable
ALTER TABLE "GroupMemberProfile" ALTER COLUMN "limitBalance" SET DEFAULT 10;
ALTER TABLE "GroupMemberProfile" ALTER COLUMN "totalLimitsEarned" SET DEFAULT 10;

-- Boost existing members with under 10 limit to 10
UPDATE "GroupMemberProfile"
SET "limitBalance" = 10
WHERE "limitBalance" < 10;
