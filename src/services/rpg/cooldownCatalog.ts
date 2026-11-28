/**
 * Pusat Single Source of Truth untuk seluruh durasi cooldown & timer fitur MinjiBot.
 * Semua modul mengimpor dari sini untuk mencegah angka duplikat atau tidak sinkron dengan `.cooldown`.
 */

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// 1. Kerja, Ekonomi & Kriminal Dasar (3x anti-spam & anti-inflasi)
export const RPG_COOLDOWNS_MS: Record<string, number> = {
  mulung: 18 * MIN, // sebelumnya 6m
  kerja: 30 * MIN, // sebelumnya 10m
  ojek: 30 * MIN, // sebelumnya 10m
  nambang: 60 * MIN, // sebelumnya 20m
  berburu: 60 * MIN, // sebelumnya 20m
  mancing: 60 * MIN, // sebelumnya 20m
  korupsi: 90 * MIN, // sebelumnya 30m
  megakorupsi: 6 * HOUR, // sebelumnya 2j
  pajak: 3 * HOUR, // sebelumnya 1j
  maling: 2 * HOUR, // sebelumnya 40m
  bansos: 18 * HOUR, // sebelumnya 6j
  casino: 30 * SEC, // sebelumnya 10d
};

// 2. Petualangan & Solo RPG (3x)
export const INFINITE_RPG_COOLDOWNS_MS: Record<string, number> = {
  adventure: 48 * MIN, // sebelumnya 16m
  nebang: 30 * MIN, // sebelumnya 10m
  berkebon: 30 * MIN, // sebelumnya 10m
  fight_boss: 45 * MIN, // sebelumnya 15m
  fight_kucing: 45 * MIN,
  fight_kyubi: 45 * MIN,
  fight_centaur: 45 * MIN,
  fight_griffin: 45 * MIN,
  fight_naga: 45 * MIN,
  fight_phonix: 45 * MIN,
};

// 3. Pet & Ekspedisi (3x)
export const PET_EXPEDITION_DURATION_MS = 90 * MIN; // sebelumnya 30m

// 4. Karir, Startup & Properti (3x)
export const CAREER_SHIFT_COOLDOWN_MS = 3 * HOUR; // sebelumnya 1j
export const STARTUP_DIVIDEND_COOLDOWN_MS = 18 * HOUR; // sebelumnya 6j
export const PROPERTY_MIN_HARVEST_MS = 60 * MIN; // sebelumnya 20m

// 5. Interaksi Grup & PvP (3x)
export const BUSINESS_COOLDOWN_MS = 3 * HOUR; // sebelumnya 1j
export const ATTACK_COOLDOWN_MS = 90 * MIN; // sebelumnya 30m
export const DUNGEON_COOLDOWN_MS = 2 * HOUR; // sebelumnya 40m

// 6. World Boss Raid & Bounty (3x)
export const WORLD_BOSS_ATTACK_COOLDOWN_MS = 24 * MIN; // sebelumnya 8m
export const WORLD_BOSS_RESPAWN_COOLDOWN_MS = 3 * HOUR; // sebelumnya 1j
export const BOUNTY_HUNT_COOLDOWN_MS = 60 * MIN; // sebelumnya 20m

// 7. Arena Taruhan & Sedekah (3x)
export const ARENA_COOLDOWN_MS = 30 * SEC; // sebelumnya 10d
export const PET_ARENA_COOLDOWN_MS = 12 * MIN; // sebelumnya 4m
export const SEDEKAH_COOLDOWN_MS = 60 * MIN; // sebelumnya 20m

// 8. Politik & Geng (3x)
export const BUDGET_COOLDOWN_MS = 36 * HOUR; // sebelumnya 12j
export const COUP_GROUP_COOLDOWN_MS = 18 * HOUR; // sebelumnya 6j
export const CLAN_BUFF_COOLDOWN_MS = 3 * HOUR; // sebelumnya 1j
export const CLAN_WAR_COOLDOWN_MS = 90 * MIN; // sebelumnya 30m

// 9. Klaim Periodik (Kalender tetap)
export const WEEKLY_COOLDOWN_MS = 7 * DAY;
export const MONTHLY_COOLDOWN_MS = 30 * DAY;

// 10. Asmara NPC, AI, Menfess & Status Grup (3x)
export const NPC_ROLL_COOLDOWN_MS = 15 * MIN; // sebelumnya 5m
export const NPC_DATE_COOLDOWN_MS = 6 * HOUR; // sebelumnya 2j
export const AI_COOLDOWN_MS = 45 * SEC; // sebelumnya 15d
export const MENFESS_COOLDOWN_MS = 15 * MIN; // sebelumnya 5m
export const GROUP_STATUS_COOLDOWN_MS = 90 * SEC; // sebelumnya 30d
