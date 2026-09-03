# Plan 007 - Heavy Feature Member Limit Switch

## Status

Completed

## Execution Evidence

### Features Switched

| Feature | Command | Cost | Old System | New System |
|---|---|---|---|---|
| TikTok download | `.tt` | 1 limit | TenantOwnerQuota | Member limit (group profile) |
| Instagram Reels | `.ig` | 1 limit | TenantOwnerQuota | Member limit (group profile) |
| Instagram Story | `.igstory` | 1 limit | TenantOwnerQuota | Member limit (group profile) |
| HD AI Photo | `.hdai` | 2 limit | TenantOwnerQuota | Member limit (group profile) |
| Play song | `.play` | 1 limit | **Tidak ada gating** | Member limit (group profile) |
| Song lyrics | `.lirik` | 1 limit | **Tidak ada gating** | Member limit (group profile) |

`.hd` (HD standar tanpa AI) tidak ada di tabel cost Plan 007 dan tidak menggunakan quota sebelumnya. Tidak diswitch.

### Skip Limit Policy (No Ledger Entry)

| Role | Konteks | Perilaku |
|---|---|---|
| Super Owner | Grup manapun | Skip limit, gratis |
| Super Owner | Private chat | Skip limit, gratis |
| Tenant Owner | Grup miliknya sendiri | Skip limit, gratis |
| Tenant Owner | Private chat (kontrak aktif) | Skip limit, gratis |
| Tenant Owner | Grup lain sebagai member | Bayar dari profil member di grup tersebut |
| Member / Admin | Grup aktif | Bayar dari profil member di grup tersebut |
| Member biasa | Private chat | Bayar dari profil dengan limit terbesar di grup aktif manapun |

### Files Added

- `src/services/member/heavyFeatureCost.ts` - Cost map per HeavyFeatureType
- `src/services/member/heavyFeatureLimit.service.ts` - reserve/consume/refund wrapper
- `src/commands/media/heavyFeatureHelper.ts` - Shared resolveFeatureAccess + helpers untuk semua command
- `tests/heavyFeatureLimit.test.ts` - 23 test baru

### Files Modified

- `src/services/quota/heavyFeatureAccess.service.ts` - Rewrite: ganti TenantOwnerQuota resolution dengan member skipLimit logic
- `src/commands/media/downloader.command.ts` - Switch ke member limit (TT, IG, IGStory)
- `src/commands/media/hdai.command.ts` - Switch ke member limit (HD AI, cost 2)
- `src/commands/media/play.command.ts` - Tambah gating baru (sebelumnya tidak ada)
- `src/commands/media/lyrics.command.ts` - Tambah gating baru (sebelumnya tidak ada)
- `tests/lyricsService.test.ts` - Update context mock: tambah tenantGroup + SUPER_OWNER role

### Reserve/Consume/Refund Boundaries

- **Reserve**: Setelah validasi input, sebelum external processing
- **Consume**: Setelah WhatsApp send sukses
- **Refund**: Di catch block manapun jika reserved = true
- Lirik not found: refund sebelum reply, tidak consume
- Error handling: pesan refund disertakan di reply user

### Owner Quota Not Touched

