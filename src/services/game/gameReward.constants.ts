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

export const KATLA_REWARD = {
  WIN_1_3_POINTS: 22,
  WIN_1_3_XP: 85,
  WIN_4_6_POINTS: 15,
  WIN_4_6_XP: 60,
  PARTICIPANT_XP: 10,
} as const;

export const CAKLONTONG_REWARD = {
  CORRECT_POINTS: 15,
  CORRECT_XP: 55,
  SURRENDER_XP: 8,
} as const;

export const BOM_REWARD = {
  STEP_1_3_POINTS: 5,
  STEP_1_3_XP: 15,
  STEP_4_6_POINTS: 8,
  STEP_4_6_XP: 25,
  STEP_7_8_POINTS: 12,
  STEP_7_8_XP: 35,
  CLEAN_SWEEP_BONUS_POINTS: 15,
  CLEAN_SWEEP_BONUS_XP: 50,
  BOMB_CONSOLATION_XP: 5,
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
  if (attempts <= 3)
    return { points: TEBAKANGKA_REWARD.BAND_1_3.POINTS, xp: TEBAKANGKA_REWARD.BAND_1_3.XP };
  if (attempts <= 7)
    return { points: TEBAKANGKA_REWARD.BAND_4_7.POINTS, xp: TEBAKANGKA_REWARD.BAND_4_7.XP };
  return { points: TEBAKANGKA_REWARD.BAND_8_PLUS.POINTS, xp: TEBAKANGKA_REWARD.BAND_8_PLUS.XP };
}

export function getKatlaWinReward(attemptCount: number): { points: number; xp: number } {
  if (attemptCount <= 3) {
    return { points: KATLA_REWARD.WIN_1_3_POINTS, xp: KATLA_REWARD.WIN_1_3_XP };
  }
  return { points: KATLA_REWARD.WIN_4_6_POINTS, xp: KATLA_REWARD.WIN_4_6_XP };
}

export function getBomSafeStepReward(step: number): { points: number; xp: number } {
  if (step <= 3) {
    return { points: BOM_REWARD.STEP_1_3_POINTS, xp: BOM_REWARD.STEP_1_3_XP };
  }
  if (step <= 6) {
    return { points: BOM_REWARD.STEP_4_6_POINTS, xp: BOM_REWARD.STEP_4_6_XP };
  }
  return { points: BOM_REWARD.STEP_7_8_POINTS, xp: BOM_REWARD.STEP_7_8_XP };
}

export function applyCluePointAdjustment(basePoints: number, cluesUsed: number): number {
  if (cluesUsed <= 0) return basePoints;
  return Math.max(2, basePoints - cluesUsed * 2);
}
