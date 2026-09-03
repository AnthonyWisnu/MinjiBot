# Plan 004 - Daily Claim and Limit Purchase

## Status

Completed

## Execution Evidence

### Files Added

- `src/utils/wibDate.ts` - WIB (Asia/Jakarta) date key helper, no server timezone dependency
- `src/services/member/randomProvider.ts` - Injectable `RandomProvider` interface + `defaultRandom` production impl
- `src/services/member/dailyClaim.service.ts` - `DailyClaimService` with streak logic and idempotency key per WIB date
- `src/services/member/limitPurchase.service.ts` - `LimitPurchaseService` with atomic single-transaction debit+credit
- `src/commands/member/daily.command.ts` - `.daily` command handler (group only)
- `src/commands/member/limitPurchase.command.ts` - `.belilimit <jumlah>` command handler (group only)
- `tests/dailyClaim.test.ts` - 22 new tests (WIB date, daily claim, limit purchase)

### Files Modified

- `src/commands/game/game.command.ts` - Removed legacy `.daily` entry (was calling in-memory `gameService.claimDaily()`)
- `src/commands/index.ts` - Registered `dailyCommand` and `limitPurchaseCommand`
- `src/types/memberEconomy.ts` - Added `"DAILY_REWARD"` to `CreditLimitInput.type` union

### Legacy Daily Disconnected

`game.command.ts` no longer routes `.daily` to `gameService.claimDaily()`.
`GameService.claimDaily()` method and `PlayerProfile.lastDailyKey` field remain in source
for now (legacy cleanup is deferred to Plan 008 when full game profile migration happens).

### WIB Date Strategy

Uses `Intl.DateTimeFormat` with `timeZone: "Asia/Jakarta"`.
Returns `YYYY-MM-DD` string key. Does not depend on server timezone.
Idempotency key format: `daily:{groupJid}:{userJid}:{YYYY-MM-DD-WIB}`

### Reward Rules

- Points: random 100-300 (via injectable `RandomProvider`)
- XP: 50 fixed
- Bonus limit: 10% chance, 1 limit
- Streak: increments on consecutive WIB days, resets otherwise

### Limit Purchase Atomicity

Single `$transaction` with `updateMany` balance predicate:
- Debit points and credit limit in one round-trip
- Two ledger entries (POINT and LIMIT) share one correlationId
- `InsufficientPointsError` if `updateMany.count === 0`

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run build` | 0 errors |
| `npm run test` | 158 pass, 0 fail (22 new tests: WIB date 8, daily 8, purchase 6) |

### Commit

See git log for SHA.

## Objective

Replace the legacy in-memory daily behavior with persistent per-group daily claim and implement point-based limit purchase using the member economy core.

## Preconditions

- Plan 003 is Completed.
- Member economy core and idempotency are tested.
- Working tree is clean.

## Existing Legacy Behavior to Replace

`src/services/game/game.service.ts` currently stores `lastDailyKey` in an in-memory `PlayerProfile`, awards a fixed 15 points, and uses timezone `Asia/Makassar`. This implementation must be removed from the active command flow.

Target behavior:

- Persistent profile.
- 100 through 300 random points.
- 50 XP.
- 10 percent chance of 1 bonus limit.
- Once per group per WIB date.
- Timezone `Asia/Jakarta`.

## Required Modules

Expected modules, adjusted to repository conventions:

```txt
src/services/member/dailyClaim.service.ts
src/services/member/limitPurchase.service.ts
src/services/member/randomProvider.ts
src/utils/wibDate.ts
src/commands/member/daily.command.ts
src/commands/member/limitPurchase.command.ts
```

Existing `game.command.ts` registration may be split or updated. Avoid duplicate registration of `.daily`.

## WIB Date Helper

Create one reusable helper that:

- Converts an instant to a stable WIB calendar key.
- Uses `Asia/Jakarta` explicitly.
- Does not depend on server timezone.
- Is injectable or accepts a `Date` for deterministic tests.

Recommended daily idempotency key:

```txt
daily:<groupJid>:<userJid>:<YYYY-MM-DD-WIB>
```

Do not rely only on `lastDailyClaimAt`. Use idempotency protection for concurrent requests.

## Random Provider

Provide an injectable interface for:

- Inclusive integer generation from 100 through 300.
- Probability decision for 10 percent bonus limit.

Production may use cryptographically unnecessary standard randomness, but tests must inject deterministic values. Do not call `Math.random()` directly inside business logic.

## Daily Transaction

Within one database transaction:

1. Find or create profile.
2. Reject duplicate claim for current WIB date.
3. Credit points.
4. Credit 50 XP.
5. Optionally credit 1 limit.
6. Update last claim timestamp and streak fields.
7. Create ledger entries with one correlation ID.
8. Commit once.

Streak rules for core implementation:

- First claim sets current streak to 1.
- Claim on consecutive WIB date increments streak.
- Missing one or more WIB dates resets streak to 1.
- Longest streak updates when current exceeds it.
- Do not add milestone bonus rewards in this plan.

## Limit Purchase

Command:

```txt
.belilimit <jumlah>
```

Rules:

- Group tenant active only.
- Amount must be a positive safe integer.
- Price is 1,000 points per limit.
- Validate multiplication overflow.
- Debit points and credit available limit atomically.
- Create two ledger entries with one correlation ID.
- Purchase does not grant XP.

Recommended idempotency source:

- Use command message ID when available in command context.
- If command context does not expose a stable message ID, add the minimal typed field through parser and context without breaking other commands.

## Command Output

Daily success output includes:

- Points gained.
- XP gained.
- Bonus limit if awarded.
- Current points.
- Current limits.
- Current streak.

Purchase success output includes:

- Limits purchased.
- Points spent.
- Current points.
- Current limits.

All messages use Bahasa Indonesia and no emoji.

## Command and Menu Integration

- Remove `.daily` routing to the legacy game service.
- Register the new command exactly once.
- Add `.belilimit` to the public group menu when appropriate.
- Do not expose these commands in private chat.

## Explicit Non-Changes

- Do not yet replace `.profile`, `.poin`, or `.rank`.
- Do not implement gift.
- Do not switch game rewards.
- Do not switch heavy feature charging.
- Do not remove owner quota tables or commands.

## Testing Requirements

### WIB date tests

- Same instant resolves correctly regardless of server timezone.
- Date immediately before and after 00.00 WIB produces different keys.
- Consecutive date calculation is correct across month and year boundaries.

### Daily tests

- First claim succeeds.
- Duplicate same-date claim rejects.
- Concurrent claims commit once.
- Group A claim does not block Group B.
- Points are inclusive from 100 through 300.
- XP is 50.
- Bonus branch adds exactly 1 limit.
- Non-bonus branch adds no limit.
- Streak increments and resets correctly.
- Ledger entries share correlation ID.
- Replay by message ID is idempotent.

### Purchase tests

- One limit costs 1,000 points.
- Multiple limits calculate correctly.
- Insufficient points rejects without mutation.
- Invalid amounts reject.
- Debit and credit rollback together on failure.
- Purchase gives no XP.

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

- Legacy in-memory daily is no longer used.
- Persistent daily follows WIB date and new rewards.
- Limit purchase is atomic and ledger-backed.
- Commands are registered once and menu is updated.
- No other economy feature is switched prematurely.
- Plan evidence is appended and status is Completed.

## Commit

```txt
feat: add daily claim and limit purchase
```

## Required Completion Report

Codex must report:

- Legacy daily code removed or disconnected.
- New modules and command registrations.
- WIB and random strategy.
- Tests and validation results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 005 was not started.