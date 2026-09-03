-- AlterTable
ALTER TABLE "TenantFeatureSetting" DROP COLUMN IF EXISTS "hdAiEnabled";
ALTER TABLE "TenantFeatureSetting" ALTER COLUMN "gameEnabled" SET DEFAULT true;
ALTER TABLE "TenantFeatureSetting" ALTER COLUMN "welcomeEnabled" SET DEFAULT true;
ALTER TABLE "TenantFeatureSetting" ALTER COLUMN "antiLinkEnabled" SET DEFAULT true;
ALTER TABLE "TenantFeatureSetting" ALTER COLUMN "antiSpamEnabled" SET DEFAULT true;
ALTER TABLE "TenantFeatureSetting" ALTER COLUMN "tagAllEnabled" SET DEFAULT true;

-- Update existing tenant groups to enable all features
UPDATE "TenantFeatureSetting"
SET
  "gameEnabled" = true,
  "welcomeEnabled" = true,
  "antiLinkEnabled" = true,
  "antiSpamEnabled" = true,
  "tagAllEnabled" = true;
