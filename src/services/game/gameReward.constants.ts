/**
 * Reward table untuk semua game yang menggunakan persistent member economy.
 * Nilai ini adalah sumber kebenaran tunggal. Jangan duplikasi di game.service.ts.
 */

export const KUIS_REWARD = {
  CORRECT_POINTS: 10,
  CORRECT_XP: 40,
  WRONG_XP: 5,
} as const;

export const MTK_REWARD = {
  CORRECT_POINTS: 10,
  CORRECT_XP: 40,
  WRONG_XP: 5,
} as const;

export const TEBAKKATA_REWARD = {
  CORRECT_POINTS: 12,
  CORRECT_XP: 50,
  SURRENDER_XP: 10,
} as const;

export const TEBAKEMOJI_REWARD = {
  CORRECT_POINTS: 10,
  CORRECT_XP: 40,
  SURRENDER_XP: 10,
} as const;

export const TEBAKANGKA_REWARD = {
  BAND_1_3: { POINTS: 20, XP: 80 },
  BAND_4_7: { POINTS: 15, XP: 60 },
  BAND_8_PLUS: { POINTS: 10, XP: 40 },
  FAIL_XP: 10,
} as const;

export const FAMILY100_REWARD = {
  ANSWER_POINTS: 8,
  ANSWER_XP: 30,
  FINAL_BONUS_POINTS: 5,
  FINAL_BONUS_XP: 20,
  CAP_POINTS: 45,
  CAP_XP: 180,
} as const;

export const TICTACTOE_REWARD = {
  WIN_POINTS: 25,
  WIN_XP: 100,
  LOSS_POINTS: 5,
  LOSS_XP: 25,
  DRAW_POINTS: 10,
  DRAW_XP: 50,
} as const;

export const SLOT_CONFIG = {
  BET_POINTS: 5,
  MATCH_TWO_POINTS: 10,
  MATCH_TWO_XP: 5,
  JACKPOT_POINTS: 30,
  JACKPOT_XP: 15,
  SUPER_JACKPOT_POINTS: 50,
  SUPER_JACKPOT_XP: 25,
  LOSS_XP: 2,
} as const;

export function getTebakangkaReward(attempts: number): { points: number; xp: number } {
  if (attempts <= 3) return { points: TEBAKANGKA_REWARD.BAND_1_3.POINTS, xp: TEBAKANGKA_REWARD.BAND_1_3.XP };
  if (attempts <= 7) return { points: TEBAKANGKA_REWARD.BAND_4_7.POINTS, xp: TEBAKANGKA_REWARD.BAND_4_7.XP };
  return { points: TEBAKANGKA_REWARD.BAND_8_PLUS.POINTS, xp: TEBAKANGKA_REWARD.BAND_8_PLUS.XP };
}

