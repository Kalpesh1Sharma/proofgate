import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  TASK_ALLOWLIST,
  TASK_IDS,
  buildCommandSpecs,
  parseTaskIds,
} from "../src/lib/verification/allowlist";
import {
  allVerifiedPassed,
  buildVerificationReport,
  buildVerificationReportText,
  summarizeRuns,
} from "../src/lib/verification/report";
import {
  assertGitCheckout,
  assertValidRef,
  normaliseRepositoryPath,
  resolveRepository,
} from "../src/lib/verification/repository";
import { runCommand } from "../src/lib/verification/runner";
import type {
  CommandEvidence,
  CommandSpec,
  HeuristicAttachment,
  VerificationReport,
} from "../src/lib/verification/types";
import { VerificationError } from "../src/lib/verification/types";
import {
  cleanupTempDirs,
  makeGitRepo,
  makePlainDir,
  makeTempDir,
} from "./git-fixture";

afterAll(() => {
  cleanupTempDirs();
});

function nodeSpec(overrides: Partial<CommandSpec> & { code: string }): CommandSpec {
  return {
    taskId: "test",
    label: "Fixture command",
    executable: process.execPath,
    args: ["-e", overrides.code],
    timeoutMs: 10_000,
    maxOutputBytes: 10_000,
    ...overrides,
  };
}

function expectVerificationError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(VerificationError);
    expect((error as VerificationError).code).toBe(code);
    return;
  }
  throw new Error("Expected a VerificationError, but none was thrown.");
}

describe("repository path validation", () => {
  it("resolves an existing directory", () => {
    const dir = makeTempDir();
    const resolved = normaliseRepositoryPath(dir);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(fs.realpathSync(dir)).toBe(resolved);
  });

  it("rejects a missing path", () => {
    expectVerificationError(
      () => normaliseRepositoryPath(path.join(makeTempDir(), "does-not-exist")),
      "INVALID_REPO_PATH",
    );
  });

  it("rejects a file instead of a directory", () => {
    const file = path.join(makeTempDir(), "package.json");
    fs.writeFileSync(file, "{}", "utf8");
    expectVerificationError(() => normaliseRepositoryPath(file), "INVALID_REPO_PATH");
  });

  it("rejects an empty path", () => {
    expectVerificationError(() => normaliseRepositoryPath("  "), "INVALID_REPO_PATH");
  });

  it("rejects a directory that is not a Git checkout", () => {
    const dir = makePlainDir();
    expectVerificationError(() => assertGitCheckout(dir), "NOT_A_GIT_REPOSITORY");
  });

  it("accepts a real Git checkout and resolves HEAD to a commit", async () => {
    const repo = makeGitRepo();
    assertGitCheckout(repo);

    const resolved = await resolveRepository({ repoPath: repo, ref: "HEAD" });
    expect(resolved.root).toBe(fs.realpathSync(repo));
    expect(resolved.ref).toBe("HEAD");
    expect(resolved.commit).toMatch(/^[a-f0-9]{40}$/);
  });

  it("resolves a branch reference", async () => {
    const repo = makeGitRepo();
    const resolved = await resolveRepository({ repoPath: repo, ref: "main" });
    expect(resolved.commit).toMatch(/^[a-f0-9]{40}$/);
  });

  it("rejects a reference that does not exist", async () => {
    const repo = makeGitRepo();
    await expect(
      resolveRepository({ repoPath: repo, ref: "no-such-branch" }),
    ).rejects.toMatchObject({ code: "INVALID_REF" });
  });
});

describe("Git reference validation", () => {
  it.each(["HEAD", "main", "feature/foo-1.2", "v1.0.0", "abc1234"])(
    "accepts %s",
    (ref) => {
      expect(() => assertValidRef(ref)).not.toThrow();
    },
  );

  it.each([
    "--upload-pack=evil",
    "main; rm -rf /",
    "$(whoami)",
    "main`id`",
    "main..other",
    "refs/heads/main.lock",
    "",
  ])("rejects %s", (ref) => {
    expectVerificationError(() => assertValidRef(ref), "INVALID_REF");
  });
});

