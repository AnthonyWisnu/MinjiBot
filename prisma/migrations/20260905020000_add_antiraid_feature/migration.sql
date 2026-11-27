-- AlterTable
ALTER TABLE "TenantFeatureSetting" ADD COLUMN "antiRaidEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TenantGroupSetting" ADD COLUMN "antiRaidThreshold" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "TenantGroupSetting" ADD COLUMN "antiRaidWindowSec" INTEGER NOT NULL DEFAULT 10;
