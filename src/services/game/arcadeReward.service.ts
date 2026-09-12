import { MemberEconomyService } from "../member/memberEconomy.service";
import { logger } from "../../config/logger";
import { normalizeUserJid } from "../../utils/jid";

export interface ClaimRewardResult {
  success: boolean;
  message: string;
  game?: string;
  pointsAwarded: number;
  xpAwarded: number;
}

export interface EconomyStore {
  creditPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    note?: string;
  }): Promise<unknown>;
  creditXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "GAME_REWARD";
    note?: string;
  }): Promise<unknown>;
}

export class ArcadeRewardService {
  private claimedTokens: Set<string> = new Set();

  constructor(private readonly economy: EconomyStore = new MemberEconomyService()) {}

  /**
   * Memvalidasi dan menukarkan token game arcade/catur/spin menjadi Points dan XP.
   */
  async claimToken(
    token: string,
    groupJid: string,
    userJid: string,
  ): Promise<ClaimRewardResult> {
    const cleanToken = token.trim().toUpperCase();

    if (this.claimedTokens.has(cleanToken)) {
      return {
        success: false,
        message: "Token ini sudah pernah diklaim sebelumnya.",
        pointsAwarded: 0,
        xpAwarded: 0,
      };
    }

    const parts = cleanToken.split("-");
    if (parts.length < 3) {
      return {
        success: false,
        message: "Format token reward tidak valid.",
        pointsAwarded: 0,
        xpAwarded: 0,
      };
    }

    const type = parts[0];
    let points = 0;
    let xp = 0;
    let gameName = "Arcade Game";

    switch (type) {
      case "ARCADE": {
        const game = parts[1]?.toLowerCase() || "dino";
        const score = parseInt(parts[2] || "0", 10);
        gameName = `Arcade ${game.toUpperCase()}`;

        // Konversi skor ke Point (maks 250) dan XP (maks 500)
        points = Math.min(250, Math.max(10, Math.floor(score / 4)));
        xp = Math.min(500, Math.max(20, Math.floor(score / 2)));
        break;
      }
      case "CATUR": {
        const outcome = parts[1] || "PLAY";
        gameName = "Dans Catur FIDE";
        if (outcome === "WIN") {
          points = 120;
          xp = 250;
        } else {
          points = 30;
          xp = 60;
        }
        break;
      }
      case "C4": {
        const outcome = parts[1] || "PLAY";
        gameName = "Connect Four";
        if (outcome === "WIN") {
          points = 80;
          xp = 150;
        } else {
          points = 25;
          xp = 50;
        }
        break;
      }
      case "TTT": {
        const p1Wins = parseInt(parts[1] || "0", 10);
        gameName = "Tic-Tac-Toe";
        points = Math.min(200, Math.max(15, p1Wins * 30));
        xp = Math.min(350, Math.max(25, p1Wins * 50));
        break;
      }
      case "SPIN": {
        const rewardKey = parts[1] || "50PTS";
        gameName = "Lucky Spin Wheel";

        if (rewardKey.includes("JACKPOT")) {
          points = 500;
          xp = 500;
        } else if (rewardKey.includes("300")) {
          points = 300;
          xp = 100;
        } else if (rewardKey.includes("200")) {
          points = 50;
          xp = 200;
        } else if (rewardKey.includes("150")) {
          points = 150;
          xp = 75;
        } else if (rewardKey.includes("100")) {
          points = 25;
          xp = 100;
        } else if (rewardKey.includes("ZONK")) {
          points = 0;
          xp = 10;
        } else {
          points = 50;
          xp = 25;
        }
        break;
      }
      default: {
        return {
          success: false,
          message: `Kategori token '${type}' tidak dikenali.`,
          pointsAwarded: 0,
          xpAwarded: 0,
        };
      }
    }

    // Catat token sebagai terpakai
    this.claimedTokens.add(cleanToken);

    // Kirim kredit ke akun ekonomi member via Prisma
    try {
      const normalizedUser = normalizeUserJid(userJid);
      if (points > 0) {
        await this.economy.creditPoints({
          groupJid,
          userJid: normalizedUser,
          amount: points,
          type: "GAME_REWARD",
          note: `Reward ${gameName} token ${cleanToken}`,
        });
      }

      if (xp > 0) {
        await this.economy.creditXp({
          groupJid,
          userJid: normalizedUser,
          amount: xp,
          type: "GAME_REWARD",
          note: `XP ${gameName} token ${cleanToken}`,
        });
      }

      logger.info(
        { token: cleanToken, groupJid, userJid, points, xp, gameName },
        "Arcade reward token claimed successfully",
      );
    } catch (err: unknown) {
      logger.warn(
        { err, token: cleanToken },
        "Database reward transaction failed (handled gracefully)",
      );
    }

    return {
      success: true,
      message: `Selamat! Token berhasil diklaim: +${points} Points & +${xp} XP.`,
      game: gameName,
      pointsAwarded: points,
      xpAwarded: xp,
    };
  }

  isClaimed(token: string): boolean {
    return this.claimedTokens.has(token.trim().toUpperCase());
  }

  clearTokens(): void {
    this.claimedTokens.clear();
  }
}

export const arcadeRewardService = new ArcadeRewardService();
