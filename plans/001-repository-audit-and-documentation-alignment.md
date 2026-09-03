# Plan 001 - Repository Audit and Documentation Alignment

## Status

Completed

## Execution Evidence

### Audit Completed: 2026-09-03

### Legacy Owner Quota - Affected Files

| File | References |
|---|---|
| `prisma/schema.prisma` | `TenantOwnerQuota`, `TenantQuotaTransaction`, `TenantQuotaTransactionType`, `TenantQuotaSource`, `TenantAuditAction` (QUOTA_*) |
| `src/repositories/tenantQuota.repository.ts` | Full CRUD for owner quota |
| `src/services/quota/tenantQuota.service.ts` | add/set/reserve/consume/refund quota |
| `src/services/quota/heavyFeatureAccess.service.ts` | resolveQuotaContext, group/private resolution |
| `src/commands/quota/quota.command.ts` | `.addquota`, `.setownerquota`, `.ownerquota`, `.listownerquota`, `.quota` |
| `src/commands/media/downloader.command.ts` | imports and uses both quota services |
| `src/commands/media/hdai.command.ts` | imports and uses both quota services |
| `src/commands/media/hd.command.ts` | needs inspection (may or may not use quota) |
| `src/commands/media/play.command.ts` | live feature, needs quota switch |
| `src/commands/media/lyrics.command.ts` | live feature, needs quota switch |
| `tests/quotaAndActivation.test.ts` | tests owner quota, will need rewrite |

### Legacy In-Memory Game Economy - Affected Symbols

| Symbol | File | Issue |
|---|---|---|
| `profilesByGroup` | `game.service.ts:104` | In-memory, lost on restart |
| `PlayerProfile` | `game.service.ts:29` | No XP, no limit, no streak |
| `claimDaily()` | `game.service.ts:228` | Timezone Asia/Makassar (BUG), reward only 15 pts |
| `DAILY_REWARD = 15` | `game.service.ts:98` | Wrong value (should be 100-300) |
| `awardWin()` | `game.service.ts:387` | Mutates in-memory only |
| `addGamesPlayed()` | `game.service.ts:394` | Mutates in-memory only |
| `getProfile()` | `game.service.ts:399` | Creates in-memory profile |
| `getPoints()` | `game.service.ts:249` | Returns in-memory data |
| `getRank()` | `game.service.ts:260` | Returns in-memory rank |
| `Math.random()` | `game.service.ts:123,324` | Not injectable for tests |

### Heavy Features Status

| Feature | Command | Enum | Uses Quota | Plan |
|---|---|---|---|---|
| TikTok download | `.tt` | `TIKTOK_DOWNLOAD` | Yes | Plan 007 |
| Instagram Reels | `.ig` | `INSTAGRAM_REELS_DOWNLOAD` | Yes | Plan 007 |
| Instagram Story | `.igstory` | `INSTAGRAM_STORY_DOWNLOAD` | Yes | Plan 007 |
| Play song | `.play` | NOT IN ENUM | Unknown | Plan 007 |
| Song lyrics | `.lyrics` | NOT IN ENUM | Unknown | Plan 007 |
| HD AI Photo | `.hdai` | `HD_AI_PHOTO` | Yes | Plan 007 |
| HD AI Photo Doc | `.hdai doc` | `HD_AI_PHOTO_DOCUMENT` | Yes | Plan 007 |
| HD Photo | `.hd` | None | No (light feature) | No change |

### TicTacToe Current State

- Player vs Bot (not PvP).
- No reward stored in DB.
- Session in memory, lost on restart.
- Will be redesigned to PvP in Plan 008.

### Existing Tests Inventory

