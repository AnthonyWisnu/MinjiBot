# MinjiBot Member Economy Database Design

## 1. Goal

Provide isolated member profiles per tenant group with safe, auditable, atomic, and idempotent balance changes.

## 2. Scope Key

The profile identity is the composite key:

```txt
groupJid + userJid
```

A user in two groups must have two independent profiles.

## 3. Required Enums

```prisma
enum MemberTransactionAsset {
  POINT
  LIMIT
  EXPERIENCE
}

enum MemberTransactionType {
  INITIAL_BALANCE
  DAILY_REWARD
  GAME_REWARD
  LIMIT_PURCHASE_POINT_DEBIT
  LIMIT_PURCHASE_LIMIT_CREDIT
  GIFT_SENT
  GIFT_RECEIVED
  FEATURE_RESERVE
  FEATURE_CONSUME
  FEATURE_REFUND
  SUPER_OWNER_ADD
  SUPER_OWNER_SET
  CORRECTION
}
```

Extend `HeavyFeatureType` with play song and song lyrics if those features are represented by the enum.

## 4. GroupMemberProfile

Recommended baseline:

```prisma
model GroupMemberProfile {
  id                  String   @id @default(cuid())
  groupJid            String
  userJid             String
  pointsBalance       Int      @default(0)
  limitBalance        Int      @default(3)
  reservedLimit       Int      @default(0)
  experience          Int      @default(0)
  totalPointsEarned   Int      @default(0)
  totalLimitsEarned   Int      @default(3)
  totalGamesPlayed    Int      @default(0)
  totalGamesWon       Int      @default(0)
  currentStreak       Int      @default(0)
  longestStreak       Int      @default(0)
  lastDailyClaimAt    DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)
  transactions GroupMemberTransaction[]

  @@unique([groupJid, userJid])
  @@index([groupJid, experience])
  @@index([groupJid, pointsBalance])
  @@index([userJid])
}
```

Rules:

- All numeric balances must be validated as non-negative.
- Available limit is `limitBalance`.
- Reserved work is stored in `reservedLimit`.
- Do not derive available limit by subtracting reserved from one shared field unless the service contract explicitly uses that design consistently.

## 5. GroupMemberTransaction

Recommended baseline:

```prisma
model GroupMemberTransaction {
  id              String                 @id @default(cuid())
  profileId       String
  groupJid        String
  userJid         String
  actorJid        String?
  targetUserJid   String?
  asset           MemberTransactionAsset
  type            MemberTransactionType
  amount          Int
  balanceBefore   Int?
  balanceAfter    Int?
  feature         HeavyFeatureType?
  correlationId   String?
  idempotencyKey  String?                @unique
  note            String?
  metadata        Json?
  createdAt       DateTime               @default(now())

  profile GroupMemberProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([groupJid, userJid])
  @@index([profileId, createdAt])
  @@index([correlationId])
  @@index([type])
  @@index([createdAt])
}
```

## 6. Transaction Semantics

### Credit

- Lock or update the target profile safely.
- Calculate before and after balance.
- Update balance and create ledger in one Prisma transaction.

### Debit

- Reject insufficient balance.
- Never allow negative after balance.
- Update balance and create ledger in one Prisma transaction.

### Gift

- Debit sender.
- Credit recipient.
- Create paired ledger entries.
- Commit all operations together.

### Purchase

- Debit points.
- Credit limit.
- Create two ledger entries with one correlation ID.
- Commit together.

### Heavy Feature

Reserve:

- Move cost from `limitBalance` to `reservedLimit`.
- Create reserve ledger.

Consume:

- Reduce `reservedLimit`.
- Create consume ledger.

Refund:

- Reduce `reservedLimit`.
- Return the same amount to `limitBalance`.
- Create refund ledger.

## 7. Idempotency

Idempotency keys are mandatory for:

- Daily claim: group, user, WIB date.
- Game reward: group, game type, round ID, user, reward event.
- Heavy feature reserve: command or job correlation ID.
- Heavy feature consume and refund: correlation ID plus operation type.

Duplicate keys must return the existing result or a controlled duplicate response without applying balance changes again.

## 8. Profile Creation

Provide a repository method similar to `findOrCreate(groupJid, userJid)` using a safe upsert. Initial balances must not be credited repeatedly. If the initial balance needs a ledger entry, create it exactly once during profile creation.

## 9. Repository Boundaries

Recommended repositories:

```txt
src/repositories/groupMemberProfile.repository.ts
src/repositories/groupMemberTransaction.repository.ts
```

Command handlers must not import Prisma. Economy services may use a transaction-scoped repository contract.

## 10. Legacy Removal

During introduction and switching phases, keep `TenantOwnerQuota` and `TenantQuotaTransaction` temporarily. Remove them only after all runtime callers, commands, tests, and menu references have moved to member profiles.