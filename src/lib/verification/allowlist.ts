/**
 * Fixed command allowlist for the verification CLI.
 *
 * The CLI never accepts a command string from the user. It accepts a task id,
 * and each task id maps to exactly one executable and one argument list here.
 * Adding a task is a code change, which is the point: the allowlist is the
 * trust boundary, not a runtime filter over user input.
 */

import fs from "node:fs";
import path from "node:path";

import type { CommandSpec, VerificationTaskId } from "./types";
import { VerificationError } from "./types";

export const TASK_IDS: VerificationTaskId[] = ["test", "lint"];

export interface TaskDefinition {
  label: string;
  /** npm script name; executed as `npm run <script>`. */
  script: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export const TASK_ALLOWLIST: Record<VerificationTaskId, TaskDefinition> = {
  test: {
    label: "Unit tests",
    script: "test",
    timeoutMs: 120_000,
    maxOutputBytes: 200_000,
  },
  lint: {
    label: "Lint",
    script: "lint",
    timeoutMs: 120_000,
    maxOutputBytes: 100_000,
  },
};

export function isTaskId(value: string): value is VerificationTaskId {
  return (TASK_IDS as string[]).includes(value);
}

/**
 * Parses repeated / comma separated `--task` values. Unknown ids are rejected
 * rather than ignored, so a typo can never silently skip a check.
 */
export function parseTaskIds(values: string[]): VerificationTaskId[] {
  const requested = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (requested.length === 0) {
    throw new VerificationError(
      "UNKNOWN_TASK",
      "No verification task was selected.",
      `Choose one or more of: ${TASK_IDS.join(", ")}.`,
    );
  }

  const tasks: VerificationTaskId[] = [];
  for (const value of requested) {
    if (!isTaskId(value)) {
      throw new VerificationError(
        "UNKNOWN_TASK",
        `"${value}" is not an allowlisted task.`,
        `Allowed tasks are ${TASK_IDS.join(", ")}. Arbitrary commands are not accepted.`,
      );
    }
    if (!tasks.includes(value)) tasks.push(value);
  }
  return tasks;
}

/**
 * Resolves the npm CLI that ships with the running Node installation.
 *
 * `npm.cmd` cannot be spawned without a shell on Windows, and using a shell
 * would reintroduce command injection. Running `node <npm-cli.js>` keeps
 * `shell: false` while still using npm's own script runner.
 */
export function resolveNpmCli(): { executable: string; argsPrefix: string[] } {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    if (candidate.endsWith(".js") && fs.existsSync(candidate)) {
      return { executable: process.execPath, argsPrefix: [candidate] };
    }
  }

  if (process.platform !== "win32") {
    // On POSIX systems `npm` is a real executable, so spawning it directly is safe.
    return { executable: "npm", argsPrefix: [] };
  }

  throw new VerificationError(
    "NPM_UNAVAILABLE",
    "Could not locate the npm CLI for the running Node installation.",
    "Run the CLI through `npm run verify -- ...`, or install Node with npm included.",
  );
}

export function buildCommandSpecs(
  tasks: VerificationTaskId[],
  npm: { executable: string; argsPrefix: string[] } = resolveNpmCli(),
): CommandSpec[] {
  return tasks.map((taskId) => {
    const definition = TASK_ALLOWLIST[taskId];
    return {
      taskId,
      label: definition.label,
      executable: npm.executable,
      args: [...npm.argsPrefix, "run", definition.script],
      timeoutMs: definition.timeoutMs,
      maxOutputBytes: definition.maxOutputBytes,
    };
  });
}