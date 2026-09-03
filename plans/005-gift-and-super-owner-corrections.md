# Plan 005 - Gift and Super Owner Corrections

## Status

Completed

## Execution Evidence

### Files Added

- `src/services/member/gift.service.ts` - Atomic gift transfer in one `$transaction` with balance predicate concurrency
- `src/services/member/memberAdmin.service.ts` - Thin wrapper over `MemberEconomyService` for Super Owner corrections
- `src/commands/member/gift.command.ts` - `.giftpoint` and `.giftlimit` handlers with Baileys participant validation
- `src/commands/member/memberAdmin.command.ts` - `.addpoint`, `.setpoint`, `.addlimit`, `.setlimit`, `.addxp`, `.setxp`, `.memberinfo` (Super Owner only)
- `tests/gift.test.ts` - 17 new tests (gift: 8, admin: 9)

### Files Modified

- `src/commands/index.ts` - Registered `giftCommands` and `memberAdminCommands`

### Participant Validation Approach

Recipient participant check is done at command handler level by calling `context.socket.groupMetadata(chatJid)` to get real-time participant list from Baileys. The JID list is passed to `GiftService` as `participantJids`. This ensures members who have left the group cannot receive gifts even if they have an old profile in the DB.

### Concurrency and Idempotency

- `GiftService` uses `updateMany` with `{ [balanceField]: { gte: amount } }` predicate — if count is 0, throws InsufficientPointsError / InsufficientLimitError without any mutation.
- Idempotency key = `message.key.id` (WhatsApp message ID, globally unique). Checked via `txRepo.findByIdempotencyKey()` before entering the transaction.
- Two ledger entries (GIFT_SENT + GIFT_RECEIVED) share one `correlationId`.

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run build` | 0 errors |
| `npm run test` | 175 pass, 0 fail (17 new tests) |

### Commit

See git log for SHA.

## Objective

Implement atomic point and limit transfers between active participants in the same group, plus audited Super Owner balance corrections.

## Preconditions

- Plan 004 is Completed.
- Persistent member profiles and economy core are stable.
- Working tree is clean.

## Public Gift Commands

```txt
.giftpoint @user <jumlah>
.giftlimit @user <jumlah>
```

Optional reply targeting may be supported if the existing parser already exposes quoted sender safely. Mention targeting remains mandatory.

## Gift Rules

- Group tenant active only.
- Sender and recipient are scoped to current `groupJid`.
- Recipient must currently be a group participant.
- Sender must currently be a group participant through normal command context.
- Reject self-transfer.
- Reject bot JID.
- Amount must be a positive safe integer.
- No fee.
- No minimum remaining balance.
- No daily limit.
- Sender may end at 0.
- Sender may never become negative.
- Tenant Owner follows the same debit rules as any member.
- Recipient profile may be created by the valid transfer.
- Gift does not grant XP.

## Participant Validation

Use current Baileys group metadata or the repository's existing participant resolution abstraction.

Do not validate recipient only by profile existence. A member may have an old profile after leaving the group.

Participant metadata failures must produce a controlled error and no mutation. Avoid fetching metadata repeatedly if a safe current-command cache already exists.

## Atomic Transfer

One Prisma transaction must:

1. Find or create recipient profile.
2. Verify sender balance safely under concurrency.
3. Debit sender.
4. Credit recipient.
5. Create `GIFT_SENT` ledger entry.
6. Create `GIFT_RECEIVED` ledger entry.
7. Use one correlation ID.
8. Commit all operations together.

Use command message ID or another stable event key for idempotency.

## Super Owner Commands

```txt
.addpoint @user <jumlah>
.setpoint @user <jumlah>
.addlimit @user <jumlah>
.setlimit @user <jumlah>
.addxp @user <jumlah>
.setxp @user <jumlah>
.memberinfo @user
```

Rules:

- Group only so group scope is unambiguous.
- Actor must be Super Owner.
- Add requires positive safe integer.
- Set accepts 0 and rejects negative values.
- Administrative mutation does not debit another profile.
- Every mutation records actor, target, before balance, after balance, transaction type, and reason.
- Correction does not grant secondary XP or statistics.
- `.memberinfo` is read-only and shows profile plus recent ledger.

Do not implement infinite numeric balances for Super Owner.

## Expected Modules

Adapt to audited conventions:

```txt
src/services/member/gift.service.ts
src/services/member/memberAdmin.service.ts
src/commands/member/gift.command.ts
src/commands/member/memberAdmin.command.ts
```

A participant resolver abstraction may be added if existing code duplicates group metadata access.

## Command Output

Gift success should show:

- Target display name or JID.
- Amount sent.
- Sender current balance.

Administrative success should show:

- Target.
- Asset.
- Before value.
- After value.
- Actor action type.

Messages must be in Bahasa Indonesia without emoji.

## Menu Integration

- Add gift commands to public group menu.
- Add correction commands only to Super Owner group menu or dedicated admin help.
- Do not expose correction commands to Tenant Owner or Tenant Admin.

## Explicit Non-Changes

- Do not switch `.profile`, `.poin`, or `.rank` yet unless required only for `.memberinfo` internals.
- Do not switch game rewards.
- Do not switch heavy features.
- Do not remove owner quota.

## Testing Requirements

- Valid point gift.
- Valid limit gift.
- Sender may end at 0.
- Insufficient balance rejects with no ledger.
- Self-transfer rejects.
- Bot target rejects.
- Non-participant rejects even with existing profile.
- Recipient profile is created on valid first transfer.
- Tenant Owner is debited normally.
- Paired ledgers use same correlation ID.
- Concurrent transfers cannot overspend.
- Duplicate command event does not transfer twice.
- Metadata failure leaves balances unchanged.
- Non-Super Owner cannot use correction commands.
- Add and set operations are audited.
- Set to 0 works.
- Negative set rejects.
- `.memberinfo` does not create a missing profile unless explicitly documented.

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

- Gift is group-scoped, participant-validated, atomic, and idempotent.
- Tenant Owner has no special minting power.
- Super Owner correction is explicit and audited.
- Menus and command registration follow role boundaries.
- Plan evidence is appended and status is Completed.

## Commit

```txt
feat: add member gifts and balance corrections
```

## Required Completion Report

Codex must report:

- Commands and services added.
- Participant validation approach.
- Concurrency and idempotency behavior.
- Tests and validation results.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 006 was not started.