/**
 * Reward table untuk semua game yang menggunakan persistent member economy.
 * Nilai ini adalah sumber kebenaran tunggal. Jangan duplikasi di game.service.ts.
 *
 * Skala Ekonomi Anti-Inflasi (Uang 60% dari skala awal; Poin & XP tetap 100%):
 * Selain Poin + XP penuh, setiap game mengguyur Uang Rp 300.000 - Rp 3.000.000
 * (masih dikalikan bonus Level pemain hingga 7x).
 */

export const KUIS_REWARD = {
  CORRECT_POINTS: 10,
  CORRECT_XP: 40,
  CORRECT_MONEY: 350_000n,
  WRONG_XP: 5,
} as const;

export const MTK_REWARD = {
  CORRECT_POINTS: 10,
  CORRECT_XP: 40,
  CORRECT_MONEY: 450_000n,
  WRONG_XP: 5,
} as const;

export const TEBAKKATA_REWARD = {
  CORRECT_POINTS: 12,
  CORRECT_XP: 50,
  CORRECT_MONEY: 500_000n,
  SURRENDER_XP: 10,
} as const;

export const TEBAKEMOJI_REWARD = {
  CORRECT_POINTS: 10,
  CORRECT_XP: 40,
  CORRECT_MONEY: 350_000n,
  SURRENDER_XP: 10,
} as const;

export const TEBAKANGKA_REWARD = {
  BAND_1_3: { POINTS: 20, XP: 80, MONEY: 1_200_000n },
  BAND_4_7: { POINTS: 15, XP: 60, MONEY: 700_000n },
  BAND_8_PLUS: { POINTS: 10, XP: 40, MONEY: 350_000n },
  FAIL_XP: 10,
} as const;

export const FAMILY100_REWARD = {
  ANSWER_POINTS: 8,
  ANSWER_XP: 30,
  ANSWER_MONEY: 250_000n,
  FINAL_BONUS_POINTS: 5,
  FINAL_BONUS_XP: 20,
  FINAL_BONUS_MONEY: 600_000n,
  CAP_POINTS: 45,
  CAP_XP: 180,
} as const;

export const KATLA_REWARD = {
  WIN_1_3_POINTS: 22,
  WIN_1_3_XP: 85,
  WIN_1_3_MONEY: 1_400_000n,
  WIN_4_6_POINTS: 15,
  WIN_4_6_XP: 60,
  WIN_4_6_MONEY: 900_000n,
  PARTICIPANT_XP: 10,
} as const;

export const CAKLONTONG_REWARD = {
  CORRECT_POINTS: 15,
  CORRECT_XP: 55,
  CORRECT_MONEY: 650_000n,
  SURRENDER_XP: 8,
} as const;

export const BOM_REWARD = {
  STEP_1_3_POINTS: 5,
  STEP_1_3_XP: 15,
  STEP_1_3_MONEY: 200_000n,
  STEP_4_6_POINTS: 8,
  STEP_4_6_XP: 25,
  STEP_4_6_MONEY: 350_000n,
  STEP_7_8_POINTS: 12,
  STEP_7_8_XP: 35,
  STEP_7_8_MONEY: 500_000n,
  CLEAN_SWEEP_BONUS_POINTS: 15,
  CLEAN_SWEEP_BONUS_XP: 50,
  CLEAN_SWEEP_BONUS_MONEY: 1_600_000n,
  BOMB_CONSOLATION_XP: 5,
} as const;

export const TICTACTOE_REWARD = {
  WIN_POINTS: 25,
  WIN_XP: 100,
  WIN_MONEY: 1_500_000n,
  LOSS_POINTS: 5,
  LOSS_XP: 25,
  LOSS_MONEY: 200_000n,
  DRAW_POINTS: 10,
  DRAW_XP: 50,
  DRAW_MONEY: 500_000n,
} as const;

export const SLOT_CONFIG = {
  BET_POINTS: 5,
  MATCH_TWO_POINTS: 10,
  MATCH_TWO_XP: 5,
  MATCH_TWO_MONEY: 300_000n,
  JACKPOT_POINTS: 30,
  JACKPOT_XP: 15,
  JACKPOT_MONEY: 900_000n,
  SUPER_JACKPOT_POINTS: 50,
  SUPER_JACKPOT_XP: 25,
  SUPER_JACKPOT_MONEY: 1_800_000n,
  LOSS_XP: 2,
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
