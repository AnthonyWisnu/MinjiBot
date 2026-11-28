import sharp from "sharp";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";
import { prisma } from "../../repositories/prismaClient";
import { mediaQueueService } from "../../utils/boundedQueue";
import { formatRemainingDuration } from "../../utils/currency";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { isGroupJid } from "../../utils/jid";
import { toWibDateKey } from "../../utils/wibDate";
import { AI_COOLDOWN_MS } from "../rpg/cooldownCatalog";
import {
  extractGroupEventStateObject,
  readGroupEventSection,
  writeGroupEventSection,
  type GroupEventTenantClient,
} from "../group/groupEventState.store";

export { AI_COOLDOWN_MS };
export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
export const AI_MAX_PROMPT_CHARS = 600;
export const AI_MAX_CONTEXT_CHARS = 2_400;
export const AI_MAX_TOKENS = 450;
const AI_REQUEST_TIMEOUT_MS = 25_000;
const MAX_COOLDOWN_ENTRIES = 2_000;
const MAX_QUOTA_ENTRIES = 500;

export type AiPersona =
  | "assistant"
  | "simi"
  | "ringkas"
  | "tanyachat"
  | "vision"
  | "ocr"
  | "roast"
  | "puji"
  | "pantunai"
  | "cerpen"
  | "curhat"
  | "debat"
  | "koding"
  | "perbaiki"
  | "summarize"
  | "ide";

export interface OpenRouterAskInput {
  groupJid: string;
  userJid: string;
  prompt: string;
  persona: AiPersona;
  imageDataUrl?: string;
  maxPromptChars?: number;
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
  tenantClient?: GroupEventTenantClient | null;
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
  ringkas: [
    "Kamu meringkas obrolan grup WhatsApp dalam Bahasa Indonesia santai dan rapi.",
    "Buat maksimal 5 poin bullet singkat tentang topik utama, keputusan, atau hal lucu dari transkrip obrolan.",
    "Jangan mengarang hal di luar transkrip.",
  ].join(" "),
  tanyachat: [
    "Jawab pertanyaan user secara singkat dan akurat dalam Bahasa Indonesia HANYA berdasarkan transkrip obrolan grup yang diberikan.",
    "Jika jawabannya tidak ada di transkrip, katakan terus terang belum dibahas di obrolan terakhir.",
  ].join(" "),
  vision: [
    "Kamu adalah MinjiBot dengan kemampuan analisis gambar di WhatsApp.",
    "Jelaskan isi gambar, meme, grafik, atau bantu selesaikan soal di gambar dalam Bahasa Indonesia yang ringkas, jelas, dan mudah dibaca di HP.",
  ].join(" "),
  ocr: [
    "Ekstrak seluruh teks yang terlihat pada gambar/screenshot dengan akurat dan rapi.",
    "Pertahankan susunan baris seperlunya tanpa tambahan basa-basi panjang.",
  ].join(" "),
  roast: [
    "Kamu komika stand-up yang me-roast teman tongkrongan secara kocak, cerdas, dan akrab berdasarkan statistik profil game/ekonomi mereka.",
    "Buat 3-4 kalimat punchy dalam Bahasa Indonesia santai. WAJIB aman, ramah teman, dilarang menghina fisik, SARA, kata kasar berat, atau menyakiti hati.",
  ].join(" "),
  puji: [
    "Kamu teman yang super suportif dan suka memuji secara kocak dan lebay dalam Bahasa Indonesia.",
    "Puji member berdasarkan data profil mereka dalam 3-4 kalimat yang bikin senyum dan makin semangat di grup.",
  ].join(" "),
  pantunai: [
    "Buatkan 2 bait pantun Bahasa Indonesia (masing-masing 4 baris berima a-b-a-b) yang jenaka, kreatif, dan sesuai topik permintaan.",
  ].join(" "),
  cerpen: [
    "Tulis cerita pendek seru, mengalir, dan menghibur dalam Bahasa Indonesia (maksimal 3 paragraf pendek) sesuai tema yang diminta.",
  ].join(" "),
  curhat: [
    "Kamu teman curhat yang hangat, empatik, tidak menghakimi, dan menenangkan dalam Bahasa Indonesia.",
    "Validasi perasaan user lalu beri 1-2 saran ringan yang realistis dan menguatkan (maksimal 3 paragraf pendek).",
  ].join(" "),
  debat: [
    "Kamu partner debat intelektual sekaligus jenaka di grup tongkrongan.",
    "Berikan sudut pandang tandingan (devil's advocate) yang logis, tajam, tapi tetap santai dan sopan dalam 3 poin singkat.",
  ].join(" "),
  koding: [
    "Kamu asisten programmer senior yang ringkas dan to the point.",
    "Jawab pertanyaan pemrograman dalam Bahasa Indonesia, sertakan contoh kode singkat yang benar dan mudah disalin di WhatsApp.",
  ].join(" "),
  perbaiki: [
    "Perbaiki ejaan, typo, tanda baca, dan tata bahasa teks berikut menjadi Bahasa Indonesia yang rapi, natural, dan enak dibaca.",
    "Tampilkan hasil perbaikannya langsung tanpa penjelasan panjang.",
  ].join(" "),
  summarize: [
    "Ringkas teks panjang berikut menjadi 3-5 poin inti yang padat, jelas, dan mudah dipahami dalam Bahasa Indonesia.",
  ].join(" "),
  ide: [
    "Berikan 5 ide kreatif, unik, dan praktis dalam format daftar bernomor singkat (Bahasa Indonesia) sesuai topik yang diminta.",
  ].join(" "),
};

