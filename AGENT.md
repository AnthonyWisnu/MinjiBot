# AGENT.md

# MinjiBot V2 Agent Guide

> REFACTOR IN PROGRESS - MEMBER ECONOMY
>
> The owner quota system described in sections 2.3, 2.3 heavy features, and related architecture rules
> is LEGACY and scheduled for removal. The authoritative guide for the active refactor is:
>
> - CODEX_REFACTOR_INSTRUCTIONS.md (authority document)
> - REFACTOR_REQUIREMENTS.md
> - MEMBER_ECONOMY.md
> - MEMBER_DATABASE.md
> - MEMBER_COMMANDS.md
> - MEMBER_MIGRATION.md
> - MEMBER_TESTING.md
> - plans/MEMBER_ECONOMY_REFACTOR_PLAN.md
>
> When this document conflicts with the refactor documents above, the refactor documents take precedence.

## 1. Project Identity

Project name: MinjiBot.

MinjiBot V2 is a fresh WhatsApp bot project. Do not assume any previous repository, previous feature, previous database, or previous implementation exists.

MinjiBot is a multi-tenant WhatsApp bot for rented WhatsApp groups. One bot can join many WhatsApp groups. Each group is treated as one tenant group.

The bot is not based on premium users. The bot is based on tenant rental.

Main business model:

- Super Owner owns and operates the bot.
- Tenant Owner rents the bot for one or more groups.
- Tenant Admin helps manage a tenant group.
- Member uses public features in an active tenant group.
- Tenant active period belongs to each group.
- LEGACY: Heavy feature quota belongs to Tenant Owner. This is being replaced by member economy.
- NEW: Every member has an independent profile per group with points, limits, XP, and rank.
- NEW: Heavy features consume member limit, not Tenant Owner quota.
- NEW: Members can claim daily rewards, purchase limits, and gift assets to other members.
- NEW: All members including Tenant Owner use normal member profiles for heavy features.
- NEW: Heavy features are available in private chat using the member profile with the highest available limit across active groups.

## 2. Mandatory Feature Scope

Codex must understand that this fresh project includes these planned feature domains.

### 2.1 Tenant Rental System

Required features:

- Register group as pending tenant when the bot sees a group for the first time.
- Super Owner can list pending groups in private chat.
- Super Owner can activate tenant from private chat using group list number or tenant code.
- Super Owner can set Tenant Owner by WhatsApp number.
- Super Owner can set active duration for a tenant group.
- Super Owner can extend tenant active period.
- Super Owner can block, unblock, and remove tenant.
- Tenant Owner can own multiple groups.
- Tenant Owner can view owned groups.
- Tenant Owner can select one tenant for group-specific settings.
- Expired tenant groups cannot use normal features.
- Blocked tenant groups cannot use normal features.

### 2.2 Role-Aware Menu

Required features:

- .menu must show different menu based on role and chat context.
- Super Owner private chat sees Super Owner menu.
- Tenant Owner private chat sees Tenant Owner menu.
- Member private chat sees basic help only.
- Group member sees public group menu.
- Tenant Owner in group sees tenant owner group menu.
- Super Owner can also use .ownermenu, .tenantmenu, .featuremenu, and .quotamenu.

### 2.3 Tenant Owner Quota - LEGACY (Scheduled for Removal)

This section describes the LEGACY owner quota system. It is being replaced by the member economy
system. See CODEX_REFACTOR_INSTRUCTIONS.md for the authoritative refactor rules. Do not build
new features based on this section.

Legacy features (will be removed in Plan 009):

- Quota belongs to Tenant Owner.
- Super Owner can add quota to Tenant Owner.
- Super Owner can set Tenant Owner quota.
- .addquota, .setownerquota, .ownerquota, .listownerquota, .quota commands.

### 2.3b Member Economy (NEW - Replacing Legacy Quota)

Required features:

- Every member has an independent profile per group (points, limit, XP, rank, streak).
- Profile is identified by groupJid plus userJid.
- Daily claim rewards points and XP once per WIB date.
- Members can purchase limits using points (.belilimit).
- Members can gift points or limits to others in the same group (.giftpoint, .giftlimit).
- Heavy features consume member limit, not Tenant Owner quota.
- Super Owner can add or set member points, limits, and XP via admin commands.
- Rank is derived from XP (Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster).
- Leaderboards show top 10 by XP (.toprank) and by points (.toppoint).
- Profile view command (.profile) and member info for Super Owner (.memberinfo @user).

Heavy features that consume member limit:

- TikTok video download (1 limit).
- Instagram Reels download (1 limit).
- Instagram Story download (1 limit).
- Play song (1 limit).
- Song lyrics (1 limit).
- HD AI photo (2 limits).
- HD AI photo document mode (2 limits).

Light features that do not consume limit:

- menu
- tenant status
- HD photo fast mode
- HD photo fast document mode
- welcome
- antilink
- antispam
- reminder
- tagall if enabled
- game sessions (game rewards earn points and XP)

### 2.4 Media Downloader

Required commands:

- .tt <link>
- .ig <link>
- .igstory <link>

Rules:

