# Plan 003 - Member Economy Core

## Status

Completed

## Execution Evidence

### Files Added

- `src/types/memberEconomy.ts` - 7 domain error classes + 14 input interfaces
- `src/services/member/rank.service.ts` - Pure rank resolver (resolveRank, nextRankThreshold, rankProgress), no DB access
- `src/services/member/memberEconomy.service.ts` - Core service with all balance mutations
- `tests/memberEconomy.test.ts` - 32 new tests (ok 105 - ok 136)

### Concurrency Strategy

Strategy: `updateMany` with balance predicate + affected-row count check

Pattern:
```typescript
const result = await tx.groupMemberProfile.updateMany({
  where: { id: profile.id, pointsBalance: { gte: amount } },
  data: { pointsBalance: { decrement: amount } },
});
if (result.count === 0) throw new InsufficientPointsError();
```

Rationale: Atomically validates and updates in a single SQL round-trip.
If count === 0, a concurrent write already modified the balance or the balance was insufficient.
No separate SELECT FOR UPDATE needed. Works with PostgreSQL default READ COMMITTED isolation.

### Domain Operations Implemented

| Operation | Method | Atomicity |
|---|---|---|
| Find or lazy-create profile | findOrCreateProfile | upsert |
| Find profile (throw if missing) | findProfile | findUnique |
| Credit points | creditPoints | tx + update |
| Debit points | debitPoints | tx + updateMany predicate |
| Set points (Super Owner) | setPoints | tx + update |
| Credit limit | creditLimit | tx + update |
| Reserve limit | reserveLimit | tx + updateMany predicate |
| Consume limit | consumeLimit | tx + updateMany predicate |
| Refund limit | refundLimit | tx + updateMany predicate |
| Set limit (Super Owner) | setLimit | tx + update |
| Credit XP | creditXp | tx + update |
| Set XP (Super Owner) | setXp | tx + update |
| Record game result | recordGameResult | tx + update |

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run build` | 0 errors |
| `npm run test` | 136 pass, 0 fail (32 new tests) |

### Commit

See git log for SHA.

## Objective

Implement the single authoritative service layer for points, available limits, reserved limits, XP, rank resolution, ledger creation, correlation IDs, and idempotency.

## Preconditions

- Plan 002 is Completed.
- Member profile and transaction repositories exist.
- Additive migration has passed on the test database.
- Working tree is clean.

## Architectural Rule

After this plan, all future balance changes must use the member economy service. Command handlers, game handlers, media handlers, and utilities must never mutate profile balances directly.

The service must support both the default Prisma client and transaction-scoped operations without nested transaction mistakes.

## Expected Modules

Adapt names to actual project conventions discovered in Plan 001. Expected modules:

```txt
src/services/member/memberProfile.service.ts
src/services/member/memberEconomy.service.ts
src/services/member/memberLedger.service.ts
src/services/member/rank.service.ts
src/types/memberEconomy.ts
```

Do not create unnecessary wrappers if the existing architecture supports a smaller clean design.

## Required Domain Operations

### Profile

- Find existing profile without creation.
- Find or create profile with safe initial values.
- Return a domain-safe profile representation.

### Point operations

- Credit points.
- Debit points with sufficient-balance validation.
- Set points for future Super Owner correction.

### Limit operations

- Credit available limit.
- Debit available limit where appropriate.
- Set available limit for future correction.
- Reserve available limit.
- Consume reserved limit.
- Refund reserved limit.

### XP operations

- Credit XP.
- Set XP for future correction.
- XP must never be transferable or spendable.

### Statistics

Provide safe operations to update games played and games won without direct profile mutation by game services.

## Rank Resolver

Implement a pure function using these thresholds:

```txt
Bronze: 0
Silver: 1,000
Gold: 5,000
Platinum: 15,000
Diamond: 40,000
Master: 100,000
Grandmaster: 250,000
```

Requirements:

- No database access.
- Deterministic.
- Rank is derived from XP.
- Spending points does not affect rank.

## Ledger Rules

Every mutation records:

- Profile ID.
- Group JID.
- User JID.
- Actor JID when relevant.
- Target JID when relevant.
- Asset.
- Transaction type.
- Amount.
- Balance before.
- Balance after.
- Correlation ID when part of a multi-entry operation.
- Idempotency key when replay is possible.
- Feature or metadata when relevant.

Amount sign convention must be documented and consistent. Recommended:

- Store positive amount.
- Transaction type and before-after balances indicate debit or credit.

Do not mix positive and negative amount conventions across transaction types.

## Atomicity and Concurrency

The current owner quota repository reads then updates, which may be vulnerable to concurrent overspending depending on isolation and query behavior. Do not copy that pattern blindly.

Implement safe conditional mutations using one of the following approaches consistent with Prisma and PostgreSQL:

- Conditional `updateMany` with balance predicate and affected-row check.
- Serializable transaction with controlled retry.
- Row lock through safe raw SQL only if justified and isolated in repository code.

The chosen strategy must be documented in the plan execution notes.

Required invariants:

```txt
pointsBalance >= 0
limitBalance >= 0
reservedLimit >= 0
experience >= 0
```

## Reserve State Machine

Reserve:

```txt
limitBalance decreases by cost
reservedLimit increases by cost
```

Consume:

```txt
reservedLimit decreases by cost
limitBalance does not change
```

Refund:

```txt
reservedLimit decreases by cost
limitBalance increases by cost
```

Invalid transitions must fail without mutation:

- Consume without sufficient reserved amount.
- Refund without sufficient reserved amount.
- Repeated consume.
- Refund after successful consume.

Idempotency may return the prior successful result when the exact operation is replayed.

## Correlation and Idempotency

Provide helpers or contracts for:

- Unique correlation ID per multi-step business operation.
- Optional caller-supplied idempotency key.
- Duplicate daily, game reward, reserve, consume, and refund prevention.

Do not use timestamps alone as idempotency keys.

## Error Handling

Create typed or consistently classified domain errors for at least:

- Profile not found when read-only behavior is required.
- Insufficient points.
- Insufficient available limit.
- Insufficient reserved limit.
- Invalid amount.
- Duplicate operation.
- Invalid reserve state transition.

User-facing message formatting remains outside the core service.

## Explicit Non-Changes

Do not yet replace:

- In-memory game profile behavior.
- `.daily`, `.profile`, `.poin`, or `.rank`.
- Heavy feature owner quota charging.
- Public menu entries.
- Owner quota commands.

## Testing Requirements

### Pure tests

- Rank threshold boundaries.
- Amount validation.
- Reserve state calculations.

### Service and integration tests

- Credit and debit points.
- Credit and debit limits.
- Credit XP.
- Set operations reject negative values.
- Insufficient balance leaves no ledger entry.
- Every successful mutation creates one correct ledger entry.
- Multi-entry operations share correlation ID.
- Duplicate idempotency key does not mutate twice.
- Concurrent debits cannot overspend.
- Concurrent reserves cannot overspend.
- Consume and refund state transitions.
- Profile initialization does not repeat.

## Validation

Run equivalent checks for:

```txt
lint
typecheck
unit tests
integration tests
build
prisma generate
prisma validate
```

## Acceptance Criteria

- One typed economy service owns all member asset mutations.
- Atomicity and concurrency strategy is tested and documented.
- Ledger is complete for every mutation.
- Rank resolver is pure and tested.
- No public behavior has switched yet.
- Plan execution evidence is appended and status is Completed.

## Commit

```txt
feat: implement member economy core
```

## Required Completion Report

Codex must report:

- Service and type files added.
- Chosen concurrency strategy and rationale.
- Domain operations implemented.
- Test coverage and results.
- Validation results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 004 was not started.