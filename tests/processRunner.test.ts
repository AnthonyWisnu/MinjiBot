import { test } from "node:test";
import assert from "node:assert/strict";

import { runExternalProcess, buildSubprocessEnv } from "../src/utils/processRunner";

void test("processRunner: executes child process producing >300KB stdout without pipe deadlock", async () => {
  const start = Date.now();
  const script = "process.stdout.write('A'.repeat(300_000)); process.exit(0);";
  const result = await runExternalProcess(process.execPath, ["-e", script], {
    timeoutMs: 5000,
    captureStdout: false,
  });

  const duration = Date.now() - start;
  assert.equal(result.exitCode, 0);
  assert.ok(duration < 4000, `Execution took ${duration}ms, should be fast`);
});

void test("processRunner: captures stdout when captureStdout is true", async () => {
  const result = await runExternalProcess(
    process.execPath,
    ["-e", "process.stdout.write('MINJIBOT_OUTPUT');"],
    { captureStdout: true },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout?.trim(), "MINJIBOT_OUTPUT");
});

void test("processRunner: timeout kills child process tree and rejects promise", async () => {
  const script = "setInterval(() => {}, 1000);"; // hang indefinitely
  await assert.rejects(
    async () => {
      await runExternalProcess(process.execPath, ["-e", script], { timeoutMs: 800 });
    },
    (err: unknown) => {
      const msg = String(err);
      return (
        msg.includes("melewati batas waktu") || msg.includes("timed out") || msg.includes("800")
      );
    },
  );
});

void test("processRunner: limits stderr buffer to tail ring buffer without memory bloat", async () => {
  // Generate 50KB stderr
  const script =
    "for(let i=0; i<500; i++) process.stderr.write('E'.repeat(100) + '\\n'); process.exit(1);";
  const result = await runExternalProcess(process.execPath, ["-e", script], {
    throwOnNonZeroExit: false,
  });

  assert.equal(result.exitCode, 1);
  assert.ok(
    result.stderr.length <= 16 * 1024 + 100,
    `stderr length ${result.stderr.length} should be capped`,
  );
});

void test("processRunner: buildSubprocessEnv preserves PATH/Path on Windows without duplicates", () => {
  const env = buildSubprocessEnv(["/extra/bin"]);
  const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === "path");
  assert.equal(pathKeys.length, 1, "There should be exactly one PATH/Path key in env");
  const pathVal = env[pathKeys[0]];
  assert.ok(pathVal?.includes("/extra/bin"), "PATH should contain extra dir");
});
