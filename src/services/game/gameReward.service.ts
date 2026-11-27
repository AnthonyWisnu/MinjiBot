import { MemberEconomyService } from "../member/memberEconomy.service";
import { DuplicateOperationError } from "../../types/memberEconomy";
import {
  KUIS_REWARD,
  MTK_REWARD,
  TEBAKKATA_REWARD,
  TEBAKEMOJI_REWARD,
  TEBAKANGKA_REWARD,
  FAMILY100_REWARD,
  KATLA_REWARD,
  CAKLONTONG_REWARD,
  BOM_REWARD,
  TICTACTOE_REWARD,
  applyCluePointAdjustment,
  getBomSafeStepReward,
  getKatlaWinReward,
  getTebakangkaReward,
} from "./gameReward.constants";

// Minimal interface for DI and testing.
interface EconomyService {
  creditPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    idempotencyKey?: string;
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
  creditXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    idempotencyKey?: string;
    correlationId?: string;
    note?: string;
  }): Promise<unknown>;
  creditMoney?(input: {
    groupJid: string;
    userJid: string;
    amount: bigint;
    type: "GAME_REWARD";
    scaleByLevel?: boolean;
    idempotencyKey?: string;
    correlationId?: string;
    note?: string;
  }): Promise<{ amountCredited: bigint; levelMultiplier?: number } | null | undefined>;
  recordGameResult(input: {
    groupJid: string;
    userJid: string;
    won: boolean;
    idempotencyKey?: string;
    correlationId?: string;
  }): Promise<unknown>;
}

export interface GameRewardResult {
  points: number;
  xp: number;
  money: bigint;
  levelMultiplier?: number;
  capped?: boolean;
}

export class GameRewardService {
  constructor(private readonly economy: EconomyService = new MemberEconomyService()) {}

  // ---- Kuis (kuis) ----