export async function prepareVisionImageDataUrl(rawBuffer: Buffer): Promise<string> {
  const jpeg = await mediaQueueService.imageComputeQueue.run(async () =>
    sharp(rawBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer(),
  );
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

function parsePersistedAiDailyUsage(
  raw: unknown,
): { dateKey: string; count: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.dateKey !== "string" ||
    obj.dateKey.length === 0 ||
    typeof obj.count !== "number" ||
    !Number.isInteger(obj.count) ||
    obj.count < 0
  ) {
    return null;
  }
  return { dateKey: obj.dateKey, count: obj.count };
}

export class OpenRouterService {
  private readonly userCooldowns = new Map<string, number>();
  private readonly groupDailyUsage = new Map<string, number>();
  private readonly hydratedQuotaGroups = new Set<string>();
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly dailyQuotaPerGroup: number;
  private readonly fetchFn: typeof fetch;
  private readonly tenantClient: GroupEventTenantClient | undefined;

  constructor(config?: Partial<OpenRouterConfig>) {
    this.apiKey = config && "apiKey" in config ? config.apiKey : env.OPENROUTER_API_KEY;
    this.model = config?.model ?? env.OPENROUTER_MODEL;
    this.dailyQuotaPerGroup = config?.dailyQuotaPerGroup ?? env.AI_DAILY_QUOTA_PER_GROUP;
    this.fetchFn = config?.fetchFn ?? fetch;
    this.tenantClient =
      config && "tenantClient" in config
        ? (config.tenantClient ?? undefined)
        : config === undefined
          ? prisma.tenantGroup
          : undefined;
  }

  syncDailyUsageFromTenantState(
    groupJid: string,
    rawGroupEventState: unknown,
    now: Date = new Date(),
  ): void {
    const obj = extractGroupEventStateObject(rawGroupEventState);
    const parsed = parsePersistedAiDailyUsage(obj.aiDailyUsage);
    const todayKey = toWibDateKey(now);
    const quotaKey = `${groupJid}:${todayKey}`;
    this.hydratedQuotaGroups.add(quotaKey);
    if (parsed?.dateKey !== todayKey) {
      return;
    }
    const existing = this.groupDailyUsage.get(quotaKey) ?? 0;
    if (parsed.count > existing) {
      this.groupDailyUsage.set(quotaKey, parsed.count);
    }
  }

  private async hydrateGroupDailyUsage(groupJid: string, now: Date): Promise<void> {
    if (!this.tenantClient || !isGroupJid(groupJid)) return;
    const todayKey = toWibDateKey(now);
    const quotaKey = `${groupJid}:${todayKey}`;
    if (this.hydratedQuotaGroups.has(quotaKey)) return;
    this.hydratedQuotaGroups.add(quotaKey);

    const raw = await readGroupEventSection(this.tenantClient, groupJid, "aiDailyUsage");
    const parsed = parsePersistedAiDailyUsage(raw);
    if (parsed?.dateKey === todayKey) {
      const existing = this.groupDailyUsage.get(quotaKey) ?? 0;
      if (parsed.count > existing) {
        this.groupDailyUsage.set(quotaKey, parsed.count);
      }
    }
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
    maxPromptChars?: number;
    bypassCooldown?: boolean;
    now?: Date;
  }): string {
    if (!this.isConfigured()) {
      throw new AppUserError(
        "Fitur AI belum diaktifkan oleh Owner bot (API Key OpenRouter belum diatur).",
      );
    }

    const maxChars = Math.min(AI_MAX_CONTEXT_CHARS, input.maxPromptChars ?? AI_MAX_PROMPT_CHARS);
    const cleaned = input.prompt.trim();
    if (!cleaned) {
      throw new AppUserError("Tulis pertanyaan atau pesan yang ingin dikirim ke AI.");
    }
    if (cleaned.length > maxChars) {
      throw new AppUserError(
        `Pesan terlalu panjang (${String(cleaned.length)} karakter). Maksimal ${String(maxChars)} karakter biar hemat dan cepat dijawab.`,
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
    await this.hydrateGroupDailyUsage(input.groupJid, now);
    const cleanedPrompt = this.validateBeforeLimitReserve({
      groupJid: input.groupJid,
      userJid: input.userJid,
      prompt: input.prompt,
      maxPromptChars: input.maxPromptChars,
      bypassCooldown: input.bypassCooldown,
      now,
    });

    const apiKey = this.apiKey?.trim() ?? "";
    const userContent = input.imageDataUrl
      ? [
          { type: "text", text: cleanedPrompt },
          { type: "image_url", image_url: { url: input.imageDataUrl } },
        ]
      : cleanedPrompt;

    const temperature =
      input.persona === "simi" || input.persona === "roast" || input.persona === "pantunai"
        ? 0.9
        : input.persona === "ocr" || input.persona === "perbaiki"
          ? 0.2
          : 0.7;

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
          temperature,
          messages: [
            { role: "system", content: SYSTEM_PROMPTS[input.persona] },
            { role: "user", content: userContent },
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
    await this.recordUsage(input.groupJid, input.userJid, now, nowMs);

    return {
      answer,
      model: this.model,
      remainingGroupQuota: this.getRemainingGroupQuota(input.groupJid, now),
      dailyQuotaLimit: this.dailyQuotaPerGroup,
    };
  }

  private async recordUsage(
    groupJid: string,
    userJid: string,
    now: Date,
    nowMs: number,
  ): Promise<void> {
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
    const nextCount = (this.groupDailyUsage.get(quotaKey) ?? 0) + 1;
    this.groupDailyUsage.set(quotaKey, nextCount);
    this.hydratedQuotaGroups.add(quotaKey);

    if (this.groupDailyUsage.size > MAX_QUOTA_ENTRIES) {
      for (const k of this.groupDailyUsage.keys()) {
        if (!k.endsWith(`:${todayKey}`)) {
          this.groupDailyUsage.delete(k);
          this.hydratedQuotaGroups.delete(k);
        }
      }
      while (this.groupDailyUsage.size > MAX_QUOTA_ENTRIES) {
        const oldest = this.groupDailyUsage.keys().next().value;
        if (!oldest) break;
        this.groupDailyUsage.delete(oldest);
        this.hydratedQuotaGroups.delete(oldest);
      }
    }

    if (this.tenantClient && isGroupJid(groupJid)) {
      await writeGroupEventSection(this.tenantClient, groupJid, "aiDailyUsage", {
        dateKey: todayKey,
        count: nextCount,
      });
    }
  }

  getRemainingCooldownMs(groupJid: string, userJid: string, nowMs = Date.now()): number {
    const cdKey = `${groupJid}:${userJid}`;
    const lastUsed = this.userCooldowns.get(cdKey);
    if (lastUsed === undefined) {
      return 0;
    }
    const elapsed = nowMs - lastUsed;
    return elapsed >= AI_COOLDOWN_MS ? 0 : AI_COOLDOWN_MS - elapsed;
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
