# TENANT_FLOW.md

# MinjiBot V2 Tenant Flow

## 1. Core Concept

MinjiBot V2 is a fresh WhatsApp bot project.

The bot is rented per group. One WhatsApp group is one Tenant Group.

Tenant active period belongs to each group.

Heavy feature quota belongs to Tenant Owner.

There is no premium user system.

There is no private limit.

There is no member self-purchase limit.

## 2. Feature Summary

MinjiBot V2 includes these planned feature groups:

1. Tenant rental management.
2. Role-aware menu.
3. Tenant Owner quota.
4. Media downloader.
5. HD photo.
6. HD AI photo.
7. Welcome.
8. Antilink.
9. Antispam.
10. Reminder.
11. Tag all.
12. Game later, only after tenant core is stable.

## 3. Tenant Lifecycle

```txt
Bot sees group
Group becomes PENDING
Super Owner activates tenant
Group becomes ACTIVE
Group can use enabled features
Group expires when active period ends
Group becomes EXPIRED
Super Owner extends group
Group becomes ACTIVE again
Super Owner blocks group
Group becomes BLOCKED
Super Owner removes group
Group becomes REMOVED
```

## 4. Pending Group Flow

When MinjiBot is added to a group or sees a group for the first time:

1. Bot reads groupJid and group name.
2. Bot creates TenantGroup with status PENDING.
3. Bot generates tenantCode.
4. Bot stays silent in the group by default.
5. Super Owner can see pending groups from private chat.

Super Owner command:

```txt
.pendinggroup
```

Bot response:

```txt
[GRUP MENUNGGU APPROVAL]

1. Nama Grup A
   Kode: MNJ-7F3A
   Status: pending

2. Nama Grup B
   Kode: MNJ-9P2B
   Status: pending
```

## 5. Tenant Activation Flow

Tenant activation is done from private chat by Super Owner.

Command:

```txt
.activatetenant <nomorList/kode> <nomorOwner> <durasi> <quota>
```

Example:

```txt
.activatetenant 1 6281234567890 30d 200
```

Meaning:

```txt
Activate pending group number 1.
Set Tenant Owner to 6281234567890.
Set active period to 30 days.
Add 200 heavy feature quota to Tenant Owner.
```

Bot response:

```txt
Tenant berhasil diaktifkan.

Grup: Nama Grup A
Kode: MNJ-7F3A
Tenant Owner: 6281234567890
Masa aktif sampai: 10 Juli 2026
Kuota fitur berat owner: 200
```

Rules:

- Only Super Owner can activate tenant.
- Activation must be done in private chat.
- Tenant Owner number must be normalized to WhatsApp JID.
- TenantGroup status becomes ACTIVE.
- TenantGroup ownerJid is set.
- TenantGroup expiresAt is set.
- TenantFeatureSetting is created if not exists.
- TenantGroupSetting is created if not exists.
- TenantOwnerQuota is created or updated.
- TenantAuditLog is created.

## 6. Tenant Active Period Flow

Active period belongs to Tenant Group.

If one Tenant Owner owns two groups, each group can have different expiresAt.

Example:

```txt
Grup A aktif sampai 30 Juni 2026
Grup B aktif sampai 15 Juli 2026
```

When tenant expires:

- Heavy features stop in that group.
- Normal group features stop in that group.
- Tenant Owner can still use private heavy features if they own at least one other active tenant group.
- Expired tenant can be extended by Super Owner.

Allowed commands in expired group:

```txt
.menu
.status
.tenantstatus
.owner
```

Bot response for blocked feature in expired group:

```txt
Masa aktif grup ini sudah habis.
Silakan hubungi owner bot untuk perpanjangan.
```

## 7. Super Owner Commands

Private chat preferred:

```txt
.pendinggroup
.activatetenant <nomorList/kode> <nomorOwner> <durasi> <quota>
.listtenant
.tenantinfo <kode>
.extendtenant <kode> <durasi>
.settenantexpire <kode> <YYYY-MM-DD>
.blocktenant <kode>
.unblocktenant <kode>
.removetenant <kode>
.addquota <nomorOwner> <jumlah>
.setownerquota <nomorOwner> <jumlah>
.ownerquota <nomorOwner>
.listownerquota
.ownermenu
.tenantmenu
.quotamenu
.featuremenu
```