  async awardKuisCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
    cluesUsed = 0,
  ): Promise<GameRewardResult> {
    const points = applyCluePointAdjustment(KUIS_REWARD.CORRECT_POINTS, cluesUsed);
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:kuis:${roundId}:${userJid}:correct`,
      points,
      KUIS_REWARD.CORRECT_XP,
      KUIS_REWARD.CORRECT_MONEY,
      correlationId,
      "kuis-correct",
    );
  }

  async awardKuisWrongParticipation(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    return this.creditXpSafe(
      groupJid,
      userJid,
      KUIS_REWARD.WRONG_XP,
      `game:kuis:${roundId}:${userJid}:wrong-xp`,
      correlationId,
      "kuis-wrong-xp",
    );
  }

  // ---- Matematika (mtk) ----

  async awardMtkCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:mtk:${roundId}:${userJid}:correct`,
      MTK_REWARD.CORRECT_POINTS,
      MTK_REWARD.CORRECT_XP,
      MTK_REWARD.CORRECT_MONEY,
      correlationId,
      "mtk-correct",
    );
  }

  async awardMtkWrongParticipation(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    return this.creditXpSafe(
      groupJid,
      userJid,
      MTK_REWARD.WRONG_XP,
      `game:mtk:${roundId}:${userJid}:wrong-xp`,
      correlationId,
      "mtk-wrong-xp",
    );
  }

  // ---- Tebak Kata ----

  async awardTebakKataCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
    cluesUsed = 0,
  ): Promise<GameRewardResult> {
    const points = applyCluePointAdjustment(TEBAKKATA_REWARD.CORRECT_POINTS, cluesUsed);
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:tebakkata:${roundId}:${userJid}:correct`,
      points,
      TEBAKKATA_REWARD.CORRECT_XP,
      TEBAKKATA_REWARD.CORRECT_MONEY,
      correlationId,
      "tebakkata-correct",
    );
  }

  async awardTebakKataSurrender(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    return this.creditXpSafe(
      groupJid,
      userJid,
      TEBAKKATA_REWARD.SURRENDER_XP,
      `game:tebakkata:${roundId}:${userJid}:surrender-xp`,
      correlationId,
      "tebakkata-surrender-xp",
    );
  }

  // ---- Tebak Emoji ----

  async awardTebakEmojiCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
    cluesUsed = 0,
  ): Promise<GameRewardResult> {
    const points = applyCluePointAdjustment(TEBAKEMOJI_REWARD.CORRECT_POINTS, cluesUsed);
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:tebakemoji:${roundId}:${userJid}:correct`,
      points,
      TEBAKEMOJI_REWARD.CORRECT_XP,
      TEBAKEMOJI_REWARD.CORRECT_MONEY,
      correlationId,
      "tebakemoji-correct",
    );
  }

  async awardTebakEmojiSurrender(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    return this.creditXpSafe(
      groupJid,
      userJid,
      TEBAKEMOJI_REWARD.SURRENDER_XP,
      `game:tebakemoji:${roundId}:${userJid}:surrender-xp`,
      correlationId,
      "tebakemoji-surrender-xp",
    );
  }

  // ---- Katla (5-7 huruf acak) ----

  async awardKatlaWin(
    groupJid: string,
    userJid: string,
    roundId: string,
    attemptCount: number,
    correlationId: string,
    cluesUsed = 0,
  ): Promise<GameRewardResult> {
    const base = getKatlaWinReward(attemptCount);
    const points = applyCluePointAdjustment(base.points, cluesUsed);
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:katla:${roundId}:${userJid}:win`,
      points,
      base.xp,
      base.money,
      correlationId,
      "katla-win",
    );
  }

  async awardKatlaParticipation(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:katla:${roundId}:${userJid}:participant`;
    const awarded = await this.creditXpSafe(
      groupJid,
      userJid,
      KATLA_REWARD.PARTICIPANT_XP,
      key,
      correlationId,
      "katla-participant-xp",
    );
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return awarded;
  }

  // ---- Cak Lontong ----

  async awardCakLontongCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
    cluesUsed = 0,
  ): Promise<GameRewardResult> {
    const points = applyCluePointAdjustment(CAKLONTONG_REWARD.CORRECT_POINTS, cluesUsed);
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:caklontong:${roundId}:${userJid}:correct`,
      points,
      CAKLONTONG_REWARD.CORRECT_XP,
      CAKLONTONG_REWARD.CORRECT_MONEY,
      correlationId,
      "caklontong-correct",
    );
  }

  async awardCakLontongSurrender(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    return this.creditXpSafe(
      groupJid,
      userJid,
      CAKLONTONG_REWARD.SURRENDER_XP,
      `game:caklontong:${roundId}:${userJid}:surrender-xp`,
      correlationId,
      "caklontong-surrender-xp",
    );
  }

  // ---- Tebak Bom (9 papan, 1 bom, 0 minus poin) ----

  async awardBomSafeStep(
    groupJid: string,
    userJid: string,
    roundId: string,
    cellNumber: number,
    step: number,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const { points, xp, money } = getBomSafeStepReward(step);
    const key = `game:bom:${roundId}:${userJid}:cell:${String(cellNumber)}`;
    await this.creditSafe(groupJid, userJid, points, key, correlationId, "bom-safe-points");
    await this.creditXpSafe(groupJid, userJid, xp, `${key}:xp`, correlationId, "bom-safe-xp");
    const moneyRes = await this.creditMoneySafe(
      groupJid,
      userJid,
      money,
      `${key}:money`,
      correlationId,
      "bom-safe-money",
    );
    return {
      points,
      xp,
      money: moneyRes.amountCredited,
      levelMultiplier: moneyRes.levelMultiplier,
    };
  }

  async awardBomCleanSweepBonus(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:bom:${roundId}:${userJid}:clean-sweep`,
      BOM_REWARD.CLEAN_SWEEP_BONUS_POINTS,
      BOM_REWARD.CLEAN_SWEEP_BONUS_XP,
      BOM_REWARD.CLEAN_SWEEP_BONUS_MONEY,
      correlationId,
      "bom-clean-sweep",
    );
  }

  /**
   * Kena bom TIDAK mengurangi saldo poin pemain sama sekali (0 penalti minus),
   * hanya mencatat permainan dan memberi +5 XP hiburan.
   */
  async recordBomHit(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:bom:${roundId}:${userJid}:bomb-hit`;
    const awarded = await this.creditXpSafe(
      groupJid,
      userJid,
      BOM_REWARD.BOMB_CONSOLATION_XP,
      key,
      correlationId,
      "bom-hit-consolation-xp",
    );
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return awarded;
  }

  // ---- Tebak Angka ----

  async awardTebakAngkaCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    attempts: number,
    correlationId: string,
    cluesUsed = 0,
  ): Promise<GameRewardResult> {
    const base = getTebakangkaReward(attempts);
    const points = applyCluePointAdjustment(base.points, cluesUsed);
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:tebakangka:${roundId}:${userJid}:correct`,
      points,
      base.xp,
      base.money,
      correlationId,
      "tebakangka-correct",
    );
  }

  async awardTebakAngkaFail(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:tebakangka:${roundId}:${userJid}:fail-xp`;
    const awarded = await this.creditXpSafe(
      groupJid,
      userJid,
      TEBAKANGKA_REWARD.FAIL_XP,
      key,
      correlationId,
      "tebakangka-fail-xp",
    );
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return awarded;
  }

  // ---- Family100 ----

  async awardFamily100Answer(
    groupJid: string,
    userJid: string,
    roundId: string,
    normalizedAnswer: string,
    correlationId: string,
    currentUserPoints: number,
    currentUserXp: number,
  ): Promise<GameRewardResult & { capped: boolean }> {
    const cap = FAMILY100_REWARD;
    const remainingPoints = cap.CAP_POINTS - currentUserPoints;
    const remainingXp = cap.CAP_XP - currentUserXp;

    if (remainingPoints <= 0 && remainingXp <= 0) {
      return { points: 0, xp: 0, money: 0n, capped: true };
    }

    const awardPoints = Math.min(cap.ANSWER_POINTS, remainingPoints);
    const awardXp = Math.min(cap.ANSWER_XP, remainingXp);

    const key = `game:family100:${roundId}:${userJid}:answer:${normalizedAnswer}`;
    if (awardPoints > 0) {
      await this.creditSafe(
        groupJid,
        userJid,
        awardPoints,
        key,
        correlationId,
        "family100-answer-points",
      );
    }
    if (awardXp > 0) {
      await this.creditXpSafe(
        groupJid,
        userJid,
        awardXp,
        `${key}:xp`,
        correlationId,
        "family100-answer-xp",
      );
    }
    const moneyRes = await this.creditMoneySafe(
      groupJid,
      userJid,
      cap.ANSWER_MONEY,
      `${key}:money`,
      correlationId,
      "family100-answer-money",
    );

    return {
      points: awardPoints,
      xp: awardXp,
      money: moneyRes.amountCredited,
      levelMultiplier: moneyRes.levelMultiplier,
      capped: false,
    };
  }

  async awardFamily100FinalBonus(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
    currentUserPoints: number,
    currentUserXp: number,
  ): Promise<GameRewardResult & { capped: boolean }> {
    const cap = FAMILY100_REWARD;
    const remainingPoints = cap.CAP_POINTS - currentUserPoints;
    const remainingXp = cap.CAP_XP - currentUserXp;

    if (remainingPoints <= 0 && remainingXp <= 0) {
      return { points: 0, xp: 0, money: 0n, capped: true };
    }

    const awardPoints = Math.min(cap.FINAL_BONUS_POINTS, remainingPoints);
    const awardXp = Math.min(cap.FINAL_BONUS_XP, remainingXp);
    const key = `game:family100:${roundId}:${userJid}:final-bonus`;

    if (awardPoints > 0) {
      await this.creditSafe(
        groupJid,
        userJid,
        awardPoints,
        key,
        correlationId,
        "family100-final-points",
      );
    }
    if (awardXp > 0) {
      await this.creditXpSafe(
        groupJid,
        userJid,
        awardXp,
        `${key}:xp`,
        correlationId,
        "family100-final-xp",
      );
    }
    const moneyRes = await this.creditMoneySafe(
      groupJid,
      userJid,
      cap.FINAL_BONUS_MONEY,
      `${key}:money`,
      correlationId,
      "family100-final-money",
    );

    return {
      points: awardPoints,
      xp: awardXp,
      money: moneyRes.amountCredited,
      levelMultiplier: moneyRes.levelMultiplier,
      capped: false,
    };
  }

  async recordFamily100GamePlayed(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<void> {
    const key = `game:family100:${roundId}:${userJid}:stat`;
    await this.recordGameSafe(groupJid, userJid, false, key, correlationId);
  }

  // ---- Tic Tac Toe PvP ----

  async awardTicTacToeWin(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    return this.awardWinBundle(
      groupJid,
      userJid,
      `game:tictactoe:${roundId}:${userJid}:win`,
      TICTACTOE_REWARD.WIN_POINTS,
      TICTACTOE_REWARD.WIN_XP,
      TICTACTOE_REWARD.WIN_MONEY,
      correlationId,
      "tictactoe-win",
    );
  }

  async awardTicTacToeLoss(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:tictactoe:${roundId}:${userJid}:loss`;
    await this.creditSafe(
      groupJid,
      userJid,
      TICTACTOE_REWARD.LOSS_POINTS,
      key,
      correlationId,
      "tictactoe-loss-points",
    );
    await this.creditXpSafe(
      groupJid,
      userJid,
      TICTACTOE_REWARD.LOSS_XP,
      `${key}:xp`,
      correlationId,
      "tictactoe-loss-xp",
    );
    const moneyRes = await this.creditMoneySafe(
      groupJid,
      userJid,
      TICTACTOE_REWARD.LOSS_MONEY,
      `${key}:money`,
      correlationId,
      "tictactoe-loss-money",
    );
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return {
      points: TICTACTOE_REWARD.LOSS_POINTS,
      xp: TICTACTOE_REWARD.LOSS_XP,
      money: moneyRes.amountCredited,
      levelMultiplier: moneyRes.levelMultiplier,
    };
  }

  async awardTicTacToeDraw(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:tictactoe:${roundId}:${userJid}:draw`;
    await this.creditSafe(
      groupJid,
      userJid,
      TICTACTOE_REWARD.DRAW_POINTS,
      key,
      correlationId,
      "tictactoe-draw-points",
    );
    await this.creditXpSafe(
      groupJid,
      userJid,
      TICTACTOE_REWARD.DRAW_XP,
      `${key}:xp`,
      correlationId,
      "tictactoe-draw-xp",
    );
    const moneyRes = await this.creditMoneySafe(
      groupJid,
      userJid,
      TICTACTOE_REWARD.DRAW_MONEY,
      `${key}:money`,
      correlationId,
      "tictactoe-draw-money",
    );
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return {
      points: TICTACTOE_REWARD.DRAW_POINTS,
      xp: TICTACTOE_REWARD.DRAW_XP,
      money: moneyRes.amountCredited,
      levelMultiplier: moneyRes.levelMultiplier,
    };
  }

  async recordTicTacToeTimeout(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<void> {
    const key = `game:tictactoe:${roundId}:${userJid}:timeout`;
    await this.recordGameSafe(groupJid, userJid, false, key, correlationId);
  }

  // ---- Private helpers ----

  private async awardWinBundle(
    groupJid: string,
    userJid: string,
    baseKey: string,
    points: number,
    xp: number,
    baseMoney: bigint,
    correlationId: string,
    notePrefix: string,
  ): Promise<GameRewardResult> {
    await this.creditSafe(
      groupJid,
      userJid,
      points,
      baseKey,
      correlationId,
      `${notePrefix}-points`,
    );
    await this.creditXpSafe(
      groupJid,
      userJid,
      xp,
      `${baseKey}:xp`,
      correlationId,
      `${notePrefix}-xp`,
    );
    const moneyRes = await this.creditMoneySafe(
      groupJid,
      userJid,
      baseMoney,
      `${baseKey}:money`,
      correlationId,
      `${notePrefix}-money`,
    );
    await this.recordGameSafe(groupJid, userJid, true, `${baseKey}:stat`, correlationId);
    return {
      points,
      xp,
      money: moneyRes.amountCredited,
      levelMultiplier: moneyRes.levelMultiplier,
    };
  }

  private async creditSafe(
    groupJid: string,
    userJid: string,
    amount: number,
    idempotencyKey: string,
    correlationId: string,
    note: string,
  ): Promise<boolean> {
    try {
      await this.economy.creditPoints({
        groupJid,
        userJid,
        amount,
        type: "GAME_REWARD",
        idempotencyKey,
        correlationId,
        note,
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof DuplicateOperationError) return false;
      throw error;
    }
  }

  private async creditXpSafe(
    groupJid: string,
    userJid: string,
    amount: number,
    idempotencyKey: string,
    correlationId: string,
    note: string,
  ): Promise<boolean> {
    try {
      await this.economy.creditXp({
        groupJid,
        userJid,
        amount,
        type: "GAME_REWARD",
        idempotencyKey,
        correlationId,
        note,
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof DuplicateOperationError) return false;
      throw error;
    }
  }

  private async creditMoneySafe(
    groupJid: string,
    userJid: string,
    baseAmount: bigint,
    idempotencyKey: string,
    correlationId: string,
    note: string,
  ): Promise<{ amountCredited: bigint; levelMultiplier: number }> {
    if (baseAmount <= 0n || typeof this.economy.creditMoney !== "function") {
      return { amountCredited: baseAmount, levelMultiplier: 1 };
    }

    try {
      const result = await this.economy.creditMoney({
        groupJid,
        userJid,
        amount: baseAmount,
        type: "GAME_REWARD",
        scaleByLevel: true,
        idempotencyKey,
        correlationId,
        note,
      });

      if (result) {
        return {
          amountCredited: result.amountCredited,
          levelMultiplier: result.levelMultiplier ?? 1,
        };
      }
      return { amountCredited: baseAmount, levelMultiplier: 1 };
    } catch (error: unknown) {
      if (error instanceof DuplicateOperationError) {
        return { amountCredited: 0n, levelMultiplier: 1 };
      }
      throw error;
    }
  }

  private async recordGameSafe(
    groupJid: string,
    userJid: string,
    won: boolean,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<boolean> {
    try {
      await this.economy.recordGameResult({
        groupJid,
        userJid,
        won,
        idempotencyKey,
        correlationId,
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof DuplicateOperationError) return false;
      throw error;
    }
  }
}

export const gameRewardService = new GameRewardService();
