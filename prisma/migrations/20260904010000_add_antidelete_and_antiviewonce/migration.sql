-- AlterTable
ALTER TABLE "TenantFeatureSetting" ADD COLUMN "antiDeleteEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "antiViewOnceEnabled" BOOLEAN NOT NULL DEFAULT true;
