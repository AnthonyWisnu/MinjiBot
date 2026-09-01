# Plan 009 - Remove Legacy Owner Quota

## Status

Planned

## Objective

Remove the obsolete Tenant Owner shared quota architecture after all active features and games have switched to persistent member profiles.

## Preconditions

- Plan 008 is Completed.
- Every implemented heavy feature charges member limits.
- Game rewards use persistent member economy.
- Public profile, daily, purchase, gift, and leaderboard commands are stable.
- Working tree is clean.
- A test database backup or disposable test database is available.

## Mandatory Legacy Search

Search the full repository for at least:

```txt
TenantOwnerQuota
TenantQuotaTransaction
TenantQuotaTransactionType
TenantQuotaSource
QUOTA_ADDED
QUOTA_SET
QUOTA_RESERVED
QUOTA_CONSUMED
QUOTA_REFUNDED
tenantQuotaService
TenantQuotaService
TenantQuotaRepository
heavyFeatureAccessService
quotaGuard
OwnerQuotaMutationInput
QuotaReservationInput
.addquota
.setownerquota
.ownerquota
.listownerquota
.quota
quotamenu
remainingQuota
reservedQuota
totalAddedQuota
```

Classify every result as:

- Runtime dependency to remove.
- Test dependency to replace.
- Documentation history to update.
- Migration history that must remain immutable.

Do not edit old migration files that have already been applied. Add a new destructive migration.

## Runtime Files to Remove or Refactor

Based on current repository, likely candidates include:

```txt
src/services/quota/tenantQuota.service.ts
src/repositories/tenantQuota.repository.ts
src/services/quota/heavyFeatureAccess.service.ts
src/commands/quota/quota.command.ts
quota-related guards, types, command registration, and menu entries
tests/quotaAndActivation.test.ts or equivalent
```

Use the Plan 001 audit as the authoritative exact inventory.

Delete a file only when no valid non-legacy responsibility remains. If a file also contains tenant activation behavior, extract or preserve that behavior before deletion.

## Prisma Cleanup

Remove from the current Prisma schema:

- `TenantOwnerQuota`.
- `TenantQuotaTransaction`.
- `TenantQuotaTransactionType`.
- `TenantQuotaSource`.
- Legacy quota-only relations.
- Legacy quota-only audit actions if no historical runtime code requires the enum values.

Consider historical audit rows before removing Prisma enum values. PostgreSQL enum removal may require careful SQL. If audit records use quota action values, either:

- Preserve legacy audit enum values as historical values, or
- Migrate historical rows to a neutral legacy action before enum replacement.

Do not destroy audit history merely to simplify the enum.

Extend or finalize `HeavyFeatureType` for:

```txt
TIKTOK_DOWNLOAD
INSTAGRAM_REELS_DOWNLOAD
INSTAGRAM_STORY_DOWNLOAD
PLAY_SONG
SONG_LYRICS
HD_AI_PHOTO
HD_AI_PHOTO_DOCUMENT
```

Only include features actually supported by current implementation and approved design. Missing features must remain documented.

## Destructive Migration

Create a new migration that:

- Drops owner quota foreign keys.
- Drops owner quota transaction table.
- Drops owner quota table.
- Safely adjusts enums.
- Preserves member profile and ledger data.
- Applies on top of all existing migrations.

Validation must include both:

- Fresh database migration from zero.
- Upgrade migration from the current pre-refactor schema populated with representative owner quota rows.

The approved decision is not to convert old owner quota balances into member limits.

## Command and Menu Cleanup

Remove registration and menu references for:

```txt
.addquota
.setownerquota
.ownerquota
.listownerquota
.quota
.quotamenu when it only serves owner quota
```

Do not silently redirect legacy commands to unrelated member commands. A temporary controlled deprecation response may be retained only if documented and scheduled for later deletion.

Update user-facing text so no group feature says:

```txt
Kuota fitur berat grup ini habis.
Hubungi Tenant Owner.
```

All active text must refer to the invoking member's limit.

## Test Cleanup

- Remove tests that assert owner quota behavior.
- Preserve tenant activation tests by separating quota assumptions from tenant lifecycle.
- Replace heavy feature tests with member limit assertions.
- Add source-level or architecture test where practical to prevent imports of removed modules.
- Confirm no mocked owner quota objects remain.

## Documentation Finalization

Update the primary project documents to reflect final architecture:

```txt
AGENT.md
PLAN.md
DATABASE.md
TENANT_FLOW.md
README.md
CODEX_REFACTOR_INSTRUCTIONS.md
```

Required documentation changes:

- Member profile per group becomes the active architecture.
- Owner quota is described only in migration history if needed.
- In-memory game profiles are removed from current design.
- Heavy feature costs and group-only context are documented.
- Commands and role permissions are synchronized.
- Refactor authority document may be marked implemented but should remain as historical decision record.

## Required Validation

- Full repository search for legacy symbols.
- `git diff --check`.
- Prisma generate.
- Prisma validate.
- Fresh migration test.
- Upgrade migration test with legacy data.
- Full lint.
- Full typecheck.
- Full unit tests.
- Full integration tests.
- Full build.
- Runtime smoke test for tenant activation and one charged feature.

## Acceptance Criteria

- No runtime import or use of owner quota remains.
- Legacy command registration and menus are gone.
- Current Prisma schema contains no owner quota models.
- Existing migration history remains valid.
- New destructive migration succeeds on representative legacy data.
- Tenant rental and activation still work.
- Member ledger data remains intact.
- Documentation describes one economy architecture only.
- Plan evidence is appended and status is Completed.

## Commit

```txt
refactor: remove tenant owner quota system
```

## Required Completion Report

Codex must report:

- Files deleted, retained, and refactored.
- Prisma models and enums removed or preserved.
- Migration name and upgrade test result.
- Legacy search results after cleanup.
- Full validation results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 010 was not started.