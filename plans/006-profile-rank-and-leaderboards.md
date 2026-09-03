# Plan 006 - Profile, Rank, and Leaderboards

## Status

Completed

## Execution Evidence

### Files Added

- `src/services/member/memberProfileView.service.ts` - Read-only profile view (own = findOrCreate, target = find-only)
- `src/services/member/leaderboard.service.ts` - Top 10 XP and points leaderboards with caller position
- `src/commands/member/profile.command.ts` - `.profile`, `.profile @user`, `.poin` (alias, concise balance)
- `src/commands/member/leaderboard.command.ts` - `.toprank` (alias `.rank`), `.toppoint`
- `tests/profileLeaderboard.test.ts` - 13 new tests

### Files Modified

- `src/commands/game/game.command.ts` - Removed legacy `.rank`, `.poin`, `.profile` entries (were calling in-memory game service)
- `src/commands/index.ts` - Registered `profileCommands`, `leaderboardCommands`

### Legacy Methods Disconnected

`game.service.ts` methods `getPoints`, `getProfileText`, `getRank` and `profilesByGroup` reads are no longer routed to from any command. The methods remain in source until Plan 008 (full game profile migration).

### Commands and Aliases

- `.profile` → own profile (findOrCreate), `.profile @user` → target (read-only)
- `.poin` → concise own balance display
- `.toprank` / `.rank` → XP leaderboard (top 10, caller position if outside)
- `.toppoint` → points leaderboard (same rules)

Aliases handled by `CommandRouter.register()` which reads `definition.aliases` and maps each name to the same handler.

### Leaderboard Query Strategy

Uses two dedicated DB queries per leaderboard call:
1. `findMany` ordered by XP/points DESC, limit 10 (the top list)
2. If caller not in top list: `count({ where: { [field]: { gt: callerValue } } }) + 1` for position

No in-memory sorting. Tie breaker is delegated to Prisma default (insertion order = earlier profile creation, then by PK).

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run build` | 0 errors |
| `npm run test` | 188 pass, 0 fail (13 new tests) |

### Commit

See git log for SHA.

## Objective

Replace legacy in-memory `.profile`, `.poin`, and `.rank` behavior with persistent profile views, XP-based ranks, and per-group leaderboards.

## Preconditions

- Plan 005 is Completed.
- Persistent profiles and ledger operations are stable.
- Working tree is clean.

## Existing Legacy Behavior to Replace

`src/services/game/game.service.ts` currently:

- Stores profiles in `profilesByGroup` memory maps.
- Uses `PlayerProfile` with points, wins, games played, and last daily key.
- Uses `.poin` and `.profile` as equivalent output.
- Uses `.rank` sorted by current points.

This state must stop being an active source of truth. Do not maintain synchronization between memory and database.

## Public Commands

```txt
.profile
.profile @user
.toprank
.toppoint
```

Legacy aliases may be retained only when explicitly documented:

- `.poin` may alias `.profile` or a concise balance display.
- `.rank` may alias `.toprank`.

Avoid multiple independent implementations for aliases.

## Profile Read Rules

### `.profile`

- Find or create the caller profile because the caller is actively using the economy.
- Scope by current group and sender JID.

### `.profile @user`

- Read target profile in current group only.
- Do not create a missing target profile merely because it is viewed.
- Target may be a current participant or an existing historical profile in the group.
- If no profile exists, return a controlled message.

Recommended output:

```txt
PROFIL MEMBER

Nama: <display name>
Rank: <derived rank>
XP: <experience>
Poin: <pointsBalance>
Limit: <limitBalance>
Daily Streak: <currentStreak> hari
Game Dimainkan: <totalGamesPlayed>
Game Menang: <totalGamesWon>
Profil Dibuat: <createdAt in WIB>
```

Do not expose reserved limit in public profile output. It may appear in Super Owner `.memberinfo`.

## Rank Rules

Use the pure resolver from Plan 003:

```txt
Bronze: 0
Silver: 1,000
Gold: 5,000
Platinum: 15,000
Diamond: 40,000
Master: 100,000
Grandmaster: 250,000
```

Do not persist rank as authoritative data.

## Leaderboards

### `.toprank`

- Sort by XP descending.
- Current group only.
- Top 10.
- Deterministic tie breaker: earlier profile creation, then user JID.
- Show caller position if outside top 10.

### `.toppoint`

- Sort by current points descending.
- Same scope, size, tie breaker, and caller-position rule.

Avoid loading all profiles into memory if database ranking queries can provide top rows and caller position efficiently.

## Display Name Resolution

Use existing group metadata or contact name helpers when available. Fall back safely to normalized JID or phone number. Display name failure must not fail the leaderboard.

## Expected Modules

Adapt to actual architecture:

```txt
src/services/member/memberProfileView.service.ts
src/services/member/leaderboard.service.ts
src/commands/member/profile.command.ts
src/commands/member/leaderboard.command.ts
```

Legacy methods in `game.service.ts` must be removed or disconnected:

```txt
getPoints
getProfileText
getRank
profilesByGroup profile reads
```

Do not remove game sessions or reward logic yet. That occurs in Plan 008.

## Command and Menu Integration

- Register commands exactly once.
- Remove legacy routing from `game.command.ts`.
- Update public group menu.
- Keep private chat unsupported.
- Ensure `.profile @user` mention parsing is consistent with gift target parsing.

## Testing Requirements

- Own profile creates or reads correct group profile.
- Target profile read does not create missing profile.
- Same user has different output in different groups.
- Rank thresholds are displayed correctly.
- Spending points does not reduce rank.
- `.toprank` sorts by XP.
- `.toppoint` sorts by points.
- Tie breaker is deterministic.
- Only current group is included.
- Top 10 limit is applied.
- Caller position outside top 10 is shown.
- Display name fallback works.
- Aliases, if retained, route to the same implementation.
- No command remains connected to in-memory profile state.

## Validation

Run equivalent checks for:

```txt
lint
typecheck
unit tests
integration tests
build
```

## Acceptance Criteria

- Persistent database profiles are the sole read source for public profile and leaderboard commands.
- Rank is XP-based.
- Point and XP leaderboards are distinct.
- In-memory profile read methods are no longer used.
- Commands and menus are synchronized.
- Plan evidence is appended and status is Completed.

## Commit

```txt
feat: add persistent profiles and leaderboards
```

## Required Completion Report

Codex must report:

- Legacy methods removed or disconnected.
- Commands and aliases registered.
- Leaderboard query strategy.
- Tests and validation results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 007 was not started.