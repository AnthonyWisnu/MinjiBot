import { spawn, type ChildProcess } from "node:child_process";

export interface RunProcessOptions {
  timeoutMs?: number;
  cwd?: string;
  extraPathDirs?: string[];
  captureStdout?: boolean;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  throwOnNonZeroExit?: boolean;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_MAX_STDERR_BYTES = 16 * 1024; // 16 KB

/**
 * Membangun environment object untuk subprocess dengan penanganan PATH yang aman
 * lintas Windows dan POSIX tanpa menduplikasi key PATH / Path.
 */
export function buildSubprocessEnv(
  extraPathDirs?: string[],
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const resultEnv: NodeJS.ProcessEnv = { ...baseEnv };
  if (!extraPathDirs || extraPathDirs.length === 0) {
    return resultEnv;
  }

  const isWindows = process.platform === "win32";
  const pathDelimiter = isWindows ? ";" : ":";

  // Temukan key PATH yang sudah ada secara case-insensitive
  const existingPathKey =
    Object.keys(resultEnv).find((key) => key.toLowerCase() === "path") ??
    (isWindows ? "Path" : "PATH");

  const currentPathVal = resultEnv[existingPathKey] ?? "";
  const existingSegments = currentPathVal.split(pathDelimiter).filter(Boolean);

  // Prepend extraPathDirs tanpa duplikasi
  const newSegments = [...extraPathDirs];
  for (const seg of existingSegments) {
    if (!newSegments.includes(seg)) {
      newSegments.push(seg);
    }
  }

  // Bersihkan semua variasi key PATH yang mungkin ada agar tidak ganda
  for (const key of Object.keys(resultEnv)) {
    if (key.toLowerCase() === "path" && key !== existingPathKey) {
      Reflect.deleteProperty(resultEnv, key);
    }
  }

  resultEnv[existingPathKey] = newSegments.join(pathDelimiter);
  return resultEnv;
}

/**
 * Eksekutor proses eksternal aman lintas platform:
 * - stdio ignore untuk stdout bila tidak diperlukan (bebas deadlock pipe 64 KB kernel)
 * - Tail buffer untuk stderr (maksimal 16 KB)
 * - Mematikan seluruh pohon proses (process tree) saat timeout
 * - Selalu menunggu event 'close' sebelum meresolusi/me-reject promise
 */
export function runExternalProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cwd,
    extraPathDirs,
    captureStdout = false,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
    env: customEnv,
    windowsHide = true,
    throwOnNonZeroExit = true,
  } = options;

  const subprocessEnv = buildSubprocessEnv(extraPathDirs, customEnv ?? process.env);
  const isWindows = process.platform === "win32";

  return new Promise<ProcessResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        env: subprocessEnv,
        windowsHide,
        detached: !isWindows, // Pada POSIX, jadikan leader process group agar bisa kill -child.pid
        stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
      });
    } catch (err: unknown) {
      reject(
        new Error(
          `Gagal men-spawn proses ${command}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    let stdoutData = "";
    let stdoutBytes = 0;
    let stderrTail = "";
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let fallbackKillTimer: NodeJS.Timeout | null = null;
    let settled = false;

    if (captureStdout && child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutBytes < maxStdoutBytes) {
          const remaining = maxStdoutBytes - stdoutBytes;
          const toAdd = chunk.subarray(0, remaining);
          stdoutData += toAdd.toString("utf8");
          stdoutBytes += toAdd.length;
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail += chunk.toString("utf8");
        if (stderrTail.length > maxStderrBytes) {
          // Simpan bagian akhir (tail) saja
          stderrTail = stderrTail.slice(-maxStderrBytes);
        }
      });
    }

    const killProcessTree = () => {
      if (!child.pid) return;

      if (isWindows) {
        try {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // Abaikan jika sudah mati
          }
        }
      } else {
        try {
          // Bunuh process group dengan tanda minus pada pid
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // Abaikan jika sudah mati
          }
        }
      }
    };

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killProcessTree();

        // Jaga-jaga jika OS tidak pernah menembakkan event close
        fallbackKillTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`Proses ${command} melewati batas waktu (${String(timeoutMs)} ms).`));
          }
        }, 2000);
      }, timeoutMs);
    }

    child.on("error", (err: Error) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (fallbackKillTimer) clearTimeout(fallbackKillTimer);
      if (!settled) {
        settled = true;
        reject(new Error(`Error pada proses ${command}: ${err.message}`));
      }
    });

    child.on("close", (code: number | null) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (fallbackKillTimer) clearTimeout(fallbackKillTimer);
      if (settled) return;
      settled = true;

      if (timedOut) {
        reject(new Error(`Proses ${command} melewati batas waktu (${String(timeoutMs)} ms).`));
        return;
      }

      if (code === 0 || !throwOnNonZeroExit) {
        resolve({
          stdout: stdoutData,
          stderr: stderrTail,
          exitCode: code,
        });
        return;
      }

      const errMsg = stderrTail.trim()
        ? `Proses ${command} gagal dengan kode ${String(code)}: ${stderrTail.slice(-500).trim()}`
        : `Proses ${command} gagal dengan kode ${String(code)}.`;
      reject(new Error(errMsg));
    });
  });
}
