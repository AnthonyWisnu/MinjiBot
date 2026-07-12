# MinjiBot Member Economy Refactor Plan

## Status

Ready for implementation.

## Objective

Replace Tenant Owner shared quota and the temporary in-memory game profile with one persistent group-scoped member economy while preserving tenant rental and unrelated group management features.

## Required Reading Order

Codex must read these documents before starting any plan:

1. `CODEX_REFACTOR_INSTRUCTIONS.md`
2. `REFACTOR_REQUIREMENTS.md`
3. `MEMBER_ECONOMY.md`
4. `MEMBER_DATABASE.md`
5. `MEMBER_COMMANDS.md`
6. `MEMBER_MIGRATION.md`
7. `MEMBER_TESTING.md`
8. The active numbered plan
9. Current `AGENT.md`, `DATABASE.md`, `TENANT_FLOW.md`, `PLAN.md`, and `README.md` for existing architecture context

When old documents conflict with the refactor documents, the refactor documents take precedence.

## Known Legacy Systems

The repository currently contains two economy implementations that must converge into one system:

- Persistent Tenant Owner shared quota in PostgreSQL.
- Temporary per-group game points and daily data stored in memory inside `game.service.ts`.

Codex must not preserve both systems or create a third balance source.

## Execution Order

| Plan | File | Purpose |
|---|---|---|
| 001 | `plans/001-repository-audit-and-documentation-alignment.md` | Audit exact repository impact and align documentation only |
| 002 | `plans/002-member-profile-persistence.md` | Add persistent group member profiles and ledger schema |
| 003 | `plans/003-member-economy-core.md` | Implement atomic asset mutations, ledger, rank, and idempotency |
| 004 | `plans/004-daily-claim-and-limit-purchase.md` | Replace legacy daily and add point-based limit purchase |
| 005 | `plans/005-gift-and-super-owner-corrections.md` | Add group gift and audited Super Owner corrections |
| 006 | `plans/006-profile-rank-and-leaderboards.md` | Replace in-memory profile and rank views |
| 007 | `plans/007-heavy-feature-member-limit-switch.md` | Charge heavy features to invoking member profiles |
| 008 | `plans/008-game-reward-integration.md` | Persist all game rewards and remove in-memory economy |
| 009 | `plans/009-remove-legacy-owner-quota.md` | Remove owner quota runtime, schema, commands, and documentation |
| 010 | `plans/010-final-validation-and-release-readiness.md` | Perform full validation and release-readiness review |

## Mandatory Sequence

- Complete one plan at a time.
- Do not begin the next plan until the active plan is Completed, committed, validated, and the working tree is clean.
- Plan 001 may correct assumptions and exact file lists in Plans 002 through 010, but it must not weaken approved business requirements.
- Plans 002 through 008 are additive or switching phases.
- Destructive owner quota removal is forbidden before Plan 009.
- Plan 010 must validate both fresh migration and upgrade from representative legacy data.

## Commit Sequence

Recommended commits:

```txt
docs: audit member economy refactor impact
feat: add persistent group member profiles
feat: implement member economy core
feat: add daily claim and limit purchase
feat: add member gifts and balance corrections
feat: add persistent profiles and leaderboards
refactor: charge heavy features to member limits
refactor: persist game rewards in member economy
refactor: remove tenant owner quota system
test: complete member economy refactor validation
```

Do not create an empty commit if a plan requires no final correction.

## Global Definition of Done

- Tenant rental and tenant lifecycle remain operational.
- One user can have independent profiles in different groups.
- Daily uses `Asia/Jakarta` and resets at 00.00 WIB.
- Points, available limits, reserved limits, and XP never become negative.
- All balance changes are atomic, ledger-backed, and idempotent where replay is possible.
- All approved heavy features charge the invoking member profile.
- Game rewards persist and no member economy remains in memory.
- Tenant Owner shared quota no longer exists in active runtime or current Prisma schema.
- Documentation, command registry, menus, tests, and migrations are consistent.
- Full validation passes and working tree is clean.

## Starting Codex Instruction

For each execution, tell Codex only which numbered plan to complete. Codex must read the shared documents and the selected plan, inspect the current branch state, complete only that plan, validate it, commit it, and stop before the next plan.