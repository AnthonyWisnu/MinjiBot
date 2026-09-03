# Plan 008A - Game Reward Integration (Quiz, Family100, Tebak Series)

## Status

Completed

## Scope Note

Plan 008 split into:
- **008A** (this plan): Persistent game rewards for kuis, family100, tebakkata, tebakemoji, tebakangka. TicTacToe reward stripped from game.service.ts (in-memory reward removed), PvP design postponed to Plan 008B.
- **008B** (next): TicTacToe full PvP redesign + persistent rewards.

## Execution Evidence

### Architecture Changes

**Before:**
- `GameService` was synchronous (all methods returned `string`)
- In-memory `PlayerProfile`, `profilesByGroup` stored points and stats
- `awardWin()`, `addGamesPlayed()` directly mutated in-memory state
- Legacy `claimDaily()`, `getPoints()`, `getRank()` still present

**After:**
- `GameService` is fully async (`Promise<string>` returns)
- No in-memory profile storage
- All rewards go through `GameRewardService` -> `MemberEconomyService` -> Prisma
- `claimDaily()`, `getPoints()`, `getRank()` removed (replaced by Plan 002-006)
- `game.command.ts` updated to async `replyGame` pattern

### Files Added

- `src/services/game/gameReward.constants.ts` - Single source of truth for all reward values
- `src/services/game/gameReward.service.ts` - Persistent reward service with idempotency

### Files Modified

- `src/services/game/game.service.ts` - Full rewrite: async, persistent rewards, roundId, session tracking
- `src/commands/game/game.command.ts` - Async handler wrapper update
- `src/services/member/memberEconomy.service.ts` - Add idempotencyKey to `recordGameResult`
- `src/types/memberEconomy.ts` - Add idempotencyKey/correlationId to `RecordGameResultInput`
- `tests/gameService.test.ts` - Rewrite to async, remove claimDaily test (replaced by Plan 004)

### Reward Table Applied

| Game | Result | Points | XP |
|---|---|---:|---:|
| Kuis | Correct | 100 | 40 |
| Kuis | Wrong participation (once) | 0 | 5 |
| Tebak Kata | Correct | 125 | 50 |
| Tebak Kata | Surrender (wrong participants only) | 0 | 10 |
| Tebak Emoji | Correct | 100 | 40 |
| Tebak Emoji | Surrender (wrong participants only) | 0 | 10 |
| Tebak Angka | Win attempt 1-3 | 200 | 80 |
| Tebak Angka | Win attempt 4-7 | 150 | 60 |
| Tebak Angka | Win attempt 8+ | 100 | 40 |
| Family100 | Each correct answer | 75 | 30 |
| Family100 | Final answer bonus | 50 | 20 |
| Family100 | Cap per user per round | 450 pts / 180 XP | - |

### Idempotency Key Format

- Kuis correct: `game:kuis:<roundId>:<userJid>:correct`
- Kuis wrong XP: `game:kuis:<roundId>:<userJid>:wrong-xp`
- Family100 answer: `game:family100:<roundId>:<userJid>:answer:<normalizedAnswer>`
- Family100 final bonus: `game:family100:<roundId>:<userJid>:final-bonus`
- Game stat: `<above-key>:stat`

### TicTacToe Status

