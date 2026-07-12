# MinjiBot Member Economy Migration Strategy

## 1. Objective

Migrate from Tenant Owner shared quota to group-scoped member economy without breaking tenant rental or losing control of heavy feature charging.

## 2. Migration Principles

- Use additive migration before destructive migration.
- Never delete legacy tables while runtime code still reads them.
- Keep schema, code, tests, menus, and documentation synchronized per phase.
- Test migrations against a separate database.
- Do not convert legacy owner quota into member balance. The approved decision is to remove the old quota system without balance migration.

## 3. Phase A - Introduce

- Add member transaction enums.
- Add `GroupMemberProfile`.
- Add `GroupMemberTransaction`.
- Add indexes and unique constraints.
- Add repositories and profile creation service.
- Keep `TenantOwnerQuota` and `TenantQuotaTransaction` unchanged.
- Do not switch heavy features yet.

Exit criteria:

- Prisma generate and validate pass.
- Migration applies to an empty database and a copy of the current schema.
- Profile repository integration tests pass.

## 4. Phase B - Economy Core

- Implement ledger-based credit and debit operations.
- Implement points, available limits, reserved limits, and XP operations.
- Implement correlation IDs and idempotency keys.
- Implement rank resolver.
- Add atomic gift and purchase operations.

Exit criteria:

- No direct balance mutation outside the economy service.
- Negative balance tests pass.
- Duplicate operation tests pass.

## 5. Phase C - Public Economy Features

- Add profile command.
- Add daily claim.
- Add limit purchase.
- Add point and limit gifts.
- Add rank and point leaderboards.
- Add Super Owner correction commands.

Exit criteria:

- Commands work only in active tenant groups.
- User profiles remain isolated across groups.
- Participant validation works for gift.

## 6. Phase D - Heavy Feature Switch

Switch the following features to member limits:

- TikTok.
- Instagram Reels.
- Instagram Story.
- Play song.
- Song lyrics.
- HD AI Photo.
- HD AI Photo Document.

Required flow:

- Resolve current group profile from command sender.
- Validate input before reserve.
- Reserve member limit.
- Process feature.
- Consume on success.
- Refund on processing failure.

Do not use owner quota fallback after a feature is switched.

Exit criteria:

- All listed heavy features use member reserve, consume, and refund.
- Owner quota balance does not change during heavy feature tests.

## 7. Phase E - Game Rewards

- Integrate reward service into all approved games.
- Use round and event idempotency keys.
- Preserve earned Family100 rewards on surrender.
- Prevent duplicate answer rewards.
- Apply timeout rules for Tic Tac Toe.

## 8. Phase F - Remove Legacy Owner Quota

Before deletion, search for:

```txt
TenantOwnerQuota
TenantQuotaTransaction
TenantQuotaTransactionType
TenantQuotaSource
tenantQuotaService
tenantQuotaRepository
heavyFeatureAccessService
quotaGuard
.addquota
.setownerquota
.ownerquota
.listownerquota
.quota
```

Then:

- Remove or replace all runtime references.
- Remove old command registrations and menu text.
- Remove old tests or rewrite them for member limits.
- Remove legacy services and repository.
- Remove models and enums from Prisma.
- Create a destructive migration that drops legacy tables only after code switch is complete.

## 9. Rollback Strategy

Before destructive migration:

- Code rollback can return to the previous branch because legacy tables still exist.

After destructive migration:

- Rollback requires restoring database backup or applying a reconstruction migration.
- Therefore create and verify a database backup before Phase F in production.

## 10. Production Checklist

- Backup database.
- Confirm no running old bot process.
- Apply migration.
- Run Prisma validation.
- Start one bot instance.
- Smoke test tenant status, profile, daily, purchase, gift, and one heavy feature.
- Inspect ledger records.
- Confirm no owner quota mutation.
- Monitor errors before restoring normal traffic.