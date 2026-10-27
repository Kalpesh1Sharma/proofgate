import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildCiJsonReportText,
  buildCiSummaryMarkdown,
  countAtOrAbove,
} from "../src/lib/ci/summary";
import { parseCiArgs, runCiAnalysis } from "../src/cli/ci";
import { analyzeDiff } from "../src/lib/engine/analyze";
import { MAX_DIFF_BYTES } from "../src/lib/engine/parse-diff";
import { LOAN_ELIGIBILITY_EXAMPLE_DIFF } from "../src/lib/examples/loan-eligibility";
import { makeDiff } from "./fixtures";
import { cleanupTempDirs, makeTempDir } from "./git-fixture";

afterAll(() => {
  cleanupTempDirs();
});

const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function writeDiff(content: string): string {
  const file = path.join(makeTempDir("proofgate-ci-"), "change.diff");
  fs.writeFileSync(file, content, "utf8");
  return file;
}

function analyzeExample() {
  return analyzeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF, { generatedAt: FIXED_TIME });
}

describe("CI argument parsing", () => {
  it("accepts the minimal invocation with defaults", () => {
    const parsed = parseCiArgs(["--diff", "change.diff"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.args.diffPath).toBe("change.diff");
    expect(parsed.args.outDir).toBe("proofgate-report");
    expect(parsed.args.failOn).toBe("none");
    expect(parsed.args.baseRef).toBeNull();
    expect(parsed.args.headRef).toBeNull();
    expect(parsed.args.help).toBe(false);
  });

  it("accepts every documented option", () => {
    const parsed = parseCiArgs([
      "--diff",
      "change.diff",
      "--out-dir",
      "out",
      "--base",
      "base-sha",
      "--head",
      "head-sha",
      "--summary",
      "summary.md",
      "--fail-on",
      "high",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.args).toMatchObject({
      diffPath: "change.diff",
      outDir: "out",
      baseRef: "base-sha",
      headRef: "head-sha",
      summaryPath: "summary.md",
      failOn: "high",
    });
  });

  it("requires --diff", () => {
    const parsed = parseCiArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("--diff is required");
  });

  it("rejects a missing option value", () => {
    const parsed = parseCiArgs(["--diff"]);
    expect(parsed.ok).toBe(false);
  });

  it("rejects unknown arguments", () => {
    const parsed = parseCiArgs(["--diff", "x.diff", "--command", "rm -rf /"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("Unknown argument");
  });

  it("rejects an unknown threshold instead of guessing", () => {
    const parsed = parseCiArgs(["--diff", "x.diff", "--fail-on", "critical"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("--fail-on must be one of");
  });

  it("supports help", () => {
    const parsed = parseCiArgs(["--help"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.args.help).toBe(true);
  });
});

describe("CI analysis", () => {
  it("writes Markdown and JSON reports with CI provenance", () => {
    const diffPath = writeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const outDir = path.join(makeTempDir("proofgate-ci-out-"), "nested", "reports");

    const run = runCiAnalysis({
      diffPath,
      outDir,
      baseRef: "base-sha",
      headRef: "head-sha",
      generatedAt: FIXED_TIME,
      env: {},
    });

    expect(run.exitCode).toBe(0);
    expect(run.files).toBeDefined();
    const files = run.files!;
    expect(fs.existsSync(files.markdown)).toBe(true);
    expect(fs.existsSync(files.json)).toBe(true);
    expect(fs.existsSync(files.summary)).toBe(true);

    const markdown = fs.readFileSync(files.markdown, "utf8");
    expect(markdown).toContain("# ProofGate review");
    expect(markdown).toContain("## CI context");
    expect(markdown).toContain("`base-sha` → `head-sha`");
    expect(markdown).toContain("Application tests were not run");
    expect(markdown).toContain("HEURISTIC");
    expect(markdown).toContain("PG-002");
    expect(markdown).toContain("src/services/loan-eligibility.ts");

    const json = JSON.parse(fs.readFileSync(files.json, "utf8")) as {
      ci: Record<string, unknown>;
      findings: unknown[];
      summary: { total: number; countsBySeverity: Record<string, number> };
    };
    expect(json.ci).toEqual({
      workflow: "github-actions",
      baseRef: "base-sha",
      headRef: "head-sha",
      analysisStatus: "completed",
      testsRun: false,
    });
    expect(json.findings.length).toBe(json.summary.total);
    expect(json.summary.countsBySeverity.high).toBeGreaterThan(0);

    const summary = fs.readFileSync(files.summary, "utf8");
    expect(summary).toContain("## ProofGate diff review");
    expect(summary).toContain("HEURISTIC — NOT VERIFIED");
    expect(summary).toContain("| High | Medium | Low | Total |");
    expect(summary).toContain("Evidence locations");
    expect(summary).toContain("src/services/loan-eligibility.ts");
    expect(summary).toContain("No code from the pull request was executed");
    expect(summary).toContain("not evidence that the change is safe");
    expect(summary).toMatch(/not run by ProofGate/);
  });

  it("analyses a sanitized real Git diff with a no-newline marker between files", () => {
    const fixture = fs.readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "git-no-newline-multi-file.diff"),
      "utf8",
    );

    const run = runCiAnalysis({
      diffPath: writeDiff(fixture),
      outDir: makeTempDir("proofgate-ci-git-"),
      baseRef: "base-sha",
      headRef: "head-sha",
      generatedAt: FIXED_TIME,
      env: {},
    });

    expect(run.exitCode).toBe(0);
    const json = JSON.parse(fs.readFileSync(run.files!.json, "utf8")) as {
      changes: unknown[];
      summary: { additions: number; deletions: number; changedFiles: number };
      findings: Array<{ ruleId: string }>;
    };

    expect(json.changes).toHaveLength(2);
    expect(json.summary.changedFiles).toBe(2);
    expect(json.summary.additions).toBe(2);
    expect(json.summary.deletions).toBe(3);
    expect(json.findings.some((finding) => finding.ruleId === "PG-001")).toBe(true);

    const markdown = fs.readFileSync(run.files!.markdown, "utf8");
    expect(markdown).toContain("src/one.ts");
    expect(markdown).toContain("src/validate.ts");
    expect(markdown).toContain("PG-001");

    const summary = fs.readFileSync(run.files!.summary, "utf8");
    expect(summary).toContain("HEURISTIC — NOT VERIFIED");
    expect(summary).toContain("src/validate.ts");
  });

  it("is deterministic for a fixed timestamp", () => {
    const diffPath = writeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const first = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-a-"),
      generatedAt: FIXED_TIME,
      env: {},
    });
    const second = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-b-"),
      generatedAt: FIXED_TIME,
      env: {},
    });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(fs.readFileSync(first.files!.json, "utf8")).toBe(
      fs.readFileSync(second.files!.json, "utf8"),
    );
    expect(fs.readFileSync(first.files!.markdown, "utf8")).toBe(
      fs.readFileSync(second.files!.markdown, "utf8"),
    );
  });

  it("rejects a missing diff file without writing reports", () => {
    const outDir = path.join(makeTempDir("proofgate-ci-missing-"), "reports");
    const run = runCiAnalysis({
      diffPath: path.join(makeTempDir("proofgate-ci-missing-"), "nope.diff"),
      outDir,
      env: {},
    });

    expect(run.exitCode).toBe(2);
    expect(run.message).toContain("not found");
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("rejects an empty diff", () => {
    const run = runCiAnalysis({
      diffPath: writeDiff("   \n"),
      outDir: makeTempDir("proofgate-ci-empty-"),
      env: {},
    });
    expect(run.exitCode).toBe(2);
    expect(run.message).toContain("EMPTY_INPUT");
  });

  it("rejects a malformed diff", () => {
    const run = runCiAnalysis({
      diffPath: writeDiff("not a unified diff\n"),
      outDir: makeTempDir("proofgate-ci-malformed-"),
      env: {},
    });
    expect(run.exitCode).toBe(2);
    expect(run.message).toContain("PREAMBLE_UNSUPPORTED");
  });

  it("rejects a diff over the 200 KB limit before analysis", () => {
    const run = runCiAnalysis({
      diffPath: writeDiff("x".repeat(MAX_DIFF_BYTES + 1)),
      outDir: makeTempDir("proofgate-ci-large-"),
      env: {},
    });
    expect(run.exitCode).toBe(2);
    expect(run.message).toContain("limit");
  });

  it("appends the job summary to an explicit file and preserves existing content", () => {
    const diffPath = writeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const summaryPath = path.join(makeTempDir("proofgate-ci-summary-"), "step-summary.md");
    fs.writeFileSync(summaryPath, "# Earlier step\n\n", "utf8");

    const run = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-summary-out-"),
      summaryPath,
      generatedAt: FIXED_TIME,
      env: {},
    });

    expect(run.exitCode).toBe(0);
    const summary = fs.readFileSync(summaryPath, "utf8");
    expect(summary.startsWith("# Earlier step")).toBe(true);
    expect(summary).toContain("## ProofGate diff review");
  });

  it("uses GITHUB_STEP_SUMMARY when no explicit path is provided", () => {
    const diffPath = writeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const summaryPath = path.join(makeTempDir("proofgate-ci-env-summary-"), "gh-summary.md");

    const run = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-env-out-"),
      generatedAt: FIXED_TIME,
      env: { GITHUB_STEP_SUMMARY: summaryPath },
    });

    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(summaryPath, "utf8")).toContain("## ProofGate diff review");
  });

  it("optionally gates on a heuristic severity without calling it a test failure", () => {
    const diffPath = writeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const run = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-gate-"),
      failOn: "high",
      generatedAt: FIXED_TIME,
      env: {},
    });

    expect(run.exitCode).toBe(1);
    expect(run.message).toContain("heuristic gate");
    expect(run.message).toContain("not a test failure");
  });

  it("passes when the heuristic gate is not configured", () => {
    const diffPath = writeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const run = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-nogate-"),
      generatedAt: FIXED_TIME,
      env: {},
    });
    expect(run.exitCode).toBe(0);
  });

  it("reports a clean rule result without claiming safety", () => {
    const diff = makeDiff("src/legacy.ts", ["-export const legacy = true;"], {
      headerNewPath: "/dev/null",
    });
    const diffPath = writeDiff(diff);
    const run = runCiAnalysis({
      diffPath,
      outDir: makeTempDir("proofgate-ci-clean-"),
      generatedAt: FIXED_TIME,
      env: {},
    });

    expect(run.exitCode).toBe(0);
    const summary = fs.readFileSync(run.files!.summary, "utf8");
    expect(summary).toContain("No ruled pattern matched this diff");
    expect(summary).toContain("not** evidence");
    expect(summary).not.toMatch(/tests passed/i);
  });
});

