import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { env } from "../config/env";

const MINJI_TEMP_PREFIX = "minji-";

function getDedicatedTempRoot(): string {
  const baseDir = env.TEMP_DIR ? path.resolve(env.TEMP_DIR) : path.join(os.tmpdir(), "minjibot");
  return path.join(baseDir, "minjibot-work");
}

export async function createTempDir(prefix: string): Promise<string> {
  const tempRoot = getDedicatedTempRoot();
  await mkdir(tempRoot, { recursive: true });

  const safePrefix = prefix.replace(/[^\w-]/g, "");
  return mkdtemp(path.join(tempRoot, `${MINJI_TEMP_PREFIX}${safePrefix}-`));
}

export async function removeTempDir(tempDir: string): Promise<void> {
  const tempRoot = getDedicatedTempRoot();
  const normalizedTarget = path.resolve(tempDir);
  const normalizedRoot = path.resolve(tempRoot);

  // Guard pengaman: Hanya hapus jika berada di dalam subdirektori minjibot-work
  // dan namanya berawalan minji-
  const basename = path.basename(normalizedTarget);
  if (!normalizedTarget.startsWith(normalizedRoot) || !basename.startsWith(MINJI_TEMP_PREFIX)) {
    return;
  }

  await rm(tempDir, {
    recursive: true,
    force: true,
  });
}

/**
 * Membersihkan seluruh direktori sementara di subdirektori khusus minjibot-work saat startup.
 * Hanya menghapus entri yang berawalan prefix 'minji-'.
 */
export async function cleanAllStaleTempDirs(): Promise<void> {
  const tempRoot = getDedicatedTempRoot();
  try {
    const entries = await readdir(tempRoot);
    for (const entry of entries) {
      if (!entry.startsWith(MINJI_TEMP_PREFIX)) continue;
      const fullPath = path.join(tempRoot, entry);
      await rm(fullPath, { recursive: true, force: true });
    }
  } catch {
    // Abaikan jika folder belum ada
  }
}

/**
 * Membersihkan file/folder sementara di minjibot-work yang berusia lebih dari maxAgeMs (default: 30 menit).
 * Hanya menghapus entri yang berawalan prefix 'minji-'.
 */
export async function sweepStaleTempFiles(maxAgeMs: number = 30 * 60 * 1000): Promise<void> {
  const tempRoot = getDedicatedTempRoot();
  const now = Date.now();
  try {
    const entries = await readdir(tempRoot);
    for (const entry of entries) {
      if (!entry.startsWith(MINJI_TEMP_PREFIX)) continue;
      const fullPath = path.join(tempRoot, entry);
      try {
        const fileStat = await stat(fullPath);
        if (now - fileStat.mtimeMs > maxAgeMs) {
          await rm(fullPath, { recursive: true, force: true });
        }
      } catch {
        // Abaikan error pada file individual
      }
    }
  } catch {
    // Abaikan jika folder belum ada
  }
}
