import { MemberEconomyService } from "../member/memberEconomy.service";
import { DuplicateOperationError } from "../../types/memberEconomy";
import {
  KUIS_REWARD,
  MTK_REWARD,
  TEBAKKATA_REWARD,
  TEBAKEMOJI_REWARD,
  TEBAKANGKA_REWARD,
  FAMILY100_REWARD,
  TICTACTOE_REWARD,
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
  ): Promise<GameRewardResult> {
    const key = `game:kuis:${roundId}:${userJid}:correct`;
    await this.creditSafe(groupJid, userJid, KUIS_REWARD.CORRECT_POINTS, key, correlationId, "kuis-correct-points");
    await this.creditXpSafe(groupJid, userJid, KUIS_REWARD.CORRECT_XP, `${key}:xp`, correlationId, "kuis-correct-xp");
    await this.recordGameSafe(groupJid, userJid, true, `${key}:stat`, correlationId);
    return { points: KUIS_REWARD.CORRECT_POINTS, xp: KUIS_REWARD.CORRECT_XP };
  }

  async awardKuisWrongParticipation(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:kuis:${roundId}:${userJid}:wrong-xp`;
    return this.creditXpSafe(groupJid, userJid, KUIS_REWARD.WRONG_XP, key, correlationId, "kuis-wrong-xp");
  }

  // ---- Matematika (mtk) ----

  async awardMtkCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:mtk:${roundId}:${userJid}:correct`;
    await this.creditSafe(groupJid, userJid, MTK_REWARD.CORRECT_POINTS, key, correlationId, "mtk-correct-points");
    await this.creditXpSafe(groupJid, userJid, MTK_REWARD.CORRECT_XP, `${key}:xp`, correlationId, "mtk-correct-xp");
    await this.recordGameSafe(groupJid, userJid, true, `${key}:stat`, correlationId);
    return { points: MTK_REWARD.CORRECT_POINTS, xp: MTK_REWARD.CORRECT_XP };
  }

  async awardMtkWrongParticipation(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:mtk:${roundId}:${userJid}:wrong-xp`;
    return this.creditXpSafe(groupJid, userJid, MTK_REWARD.WRONG_XP, key, correlationId, "mtk-wrong-xp");
  }

  // ---- Tebak Kata ----

  async awardTebakKataCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:tebakkata:${roundId}:${userJid}:correct`;
    await this.creditSafe(groupJid, userJid, TEBAKKATA_REWARD.CORRECT_POINTS, key, correlationId, "tebakkata-correct-points");
    await this.creditXpSafe(groupJid, userJid, TEBAKKATA_REWARD.CORRECT_XP, `${key}:xp`, correlationId, "tebakkata-correct-xp");
    await this.recordGameSafe(groupJid, userJid, true, `${key}:stat`, correlationId);
    return { points: TEBAKKATA_REWARD.CORRECT_POINTS, xp: TEBAKKATA_REWARD.CORRECT_XP };
  }

  async awardTebakKataSurrender(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:tebakkata:${roundId}:${userJid}:surrender-xp`;
    return this.creditXpSafe(groupJid, userJid, TEBAKKATA_REWARD.SURRENDER_XP, key, correlationId, "tebakkata-surrender-xp");
  }

  // ---- Tebak Emoji ----

  async awardTebakEmojiCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:tebakemoji:${roundId}:${userJid}:correct`;
    await this.creditSafe(groupJid, userJid, TEBAKEMOJI_REWARD.CORRECT_POINTS, key, correlationId, "tebakemoji-correct-points");
    await this.creditXpSafe(groupJid, userJid, TEBAKEMOJI_REWARD.CORRECT_XP, `${key}:xp`, correlationId, "tebakemoji-correct-xp");
    await this.recordGameSafe(groupJid, userJid, true, `${key}:stat`, correlationId);
    return { points: TEBAKEMOJI_REWARD.CORRECT_POINTS, xp: TEBAKEMOJI_REWARD.CORRECT_XP };
  }

  async awardTebakEmojiSurrender(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:tebakemoji:${roundId}:${userJid}:surrender-xp`;
    return this.creditXpSafe(groupJid, userJid, TEBAKEMOJI_REWARD.SURRENDER_XP, key, correlationId, "tebakemoji-surrender-xp");
  }

  // ---- Tebak Angka ----

  async awardTebakAngkaCorrect(
    groupJid: string,
    userJid: string,
    roundId: string,
    attempts: number,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const { points, xp } = getTebakangkaReward(attempts);
    const key = `game:tebakangka:${roundId}:${userJid}:correct`;
    await this.creditSafe(groupJid, userJid, points, key, correlationId, "tebakangka-correct-points");
    await this.creditXpSafe(groupJid, userJid, xp, `${key}:xp`, correlationId, "tebakangka-correct-xp");
    await this.recordGameSafe(groupJid, userJid, true, `${key}:stat`, correlationId);
    return { points, xp };
  }

  async awardTebakAngkaFail(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<boolean> {
    const key = `game:tebakangka:${roundId}:${userJid}:fail-xp`;
    const awarded = await this.creditXpSafe(groupJid, userJid, TEBAKANGKA_REWARD.FAIL_XP, key, correlationId, "tebakangka-fail-xp");
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
      return { points: 0, xp: 0, capped: true };
    }

    const awardPoints = Math.min(cap.ANSWER_POINTS, remainingPoints);
    const awardXp = Math.min(cap.ANSWER_XP, remainingXp);

    const key = `game:family100:${roundId}:${userJid}:answer:${normalizedAnswer}`;
    if (awardPoints > 0) {
      await this.creditSafe(groupJid, userJid, awardPoints, key, correlationId, "family100-answer-points");
    }
    if (awardXp > 0) {
      await this.creditXpSafe(groupJid, userJid, awardXp, `${key}:xp`, correlationId, "family100-answer-xp");
    }

    return { points: awardPoints, xp: awardXp, capped: false };
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
      return { points: 0, xp: 0, capped: true };
    }

    const awardPoints = Math.min(cap.FINAL_BONUS_POINTS, remainingPoints);
    const awardXp = Math.min(cap.FINAL_BONUS_XP, remainingXp);
    const key = `game:family100:${roundId}:${userJid}:final-bonus`;

    if (awardPoints > 0) {
      await this.creditSafe(groupJid, userJid, awardPoints, key, correlationId, "family100-final-points");
    }
    if (awardXp > 0) {
      await this.creditXpSafe(groupJid, userJid, awardXp, `${key}:xp`, correlationId, "family100-final-xp");
    }

    return { points: awardPoints, xp: awardXp, capped: false };
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
    const key = `game:tictactoe:${roundId}:${userJid}:win`;
    await this.creditSafe(groupJid, userJid, TICTACTOE_REWARD.WIN_POINTS, key, correlationId, "tictactoe-win-points");
    await this.creditXpSafe(groupJid, userJid, TICTACTOE_REWARD.WIN_XP, `${key}:xp`, correlationId, "tictactoe-win-xp");
    await this.recordGameSafe(groupJid, userJid, true, `${key}:stat`, correlationId);
    return { points: TICTACTOE_REWARD.WIN_POINTS, xp: TICTACTOE_REWARD.WIN_XP };
  }

  async awardTicTacToeLoss(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:tictactoe:${roundId}:${userJid}:loss`;
    await this.creditSafe(groupJid, userJid, TICTACTOE_REWARD.LOSS_POINTS, key, correlationId, "tictactoe-loss-points");
    await this.creditXpSafe(groupJid, userJid, TICTACTOE_REWARD.LOSS_XP, `${key}:xp`, correlationId, "tictactoe-loss-xp");
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return { points: TICTACTOE_REWARD.LOSS_POINTS, xp: TICTACTOE_REWARD.LOSS_XP };
  }

  async awardTicTacToeDraw(
    groupJid: string,
    userJid: string,
    roundId: string,
    correlationId: string,
  ): Promise<GameRewardResult> {
    const key = `game:tictactoe:${roundId}:${userJid}:draw`;
    await this.creditSafe(groupJid, userJid, TICTACTOE_REWARD.DRAW_POINTS, key, correlationId, "tictactoe-draw-points");
    await this.creditXpSafe(groupJid, userJid, TICTACTOE_REWARD.DRAW_XP, `${key}:xp`, correlationId, "tictactoe-draw-xp");
    await this.recordGameSafe(groupJid, userJid, false, `${key}:stat`, correlationId);
    return { points: TICTACTOE_REWARD.DRAW_POINTS, xp: TICTACTOE_REWARD.DRAW_XP };
  }

  // Timeout: 0 reward, only record games-played stat.
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
