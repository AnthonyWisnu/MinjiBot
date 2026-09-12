import { env } from "../../config/env";
import { playerSessionService, type PlayerSession } from "./player-session.service";

export class WebViewService {
  getBaseUrl(): string {
    return env.WEB_BASE_URL.replace(/\/+$/, "");
  }

  getPlayerUrl(sessionId: string): string {
    return `${this.getBaseUrl()}/player/${sessionId}`;
  }

  getArcadeUrl(game?: string): string {
    const base = `${this.getBaseUrl()}/arcade`;
    return game ? `${base}/${game}` : base;
  }

  validatePlayerSession(sessionId: string): PlayerSession | null {
    return playerSessionService.getSession(sessionId);
  }
}

export const webViewService = new WebViewService();
