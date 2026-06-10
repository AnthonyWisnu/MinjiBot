import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