describe("CI summary", () => {
  it("counts findings at or above a threshold", () => {
    const result = analyzeExample();
    expect(countAtOrAbove(result, "high")).toBe(result.summary.countsBySeverity.high);
    expect(countAtOrAbove(result, "medium")).toBe(
      result.summary.countsBySeverity.high + result.summary.countsBySeverity.medium,
    );
    expect(countAtOrAbove(result, "low")).toBe(result.summary.total);
  });

  it("labels the summary HEURISTIC and never approves the pull request", () => {
    const result = analyzeExample();
    const summary = buildCiSummaryMarkdown(result, {
      baseRef: "base-sha",
      headRef: "head-sha",
    });

    expect(summary).toContain("HEURISTIC — NOT VERIFIED");
    expect(summary).toContain("does not approve or clear the pull request");
    expect(summary).toContain("Application tests:** not run by ProofGate");
    expect(summary).not.toMatch(/tests passed/i);
    expect(summary).not.toMatch(/\bapproved\b/i);
    expect(summary).not.toMatch(/safe to merge/i);
    expect(summary).not.toContain("confidence");
  });

  it("includes evidence locations and bounded excerpts", () => {
    const result = analyzeExample();
    const summary = buildCiSummaryMarkdown(result, { baseRef: null, headRef: null });

    for (const finding of result.findings.slice(0, 5)) {
      expect(summary).toContain(finding.ruleId);
      expect(summary).toContain(`\`${finding.file}`);
    }
    expect(summary).toContain("evidence:");
    expect(summary).toContain("Local diff file");
  });

  it("adds provenance to the JSON report without changing analysis fields", () => {
    const result = analyzeExample();
    const parsed = JSON.parse(
      buildCiJsonReportText(result, { baseRef: "b", headRef: "h" }),
    ) as Record<string, unknown> & { ci: Record<string, unknown>; findings: unknown[] };

    expect(parsed.ci).toMatchObject({
      workflow: "github-actions",
      baseRef: "b",
      headRef: "h",
      testsRun: false,
    });
    expect(parsed.findings).toHaveLength(result.summary.total);
    expect(parsed.schemaVersion).toBe("1.0");
  });
});

