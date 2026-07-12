# Plan 001 - Repository Audit and Documentation Alignment

## Status

Planned

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