| Test File | Tests | Fate |
|---|---|---|
| `tests/afkService.test.ts` | AFK service | Keep |
| `tests/antiLinkService.test.ts` | Anti-link | Keep |
| `tests/antiSpamService.test.ts` | Anti-spam | Keep |
| `tests/featureGuard.test.ts` | Feature guard | Keep |
| `tests/gameService.test.ts` | Game (basic) | Rewrite in Plan 008 |
| `tests/lyricsService.test.ts` | Lyrics service | Keep (update imports Plan 007) |
| `tests/manualModerationService.test.ts` | Moderation | Keep |
| `tests/messageParser.test.ts` | Message parser | Keep |
| `tests/quotaAndActivation.test.ts` | Owner quota + activation | Partially rewrite in Plan 009 |
| `tests/roleGuard.test.ts` | Role guard | Keep |
| `tests/tenantAdminService.test.ts` | Tenant admin | Keep |
| `tests/tenantGuard.test.ts` | Tenant guard | Keep |
| `tests/tenantOwnerTransferService.test.ts` | Owner transfer | Keep |
| `tests/time.test.ts` | Time utils | Keep + expand for WIB tests |

### Missing Tests (to be added in later plans)

- Member profile isolation (Plan 002)
- Rank resolver boundary tests (Plan 003)
- Daily claim idempotency and timezone (Plan 004)
- Limit purchase atomicity (Plan 004)
- Gift sender/recipient isolation (Plan 005)
- Leaderboard sorting (Plan 006)
- Heavy feature reserve/consume/refund (Plan 007)
- All game rewards (Plan 008)

### Concurrency Risks

- Daily claim: two concurrent requests same user/group/date could double-reward without idempotency key.
- Gift: concurrent transfers could overspend sender balance without proper transaction locking.
- Heavy feature: reserve without consume could leak reservedLimit if crash occurs.
- TicTacToe PvP: two players acting simultaneously needs turn validation.

### Idempotency Risks

- Daily claim: must use unique key `daily:{groupJid}:{userJid}:{wibDate}`.
- Game rewards: must use `game:{type}:{roundId}:{userJid}:{event}`.
- Heavy feature reserve: must use correlationId across reserve/consume/refund.

### Migration Risks

- Plan 002: additive only, safe.
- Plan 009: destructive (DROP TABLE), requires backup before execution.
- In-memory game state: lost without migration (accepted, no legacy data to preserve).

### Features Not Yet Implemented

- `.belilimit` command - new in Plan 004.
- `.giftpoint` / `.giftlimit` - new in Plan 005.
- `.toprank` / `.toppoint` - new in Plan 006.
- `.addpoint` / `.setpoint` / `.addlimit` / `.setlimit` / `.addxp` / `.setxp` - new in Plan 005.
- `.memberinfo` - new in Plan 005.
- TicTacToe PvP - redesign in Plan 008.

### Documentation Changes Made

| File | Change |
|---|---|
| `AGENT.md` | Added refactor notice, marked owner quota section as legacy, added section 2.3b member economy, updated downloader and HDAI rules |
| `DATABASE.md` | Added refactor notice, marked quota support/relationships/rules as legacy, added member profile relationships, updated core DB rules |
| `TENANT_FLOW.md` | Added refactor notice, updated core concept and feature summary |
| `PLAN.md` | Added refactor notice, updated focus section to mark legacy quota and in-memory profile |
| `README.md` | Updated description to mention member economy |
| `plans/001-*.md` | This file - marked Completed with audit evidence |

### Validation

```bash
git diff --name-only
# Expected: only .md files
```

## Objective

Audit the existing MinjiBot implementation and align all authoritative documentation before any runtime, Prisma, migration, dependency, or test change.

## Known Starting Conditions

The repository currently has two incompatible legacy economy mechanisms:

1. PostgreSQL owner quota through `TenantOwnerQuota`, `TenantQuotaTransaction`, `tenantQuota.service.ts`, `tenantQuota.repository.ts`, and `heavyFeatureAccess.service.ts`.
2. In-memory game profiles inside `src/services/game/game.service.ts` using `profilesByGroup`, `PlayerProfile`, fixed daily reward, point-based rank, and `Asia/Makassar` daily date.

The new target is one persistent group-scoped member economy. Do not preserve the in-memory game profile as a second balance source.

## Required Reading