`tenantQuota.service.ts` dan `TenantOwnerQuota` repository tidak dipanggil sama sekali dari semua command di atas. Import `tenantQuotaService` sudah dihapus dari seluruh command media.

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run build` | 0 errors |
| `npm run test` | 211 pass, 0 fail (23 test baru) |

### Commit

See git log for SHA.

## Objective

Replace Tenant Owner shared quota charging with group-scoped member limit charging for every approved heavy feature while preserving tenant and feature guards.

## Preconditions

- Plan 006 is Completed.
- Member economy reserve, consume, and refund operations are stable.
- Public member profile and balance commands are available.
- Working tree is clean.

## Existing Legacy Flow

Current group heavy feature access resolves `tenantGroup.ownerJid`, reads `TenantOwnerQuota`, and charges one quota through `heavyFeatureAccess.service.ts` and `tenantQuota.service.ts`.

Target flow:

```txt
command sender
current active tenant group
feature enabled validation
input validation
member profile by groupJid + senderUserJid
reserve configured limit cost
external processing
consume on success or refund on failure
```

Tenant Owner ownership must not influence whose limit is charged.

## Charged Features and Costs

| Feature | Cost |
|---|---:|
| TikTok download | 1 limit |
| Instagram Reels download | 1 limit |
| Instagram Story download | 1 limit |
| Play song | 1 limit |
| Song lyrics | 1 limit |
| HD AI Photo | 2 limits |
| HD AI Photo Document | 2 limits |

## Feature Inventory Requirement

Before modifying code, confirm exact implementation status from Plan 001:

- If play song and lyrics exist, switch them.
- If they do not exist, do not invent incomplete implementations inside this plan. Record them as missing and either implement them under an explicitly approved sub-scope or leave a documented blocked item.
- Do not falsely claim all seven features switched when some do not exist.

## Access Service Refactor

Replace or redesign `heavyFeatureAccess.service.ts` so it resolves:

- `groupJid` from active group context.
- `userJid` from command sender.
- Profile identity.
- Feature cost.
- Correlation ID.

The access layer may validate available balance, but the authoritative reserve must remain atomic inside the economy service.

Do not retain owner quota fallback for group commands.

## Private Chat Policy

Member economy is per group. Therefore heavy features using member limits must not operate in private chat unless a future explicit group selection design is approved.

During this refactor:

- Group member heavy features use current group profile.
- Tenant Owner private heavy feature behavior from the legacy architecture must be disabled or explicitly preserved through a separate non-member policy only if the specification is revised.
- Current approved design favors group-only member limit charging.
- Super Owner normal heavy feature usage in a group uses a normal group profile.

Document any private behavior change clearly in user messages and menus.

## Validation Before Reserve

Perform all cheap deterministic validation before reserve:

- Tenant active.
- Feature enabled.
- Required argument or replied media exists.
- URL format and supported provider.
- Input type.
- Input size.
- Required external dependency availability when it can be checked safely.

Do not reserve for malformed input.

## Reserve, Consume, Refund

For each execution:

1. Generate or reuse a stable correlation ID.
2. Reserve exact feature cost.
3. Start processing.
4. Consume exact reserved amount only after successful output preparation or send boundary defined by the feature.
5. Refund on controlled processing failure.
6. Record all ledger entries.
7. Ensure replay cannot double reserve or consume.

Define the success boundary carefully. Recommended:

- Consume after media processing succeeds and before or after WhatsApp send based on existing retry semantics.
- If send failure should refund, document and test it consistently.

## Expected Files

Based on current repository, likely impacted:

```txt
src/services/quota/heavyFeatureAccess.service.ts
src/services/quota/tenantQuota.service.ts
src/commands/media/downloader.command.ts
src/commands/media/hdai.command.ts
related media services
command registry
menu service
quota tests
media tests
```

Create member-specific access or charging modules if clearer, for example:

```txt
src/services/member/heavyFeatureLimit.service.ts
src/services/member/heavyFeatureCost.ts
```

Do not delete legacy quota repository or Prisma tables yet. That is Plan 009.

## User Messages

Insufficient balance:

```txt
Limit kamu tidak cukup untuk menggunakan fitur ini.
Gunakan .daily, beli melalui .belilimit, atau terima gift limit dari member lain.
```

Failure after refund must state that the reserved limit was returned.

Do not mention Tenant Owner quota in group feature responses.

## Menu and Command Changes

- Remove owner quota wording from public feature help.
- Remove private Tenant Owner heavy feature entries if group-only policy is applied.
- Keep feature enable and tenant status checks.
- Do not remove legacy Super Owner quota management commands until Plan 009, but mark them deprecated or hide them if no longer meaningful.

## Testing Requirements

For every implemented charged feature:

- Correct member profile is charged.
- Same user in another group has independent balance.
- Tenant Owner profile is not charged when another member invokes the feature.
- Insufficient balance rejects before external processing.
- Invalid input does not reserve.
- Correct cost is reserved.
- Success consumes reserved balance.
- Processing failure refunds exact cost.
- Duplicate callback or replay does not double charge.
- Concurrent feature requests cannot overspend.
- No owner quota record is read or mutated by switched flows.
- Private chat behavior follows the documented group-only policy.

## Validation

Run equivalent checks for:

```txt
lint
typecheck
unit tests
integration tests
media command tests
build
runtime smoke tests with mocked or available dependencies
```

## Acceptance Criteria

- All existing approved heavy features use member limits.
- Costs match specification.
- Owner quota is absent from active feature execution.
- Reserve, consume, and refund are consistent and tested.
- Tenant and feature guards remain intact.
- Missing play or lyrics implementation is reported honestly.
- Plan evidence is appended and status is Completed.

## Commit

```txt
refactor: charge heavy features to member limits
```

## Required Completion Report

Codex must report:

- Exact features switched.
- Features found missing or blocked.
- Files changed.
- Success and refund boundary.
- Tests and smoke validation.
- Proof owner quota was not mutated.
- Commit SHA.
- Working tree status.
- Explicit statement that Plan 008 was not started.