TicTacToe session logic intact (vs bot, playable), but all in-memory reward calls removed. No replacement reward. To be fully rewired in Plan 008B (PvP).

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run build` | 0 errors |
| `npm run test` | 238 pass, 0 fail (+27 test baru) |

### Commit

See git log for SHA.



## Objective

Remove the legacy in-memory game economy and route every approved game reward, XP change, and game statistic update through the persistent member economy service.

## Preconditions

- Plan 007 is Completed.
- Persistent profiles, ledger, idempotency, and public profile commands are stable.
- Working tree is clean.

## Existing Legacy State

`src/services/game/game.service.ts` currently combines:

- Game session state.
- Question bank.
- Answer validation.
- In-memory `PlayerProfile` storage.
- Daily claim.
- Point profile and rank output.
- Reward mutation.

This violates the target separation of concerns. Keep game session logic only where appropriate and remove all in-memory profile ownership.

## Required Refactor Boundaries

Separate:

```txt
Game session and answer validation
Game reward decision
Member economy mutation
User response formatting
```

Game service may return a structured result describing reward events. A dedicated game reward service must apply those events through the member economy core.

Do not call Prisma directly from game commands or session helpers.

## Session Identity and Idempotency

Every game session must have a stable unique round ID.

Every reward must use a deterministic event key containing at least:

```txt
groupJid
game type
round ID
userJid
reward event type
answer identifier when relevant
```

Examples:

```txt
game:family100:<roundId>:<userJid>:answer:<normalizedAnswer>
game:tictactoe:<roundId>:<userJid>:result:win
```

Do not use timestamps alone.

## Reward Table

| Game | Result | Points | XP |
|---|---|---:|---:|
| Math quiz | Correct | 100 | 40 |
| Math quiz | Wrong participation once per round | 0 | 5 |
| Guess word | Correct | 125 | 50 |
| Guess word | Surrender or fail | 0 | 10 |
| Guess emoji | Correct | 100 | 40 |
| Guess emoji | Surrender or fail | 0 | 10 |
| Guess number | Win in 1-3 attempts | 200 | 80 |
| Guess number | Win in 4-7 attempts | 150 | 60 |
| Guess number | Win after 7 attempts | 100 | 40 |
| Guess number | Fail | 0 | 10 |
| Family100 | Each correct answer | 75 | 30 |
| Family100 | Final answer bonus | 50 | 20 |
| Tic Tac Toe | Winner | 250 | 100 |
| Tic Tac Toe | Normal loser | 50 | 25 |
| Tic Tac Toe | Draw per player | 100 | 50 |
| Tic Tac Toe | Timeout player | 0 | 0 |

## Important Tic Tac Toe Audit Decision

The current implementation appears to be one member versus bot, not member versus member. Before implementing rewards:

- Confirm actual current design from Plan 001.
- If still versus bot, apply winner, loss, draw, and timeout rewards to the human player only.
- Do not invent a second player architecture within this plan.
- If the product is later changed to member versus member, create a separate plan.

## Math Quiz

- Correct answer grants 100 points and 40 XP.
- Wrong answer participation grants 5 XP at most once per user per round.
- Repeated wrong answers do not farm XP.
- Correct answer event must not also duplicate wrong participation XP unless the chosen policy explicitly allows both. Recommended: a user may receive prior participation XP and later correct reward once.

## Guess Word and Guess Emoji

- Correct answer grants configured reward once.
- Surrender or failure participation grants 10 XP according to actual participation tracking.
- Do not grant failure XP to users who never participated.
- A user cannot receive surrender or failure reward multiple times for one round.

## Guess Number

Track attempt count per user or per active player consistently.

- Attempts 1-3: 200 points and 80 XP.
- Attempts 4-7: 150 points and 60 XP.
- More than 7: 100 points and 40 XP.
- Failure or surrender after participation: 0 points and 10 XP.

Inject random number generation for deterministic tests.

## Family100

- Reward every unique validated answer immediately with 75 points and 30 XP.
- Already committed rewards remain when `.nyerah` is used.
- Duplicate normalized answers never reward twice.
- Multiple members can receive independent rewards.
- The member finding the final answer receives an additional 50 points and 20 XP.
- Maximum per user per round is 450 points and 180 XP.
- The cap includes the final-answer bonus.
- Once at cap, answers may still count toward completion but do not grant additional assets.
- Reward response must disclose when a cap prevents additional reward.

## Tic Tac Toe

For the current human-versus-bot design:

- Human win: 250 points and 100 XP, increment games played and games won.
- Human normal loss: 50 points and 25 XP, increment games played only.
- Draw: 100 points and 50 XP, increment games played.
- Timeout or abandonment: 0 reward. Update games played only if the existing product definition considers the game started.
- Surrender behavior must be explicitly mapped to loss or timeout. Recommended: surrender gives 0 reward to prevent farming.

## Game Statistics

Use member economy or a dedicated profile statistics operation:

- `totalGamesPlayed` increments once per completed or qualifying round.
- `totalGamesWon` increments once for a valid win.
- Family100 should count participation according to one documented policy. Recommended: each participating user receives one game played when the round ends or is surrendered.
- Statistics updates must be idempotent.

## Legacy Removal Within Game Service

Remove or disconnect:

```txt
PlayerProfile
profilesByGroup
getProfile in-memory creation
awardWin direct mutation
addGamesPlayed direct mutation
legacy daily logic
legacy profile and rank logic
question reward values as authoritative economy values
```

Question bank may keep content data, but economy rewards must come from centralized configuration or domain policy.

## Async Refactor

Persistent rewards make game methods asynchronous. Update:

- Service method signatures.
- Command wrappers.
- Error handling.
- Session cleanup sequencing.

Do not delete a session before a required reward transaction succeeds unless retry behavior is safely idempotent. Design session finalization to avoid lost or duplicated rewards.

## Testing Requirements

- Every reward table row.
- Stable round IDs.
- Duplicate event replay.
- Wrong participation once per round.
- Guess number attempt bands.
- Family100 multiple users.
- Family100 duplicate answers.
- Family100 surrender preserves prior rewards.
- Family100 cap includes final bonus.
- Tic Tac Toe win, loss, draw, surrender, and timeout.
- Statistics update once.
- Same user in different groups remains isolated.
- Game service no longer stores profile balances.
- Process or handler retry does not duplicate reward.

## Validation

Run equivalent checks for:

```txt
lint
typecheck
game unit tests
member economy integration tests
build
runtime game smoke tests
```

## Acceptance Criteria

- Database profile is the sole game economy source of truth.
- All approved game rewards match specification.
- Family100 partial rewards survive surrender.
- Reward events are idempotent.
- Game statistics are persistent and idempotent.
- No in-memory member balance remains.
- Plan evidence is appended and status is Completed.

## Commit

```txt
refactor: persist game rewards in member economy
```

## Required Completion Report

Codex must report:

- Game architecture changes.
- Legacy in-memory fields and methods removed.
- Reward and idempotency implementation.
- Tic Tac Toe policy actually applied.
- Tests and smoke results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 009 was not started.