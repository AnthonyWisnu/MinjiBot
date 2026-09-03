# Plan 010 - Final Validation and Release Readiness

## Status

Completed

## Objective

Perform full repository validation, verify member economy invariants, confirm tenant rental still works, close documentation gaps, and prepare the refactor for merge or deployment.

## Preconditions

- Plans 001 through 009 are Completed.
- Legacy owner quota has been removed from active architecture.
- All implementation commits exist on the refactor branch.
- Working tree is clean before final validation begins.

## Scope

This plan is for verification, correction of validation defects, documentation closure, and release readiness. Do not add unrelated features.

## 1. Repository Integrity

Verify:

- Correct branch.
- No untracked secrets, sessions, media, cookies, credentials, or generated artifacts.
- `.env` remains ignored.
- Migration files are committed and ordered.
- No accidental edits to historical migrations.
- No debug `console.log` or temporary code.
- No `any` without documented technical reason.
- No emoji or em dash in code, documentation, logger strings, or bot messages.

Run:

```txt
git status
git diff --check
repository search for forbidden and legacy patterns
```

## 2. Documentation Consistency

Read and reconcile:

```txt
AGENT.md
README.md
PLAN.md
DATABASE.md
TENANT_FLOW.md
CODEX_REFACTOR_INSTRUCTIONS.md
REFACTOR_REQUIREMENTS.md
MEMBER_ECONOMY.md
MEMBER_DATABASE.md
MEMBER_COMMANDS.md
MEMBER_MIGRATION.md
MEMBER_TESTING.md
plans/001 through plans/010
```

Verify:

- One active economy architecture is described.
- Tenant rental is still documented.
- Profile scope is per group.
- Timezone is `Asia/Jakarta` for daily.
- Costs and rewards are identical across documents and code.
- Private chat policy is consistent.
- Command names and permissions match command registry and menus.
- Missing play or lyrics features are honestly marked if still absent.

## 3. Static Validation

Inspect `package.json` and run all relevant existing scripts. At minimum run equivalents for:

```txt
lint
typecheck
format check
build
prisma generate
prisma validate
```

Do not report success if a command was skipped. Record exact command and output summary.

## 4. Database and Migration Validation

Use a dedicated test database.

### Fresh path

- Create empty database.
- Apply all migrations from zero.
- Run seed if supported and safe.
- Verify expected current tables and enums.

### Upgrade path

- Build a database at the pre-refactor schema.
- Insert representative data:
  - active tenant
  - Tenant Owner
  - legacy owner quota and transactions
  - group settings and features
- Apply all refactor migrations.
- Verify legacy quota tables are removed.
- Verify tenant, settings, reminders, AFK, member profiles, and member ledger remain valid.

### Invariant queries

Confirm no rows violate:

```txt
pointsBalance >= 0
limitBalance >= 0
reservedLimit >= 0
experience >= 0
unique groupJid + userJid
unique non-null idempotency keys
```

## 5. Full Automated Tests

Run all:

- Unit tests.
- Integration tests.
- Command tests.
- Tenant lifecycle tests.
- Member profile tests.
- Daily tests.
- Purchase tests.
- Gift tests.
- Super Owner correction tests.
- Leaderboard tests.
- Heavy feature charging tests.
- Game reward tests.
- Migration tests.

Check for flaky random or timezone tests by running relevant suites repeatedly if practical.

## 6. Architecture Verification

Search and verify:

- No command imports Prisma directly.
- No command mutates profile balances.
- No game service stores member balances in `Map`.
- No active feature reads `ownerJid` to determine payer.
- No owner quota model, service, repository, guard, command, or menu remains.
- All balance mutations pass through member economy service.
- All replayable operations use idempotency.
- All multi-entry operations use correlation IDs.

## 7. Runtime Smoke Tests

Start the bot in a safe development or test environment and verify at minimum:

### Tenant

- Pending tenant detection still works.
- Tenant activation still works without quota input, or uses the revised command contract.
- Active tenant commands work.
- Expired or blocked tenant remains restricted.

### Member economy

- `.profile` creates the caller profile.
- `.daily` works once and rejects duplicate.
- `.belilimit` works with sufficient points.
- `.giftpoint` or `.giftlimit` works between group participants.
- `.toprank` and `.toppoint` render.

### Heavy feature

- One 1-limit feature reserves and consumes.
- One 2-limit feature reserves and consumes.
- One controlled failure refunds.

### Game

- One simple quiz grants persistent reward.
- Family100 partial reward remains after surrender.
- Profile and leaderboard reflect rewards.

Record exact smoke coverage and environment limitations.

## 8. Security and Abuse Review

Review:

- Integer overflow and unsafe input.
- Concurrent overspending.
- Duplicate event replay.
- Self-gift.
- Gift to non-participant.
- Cross-group access.
- Unauthorized correction commands.
- Sensitive values in logs.
- User-controlled text in logger and responses.
- Database transaction rollback behavior.

## 9. Performance Review

Verify:

- Leaderboard uses indexed queries.
- Profile lookup uses composite unique key.
- Transaction history queries are indexed and bounded.
- Group metadata is not fetched excessively.
- Game sessions do not leak indefinitely.
- Ledger operations do not use unnecessary full-table scans.

No premature optimization is required, but obvious regressions must be fixed.

## 10. Final Documentation and Plan Closure

For every plan:

- Confirm status is Completed.
- Append actual changed files.
- Append validation evidence.
- Append commit SHA.
- Record deviations from original plan.

Update the main plan with final completion summary.

## Required Final Report

Create or update a final section containing:

- Refactor summary.
- Final architecture.
- Migration summary.
- Full file change summary.
- Test totals and results.
- Smoke test results.
- Known limitations.
- Missing optional features.
- Deployment instructions.
- Rollback instructions.
- All commit SHAs.

## Acceptance Criteria

- All required static checks pass.
- All required automated tests pass.
- Fresh and upgrade migrations pass.
- Runtime smoke tests pass or environment-dependent limitations are explicitly documented.
- No legacy owner quota runtime dependency remains.
- No in-memory member economy remains.
- Tenant rental remains functional.
- Documentation and implementation are consistent.
- Working tree is clean.
- This plan status is Completed.

## Commit

Use one final correction or closure commit only when needed:

```txt
test: complete member economy refactor validation
```

Do not create an empty commit merely to match the plan.

## Required Completion Report to User

Codex must report:

- Final architecture summary.
- Validation commands and exact outcomes.
- Migration results.
- Smoke test coverage.
- Known limitations.
- Final commit SHA or statement that no final commit was needed.
- Working tree status.
- Merge readiness recommendation.