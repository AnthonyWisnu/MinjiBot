-- AlterTable
ALTER TABLE "TenantFeatureSetting" ADD COLUMN "goodbyeEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TenantGroupSetting" ADD COLUMN "goodbyeMessage" TEXT;
