import { BotLifecycle } from "./bot/lifecycle";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { memberEconomyService } from "./services/member/memberEconomy.service";
import { cleanAllStaleTempDirs, sweepStaleTempFiles } from "./utils/tempFile";

async function main(): Promise<void> {
  // Bersihkan sisa file sementara jika bot sebelumnya restart mendadak
  await cleanAllStaleTempDirs();

  // Jadwalkan pembersihan otomatis setiap 1 jam untuk file temp berusia > 30 menit
  setInterval(
    () => {
      void sweepStaleTempFiles();
    },
    60 * 60 * 1000,
  ).unref();

  // Rekonsiliasi limit reservasi yang menggantung akibat crash/restart sebelumnya
  try {
    const recovered = await memberEconomyService.reconcileOrphanedReservations();
    if (recovered > 0) {
      logger.info({ recovered }, "Berhasil merekonsiliasi reservasi limit yatim saat startup");
    }
  } catch (error: unknown) {
    logger.error({ err: error }, "Gagal rekonsiliasi reservasi limit yatim saat startup");
  }

  // Jadwalkan rekonsiliasi berkala setiap 30 menit
  setInterval(
    () => {
      memberEconomyService.reconcileOrphanedReservations().catch((error: unknown) => {
        logger.error({ err: error }, "Gagal rekonsiliasi reservasi limit yatim periodik");
      });
    },
    30 * 60 * 1000,
  ).unref();

  logger.info(
    {
      environment: env.NODE_ENV,
      commandPrefix: env.COMMAND_PREFIX,
    },
    "MinjiBot configuration loaded",
  );

  const lifecycle = new BotLifecycle();
  registerProcessHandlers(lifecycle);
  await lifecycle.start();
}

function registerProcessHandlers(lifecycle: BotLifecycle): void {
  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info({ signal }, "Shutdown signal diterima");

    lifecycle
      .stop(signal)
      .catch((error: unknown) => {
        logger.error({ err: error }, "Gagal menghentikan lifecycle MinjiBot");
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ err: reason }, "Unhandled promise rejection terdeteksi pada proses utama");
  });

  process.on("uncaughtException", (error: Error) => {
    logger.fatal({ err: error }, "Uncaught exception terdeteksi pada proses utama");
    if (!isShuttingDown) {
      isShuttingDown = true;
      lifecycle
        .stop("uncaughtException")
        .catch((stopErr: unknown) => {
          logger.error({ err: stopErr }, "Gagal menghentikan lifecycle saat uncaughtException");
        })
        .finally(() => {
          process.exit(1);
        });
    }
  });
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "MinjiBot gagal dijalankan");
  process.exitCode = 1;
});
