/**
 * MinjiBot Telemetry Service
 * Mengirimkan metrik operasional dan eksekusi command ke Pulse Analytics secara asinkron (fire-and-forget).
 * Tidak memblokir alur pesan dan sepenuhnya aman dari error network (zero impact).
 */

interface CommandTelemetryPayload {
  command: string;
  role?: string;
  isGroup: boolean;
  status: "success" | "error";
  executionTimeMs?: number;
  errorMessage?: string;
}

interface MessageTelemetryPayload {
  isGroup: boolean;
  hasMedia?: boolean;
}

const PULSE_URL = process.env.PULSE_COLLECT_URL || "http://127.0.0.1:3002/api/collect";
const WEBSITE_ID = "minji-bot";
const TIMEOUT_MS = 1500;

async function sendPulseEvent(eventName: string, eventData: Record<string, unknown>): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    await fetch(PULSE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "event",
        website_id: WEBSITE_ID,
        event_name: eventName,
        event_data: eventData,
      }),
      signal: controller.signal,
    }).catch(() => {
      // Fire-and-forget: kegagalan analitik diabaikan secara diam-diam
    });

    clearTimeout(timer);
  } catch {
    // Abaikan seluruh exception agar kestabilan bot tetap 100%
  }
}

export function reportIncomingMessage(payload: MessageTelemetryPayload): void {
  void sendPulseEvent("bot_message", {
    is_group: payload.isGroup,
    has_media: Boolean(payload.hasMedia),
  });
}

export function reportCommandExecution(payload: CommandTelemetryPayload): void {
  void sendPulseEvent("bot_command", {
    command: payload.command,
    role: payload.role || "member",
    is_group: payload.isGroup,
    status: payload.status,
    latency_ms: payload.executionTimeMs || 0,
    error: payload.errorMessage || null,
  });
}