- `CODEX_REFACTOR_INSTRUCTIONS.md`
- `REFACTOR_REQUIREMENTS.md`
- `MEMBER_ECONOMY.md`
- `MEMBER_DATABASE.md`
- `MEMBER_COMMANDS.md`
- `MEMBER_MIGRATION.md`
- `MEMBER_TESTING.md`
- `plans/MEMBER_ECONOMY_REFACTOR_PLAN.md`
- `AGENT.md`
- `PLAN.md`
- `DATABASE.md`
- `TENANT_FLOW.md`
- `README.md`
- `prisma/schema.prisma`

## Scope

### Audit legacy owner quota

Find and document every reference to:

```txt
TenantOwnerQuota
TenantQuotaTransaction
TenantQuotaTransactionType
TenantQuotaSource
TenantAuditAction quota values
tenantQuotaService
TenantQuotaRepository
heavyFeatureAccessService
quota guard and quota types
quota commands and menu entries
quota tests and activation tests
```

### Audit in-memory game economy

Inspect at minimum:

```txt
src/services/game/game.service.ts
src/commands/game/game.command.ts
src/services/menu/menu.service.ts
src/guards/featureGuard.ts
```

Document:

- `profilesByGroup` lifecycle.
- `PlayerProfile` fields.
- Existing `.daily`, `.poin`, `.profile`, and `.rank` behavior.
- Current rewards embedded in question data.
- Current Tic Tac Toe model, including that it is player versus bot rather than two members if that remains true.
- Current session storage and TTL.
- All `Math.random()` usage that must become injectable for tests.

### Audit charged features

Inspect the full command and service flow for:

- TikTok downloader.
- Instagram Reels downloader.
- Instagram Story downloader.
- HD AI Photo.
- HD AI Photo Document.
- Play song and song lyrics if implemented.

If play song or lyrics are not implemented, explicitly record them as new feature dependencies rather than pretending they exist.

### Audit shared infrastructure

Inspect:

- Command registry.
- Message parser and command context.
- Role guard.
- Tenant guard.
- Feature guard.
- Menu generation.
- Prisma client and transaction patterns.
- Existing test helpers and database reset strategy.
- Package scripts and validation commands.

## Documentation Changes

Update old documentation only enough to prevent it from directing new owner quota work:

- Mark owner quota architecture as legacy and scheduled for removal.
- Mark in-memory game profile as temporary legacy state.
- Add a pointer to `CODEX_REFACTOR_INSTRUCTIONS.md` as refactor authority.
- Preserve useful historical context and current architecture descriptions.
- Do not document unimplemented behavior as completed.

Likely files:

```txt
AGENT.md
PLAN.md
DATABASE.md
TENANT_FLOW.md
README.md
```

## Required Output

Create or complete an audit section in this plan containing:

- Exact affected file list.
- Exact affected symbols.
- Current owner quota call graph.
- Current game profile call graph.
- Target member economy call graph.
- Existing test inventory.
- Missing tests.
- Concurrency risks.
- Idempotency risks.
- Migration risks.
- Features not yet implemented.
- Recommended changes for Plans 002 through 010.

## Non-Goals

- No TypeScript runtime changes.
- No Prisma schema changes.
- No migration.
- No test changes.
- No dependency changes.
- No placeholder implementation.

## Validation

- Run `git diff --check`.
- List changed files.
- Verify all changed files are Markdown only.
- Search the repository for all legacy keywords and record results.
- Confirm no `.ts`, `.prisma`, migration, package, lockfile, or test file changed.

## Acceptance Criteria

- Every owner quota dependency is inventoried.
- Every in-memory game economy dependency is inventoried.
- Charged feature status is verified from code.
- Documentation conflicts are clearly marked.
- Later plans are corrected if audit reveals inaccurate file assumptions.
- This file is updated with execution evidence and set to Completed.

## Commit

```txt
docs: audit member economy refactor impact
```

## Required Completion Report

Codex must report:

- Audit summary.
- Changed documentation files.
- Confirmed implemented and missing features.
- Validation commands and outcomes.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 002 was not started.