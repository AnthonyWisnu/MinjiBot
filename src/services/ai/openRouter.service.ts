import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";
import { formatRemainingDuration } from "../../utils/currency";
import { toWibDateKey } from "../../utils/wibDate";

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
export const AI_MAX_PROMPT_CHARS = 600;
export const AI_MAX_TOKENS = 450;
export const AI_COOLDOWN_MS = 15_000;
const AI_REQUEST_TIMEOUT_MS = 20_000;
const MAX_COOLDOWN_ENTRIES = 2_000;
const MAX_QUOTA_ENTRIES = 500;

export type AiPersona = "assistant" | "simi";

export interface OpenRouterAskInput {
  groupJid: string;
  userJid: string;
  prompt: string;
  persona: AiPersona;
  bypassCooldown?: boolean;
  now?: Date;
}

export interface OpenRouterAskResult {
  answer: string;
  model: string;
  remainingGroupQuota: number;
  dailyQuotaLimit: number;
}

interface OpenRouterConfig {
  apiKey?: string;
  model: string;
  dailyQuotaPerGroup: number;
  fetchFn?: typeof fetch;
}

interface OpenRouterCompletionResponse {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
  error?: {
    message?: string;
    code?: number | string;
  };
}

const SYSTEM_PROMPTS: Record<AiPersona, string> = {
  assistant: [
    "Kamu adalah MinjiBot, asisten pintar di grup WhatsApp.",
    "Jawab dalam Bahasa Indonesia yang ramah, akurat, ringkas, dan rapi untuk dibaca di layar HP.",
    "Gunakan maksimal 2-3 paragraf pendek atau daftar poin seperlunya. Hindari jawaban bertele-tele.",
  ].join(" "),
  simi: [
    "Kamu adalah Minji mode Simi, teman ngobrol grup WhatsApp yang santai, kocak, dan akrab.",
    "Balas super singkat (1-3 kalimat saja) pakai gaya bahasa Indonesia sehari-hari yang seru dan lucu.",
    "Tetap sopan, dilarang kasar, dilarang SARA, dan dilarang konten dewasa.",
  ].join(" "),
};

export class OpenRouterService {
  private readonly userCooldowns = new Map<string, number>();
  private readonly groupDailyUsage = new Map<string, number>();
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly dailyQuotaPerGroup: number;
  private readonly fetchFn: typeof fetch;

