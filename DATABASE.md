# DATABASE.md

# MinjiBot V2 Database Design

> REFACTOR IN PROGRESS - MEMBER ECONOMY
>
> Sections 4 (TenantOwnerQuota relationship), 5 (quota enums), 6 (TenantOwnerQuota and
> TenantQuotaTransaction models), 9 (Quota Rules), and 14 (Audit Log quota entries) describe
> the LEGACY owner quota system scheduled for removal in Plan 009.
> New member economy schema is defined in MEMBER_DATABASE.md.
> When this document conflicts with CODEX_REFACTOR_INSTRUCTIONS.md, the refactor document wins.

## 1. Database Goal

MinjiBot V2 uses a tenant-based database design.

One WhatsApp group is one Tenant Group. A Tenant Owner can own multiple Tenant Groups. Tenant active period belongs to each group.

LEGACY: Heavy feature quota belongs to Tenant Owner. This is being replaced by member economy where every member has an independent profile per group.

Database must support:

- Multi-tenant group isolation.
- Tenant active period.
- Tenant owner management.
- Tenant admin management.
- Feature settings per tenant group.
- Moderation settings per tenant group.
- Welcome settings per tenant group.
- Reminder data per tenant group.
- LEGACY: Tenant Owner quota (scheduled for removal in Plan 009).
- LEGACY: Quota transaction history (scheduled for removal in Plan 009).
- NEW: Group member profiles per group (points, limit, XP, rank, streak).
- NEW: Member transaction ledger.
- Private tenant session for group-specific settings.
- Audit logs for important actions.

## 2. Database Technology

Production database:

- PostgreSQL

Development database:

- SQLite is allowed only for local development if needed.

ORM:

- Prisma

Do not use JSON files as production storage.

## 3. Core Database Rule

Codex must not assume previous database exists. This is a fresh project.

Do not create:

- PremiumUser
- UserDownloadLimit
- PrivateLimit
- JSON database

These tables ARE now required (member economy refactor):

- GroupMemberProfile
- GroupMemberTransaction

Use tenant-based and member-economy tables as defined in MEMBER_DATABASE.md.

## 4. Relationship Summary

```txt
Tenant Owner
  LEGACY: owns quota through TenantOwnerQuota (scheduled for removal)
  owns one or more TenantGroup through ownerJid

TenantGroup
  has one TenantFeatureSetting
  has one TenantGroupSetting
  has many TenantAdmin
  has many Reminder
  has many TenantAuditLog
  NEW: has many GroupMemberProfile (member economy)

TenantAdmin
  belongs to one TenantGroup

LEGACY: TenantOwnerQuota
  belongs to one ownerJid
  has many TenantQuotaTransaction
  (this relationship will be removed in Plan 009)

NEW: GroupMemberProfile
  belongs to one TenantGroup (cascade delete)
  identified by groupJid + userJid
  has many GroupMemberTransaction

TenantPrivateSession
  stores selected TenantGroup for private group-specific settings
```

## 5. Enums

```prisma
enum TenantStatus {
  PENDING
  ACTIVE
  EXPIRED
  BLOCKED
  REMOVED
}

enum TenantQuotaTransactionType {
  ADD
  SET
  RESERVE
  CONSUME
  REFUND
  CORRECTION
}

enum TenantQuotaSource {
  SUPER_OWNER
  GROUP_COMMAND
  PRIVATE_COMMAND
  SYSTEM
}

enum HeavyFeatureType {
  TIKTOK_DOWNLOAD
  INSTAGRAM_REELS_DOWNLOAD
  INSTAGRAM_STORY_DOWNLOAD
  HD_AI_PHOTO
  HD_AI_PHOTO_DOCUMENT
}

enum TenantAuditAction {
  TENANT_REGISTERED
  TENANT_ACTIVATED
  TENANT_EXTENDED
  TENANT_EXPIRED
  TENANT_BLOCKED
  TENANT_UNBLOCKED
  TENANT_REMOVED
  TENANT_OWNER_CHANGED
  TENANT_ADMIN_ADDED
  TENANT_ADMIN_REMOVED
  FEATURE_UPDATED
  QUOTA_ADDED
  QUOTA_SET
  QUOTA_RESERVED
  QUOTA_CONSUMED
  QUOTA_REFUNDED
  WELCOME_UPDATED
  MODERATION_UPDATED
  REMINDER_CREATED
  REMINDER_DELETED
}

enum AntiSpamMode {
  NORMAL
  STRICT
}
```

