#!/usr/bin/env node
/**
 * Phase 2 demo: a failing test before the fix, a passing test after it.
 *
 * The script copies a small fixture repository into a temporary directory,
 * commits it, then runs the real verification CLI twice:
 *
 *   1. before the fix  → the allowlisted `npm run test` fails (exit 1)
 *   2. after the fix   → the same command passes (exit 0)
 *
 * It proves the CLI records real command outcomes. Nothing here is faked, and
 * the diff is never executed; only the allowlisted npm script runs.
 *
 *   npm run verify:demo
 *   npm run verify:demo -- --keep
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(projectRoot, "examples", "phase2-fix");
const cliPath = path.join(projectRoot, "src", "cli", "verify.ts");
const tsxPath = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const keep = process.argv.includes("--keep");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function git(cwd, args) {
  const result = spawnSync(
    "git",
    ["-C", cwd, "-c", "user.email=demo@proofgate.local", "-c", "user.name=ProofGate Demo", ...args],
    { encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function runCli(repo, reportPath) {
  const result = spawnSync(
    process.execPath,
    [tsxPath, cliPath, "--repo", repo, "--task", "test", "--approve", "--json", "--out", reportPath],
    { encoding: "utf8", shell: false, cwd: projectRoot },
  );
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  return { exitCode: result.status, report };
}

function describe(label, outcome) {
  const run = outcome.report.verified.runs[0];
  const lines = [
    "",
    `── ${label}`,
    `   command   ${run.command.executable} ${run.command.args.join(" ")}`,
    `   status    ${run.status.toUpperCase()} (exit ${run.exitCode})`,
    `   duration  ${run.durationMs} ms`,
    `   commit    ${outcome.report.repository.commit.slice(0, 12)}`,
    `   report    ${outcome.reportPath}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);

  if (run.status !== "passed") {
    const output = `${run.stdout}\n${run.stderr}`.trim();
    const tail = output.split("\n").filter(Boolean).slice(-10);
    if (tail.length > 0) {
      process.stdout.write("   output    ");
      process.stdout.write(`${tail.join("\n             ")}\n`);
    }
  }
}

function main() {
  if (!fs.existsSync(tsxPath)) {
    throw new Error("tsx is not installed. Run `npm install` first.");
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "proofgate-phase2-demo-"));
  const repo = path.join(workspace, "shop");
  copyDir(path.join(fixtures, "before"), repo);

  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "feat: discount service (failing test)"]);

  process.stdout.write(
    [
      "",
      "ProofGate Phase 2 demo · trusted local commands",
      `workspace ${workspace}`,
      "",
      "This runs ONLY the allowlisted `npm run test` in the fixture repository.",
      "Both runs are real process executions, not simulated output.",
    ].join("\n") + "\n",
  );

  const beforeReportPath = path.join(workspace, "report-before-fix.json");
  const before = runCli(repo, beforeReportPath);
  before.reportPath = beforeReportPath;
  describe("Before the fix", before);

  fs.copyFileSync(
    path.join(fixtures, "after", "src", "discount.js"),
    path.join(repo, "src", "discount.js"),
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "fix: clamp discount rate to MAX_DISCOUNT"]);

  const afterReportPath = path.join(workspace, "report-after-fix.json");
  const after = runCli(repo, afterReportPath);
  after.reportPath = afterReportPath;
  describe("After the fix", after);

  const ok =
    before.exitCode === 1 &&
    before.report.verified.summary.failed === 1 &&
    after.exitCode === 0 &&
    after.report.verified.summary.passed === 1;

  process.stdout.write(
    [
      "",
      ok
        ? "Demo result: the CLI recorded a real failure before the fix and a real pass after it."
        : "Demo result: UNEXPECTED. Inspect the reports above; no result was fabricated.",
      keep
        ? `Workspace kept at ${workspace}`
        : "Workspace removed. Re-run with --keep to inspect the reports.",
      "",
    ].join("\n") + "\n",
  );

  if (!keep) fs.rmSync(workspace, { recursive: true, force: true });
  process.exitCode = ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`\nDemo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}