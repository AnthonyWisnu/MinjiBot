import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { env } from "../config/env";

export async function createTempDir(prefix: string): Promise<string> {
  const baseDir = path.resolve(env.TEMP_DIR);
  const systemTempDir = path.join(os.tmpdir(), "minjibot");
  const tempRoot = baseDir.length > 0 ? baseDir : systemTempDir;
  await mkdir(tempRoot, { recursive: true });

  return mkdtemp(path.join(tempRoot, `${prefix}-`));
}

export async function removeTempDir(tempDir: string): Promise<void> {
  await rm(tempDir, {
    recursive: true,
    force: true,
  });
}

/**
 * Membersihkan seluruh file/folder sementara di TEMP_DIR saat startup.
 */
export async function cleanAllStaleTempDirs(): Promise<void> {
  const baseDir = path.resolve(env.TEMP_DIR);
  try {
    const entries = await readdir(baseDir);
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry);
      await rm(fullPath, { recursive: true, force: true });
    }
  } catch {
    // Abaikan jika folder belum ada
  }
}

/**
 * Membersihkan file/folder sementara di TEMP_DIR yang berusia lebih dari maxAgeMs (default: 30 menit).
 */
export async function sweepStaleTempFiles(maxAgeMs: number = 30 * 60 * 1000): Promise<void> {
  const baseDir = path.resolve(env.TEMP_DIR);
  const now = Date.now();
  try {
    const entries = await readdir(baseDir);
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry);
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
