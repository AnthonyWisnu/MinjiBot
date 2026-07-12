# Plan 002 - Member Profile Persistence

## Status

Planned

## Objective

Introduce persistent group-scoped member profiles and an immutable transaction ledger without switching public commands, games, or heavy features yet.

## Preconditions

- Plan 001 is Completed.
- The audit contains exact file names and confirms current Prisma and test patterns.
- Documentation conflicts have been marked.
- Working tree is clean.

## Target Architecture

One profile is identified by:

```txt
groupJid + userJid
```

The user may have independent profiles in different groups. Profile data persists after the member leaves and is reused if the member rejoins.

## Required Prisma Changes

Add enums equivalent to:

```prisma
enum MemberTransactionAsset {
  POINT
  LIMIT
  EXPERIENCE
}

enum MemberTransactionType {
  INITIAL_BALANCE
  DAILY_REWARD
  GAME_REWARD
  LIMIT_PURCHASE_POINT_DEBIT
  LIMIT_PURCHASE_LIMIT_CREDIT
  GIFT_SENT
  GIFT_RECEIVED
  FEATURE_RESERVE
  FEATURE_CONSUME
  FEATURE_REFUND
  SUPER_OWNER_ADD
  SUPER_OWNER_SET
  CORRECTION
}
```

Add models based on `MEMBER_DATABASE.md`:

- `GroupMemberProfile`
- `GroupMemberTransaction`

Required profile fields include:

```txt
pointsBalance
limitBalance
reservedLimit
experience
totalPointsEarned
totalLimitsEarned
totalGamesPlayed
totalGamesWon
currentStreak
longestStreak
lastDailyClaimAt
createdAt
updatedAt
```

Required constraints:

- Unique `groupJid + userJid`.
- Index for leaderboard by group and XP.
- Index for leaderboard by group and points.
- Transaction idempotency key unique when present.
- Cascade relationship from Tenant Group to profiles.

## Migration Strategy

- Create an additive migration only.
- Keep `TenantOwnerQuota` and `TenantQuotaTransaction` intact.
- Do not migrate owner quota into member balances.
- Do not migrate in-memory game profiles because they are not persistent and cannot be reliably recovered.
- Name the migration clearly as member profile introduction.

## Repository Layer

Create repository files following actual repository conventions discovered in Plan 001. Expected files:

```txt
src/repositories/groupMemberProfile.repository.ts
src/repositories/groupMemberTransaction.repository.ts
```

Required repository capabilities:

### Profile repository

- Find by group and user.
- Safe find-or-create using upsert.
- Read profile without creating it.
- List top profiles by XP.
- List top profiles by points.
- Resolve caller position.
- Support transaction-scoped client.

### Transaction repository

- Create one ledger entry.
- Find by idempotency key.
- List recent transactions for a profile.
- Support transaction-scoped client.

Do not put business mutation rules in repositories beyond safe persistence primitives.

## Initial Profile Semantics

A newly created profile receives:

```txt
0 points
3 available limits
0 reserved limits
0 XP
```

Profile creation must be idempotent. Repeated find-or-create must not restore spent limits or reset any balance.

If an initial ledger entry is recorded:

- It must be created exactly once.
- It must not duplicate when concurrent requests create the same profile.
- The ledger representation must clearly describe initial limit balance.

## Expected Source Changes

At minimum, depending on Plan 001 audit:

```txt
prisma/schema.prisma
prisma/migrations/<timestamp>_add_group_member_profiles/migration.sql
src/repositories/groupMemberProfile.repository.ts
src/repositories/groupMemberTransaction.repository.ts
tests or integration tests for repositories
```

Potential supporting type files may be added if they match project conventions.

## Explicit Non-Changes

Do not modify behavior of:

- `.daily`
- `.profile`
- `.poin`
- `.rank`
- Game rewards.
- Downloader charging.
- HD AI charging.
- Owner quota commands.
- Menus.

The old systems remain operational during this additive phase.

## Testing Requirements

- Prisma generate succeeds.
- Prisma validate succeeds.
- Migration applies to an empty test database.
- Migration applies on top of current migrations.
- New profile has exact initial balances.
- Same user in different groups has independent profiles.
- Repeated find-or-create returns the same profile without reset.
- Concurrent creation produces one profile.
- Read-only lookup does not create a profile.
- Tenant deletion cascade behavior is covered according to existing tenant removal design.
- Transaction idempotency key uniqueness is verified.

## Validation

Use actual package scripts. Run at minimum equivalent checks for:

```txt
lint
typecheck
relevant unit tests
relevant integration tests
build
prisma generate
prisma validate
migration on test database
```

## Acceptance Criteria

- Additive schema and migration are complete.
- Repository APIs are typed and transaction-client compatible.
- No public behavior changed.
- Legacy owner quota remains intact.
- In-memory game profiles remain untouched for now.
- Tests prove group isolation and idempotent profile creation.
- Plan execution evidence is appended and status is Completed.

## Commit

```txt
feat: add persistent group member profiles
```

## Required Completion Report

Codex must report:

- Prisma models and indexes added.
- Migration name.
- Repository files added.
- Tests added and results.
- Validation results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 003 was not started.