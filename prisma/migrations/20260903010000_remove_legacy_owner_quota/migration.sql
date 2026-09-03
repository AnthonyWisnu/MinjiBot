-- Migration: Remove legacy TenantOwnerQuota and TenantQuotaTransaction tables
-- Plan 009: Remove Legacy Owner Quota

-- Drop TenantQuotaTransaction first (has FK to TenantOwnerQuota)
DROP TABLE IF EXISTS "TenantQuotaTransaction";

-- Drop TenantOwnerQuota
DROP TABLE IF EXISTS "TenantOwnerQuota";

-- Drop legacy enums (PostgreSQL requires no active columns referencing them)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantQuotaTransactionType') THEN
    DROP TYPE "TenantQuotaTransactionType";
  END IF;
END \$\$;

DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantQuotaSource') THEN
    DROP TYPE "TenantQuotaSource";
  END IF;
END \$\$;

-- Remove quota audit actions from TenantAuditAction enum
-- PostgreSQL does not support DROP VALUE from enum; we recreate the enum.
-- Only needed if old values still exist in audit rows. Use ALTER TABLE ... USING cast.
-- For safety, we just leave the audit enum as-is if the values are unused.
-- No data migration needed — quota audit rows can remain as historical data.