## 8. Tenant Owner Private Flow

Tenant Owner can manage owned groups in private chat.

### View owned tenants

Command:

```txt
.mytenant
```

Bot response:

```txt
[TENANT KAMU]

1. Nama Grup A
   Kode: MNJ-7F3A
   Status: Aktif
   Masa aktif sampai: 10 Juli 2026

2. Nama Grup B
   Kode: MNJ-9P2B
   Status: Aktif
   Masa aktif sampai: 15 Juli 2026
```

### Select tenant for settings

Command:

```txt
.usetenant 1
```

Bot response:

```txt
Tenant aktif dipilih: Nama Grup A.
Command pengaturan berikutnya akan berlaku untuk tenant ini.
```

### View selected tenant

```txt
.currenttenant
```

### Clear selected tenant

```txt
.cleartenant
```

Selected tenant is required for group-specific settings.

Examples:

```txt
.feature hdai off
.feature downloader on
.antilink on
.antispam on
.welcome on
.setwelcome Selamat datang di grup.
.addtenantadmin 628111222333
```

Selected tenant is not required for private heavy features.

## 9. Private Heavy Feature Flow

Tenant Owner can use private heavy features directly.

Commands:

```txt
.tt <link>
.ig <link>
.igstory <link>
.hdai
.hdai doc
```

Rules:

1. User must be Tenant Owner.
2. Tenant Owner must own at least one ACTIVE tenant group.
3. Tenant Owner quota must be available.
4. Quota is reserved before processing.
5. If success, quota is consumed.
6. If failure, quota is refunded.
7. Result is sent only to private chat.

Tenant Owner does not need to run .usetenant for private heavy features.

Bot response when quota is empty:

```txt
Kuota fitur berat kamu habis.
Hubungi Super Owner untuk menambah kuota.
```

Bot response when no active tenant exists:

```txt
Kamu belum memiliki tenant aktif.
Hubungi Super Owner untuk aktivasi atau perpanjangan.
```

## 10. Member Private Chat Flow

Member private chat is limited.

If member tries:

```txt
.tt <link>
```

Bot response:

```txt
Fitur ini hanya tersedia untuk Tenant Owner di private chat.
Gunakan fitur ini di grup tenant aktif jika tersedia.
```

Member can still receive basic help:

```txt
.menu
```

## 11. Group Heavy Feature Flow

When a member uses heavy feature in an active tenant group:

Example:

```txt
.tt <link>
```

Flow:

1. Load tenant by groupJid.
2. Check tenant is ACTIVE.
3. Check downloaderEnabled is true.
4. Resolve Tenant Owner from group.
5. Check Tenant Owner quota.
6. Reserve quota.
7. Process feature.
8. Send result to group.
9. Consume quota on success.
10. Refund quota on failure.

If quota is empty:

```txt
Kuota fitur berat grup ini habis.
Silakan hubungi Tenant Owner.
```

If feature disabled:

```txt
Fitur ini sedang dinonaktifkan untuk grup ini.
```

If tenant expired:

```txt
Masa aktif grup ini sudah habis.
Silakan hubungi owner bot untuk perpanjangan.
```

## 12. Media Downloader Flow

Commands:

```txt
.tt <link>
.ig <link>
.igstory <link>
```

Group rules:

- Tenant must be ACTIVE.
- downloaderEnabled must be true.
- Consume Tenant Owner quota.
- Result is sent to group.

Private rules:

- Only Tenant Owner and Super Owner can use.
- Member is rejected.
- Tenant Owner must have at least one active tenant group.
- Consume Tenant Owner quota.
- Result is sent to private chat.

Video compatibility rules:

- Output must be playable on WhatsApp Android and iPhone.
- Use mp4 output when possible.
- Use H.264 and AAC when normalization is needed.
- Use faststart when normalization is needed.

## 13. HD Photo Flow

### .hd

Commands:

```txt
.hd
.hd doc
```

Rules:

- Works by replying to a photo or sending a photo with caption.
- Max input size: 7 MB.
- Output scale: 2x.
- Uses sharp.
- Does not consume quota.
- Document mode sends as document.

