# MinjiBot Member Economy Refactor Plan

## Status

Ready for implementation.

## Objective

Replace Tenant Owner shared quota with group-scoped member profiles while preserving tenant rental and all unrelated group management features.

## Required Reading

Codex must read these files before implementation:

1. `CODEX_REFACTOR_INSTRUCTIONS.md`
2. `REFACTOR_REQUIREMENTS.md`
3. `MEMBER_ECONOMY.md`
4. `MEMBER_DATABASE.md`
5. `MEMBER_COMMANDS.md`
6. `MEMBER_MIGRATION.md`
7. `MEMBER_TESTING.md`
8. Current `AGENT.md`, `DATABASE.md`, `TENANT_FLOW.md`, and `PLAN.md` for existing architecture only

When old documents conflict with the new refactor documents, the new refactor documents take precedence.

## Plan 001 - Repository Audit and Documentation Alignment

Goals:

- Inspect the current codebase and locate every owner quota dependency.
- Create an impact inventory by file.
- Update old documentation sections that directly block the new design.
- Do not change runtime code or Prisma schema.

Required output:

- `plans/001-member-economy-audit.md` with exact files, symbols, commands, tests, and migration dependencies.
- Updated status and validation notes.

Validation:

- Documentation consistency search.
- Working tree contains documentation changes only.

## Plan 002 - Member Profile Persistence

Goals:

- Add member profile and ledger enums/models.
- Add additive migration.
- Add profile and transaction repositories.
- Add safe profile find-or-create.
- Keep legacy owner quota intact.

Tests:

- Initial balances.
- Group isolation.
- Idempotent creation.
- Migration on test database.

## Plan 003 - Member Economy Core

Goals:

- Add services for points, limits, reserved limits, XP, rank, ledger, and idempotency.
- Implement atomic credit and debit.
- Implement reserve, consume, and refund state transitions.
- Prevent negative balances and duplicate operations.

Recommended modules:

```txt
src/services/member/memberProfile.service.ts
src/services/member/memberEconomy.service.ts
src/services/member/memberLedger.service.ts
src/services/member/rank.service.ts
```

Tests:

- All balance transitions.
- Concurrent debit safety.
- Duplicate key safety.
- Invalid state transitions.

## Plan 004 - Daily Claim and Limit Purchase

Goals:

- Add WIB calendar date helper.
- Add injectable random provider.
- Implement `.daily`.
- Implement `.belilimit <jumlah>`.
- Add command registration and menu entries.

Tests:

- Date boundary.
- Group isolation.
- Probability branches with mocks.
- Concurrent daily claim.
- Purchase arithmetic and rollback.

## Plan 005 - Gift and Administrative Corrections

Goals:

- Implement point and limit gifts.
- Validate current group participants through Baileys metadata.
- Implement Super Owner add and set commands.
- Add paired ledger records and actor metadata.

Tests:

- Sender-recipient atomicity.
- Non-participant rejection.
- Self-transfer rejection.
- Tenant Owner normal debit.
- Super Owner authorization.

## Plan 006 - Profile, Rank, and Leaderboards

Goals:

- Implement `.profile` and `.profile @user`.
- Implement rank resolver output.
- Implement `.toprank` and `.toppoint`.
- Do not create profiles through read-only lookup.

Tests:

- Current group scope.
- Missing profile behavior.
- Rank thresholds.
- Stable leaderboard ties.
- Caller position outside top 10.

## Plan 007 - Heavy Feature Member Limit Switch

Goals:

- Replace owner quota lookup with sender member profile lookup.
- Apply configured costs.
- Integrate reserve, consume, and refund into every listed feature.
- Keep legacy tables temporarily but stop using them in switched features.

Features:

- TikTok.
- Instagram Reels.
- Instagram Story.
- Play song.
- Song lyrics.
- HD AI Photo.
- HD AI Photo Document.

Tests:

- Per-feature costs.
- Failure refund.
- Invalid input no charge.
- Duplicate job no double charge.
- No owner quota mutation.

## Plan 008 - Game Reward Integration

Goals:

- Route all approved game rewards through member economy service.
- Add round and reward event identifiers.
- Preserve Family100 partial rewards on surrender.
- Enforce duplicate and cap rules.

Tests:

- Every reward table entry.
- Family100 partial completion and surrender.
- Tic Tac Toe timeout.
- Event replay idempotency.

## Plan 009 - Legacy Owner Quota Removal

Goals:

- Remove deprecated commands, menus, guards, services, repositories, types, and tests.
- Remove Prisma owner quota models and enums.
- Add destructive migration.
- Update `AGENT.md`, `DATABASE.md`, `TENANT_FLOW.md`, `PLAN.md`, and `README.md` to the final architecture.

Required source search must return no runtime references to legacy symbols.

## Plan 010 - Final Validation

Goals:

- Run full static, test, build, Prisma, migration, and runtime validation.
- Review transaction and idempotency invariants.
- Review user-facing messages.
- Confirm no secrets or generated files are tracked.
- Update every plan status and final documentation.

Definition of done:

- All required validations pass.
- Working tree is clean.
- No legacy owner quota runtime dependency remains.
- All balance mutations use the economy service and ledger.
- All listed heavy features charge member profiles.
- Tenant rental remains operational.

## Implementation Discipline

- Complete one plan at a time.
- Do not begin the next plan until current tests pass.
- Make one intentional commit per plan.
- Never claim a test passed without running it.
- Do not silently reduce scope to make tests pass.
- Record deviations in the active plan document with reasons and consequences.