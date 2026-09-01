# MinjiBot Member Economy Testing

## 1. Test Layers

- Pure unit tests for rank, prices, rewards, timezone dates, and validation.
- Service tests for transaction semantics and idempotency.
- Repository integration tests using a dedicated PostgreSQL test database.
- Command tests for parsing, authorization, target resolution, and user messages.
- Runtime smoke tests for one real or mocked feature flow.

## 2. Profile Tests

- New profile receives 0 points, 3 limits, 0 reserved limits, and 0 XP.
- Same user in two groups receives isolated profiles.
- Repeated find-or-create does not reset balance.
- Viewing a missing target profile does not create it.
- Existing profile remains after participant leaves and can be reused after rejoin.
- Tenant deletion cascades profiles only when the tenant is permanently removed.

## 3. Rank Tests

Test every lower boundary, exact threshold, and value immediately below the next threshold.

- 0 is Bronze.
- 999 is Bronze.
- 1,000 is Silver.
- 5,000 is Gold.
- 15,000 is Platinum.
- 40,000 is Diamond.
- 100,000 is Master.
- 250,000 is Grandmaster.
- Spending points does not alter rank.

## 4. Daily Tests

- First claim on a WIB date succeeds.
- Second claim on the same WIB date is rejected.
- Claim after the WIB date changes succeeds.
- A claim in Group A does not block Group B.
- Point reward is inclusive from 100 through 300.
- XP reward is exactly 50.
- Mocked random value below threshold awards 1 limit.
- Mocked random value outside threshold awards no limit.
- Concurrent duplicate claims result in exactly one committed reward.
- Idempotency key prevents replay.
- Server timezone does not change WIB date behavior.

## 5. Purchase Tests

- Buying 1 limit costs 1,000 points.
- Buying multiple limits calculates total correctly.
- Insufficient points reject without any mutation.
- Zero, negative, decimal, unsafe integer, and overflow values reject.
- Point debit and limit credit commit together.
- Duplicate purchase idempotency does not apply twice when an idempotency key is used.

## 6. Gift Tests

- Valid point gift debits sender and credits recipient.
- Valid limit gift debits sender and credits recipient.
- Sender may end at 0.
- Insufficient balance rejects.
- Self gift rejects.
- Non-participant target rejects even if an old profile exists.
- Recipient profile is created by a valid first gift.
- Tenant Owner balance is reduced like any member.
- Paired ledger entries share correlation ID.
- Concurrent transfers cannot overspend sender balance.
- Any failure rolls back both sides.

## 7. Super Owner Tests

- Non-Super Owner cannot use correction commands.
- Add and set commands work in the current group scope.
- Set accepts 0 and rejects negative values.
- Administrative changes record actor and before-after balances.
- Administrative minting does not require a source profile.
- Normal gameplay by Super Owner follows normal profile rules.

## 8. Heavy Feature Tests

For every charged feature:

- Insufficient available limit rejects before processing.
- Valid input reserves the configured amount.
- Successful processing consumes reserved limit.
- Processing failure refunds the exact amount.
- Input validation failure does not reserve.
- Duplicate consume does not charge twice.
- Refund after consume is rejected or handled as a controlled invalid state.
- Costs are 1 for TikTok, Reels, Story, play, and lyrics.
- Costs are 2 for HD AI photo and document mode.
- The sender profile in the current group is charged, not Tenant Owner quota.

## 9. Game Reward Tests

### Math Quiz

- Correct answer awards 100 points and 40 XP.
- Wrong participation XP is granted at most once per user per round.

### Guess Word and Emoji

- Correct rewards match specification.
- Surrender or failure reward is not duplicated.

### Guess Number

- Attempt bands produce 200/80, 150/60, or 100/40.
- Failure produces 0 points and 10 XP.

### Family100

- Each unique correct answer awards 75 points and 30 XP.
- Duplicate answer does not reward twice.
- Multiple users receive independent rewards.
- Surrender keeps all committed rewards.
- Final answer awards the bonus once.
- Per-user round cap is enforced consistently.

### Tic Tac Toe

- Winner receives 250 points and 100 XP.
- Normal loser receives 50 points and 25 XP.
- Draw gives each player 100 points and 50 XP.
- Timeout player receives no reward.
- Round result replay does not duplicate rewards.

## 10. Leaderboard Tests

- `.toprank` sorts by XP descending.
- `.toppoint` sorts by current points descending.
- Tie breaker is deterministic.
- Only current group profiles are included.
- Top 10 output is correct.
- Caller position is shown when outside top 10.

## 11. Legacy Removal Tests

- Source search finds no runtime import of legacy quota service after final phase.
- Prisma schema no longer contains owner quota models after final phase.
- Legacy quota commands are not registered or displayed.
- Heavy feature tests prove owner quota is never read or mutated.

## 12. Required Validation Commands

Codex must inspect `package.json` and use existing scripts. Final validation must include equivalent checks for:

```txt
lint
typecheck
test
integration test
build
prisma generate
prisma validate
migration on test database
runtime smoke test
```

Do not claim completion when any required validation is skipped. Document the exact reason if an environment-dependent test cannot run.