## 6. Prisma Schema Draft

Use this as the baseline.

```prisma
model TenantGroup {
  id          String       @id @default(cuid())
  groupJid    String       @unique
  tenantCode  String       @unique
  name        String?
  status      TenantStatus @default(PENDING)
  ownerJid    String?
  expiresAt   DateTime?
  isBlocked   Boolean      @default(false)
  approvedAt  DateTime?
  activatedAt DateTime?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  featureSetting TenantFeatureSetting?
  groupSetting   TenantGroupSetting?
  admins         TenantAdmin[]
  reminders      Reminder[]
  auditLogs      TenantAuditLog[]

  @@index([ownerJid])
  @@index([status])
  @@index([expiresAt])
}

model TenantAdmin {
  id        String   @id @default(cuid())
  groupJid  String
  userJid   String
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)

  @@unique([groupJid, userJid])
  @@index([groupJid])
  @@index([userJid])
}

model TenantFeatureSetting {
  id                String   @id @default(cuid())
  groupJid          String   @unique
  downloaderEnabled Boolean  @default(true)
  hdEnabled         Boolean  @default(true)
  hdAiEnabled       Boolean  @default(true)
  gameEnabled       Boolean  @default(false)
  welcomeEnabled    Boolean  @default(false)
  antiLinkEnabled   Boolean  @default(false)
  antiSpamEnabled   Boolean  @default(false)
  reminderEnabled   Boolean  @default(true)
  tagAllEnabled     Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)
}

model TenantGroupSetting {
  id                  String       @id @default(cuid())
  groupJid            String       @unique
  welcomeMessage      String?
  antiLinkAutoKick    Boolean      @default(false)
  antiSpamMode        AntiSpamMode @default(NORMAL)
  tagAllCooldownSec   Int          @default(600)
  remindAllCooldownSec Int         @default(600)
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)
}

model TenantOwnerQuota {
  id              String   @id @default(cuid())
  ownerJid        String   @unique
  remainingQuota  Int      @default(0)
  reservedQuota   Int      @default(0)
  totalAddedQuota Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  transactions TenantQuotaTransaction[]

  @@index([ownerJid])
}

model TenantQuotaTransaction {
  id            String                     @id @default(cuid())
  ownerJid      String
  groupJid      String?
  actorJid      String?
  amount        Int
  type          TenantQuotaTransactionType
  source        TenantQuotaSource
  feature       HeavyFeatureType?
  note          String?
  correlationId String?
  createdAt     DateTime                   @default(now())

  ownerQuota TenantOwnerQuota @relation(fields: [ownerJid], references: [ownerJid], onDelete: Cascade)

  @@index([ownerJid])
  @@index([groupJid])
  @@index([actorJid])
  @@index([type])
  @@index([feature])
  @@index([createdAt])
  @@index([correlationId])
}

model TenantPrivateSession {
  id        String   @id @default(cuid())
  userJid   String   @unique
  groupJid  String
  expiresAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userJid])
  @@index([groupJid])
  @@index([expiresAt])
}

model Reminder {
  id         String   @id @default(cuid())
  groupJid   String
  message    String
  remindAt   DateTime
  createdBy  String
  mentionAll Boolean  @default(false)
  isSent     Boolean  @default(false)
  sentAt     DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tenantGroup TenantGroup @relation(fields: [groupJid], references: [groupJid], onDelete: Cascade)

  @@index([groupJid, remindAt])
  @@index([isSent, remindAt])
  @@index([createdBy, groupJid])
}

model TenantAuditLog {
  id        String            @id @default(cuid())
  groupJid  String?
  actorJid  String?
  action    TenantAuditAction
  metadata  Json?
  createdAt DateTime          @default(now())

  tenantGroup TenantGroup? @relation(fields: [groupJid], references: [groupJid], onDelete: SetNull)

  @@index([groupJid])
  @@index([actorJid])
  @@index([action])
  @@index([createdAt])
}
```

## 7. TenantGroup Rules