  constructor(config?: Partial<OpenRouterConfig>) {
    this.apiKey = config && "apiKey" in config ? config.apiKey : env.OPENROUTER_API_KEY;
    this.model = config?.model ?? env.OPENROUTER_MODEL;
    this.dailyQuotaPerGroup = config?.dailyQuotaPerGroup ?? env.AI_DAILY_QUOTA_PER_GROUP;
    this.fetchFn = config?.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  getModel(): string {
    return this.model;
  }

  getDailyQuotaLimit(): number {
    return this.dailyQuotaPerGroup;
  }

  getRemainingGroupQuota(groupJid: string, now: Date = new Date()): number {
    const key = `${groupJid}:${toWibDateKey(now)}`;
    const used = this.groupDailyUsage.get(key) ?? 0;
    return Math.max(0, this.dailyQuotaPerGroup - used);
  }

  validateBeforeLimitReserve(input: {
    groupJid: string;
    userJid: string;
    prompt: string;
    bypassCooldown?: boolean;
    now?: Date;
  }): string {
    if (!this.isConfigured()) {
      throw new AppUserError(
        "Fitur AI belum diaktifkan oleh Owner bot (API Key OpenRouter belum diatur).",
      );
    }

    const cleaned = input.prompt.trim();
    if (!cleaned) {
      throw new AppUserError("Tulis pertanyaan atau pesan yang ingin dikirim ke AI.");
    }
    if (cleaned.length > AI_MAX_PROMPT_CHARS) {
      throw new AppUserError(
        `Pesan terlalu panjang (${String(cleaned.length)} karakter). Maksimal ${String(AI_MAX_PROMPT_CHARS)} karakter biar hemat dan cepat dijawab.`,
      );
    }

    const now = input.now ?? new Date();
    const nowMs = now.getTime();

    if (!input.bypassCooldown) {
      const cdKey = `${input.groupJid}:${input.userJid}`;
      const lastUsed = this.userCooldowns.get(cdKey);
      if (lastUsed !== undefined) {
        const elapsed = nowMs - lastUsed;
        if (elapsed < AI_COOLDOWN_MS) {
          throw new AppUserError(
            `Tunggu *${formatRemainingDuration(AI_COOLDOWN_MS - elapsed)}* lagi sebelum bertanya ke AI.`,
          );
        }
      }
    }

    const quotaKey = `${input.groupJid}:${toWibDateKey(now)}`;
    const used = this.groupDailyUsage.get(quotaKey) ?? 0;
    if (used >= this.dailyQuotaPerGroup) {
      throw new AppUserError(
        `Kuota AI harian grup ini sudah habis (${String(this.dailyQuotaPerGroup)}/${String(this.dailyQuotaPerGroup)}). Kuota akan reset otomatis pukul 00:00 WIB.`,
      );
    }

    return cleaned;
  }

  async ask(input: OpenRouterAskInput): Promise<OpenRouterAskResult> {
    const now = input.now ?? new Date();
    const cleanedPrompt = this.validateBeforeLimitReserve({
      groupJid: input.groupJid,
      userJid: input.userJid,
      prompt: input.prompt,
      bypassCooldown: input.bypassCooldown,
      now,
    });

    const apiKey = this.apiKey?.trim() ?? "";

    let response: Response;
    try {
      response = await this.fetchFn(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/AnthonyWisnu/MinjiBot",
          "X-Title": "MinjiBot",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: AI_MAX_TOKENS,
          temperature: input.persona === "simi" ? 0.9 : 0.7,
          messages: [
            { role: "system", content: SYSTEM_PROMPTS[input.persona] },
            { role: "user", content: cleanedPrompt },
          ],
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      logger.warn({ err: error, model: this.model }, "OpenRouter network or timeout error");
      throw new AppUserError("AI sedang tidak merespons saat ini. Coba lagi beberapa saat ya.");
    }

    if (!response.ok) {
      const status = response.status;
      logger.warn({ status, model: this.model }, "OpenRouter returned non-OK HTTP status");
      if (status === 401 || status === 402) {
        throw new AppUserError(
          "Maaf, saldo kredit AI bot sedang habis atau API key perlu diperbarui oleh Owner.",
        );
      }
      if (status === 429) {
        throw new AppUserError("Layanan AI sedang ramai, coba tanya lagi beberapa detik lagi ya.");
      }
      throw new AppUserError("Layanan AI sedang mengalami gangguan sementara. Coba lagi nanti ya.");
    }

    let payload: OpenRouterCompletionResponse;
    try {
      payload = (await response.json()) as OpenRouterCompletionResponse;
    } catch {
      throw new AppUserError("Respons AI tidak dapat dibaca. Coba ulangi pertanyaanmu ya.");
    }

    const answer = extractAnswerText(payload);
    if (!answer) {
      throw new AppUserError("AI tidak memberikan jawaban. Coba ubah sedikit kalimat pertanyaanmu.");
    }

    const nowMs = now.getTime();
    this.recordUsage(input.groupJid, input.userJid, now, nowMs);

    return {
      answer,
      model: this.model,
      remainingGroupQuota: this.getRemainingGroupQuota(input.groupJid, now),
      dailyQuotaLimit: this.dailyQuotaPerGroup,
    };
  }

  private recordUsage(groupJid: string, userJid: string, now: Date, nowMs: number): void {
    const cdKey = `${groupJid}:${userJid}`;
    this.userCooldowns.set(cdKey, nowMs);
    if (this.userCooldowns.size > MAX_COOLDOWN_ENTRIES) {
      for (const [k, ts] of this.userCooldowns.entries()) {
        if (nowMs - ts > AI_COOLDOWN_MS * 4 || this.userCooldowns.size > MAX_COOLDOWN_ENTRIES) {
          this.userCooldowns.delete(k);
        }
        if (this.userCooldowns.size <= Math.floor(MAX_COOLDOWN_ENTRIES * 0.75)) {
          break;
        }
      }
    }

    const todayKey = toWibDateKey(now);
    const quotaKey = `${groupJid}:${todayKey}`;
    const prev = this.groupDailyUsage.get(quotaKey) ?? 0;
    this.groupDailyUsage.set(quotaKey, prev + 1);

    if (this.groupDailyUsage.size > MAX_QUOTA_ENTRIES) {
      for (const k of this.groupDailyUsage.keys()) {
        if (!k.endsWith(`:${todayKey}`)) {
          this.groupDailyUsage.delete(k);
        }
      }
      while (this.groupDailyUsage.size > MAX_QUOTA_ENTRIES) {
        const oldest = this.groupDailyUsage.keys().next().value;
        if (!oldest) break;
        this.groupDailyUsage.delete(oldest);
      }
    }
  }
}

function extractAnswerText(payload: OpenRouterCompletionResponse): string {
  const rawContent = payload.choices?.[0]?.message?.content;
  if (typeof rawContent === "string") {
    return rawContent.trim();
  }
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

export const openRouterService = new OpenRouterService();
