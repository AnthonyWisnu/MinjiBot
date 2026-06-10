import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { env } from "../../config/env";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { AiJobQueueService } from "./aiJobQueue.service";

const aiUpscaleQueue = new AiJobQueueService(env.HD_AI_MAX_CONCURRENT_JOBS);

export class ImageAiUpscaleService {
  async upscale(inputBuffer: Buffer): Promise<Buffer> {
    const aiUpscaleBin = env.AI_UPSCALE_BIN;
    if (!aiUpscaleBin) {
      throw new Error("Dependency HD AI belum tersedia. Atur AI_UPSCALE_BIN di .env.");
    }

    return aiUpscaleQueue.run(async () => this.runUpscale(inputBuffer, aiUpscaleBin));
  }

  private async runUpscale(inputBuffer: Buffer, aiUpscaleBin: string): Promise<Buffer> {
    const tempDir = await createTempDir("hdai");
    const inputPath = path.join(tempDir, "input.png");
    const rawOutputPath = path.join(tempDir, "output.png");
    const finalOutputPath = path.join(tempDir, "output.jpg");

    try {
      await writeFile(inputPath, inputBuffer);
      await runProcess(aiUpscaleBin, [inputPath, rawOutputPath], 600000);
      await sharp(rawOutputPath)
        .rotate()
        .jpeg({
          quality: 94,
          mozjpeg: true,
        })
        .toFile(finalOutputPath);

      return await readFile(finalOutputPath);
    } finally {
      await removeTempDir(tempDir);
    }
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Proses HD AI melewati batas waktu."));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Dependency HD AI tidak dapat dijalankan: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Proses HD AI gagal: ${stderr.slice(-500)}`));
    });
  });
}

export const imageAiUpscaleService = new ImageAiUpscaleService();
