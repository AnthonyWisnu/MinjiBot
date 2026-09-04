import { BotLifecycle } from "./bot/lifecycle";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { cleanAllStaleTempDirs, sweepStaleTempFiles } from "./utils/tempFile";

async function main(): Promise<void> {
  // Bersihkan sisa file sementara jika bot sebelumnya restart mendadak
  await cleanAllStaleTempDirs();

  // Jadwalkan pembersihan otomatis setiap 1 jam untuk file temp berusia > 30 menit
  setInterval(() => {
    void sweepStaleTempFiles();
  }, 60 * 60 * 1000).unref();

  logger.info(
    {
      environment: env.NODE_ENV,
      commandPrefix: env.COMMAND_PREFIX,
    },
    "MinjiBot configuration loaded",
  );

  const lifecycle = new BotLifecycle();
  registerShutdownHandlers(lifecycle);
  await lifecycle.start();
}

function registerShutdownHandlers(lifecycle: BotLifecycle): void {
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
        logger.error({ error }, "Gagal menghentikan lifecycle MinjiBot");
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  logger.error({ error }, "MinjiBot gagal dijalankan");
  process.exitCode = 1;
});
