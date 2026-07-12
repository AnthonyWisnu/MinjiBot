# MinjiBot Member Economy Commands

## 1. General Rules

- All member economy commands run only in active tenant groups.
- Every command uses the current `groupJid` as profile scope.
- Private chat does not expose member economy commands.
- Command handlers parse and validate input, then call services.
- Command handlers do not mutate balances directly.

## 2. Public Member Commands

| Command | Access | Purpose |
|---|---|---|
| `.profile` | All members | View own profile in current group |
| `.profile @user` | All members | View another member profile in current group |
| `.daily` | All members | Claim daily reward |
| `.belilimit <jumlah>` | All members | Buy limits with points |
| `.giftpoint @user <jumlah>` | All members | Transfer points |
| `.giftlimit @user <jumlah>` | All members | Transfer limits |
| `.toprank` | All members | Top XP leaderboard |
| `.toppoint` | All members | Top point balance leaderboard |

## 3. Super Owner Commands

| Command | Purpose |
|---|---|
| `.addpoint @user <jumlah>` | Add points without debiting a source profile |
| `.setpoint @user <jumlah>` | Set point balance |
| `.addlimit @user <jumlah>` | Add available limit |
| `.setlimit @user <jumlah>` | Set available limit |
| `.addxp @user <jumlah>` | Add XP |
| `.setxp @user <jumlah>` | Set XP |
| `.memberinfo @user` | View detailed profile and recent ledger |

Administrative command rules:

- Group only so target group scope is explicit.
- Actor must be Super Owner.
- Add amount must be a positive safe integer.
- Set value may be 0 but never negative.
- Every administrative mutation requires a reason or stores a standard reason.
- Every mutation records actor, before value, after value, and transaction type.

## 4. Profile Output

Recommended fields:

```txt
PROFIL MEMBER

Nama: <display name>
Rank: <rank>
XP: <experience>
Poin: <pointsBalance>
Limit: <limitBalance>
Daily Streak: <currentStreak> hari
Game Dimainkan: <totalGamesPlayed>
Game Menang: <totalGamesWon>
Profil Dibuat: <createdAt WIB>
```

`.profile @user` rules:

- Target must be a current participant or have an existing profile in the current group.
- Do not search another group.
- Do not create a profile only because it was viewed.
- If no profile exists, reply that the member has not created activity in this group.

## 5. Daily Command

Success output must state:

- Points received.
- XP received.
- Bonus limit if awarded.
- Current point and limit balances.
- Next reset is based on 00.00 WIB.

Duplicate claim on the same WIB date must return a controlled message without mutation.

## 6. Purchase Command

`.belilimit <jumlah>`

Validation:

- Exactly one amount argument.
- Positive safe integer.
- Multiplication must not overflow.
- User must have enough points.

Success output includes purchased amount, spent points, current points, and current limits.

## 7. Gift Commands

Target resolution priority:

1. Mentioned user.
2. Quoted message sender if command syntax supports reply targeting.

Rules:

- Target must be an active group participant.
- Reject self-transfer.
- Reject bot JID.
- Reject non-positive or unsafe amounts.
- Reject insufficient balance.
- Recipient profile may be created by a valid gift.

## 8. Leaderboards

### `.toprank`

- Sort by experience descending.
- Stable tie breaker: earlier `createdAt`, then userJid.
- Show top 10.
- Show caller position if outside top 10.

### `.toppoint`

- Sort by pointsBalance descending.
- Same tie breaker policy.
- Show top 10.
- Show caller position if outside top 10.

## 9. Heavy Feature Messages

Insufficient member limit message must reference the member balance, not Tenant Owner quota.

Recommended response:

```txt
Limit kamu tidak cukup untuk menggunakan fitur ini.
Gunakan .daily, beli melalui .belilimit, atau terima gift limit dari member lain.
```

Processing failures after reserve must refund automatically and inform the user that the reserved limit was returned.

## 10. Legacy Commands

The following owner quota commands are deprecated and removed in the final cleanup phase:

```txt
.addquota
.setownerquota
.ownerquota
.listownerquota
.quota
```

Do not silently repurpose these commands unless an explicit compatibility alias is documented.