### .hdai

Commands:

```txt
.hdai
.hdai doc
```

Rules:

- Works by replying to a photo or sending a photo with caption.
- Max input size: 7 MB.
- Output scale: 4x.
- Uses AI upscale dependency when available.
- Consumes 1 Tenant Owner quota.
- Must use queue.
- Must refund quota if processing fails.
- Document mode sends as document.

## 14. Welcome Flow

Commands:

```txt
.welcome on
.welcome off
.setwelcome <pesan>
```

Rules:

- Tenant must be ACTIVE.
- welcomeEnabled controls behavior.
- welcomeMessage is stored per group.
- Welcome does not affect other tenant groups.

## 15. Antilink Flow

Commands:

```txt
.antilink on
.antilink off
```

Rules:

- Tenant must be ACTIVE.
- antiLinkEnabled controls behavior.
- Detect WhatsApp group invite links.
- Delete link if bot is admin.
- Auto kick is optional through group setting.
- Never kick Super Owner, Tenant Owner, or Tenant Admin.

## 16. Antispam Flow

Commands:

```txt
.antispam on
.antispam off
.antispam status
.antispam mode normal
.antispam mode strict
```

Rules:

- Tenant must be ACTIVE.
- antiSpamEnabled controls behavior.
- Normal mode warns or bot-timeouts.
- Strict mode may delete or kick if bot is admin.
- Owner roles must not be kicked.
- Detect message flood, command flood, repeated text, and media spam.

## 17. Reminder Flow

Commands:

```txt
.remind <waktu> <pesan>
.remindall <waktu> <pesan>
.listreminder
.delreminder <nomor>
```

Rules:

- Tenant must be ACTIVE.
- reminderEnabled controls behavior.
- Reminder stores data per groupJid.
- .remindall is scheduled mention all.
- .remindall uses Baileys mentions array.
- Do not rely on native @semua.
- Do not send reminder if tenant is expired or blocked.
- Mark reminder as sent after success.

## 18. Tag All Flow

Command:

```txt
.tagall <pesan>
```

Rules:

- Tenant must be ACTIVE.
- tagAllEnabled must be true.
- Use Baileys mentions array.
- Do not list all users in text body.
- Apply cooldown.
- Only allowed roles can use.

## 19. Role-Aware Menu Flow

Command:

```txt
.menu
```

Private chat behavior:

- Super Owner sees Super Owner Menu.
- Tenant Owner sees Tenant Owner Menu.
- Member sees basic private help.

Group chat behavior:

- Super Owner sees owner-aware group menu or short owner notice.
- Tenant Owner sees tenant group menu.
- Tenant Admin sees tenant admin menu.
- Member sees public group menu.

## 20. Public Group Menu Example

```txt
[MENU MINJIBOT]

[MEDIA]
.tt <link>
.ig <link>
.igstory <link>
.hd
.hd doc
.hdai
.hdai doc

[INFO]
.status
.quota
.menu
```

Show only enabled features if possible.

## 21. Super Owner Menu Example

```txt
[SUPER OWNER MENU]

[TENANT]
.pendinggroup
.activatetenant <nomorList/kode> <nomorOwner> <durasi> <quota>
.listtenant
.tenantinfo <kode>
.extendtenant <kode> <durasi>
.settenantexpire <kode> <YYYY-MM-DD>
.blocktenant <kode>
.unblocktenant <kode>
.removetenant <kode>

[KUOTA OWNER]
.addquota <nomorOwner> <jumlah>
.setownerquota <nomorOwner> <jumlah>
.ownerquota <nomorOwner>
.listownerquota

[MENU]
.tenantmenu
.quotamenu
.featuremenu
.usermenu
```

## 22. Safety Rules

- Do not let one Tenant Owner manage another Tenant Owner tenant.
- Do not let member private chat consume tenant quota.
- Do not let expired tenant use heavy features.
- Do not let blocked tenant use commands.
- Do not reduce quota when validation fails.
- Always refund quota when processing fails after reserve.
- Always log important tenant and quota actions.
- Never expose groupJid to normal users unless needed for Super Owner debugging.
- Use tenantCode in user-facing tenant management commands.
