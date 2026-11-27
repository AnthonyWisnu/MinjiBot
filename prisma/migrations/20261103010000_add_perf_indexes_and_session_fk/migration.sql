-- Clean orphan sessions that refer to non-existent TenantGroup before adding FK constraint
DELETE FROM "TenantPrivateSession" WHERE "groupJid" NOT IN (SELECT "groupJid" FROM "TenantGroup");

-- Drop redundant userJid index on TenantPrivateSession (already indexed by unique constraint)
DROP INDEX IF EXISTS "TenantPrivateSession_userJid_idx";

-- Add ForeignKey from TenantPrivateSession to TenantGroup
ALTER TABLE "TenantPrivateSession" ADD CONSTRAINT "TenantPrivateSession_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "TenantGroup"("groupJid") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create index on GroupMemberProfile (groupJid, lastActiveAt) for .silent query performance
CREATE INDEX IF NOT EXISTS "GroupMemberProfile_groupJid_lastActiveAt_idx" ON "GroupMemberProfile"("groupJid", "lastActiveAt");
