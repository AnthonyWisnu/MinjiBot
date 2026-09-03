import "dotenv/config";
import { z } from "zod";

const optionalPathSchema = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value.length > 0 ? value : undefined))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  COMMAND_PREFIX: z.string().min(1),
  SUPER_OWNER_JIDS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((jid) => jid.trim())
        .filter((jid) => jid.length > 0),
    )
    .refine((value) => value.length > 0, "Minimal satu Super Owner wajib diisi"),
  SESSION_DIR: z.string().min(1),
  TEMP_DIR: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
  BOT_BROWSER_NAME: z.string().min(1),
  RECONNECT_INITIAL_MS: z.coerce.number().int().positive(),
  RECONNECT_MAX_MS: z.coerce.number().int().positive(),
  MAX_DOWNLOAD_FILE_MB: z.coerce.number().int().positive(),
  DOWNLOADER_BIN: z.string().min(1),
  DOWNLOADER_COOKIES_PATH: optionalPathSchema,
  YOUTUBE_COOKIES_PATH: optionalPathSchema,
  INSTAGRAM_COOKIES_PATH: optionalPathSchema,
  TIKTOK_COOKIES_PATH: optionalPathSchema,
  DOWNLOADER_TIMEOUT_MS: z.coerce.number().int().positive(),
  HD_MAX_INPUT_MB: z.coerce.number().int().positive(),
  HD_AI_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive(),
  TENANT_SESSION_TTL_DAYS: z.coerce.number().int().positive(),
  REMINDER_POLL_MS: z.coerce.number().int().positive(),
  FFMPEG_PATH: optionalPathSchema,
  AI_UPSCALE_BIN: optionalPathSchema,
  GALLERY_DL_BIN: z.string().default("gallery-dl"),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