- groupJid must be unique.
- tenantCode must be unique.
- ownerJid can be null while status is PENDING.
- expiresAt can be null while status is PENDING.
- status must be checked before group commands.
- isBlocked is a hard guard.

Status behavior:

```txt
PENDING - bot knows the group but it is not activated
ACTIVE - group can use enabled features until expiresAt
EXPIRED - group active period has ended
BLOCKED - Super Owner blocked the group
REMOVED - group removed from tenant management
```

## 8. Tenant Code Rules

Recommended format:

```txt
MNJ-7F3A
```

Rules:

- Prefix should be MNJ.
- Code must be unique.
- Code must not expose groupJid.
- Super Owner commands should accept tenantCode.
- Some commands may also accept list number after .pendinggroup or .listtenant.

## 9. Quota Rules - LEGACY (Scheduled for Removal in Plan 009)

This section describes the LEGACY owner quota system. It will be removed when Plan 009 is
completed. Do not build new features based on these rules. See MEMBER_DATABASE.md for
the replacement member economy database design.

LEGACY rules (kept for historical reference only):

- ownerJid is unique.
- remainingQuota is usable quota.
- reservedQuota is quota currently reserved by running jobs.
- totalAddedQuota records total quota ever added.
- Quota must never become negative.
- Heavy features must reserve quota before processing.
- If processing succeeds, reserved quota becomes consumed.
- If processing fails, reserved quota is refunded.

LEGACY heavy features (now handled by member limit):

```txt
TIKTOK_DOWNLOAD
INSTAGRAM_REELS_DOWNLOAD
INSTAGRAM_STORY_DOWNLOAD
HD_AI_PHOTO
HD_AI_PHOTO_DOCUMENT
PLAY_SONG (new, in member economy only)
SONG_LYRICS (new, in member economy only)
```

## 10. Feature Setting Rules

Feature settings belong to one tenant group.

Default values:

- downloaderEnabled: true
- hdEnabled: true
- hdAiEnabled: true
- gameEnabled: false
- welcomeEnabled: false
- antiLinkEnabled: false
- antiSpamEnabled: false
- reminderEnabled: true
- tagAllEnabled: false

If feature is disabled, reply:

```txt
Fitur ini sedang dinonaktifkan untuk grup ini.
```

## 11. Group Setting Rules

TenantGroupSetting stores operational group settings:

- welcomeMessage
- antiLinkAutoKick
- antiSpamMode
- tagAllCooldownSec
- remindAllCooldownSec

Do not store large media files here.

## 12. Reminder Rules

Reminder is scoped by groupJid.

Rules:

- isSent prevents duplicate sends.
- mentionAll means scheduled mention all.
- mentionAll must use Baileys mentions array during send.
- Reminder scheduler must check tenant status before sending.
- Expired or blocked tenants must not send scheduled reminder.

## 13. TenantPrivateSession Rules

Used only for private group-specific settings.

Tenant Owner must use:

```txt
.mytenant
.usetenant <nomor/kode>
```

Private heavy features do not require selected tenant.

Session expiration:

- Expire after 7 days of inactivity.
- If expired, ask user to select tenant again.

## 14. Audit Log Rules

Log important actions:

- tenant registered
- tenant activated
- tenant extended
- tenant blocked
- tenant unblocked
- tenant removed
- owner changed
- admin added
- admin removed
- feature changed
- quota added
- quota consumed
- quota refunded
- welcome changed
- moderation setting changed
- reminder created
- reminder deleted

Do not log credentials, cookies, media binary, or sensitive values.

## 15. Repository Layer Rules

Database access must be inside repositories or services designed for data access.

Recommended repositories:

```txt
tenantGroup.repository.ts
tenantAdmin.repository.ts
tenantFeature.repository.ts
tenantGroupSetting.repository.ts
tenantQuota.repository.ts
tenantSession.repository.ts
tenantAudit.repository.ts
reminder.repository.ts
```

Do not access Prisma directly from command handlers.

## 16. Data Isolation Rules

Tenant data must be isolated.

Use:

- groupJid for group data
- ownerJid for Tenant Owner quota
- userJid for private session

Do not allow Tenant Owner to access another Tenant Owner group.

Super Owner can access all tenants.
