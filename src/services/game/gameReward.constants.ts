/**
 * Reward table untuk semua game yang menggunakan persistent member economy.
 * Nilai ini adalah sumber kebenaran tunggal. Jangan duplikasi di game.service.ts.
 *
 * Skala Ekonomi Anti-Inflasi (60% dari skala awal):
 * Selain Poin + XP, setiap game mengguyur Uang Rp 300.000 - Rp 3.000.000
 * (masih dikalikan bonus Level pemain hingga 7x).
 */

export const KUIS_REWARD = {
  CORRECT_POINTS: 6,
  CORRECT_XP: 24,
  CORRECT_MONEY: 600_000n,
  WRONG_XP: 3,
} as const;

export const MTK_REWARD = {
  CORRECT_POINTS: 6,
  CORRECT_XP: 24,
  CORRECT_MONEY: 750_000n,
  WRONG_XP: 3,
} as const;

export const TEBAKKATA_REWARD = {
  CORRECT_POINTS: 7,
  CORRECT_XP: 30,
  CORRECT_MONEY: 900_000n,
  SURRENDER_XP: 6,
} as const;

export const TEBAKEMOJI_REWARD = {
  CORRECT_POINTS: 6,
  CORRECT_XP: 24,
  CORRECT_MONEY: 600_000n,
  SURRENDER_XP: 6,
} as const;

export const TEBAKANGKA_REWARD = {
  BAND_1_3: { POINTS: 12, XP: 48, MONEY: 2_100_000n },
  BAND_4_7: { POINTS: 9, XP: 36, MONEY: 1_200_000n },
  BAND_8_PLUS: { POINTS: 6, XP: 24, MONEY: 600_000n },
  FAIL_XP: 6,
} as const;

export const FAMILY100_REWARD = {
  ANSWER_POINTS: 5,
  ANSWER_XP: 18,
  ANSWER_MONEY: 360_000n,
  FINAL_BONUS_POINTS: 3,
  FINAL_BONUS_XP: 12,
  FINAL_BONUS_MONEY: 900_000n,
  CAP_POINTS: 27,
  CAP_XP: 108,
} as const;

export const KATLA_REWARD = {
  WIN_1_3_POINTS: 13,
  WIN_1_3_XP: 51,
  WIN_1_3_MONEY: 2_400_000n,
  WIN_4_6_POINTS: 9,
  WIN_4_6_XP: 36,
  WIN_4_6_MONEY: 1_500_000n,
  PARTICIPANT_XP: 6,
} as const;

export const CAKLONTONG_REWARD = {
  CORRECT_POINTS: 9,
  CORRECT_XP: 33,
  CORRECT_MONEY: 1_200_000n,
  SURRENDER_XP: 5,
} as const;

export const BOM_REWARD = {
  STEP_1_3_POINTS: 3,
  STEP_1_3_XP: 9,
  STEP_1_3_MONEY: 300_000n,
  STEP_4_6_POINTS: 5,
  STEP_4_6_XP: 15,
  STEP_4_6_MONEY: 510_000n,
  STEP_7_8_POINTS: 7,
  STEP_7_8_XP: 21,
  STEP_7_8_MONEY: 750_000n,
  CLEAN_SWEEP_BONUS_POINTS: 9,
  CLEAN_SWEEP_BONUS_XP: 30,
  CLEAN_SWEEP_BONUS_MONEY: 3_000_000n,
  BOMB_CONSOLATION_XP: 3,
} as const;

export const TICTACTOE_REWARD = {
  WIN_POINTS: 15,
  WIN_XP: 60,
  WIN_MONEY: 2_700_000n,
  LOSS_POINTS: 3,
  LOSS_XP: 15,
  LOSS_MONEY: 300_000n,
  DRAW_POINTS: 6,
  DRAW_XP: 30,
  DRAW_MONEY: 900_000n,
} as const;

export const SLOT_CONFIG = {
  BET_POINTS: 5,
  MATCH_TWO_POINTS: 6,
  MATCH_TWO_XP: 3,
  MATCH_TWO_MONEY: 450_000n,
  JACKPOT_POINTS: 18,
  JACKPOT_XP: 9,
  JACKPOT_MONEY: 1_500_000n,
  SUPER_JACKPOT_POINTS: 30,
  SUPER_JACKPOT_XP: 15,
  SUPER_JACKPOT_MONEY: 3_000_000n,
  LOSS_XP: 1,
} as const;

export function getTebakangkaReward(attempts: number): {
  points: number;
  xp: number;
  money: bigint;
} {
  if (attempts <= 3) {
    return {
      points: TEBAKANGKA_REWARD.BAND_1_3.POINTS,
      xp: TEBAKANGKA_REWARD.BAND_1_3.XP,
      money: TEBAKANGKA_REWARD.BAND_1_3.MONEY,
    };
  }
  if (attempts <= 7) {
    return {
      points: TEBAKANGKA_REWARD.BAND_4_7.POINTS,
      xp: TEBAKANGKA_REWARD.BAND_4_7.XP,
      money: TEBAKANGKA_REWARD.BAND_4_7.MONEY,
    };
  }
  return {
    points: TEBAKANGKA_REWARD.BAND_8_PLUS.POINTS,
    xp: TEBAKANGKA_REWARD.BAND_8_PLUS.XP,
    money: TEBAKANGKA_REWARD.BAND_8_PLUS.MONEY,
  };
}

export function getKatlaWinReward(attemptCount: number): {
  points: number;
  xp: number;
  money: bigint;
} {
  if (attemptCount <= 3) {
    return {
      points: KATLA_REWARD.WIN_1_3_POINTS,
      xp: KATLA_REWARD.WIN_1_3_XP,
      money: KATLA_REWARD.WIN_1_3_MONEY,
    };
  }
  return {
    points: KATLA_REWARD.WIN_4_6_POINTS,
    xp: KATLA_REWARD.WIN_4_6_XP,
    money: KATLA_REWARD.WIN_4_6_MONEY,
  };
}

export function getBomSafeStepReward(step: number): {
  points: number;
  xp: number;
  money: bigint;
} {
  if (step <= 3) {
    return {
      points: BOM_REWARD.STEP_1_3_POINTS,
      xp: BOM_REWARD.STEP_1_3_XP,
      money: BOM_REWARD.STEP_1_3_MONEY,
    };
  }
  if (step <= 6) {
    return {
      points: BOM_REWARD.STEP_4_6_POINTS,
      xp: BOM_REWARD.STEP_4_6_XP,
      money: BOM_REWARD.STEP_4_6_MONEY,
    };
  }
  return {
    points: BOM_REWARD.STEP_7_8_POINTS,
    xp: BOM_REWARD.STEP_7_8_XP,
    money: BOM_REWARD.STEP_7_8_MONEY,
  };
}

export function applyCluePointAdjustment(basePoints: number, cluesUsed: number): number {
  if (cluesUsed <= 0) return basePoints;
  return Math.max(2, basePoints - cluesUsed * 2);
}