- In group chat, downloader works only in active tenant group with downloaderEnabled true.
- In group chat, downloader consumes 1 member limit from the member who invoked the command.
- In private chat, downloader is available to any member who has an active profile with sufficient limit in at least one active tenant group.
- In private chat, limit is charged from the profile with the highest available limit across active groups.
- Video output must be compatible with WhatsApp Android and iPhone.
- Use safe video normalization if needed.
- File size limit must come from .env.

### 2.5 HD Photo

Required commands:

- .hd
- .hd doc

Rules:

- .hd works by replying to a photo or sending a photo with caption .hd.
- .hd doc works by replying to a photo or sending a photo with caption .hd doc.
- Input must be image only.
- Max input size is 7 MB.
- Output scale is 2x.
- Use lightweight enhancement with sharp.
- This feature does not consume quota.
- Output must be compatible with WhatsApp Android and iPhone.
- Document mode sends image as document to preserve quality.

### 2.6 HD AI Photo

Required commands:

- .hdai
- .hdai doc

Rules:

- .hdai works by replying to a photo or sending a photo with caption .hdai.
- .hdai doc works by replying to a photo or sending a photo with caption .hdai doc.
- Input must be image only.
- Max input size is 7 MB.
- Output scale is 4x.
- Use AI upscale through a local command line dependency such as Real-ESRGAN when available.
- If dependency is not installed, bot must not crash.
- This feature consumes 2 member limits from the invoking member profile.
- This feature must use a queue.
- Only one HD AI job should run at a time by default.
- Output must be compatible with WhatsApp Android and iPhone.
- Document mode sends image as document to preserve quality.

### 2.7 Moderation

Required initial moderation features:

- .kick
- .del
- .antilink on
- .antilink off
- .antispam on
- .antispam off
- .antispam status
- .antispam mode normal
- .antispam mode strict

Rules:

- Moderation features must be tenant-aware.
- Moderation features must only run in active tenant groups.
- Tenant Owner and Tenant Admin can use moderation features based on permission.
- WhatsApp Group Admin is not automatically Tenant Admin unless explicitly allowed by feature rules.
- Antilink must detect WhatsApp group invite links.
- Antispam must protect against message flood, command flood, repeated text, and media spam.
- Strict antispam can delete or kick only if bot is group admin.
- Normal antispam should warn or bot-timeout, not kick.

### 2.8 Welcome

Required commands:

- .welcome on
- .welcome off
- .setwelcome <pesan>

Rules:

- Welcome is per tenant group.
- Welcome only works in active tenant groups.
- Welcome message is stored per group.
- Welcome must not affect another tenant group.

### 2.9 Reminder

Required commands:

- .remind <waktu> <pesan>
- .remindall <waktu> <pesan>
- .listreminder
- .delreminder <nomor>

Rules:

- Reminder is per tenant group.
- .remind can be used by allowed group users.
- .remindall is scheduled mention all and only for Tenant Owner, Tenant Admin, or Super Owner.
- .remindall must use Baileys mentions array, not depend on native @semua.
- Reminder must not send repeatedly after it is marked sent.
- Reminder must respect tenant active status.

### 2.10 Tag All

Required command:

- .tagall <pesan>

Rules:

- Tag all is per tenant group.
- Tag all uses Baileys mentions array.
- Tag all must not list every user in the text body.
- Tag all must have cooldown.
- Tag all only works if tagAllEnabled is true.
- Tag all only works for allowed roles.

### 2.11 Game

Game is optional for later phase. Do not implement game until tenant core, quota, media, and moderation are stable.

Possible future commands:

- .kuis
- .family100
- .tebakkata
- .tebakemoji
- .tebakangka
- .tictactoe
- .nyerah
- .rank
- .poin
- .profile
- .daily

If implemented later, game must be tenant-aware and scoped by groupJid.

## 3. Non-Goals

Do not build these unless explicitly requested:

- Premium user system.
- Private limit system (member economy replaced this with GroupMemberProfile).
- Payment gateway.
- Auto invoice.
- Auto payment validation.
- Web dashboard.
- AI chatbot.
- Broadcast promotion system.
- Referral system.
- Member wallet.
- Customer deposit.
- Reseller commission.
- Hidden tag.
- JSON database for production.
- Any feature not documented in AGENT.md, DATABASE.md, or TENANT_FLOW.md.

## 4. Required Tech Stack

Use this stack:

- Node.js
- TypeScript
- Baileys
- Prisma ORM
- PostgreSQL for production
- SQLite only for local development if needed
- dotenv
- zod
- pino
- PM2
- ESLint
- Prettier
- sharp for fast HD image processing
- ffmpeg for video normalization and media conversion
- Optional local AI image upscale binary for HD AI

Do not use JSON files as a production database.

## 5. Global Coding Rules

The following rules are mandatory across the project:

1. Do not use emoji in program code, including comments, internal strings, logger messages, file names, function names, and internal error messages.
2. Bot messages to users may be friendly, but avoid emoji so output stays consistent and professional.
3. Do not use em dash in code, comments, documentation, prompts, AGENT.md, PLAN.md, README, or bot message strings.
4. Use a normal hyphen if a sentence needs separation.
5. All bot messages must use Bahasa Indonesia.
6. Use TypeScript strict mode.
7. Do not use any unless truly required. If any is used, add a comment explaining the technical reason.
8. Do not hardcode owner number, session path, database URL, command prefix, or other important configuration.
9. All important configuration must come from .env.
10. Do not commit session files, QRIS files, media files, cookies, tokens, or credentials.
11. Every async function must have clear error handling.
12. Errors in commands must not crash the bot.
13. Use pino logger, not console.log.
14. Do not build features outside the documented scope unless explicitly instructed.
15. Do not mix business logic into command handlers.
16. Do not put database access directly in utility files.
17. Do not create one large file with many responsibilities.
18. The program must be modular and follow the Single Responsibility Principle.

## 6. Recommended Folder Structure

Use feature-based modular structure.

```txt
src/
  bot/
    connection.ts
    lifecycle.ts
    messageHandler.ts
    messageParser.ts
  config/
    env.ts
  commands/
    index.ts
    menu.command.ts
    tenant/
      superOwnerTenant.command.ts
      tenantOwner.command.ts
      tenantMenu.command.ts
    quota/
      quota.command.ts
    moderation/
      kick.command.ts
      deleteMessage.command.ts
      antiLink.command.ts
      antiSpam.command.ts
    media/
      downloader.command.ts
      hd.command.ts
    reminder/
      reminder.command.ts
    tagall/
      tagAll.command.ts
    member/
      memberProfile.command.ts
      memberDaily.command.ts
      memberLimit.command.ts
      memberGift.command.ts
      memberAdmin.command.ts
  services/
    tenant/
      tenantGroup.service.ts
      tenantActivation.service.ts
      tenantPermission.service.ts
      tenantFeature.service.ts
      tenantSession.service.ts
    quota/
      tenantQuota.service.ts
    member/
      memberEconomy.service.ts
      rank.service.ts
    moderation/
      antiLink.service.ts
      antiSpam.service.ts
    media/
      downloader.service.ts
      imageEnhance.service.ts
      imageAiUpscale.service.ts
      videoNormalize.service.ts
    reminder/
      reminder.service.ts
      reminderScheduler.ts
    tagall/
      tagAll.service.ts
  repositories/
    tenantGroup.repository.ts
    tenantAdmin.repository.ts
    tenantFeature.repository.ts
    tenantQuota.repository.ts
    tenantSession.repository.ts
    tenantAudit.repository.ts
    reminder.repository.ts
    groupMemberProfile.repository.ts
    groupMemberTransaction.repository.ts
  guards/
    tenantGuard.ts
    roleGuard.ts
    featureGuard.ts
    quotaGuard.ts
  utils/
    jid.ts
    time.ts
    format.ts
    mediaTarget.ts
    tempFile.ts
  types/
    command.ts
    tenant.ts
    role.ts
    feature.ts
    quota.ts
    memberEconomy.ts
prisma/
  schema.prisma
  seed.ts
```

## 7. Architecture Rules

- Command files parse user input and call services.
- Services contain business logic.
- Repositories contain Prisma data access.
- Guards check access, role, tenant status, feature status, and quota.
- Utilities must not contain business logic.
- Do not import Prisma client directly in command files.
- Do not import command files into services.
- Do not put tenant logic inside unrelated media or game services.
- All tenant-specific data must be scoped by groupJid.
- LEGACY: Tenant Owner quota is scoped by ownerJid (will be removed in Plan 009).
- NEW: All member balance mutations must go through MemberEconomyService. Command handlers, game handlers, and media handlers must never mutate GroupMemberProfile directly.
- NEW: Rank is a pure derived value from XP. Never persist rank as an authoritative field.
- NEW: Every balance mutation must create a corresponding GroupMemberTransaction ledger entry.
- NEW: Heavy features must reserve limit before processing, then consume on success or refund on failure.

## 8. Line Limit Rules

Use these line limits as a guide.

- Command handler: 80 to 150 lines
- Service: 150 to 250 lines
- Orchestrator: 250 to 350 lines
- Repository: 120 to 220 lines
- Guard and permission checker: 100 to 220 lines
- Validator and zod schema: 80 to 180 lines
- Type definition: flexible, but split by domain
- Pure helper and utility: flexible, but focused
- Prisma schema: may exceed limit if reasonable
- Seed file: may exceed limit if needed

## 9. Implementation Priority

Build in this order:

1. Project setup, env validation, logger.
2. Baileys connection and safe lifecycle.
3. Prisma setup.
4. Message parser and command router.
5. Super Owner detection.
6. Pending tenant registration.
7. Tenant activation from private chat.
8. Tenant status guard.
9. Role-aware menu.
10. Tenant Owner quota.
11. Feature gate.
12. Public group status and quota.
13. HD photo fast mode.
14. Heavy feature quota reserve and refund.
15. Downloader.
16. HD AI.
17. Welcome.
18. Antilink.
19. Antispam.
20. Reminder.
21. Tag all.
22. Game only after all above are stable.

Do not implement all features at once.
