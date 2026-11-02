import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { pendingTenantRegistrationService } from "../../../services/tenant/pendingTenantRegistration.service";
import { tenantRuntimeCacheService } from "../../../services/tenant/tenantRuntimeCache.service";
import { getMessageSenderJid, isGroupJid, isStatusBroadcastJid } from "../../../utils/jid";
import { extractTextFromMessageContent } from "../../../utils/messageText";
import type { IncomingPipelineContext, InterceptorOutput, MessageInterceptor } from "../types";

export class TenantContextInterceptor implements MessageInterceptor {
  readonly name = "TenantContextInterceptor";
  readonly priority = 5; // Berjalan paling awal di seluruh pipeline

  async intercept(context: IncomingPipelineContext): Promise<InterceptorOutput> {
    const chatJid = context.remoteJid;
    if (!chatJid || !context.isGroup || !isGroupJid(chatJid) || isStatusBroadcastJid(chatJid)) {
      return null;
    }

    let snapshot = await tenantRuntimeCacheService.getOrFetchSnapshot(chatJid);

    // Jika grup belum terdaftar di DB sama sekali, daftarkan sebagai PENDING sekali
    if (!snapshot) {
      try {
        await pendingTenantRegistrationService.registerIfNeeded({
          socket: context.socket,
          groupJid: chatJid,
          actorJid: getMessageSenderJid(chatJid, context.message.key.participant),
        });
        tenantRuntimeCacheService.invalidate(chatJid);
        snapshot = await tenantRuntimeCacheService.getOrFetchSnapshot(chatJid);
      } catch (error: unknown) {
        logger.error(
          { error, groupJid: chatJid },
          "TenantContextInterceptor: Gagal registrasi pending tenant",
        );
      }
    }

    // Lampirkan snapshot ke pipeline context agar seluruh interceptor berikutnya
    // tidak perlu melakukan query SQL ke database lagi
    context.tenantSnapshot = snapshot;

    // Evaluasi status keaktifan tenant
    const tenant = snapshot?.tenant;
    const isExpired = Boolean(tenant?.expiresAt && tenant.expiresAt.getTime() <= Date.now());
    const isInactive = tenant?.status !== "ACTIVE" || isExpired;

    if (isInactive) {
      // Periksa apakah pesan masuk merupakan command
      const text = extractTextFromMessageContent(context.message.message).trim();
      const isCommand = text.startsWith(env.COMMAND_PREFIX);

      if (!isCommand) {
        // PERF-01 Early Pipeline Gate:
        // Hentikan pemrosesan 100% untuk chat biasa di grup yang mati / pending / expired / blocked.
        // AntiDelete, ActivityTracker, AFK, AntiLink, dan AntiSpam 0% menyentuh CPU/RAM/DB!
        return { halt: true };
      }

      // Jika merupakan command (misal .menu, .infosewa, .sewa, .panel), teruskan
      // agar TenantGuard & Router dapat memberikan balasan panduan yang sesuai
      return null;
    }

    return null;
  }
}
