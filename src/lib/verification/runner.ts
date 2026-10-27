/**
 * Bounded process execution for the verification CLI.
 *
 * - `shell: false` always, with an argument array. No string is ever parsed by
 *   a shell and no user supplied command can reach this function.
 * - Output is capped per stream; the report records that the tail was dropped.
 * - A timeout kills the process and is reported as `timed-out`, not as a
 *   failure of the repository's code.
 *
 * This is NOT a sandbox. The spawned npm script can run any code in the
 * repository and can reach the network.
 */

import { spawn } from "node:child_process";

import type { CommandEvidence, CommandSpec, CommandStatus } from "./types";

export interface RunCommandOptions {
  cwd: string;
  spec: CommandSpec;
  /** Optional abort signal so a caller can stop a run. */
  signal?: AbortSignal;
  /** Milliseconds between SIGTERM and SIGKILL. Exposed for tests. */
  killGraceMs?: number;
}

function appendBounded(
  current: string,
  chunk: Buffer,
  limit: number,
): { value: string; truncated: boolean } {
  if (current.length >= limit) return { value: current, truncated: true };
  const remaining = limit - current.length;
  const text = chunk.toString("utf8");
  if (text.length <= remaining) return { value: current + text, truncated: false };
  return { value: current + text.slice(0, remaining), truncated: true };
}

export async function runCommand({
  cwd,
  spec,
  signal,
  killGraceMs = 1_000,
}: RunCommandOptions): Promise<CommandEvidence> {
  const startedAt = new Date();
  const startedMs = Date.now();

  return new Promise<CommandEvidence>((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(spec.executable, spec.args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    let killTimer: NodeJS.Timeout | null = null;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, killGraceMs);
      killTimer.unref?.();
    }, spec.timeoutMs);

    const onAbort = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      const next = appendBounded(stdout, chunk, spec.maxOutputBytes);
      stdout = next.value;
      truncated = truncated || next.truncated;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const next = appendBounded(stderr, chunk, spec.maxOutputBytes);
      stderr = next.value;
      truncated = truncated || next.truncated;
    });

    const finish = (
      exitCode: number | null,
      processSignal: NodeJS.Signals | null,
      spawnError: string | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);

      let status: CommandStatus;
      if (spawnError) status = "spawn-error";
      else if (timedOut) status = "timed-out";
      else if (exitCode === 0) status = "passed";
      else status = "failed";

      const finishedAt = new Date();
      resolve({
        taskId: spec.taskId,
        label: spec.label,
        command: { executable: spec.executable, args: [...spec.args] },
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedMs,
        exitCode,
        signal: processSignal,
        status,
        timedOut,
        truncated,
        stdout,
        stderr,
        spawnError,
      });
    };

    child.on("error", (error) => {
      finish(null, null, error.message);
    });
    child.on("close", (code, processSignal) => {
      finish(code, processSignal, null);
    });
  });
}