describe("CI workflow safety", () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), ".github", "workflows", "proofgate.yml"),
    "utf8",
  );

  it("runs on pull_request and never on pull_request_target", () => {
    expect(workflow).toMatch(/^\s*pull_request\s*:/m);
    expect(workflow).not.toMatch(/^\s*pull_request_target\s*:/m);
  });

  it("requests only contents: read and exposes no secrets", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(/:\s*write/);
    expect(workflow).not.toMatch(/secrets\./);
  });

  it("executes the trusted base revision, not the PR head", () => {
    expect(workflow).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).not.toContain("ref: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("refs/remotes/proofgate/pr-head");
  });

  it("pins Node, installs dependencies and runs only the report generator", () => {
    expect(workflow).toContain("node-version: 22.14.0");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run ci:analyze");
    expect(workflow).not.toMatch(/npm (run )?test\b/);
    expect(workflow).toContain("actions/upload-artifact@v4");
  });

  it("uses diff flags that avoid external diff drivers", () => {
    expect(workflow).toContain("--no-ext-diff");
    expect(workflow).toContain("--no-textconv");
    expect(workflow).toContain("--no-color");
  });
});

describe("CI modules remain offline", () => {
  it("has no network or process execution in the CI report path", () => {
    const files = [
      path.join(process.cwd(), "src", "cli", "ci.ts"),
      path.join(process.cwd(), "src", "lib", "ci", "summary.ts"),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("api.groq");
      expect(source).not.toContain("child_process");
      expect(source).not.toContain("console.log");
    }
  });
});