describe("command allowlisting", () => {
  it("maps each task to a fixed npm script", () => {
    const specs = buildCommandSpecs([...TASK_IDS], {
      executable: "node",
      argsPrefix: ["npm-cli.js"],
    });

    expect(specs).toHaveLength(TASK_IDS.length);
    for (const spec of specs) {
      expect(spec.executable).toBe("node");
      expect(spec.args).toEqual(["npm-cli.js", "run", TASK_ALLOWLIST[spec.taskId].script]);
      expect(spec.timeoutMs).toBeGreaterThan(0);
      expect(spec.maxOutputBytes).toBeGreaterThan(0);
    }
  });

  it("has no task that runs an arbitrary command", () => {
    for (const task of TASK_IDS) {
      expect(TASK_ALLOWLIST[task].script).not.toMatch(/[;&|$`><\n]/);
      expect(TASK_ALLOWLIST[task].script).toMatch(/^[a-z]+$/);
    }
  });

  it("parses repeated and comma separated task values", () => {
    expect(parseTaskIds(["test"])).toEqual(["test"]);
    expect(parseTaskIds(["test,lint"])).toEqual(["test", "lint"]);
    expect(parseTaskIds(["test", "test"])).toEqual(["test"]);
    expect(parseTaskIds([" lint ", "test"])).toEqual(["lint", "test"]);
  });

  it("rejects an unknown task instead of ignoring it", () => {
    expectVerificationError(() => parseTaskIds(["build"]), "UNKNOWN_TASK");
    expectVerificationError(() => parseTaskIds(["test; rm -rf /"]), "UNKNOWN_TASK");
  });

  it("rejects an empty task selection", () => {
    expectVerificationError(() => parseTaskIds([]), "UNKNOWN_TASK");
    expectVerificationError(() => parseTaskIds([","]), "UNKNOWN_TASK");
  });
});

describe("bounded command execution", () => {
  it("captures a passing exit code and output", async () => {
    const cwd = makeTempDir();
    const evidence = await runCommand({
      cwd,
      spec: nodeSpec({ code: "console.log('hello from proofgate')" }),
    });

    expect(evidence.status).toBe("passed");
    expect(evidence.exitCode).toBe(0);
    expect(evidence.stdout).toContain("hello from proofgate");
    expect(evidence.timedOut).toBe(false);
    expect(evidence.truncated).toBe(false);
    expect(new Date(evidence.startedAt).toString()).not.toBe("Invalid Date");
    expect(evidence.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures a non-zero exit code as a failure", async () => {
    const cwd = makeTempDir();
    const evidence = await runCommand({
      cwd,
      spec: nodeSpec({ code: "console.error('boom'); process.exit(3)" }),
    });

    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(3);
    expect(evidence.stderr).toContain("boom");
    expect(evidence.timedOut).toBe(false);
  });

  it("reports a timeout separately from a failure", async () => {
    const cwd = makeTempDir();
    const started = Date.now();
    const evidence = await runCommand({
      cwd,
      spec: nodeSpec({
        code: "setTimeout(() => {}, 30000)",
        timeoutMs: 400,
      }),
      killGraceMs: 200,
    });

    expect(evidence.status).toBe("timed-out");
    expect(evidence.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("caps captured output and records truncation", async () => {
    const cwd = makeTempDir();
    const evidence = await runCommand({
      cwd,
      spec: nodeSpec({
        code: "process.stdout.write('x'.repeat(50000))",
        maxOutputBytes: 500,
      }),
    });

    expect(evidence.status).toBe("passed");
    expect(evidence.truncated).toBe(true);
    expect(evidence.stdout.length).toBeLessThanOrEqual(500);
  });

  it("reports a spawn error instead of throwing", async () => {
    const cwd = makeTempDir();
    const evidence = await runCommand({
      cwd,
      spec: {
        taskId: "test",
        label: "Missing binary",
        executable: "proofgate-definitely-not-a-real-binary",
        args: ["--version"],
        timeoutMs: 5_000,
        maxOutputBytes: 1_000,
      },
    });

    expect(evidence.status).toBe("spawn-error");
    expect(evidence.spawnError).toBeTruthy();
    expect(evidence.exitCode).toBeNull();
  });

  it("runs the allowlisted task end to end through npm", async () => {
    const repo = makeGitRepo();
    const [spec] = buildCommandSpecs(["test"]);

    const evidence = await runCommand({ cwd: repo, spec });

    expect(evidence.taskId).toBe("test");
    expect(evidence.command.args).toContain("run");
    expect(evidence.command.args).toContain("test");
    expect(evidence.status).toBe("passed");
    expect(evidence.exitCode).toBe(0);
  }, 30_000);

  it("records a failing repository check end to end", async () => {
    const repo = makeGitRepo();
    fs.writeFileSync(
      path.join(repo, "package.json"),
      `${JSON.stringify(
        {
          name: "verify-fixture",
          private: true,
          version: "1.0.0",
          scripts: { test: 'node -e "process.exit(1)"' },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const [spec] = buildCommandSpecs(["test"]);
    const evidence = await runCommand({ cwd: repo, spec });

    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(1);
  }, 30_000);
});

describe("verification report", () => {
  const repository = {
    root: "/tmp/trusted-repo",
    ref: "HEAD",
    commit: "a".repeat(40),
  };
  const approval = {
    grantedAt: "2026-01-01T00:00:00.000Z",
    method: "cli-flag-and-prompt" as const,
    approvedCommands: ["node npm-cli.js run test"],
  };

  function run(overrides: Partial<CommandEvidence>): CommandEvidence {
    return {
      taskId: "test",
      label: "Unit tests",
      command: { executable: "node", args: ["npm-cli.js", "run", "test"] },
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      durationMs: 2000,
      exitCode: 0,
      signal: null,
      status: "passed",
      timedOut: false,
      truncated: false,
      stdout: "ok",
      stderr: "",
      spawnError: null,
      ...overrides,
    };
  }

  const heuristic: HeuristicAttachment = {
    status: "included",
    classification: "HEURISTIC",
    source: "phase-1-deterministic-rules",
    diffPath: "/tmp/change.diff",
    diffSha256: "b".repeat(64),
    findings: [{ ruleId: "PG-002", severity: "high" }],
    note: "not verified",
  };

  it("separates verified outcomes from heuristic findings", () => {
    const report = buildVerificationReport({
      repository,
      approval,
      runs: [run({}), run({ taskId: "lint", label: "Lint", status: "failed", exitCode: 1 })],
      heuristic,
      generatedAt: "2026-01-01T00:01:00.000Z",
      platform: "linux",
      nodeVersion: "v24.0.0",
    });

    expect(report.schemaVersion).toBe("2.0");
    expect(report.tool.mode).toBe("trusted-local-cli");
    expect(report.repository).toEqual(repository);
    expect(report.verified.summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      timedOut: 0,
      spawnErrors: 0,
    });
    expect(report.heuristic.status).toBe("included");
    expect(report.verified).not.toHaveProperty("findings");
    expect(report.limitations.join(" ")).toContain("not a sandbox");
    expect(report.limitations.join(" ")).toContain("not a proof");
    expect(allVerifiedPassed(report)).toBe(false);
  });

  it("does not claim a pass when a command timed out", () => {
    const report = buildVerificationReport({
      repository,
      approval,
      runs: [run({ status: "timed-out", timedOut: true, exitCode: null })],
      heuristic: { status: "not-requested", note: "no diff" },
      generatedAt: "2026-01-01T00:01:00.000Z",
    });

    expect(report.verified.summary.timedOut).toBe(1);
    expect(report.verified.summary.passed).toBe(0);
    expect(allVerifiedPassed(report)).toBe(false);
  });

  it("does not claim a pass when checks were skipped", () => {
    const report = buildVerificationReport({
      repository,
      approval,
      runs: [run({})],
      heuristic: { status: "not-requested", note: "no diff" },
      skippedChecks: [{ taskId: "lint", reason: "not requested" }],
      generatedAt: "2026-01-01T00:01:00.000Z",
    });

    expect(report.skippedChecks).toHaveLength(1);
    expect(allVerifiedPassed(report)).toBe(false);
  });

  it("serialises to stable, parseable JSON", () => {
    const report = buildVerificationReport({
      repository,
      approval,
      runs: [run({})],
      heuristic,
      generatedAt: "2026-01-01T00:01:00.000Z",
    });

    const text = buildVerificationReportText(report);
    const parsed = JSON.parse(text) as VerificationReport;

    expect(parsed.verified.runs[0].command.args).toEqual([
      "npm-cli.js",
      "run",
      "test",
    ]);
    expect(parsed.heuristic.status).toBe("included");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toMatch(/confidence/i);
  });

  it("summarises runs without inventing statuses", () => {
    expect(
      summarizeRuns([
        run({}),
        run({ status: "failed" }),
        run({ status: "timed-out", timedOut: true }),
        run({ status: "spawn-error", spawnError: "ENOENT" }),
      ]),
    ).toEqual({ total: 4, passed: 1, failed: 1, timedOut: 1, spawnErrors: 1 });
  });
});