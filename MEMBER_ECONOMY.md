# MinjiBot Member Economy Specification

## 1. Economic Assets

### Points

- Spendable.
- Transferable within the same group.
- Used to purchase limits.
- May decrease to 0 but never below 0.

### Limit

- Spendable by heavy features.
- Transferable within the same group.
- Purchased using points.
- Uses available and reserved balances.

### Experience

- Permanent progression.
- Not spendable.
- Not transferable.
- Determines rank.

## 2. Initial Balance

| Asset | Initial Value |
|---|---:|
| Points | 0 |
| Available limit | 3 |
| Reserved limit | 0 |
| Experience | 0 |

## 3. Rank Thresholds

| Rank | Minimum XP |
|---|---:|
| Bronze | 0 |
| Silver | 1,000 |
| Gold | 5,000 |
| Platinum | 15,000 |
| Diamond | 40,000 |
| Master | 100,000 |
| Grandmaster | 250,000 |

Rank must be resolved from XP by a pure domain function. Do not persist rank as the authoritative value.

## 4. Daily Claim

- Base points: random integer from 100 through 300 inclusive.
- XP: 50.
- Bonus limit probability: 10 percent.
- Bonus limit amount: 1.
- Reset: calendar date at 00.00 WIB.
- Timezone: `Asia/Jakarta`.
- Scope: once per profile per WIB date.
- Command context: active tenant group only.

Daily reward must be committed in one database transaction with an idempotency key based on group, user, and WIB date.

## 5. Limit Purchase

- Price: 1,000 points per limit.
- Command: `.belilimit <jumlah>`.
- Total price: requested amount multiplied by 1,000.
- Amount must be a safe positive integer.
- Debit points and credit limits in one database transaction.

## 6. Gift

### Point Gift

`.giftpoint @user <jumlah>`

### Limit Gift

`.giftlimit @user <jumlah>`

Rules:

- Group only.
- Sender and recipient must be active participants in the current group.
- Sender and recipient profiles are scoped to the current `groupJid`.
- Recipient profile may be created when receiving the first valid gift.
- Sender cannot equal recipient.
- No fee.
- No daily cap.
- Sender balance may become 0.
- Transfer must create paired ledger entries for sender and recipient.
- The entire operation must roll back on any failure.

## 7. Heavy Feature Cost

| Feature | Limit Cost |
|---|---:|
| TikTok download | 1 |
| Instagram Reels download | 1 |
| Instagram Story download | 1 |
| Play song | 1 |
| Song lyrics | 1 |
| HD AI Photo | 2 |
| HD AI Photo Document | 2 |

Processing flow:

1. Validate tenant and feature access.
2. Validate input before reserving.
3. Reserve limit atomically.
4. Run external processing.
5. Consume reserved limit on success.
6. Refund reserved limit on processing failure.
7. Use one correlation ID for reserve, consume, and refund.

## 8. Game Rewards

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

Family100 rules:

- Reward each validated answer independently.
- Existing rewards remain when players surrender.
- Duplicate answers never reward twice.
- Maximum reward per user per round is 450 points and 180 XP, excluding or including final bonus according to one consistent implementation documented in tests. Recommended: cap includes the final bonus.

Game reward rules:

- Use round ID and reward event ID as idempotency keys.
- Wrong answer participation XP may be granted at most once per user per round.
- Gift, purchase, and corrections do not grant XP.
- Timeout does not receive loser reward.

## 9. Streak

The profile stores current and longest streak. Core daily must work without milestone rewards. Optional milestone rewards after stabilization:

- Day 7: 300 points.
- Day 14: 500 points.
- Day 30: 1,000 points and 1 limit.

Streak milestone rewards must not be implemented before core ledger and daily tests are stable.

## 10. Super Owner

Super Owner uses normal profiles for normal gameplay and heavy features. Administrative commands can mint or correct assets without debiting a source profile. Every administrative change must store actor JID, reason, before balance, and after balance.