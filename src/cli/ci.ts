#!/usr/bin/env node
/**
 * ProofGate CI analysis entrypoint.
 *
 *   npm run ci:analyze -- --diff pr.diff --out-dir proofgate-report \
 *     --base <base-sha> --head <head-sha>
 *
 * Reads one local unified diff, runs the deterministic Phase 1 engine and
 * writes Markdown and JSON reports plus a GitHub Actions step summary.
 *
 * This entrypoint performs no network requests, no code execution and no
 * provider calls. It is safe to run in a trusted CI checkout while treating
 * the diff itself as untrusted data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCiJsonReportText,
  buildCiMarkdownReport,
  buildCiSummaryMarkdown,
  countAtOrAbove,
} from "../lib/ci/summary";
import type { CiMetadata } from "../lib/ci/summary";
import { analyzeDiff } from "../lib/engine/analyze";
import { DiffParseError, MAX_DIFF_BYTES } from "../lib/engine/parse-diff";
import type { AnalysisResult, Severity } from "../lib/engine/types";

const FAIL_ON_VALUES = ["none", "high", "medium", "low"] as const;
type FailOn = (typeof FAIL_ON_VALUES)[number];

export interface CiArgs {
  diffPath: string;
  outDir: string;
  baseRef: string | null;
  headRef: string | null;
  summaryPath: string | null;
  failOn: FailOn;
  help: boolean;
}

export type ParseCiArgsResult =
  | { ok: true; args: CiArgs }
  | { ok: false; message: string };

const HELP = `ProofGate CI diff review

Usage:
  npm run ci:analyze -- --diff <file> [options]

Required:
  --diff <file>       Local unified diff file to analyse (max 200 KB).

Options:
  --out-dir <dir>     Directory for the reports. Default: proofgate-report
  --base <ref>        Base commit or ref, recorded in the reports.
  --head <ref>        Head commit or ref, recorded in the reports.
  --summary <file>    Append the job summary to this file. Defaults to
                      GITHUB_STEP_SUMMARY when set.
  --fail-on <level>   Optional heuristic threshold: none | high | medium | low.
                      Default: none. A threshold failure is not a test failure.
  -h, --help          Show this help.

The command reads a diff only. It never executes code from the diff, never
runs tests and makes no network calls. Findings are HEURISTIC, not verified
defects, and a successful run does not approve the pull request.
`;

function isFailOn(value: string): value is FailOn {
  return (FAIL_ON_VALUES as readonly string[]).includes(value);
}

export function parseCiArgs(argv: string[]): ParseCiArgsResult {
  let diffPath: string | null = null;
  let outDir = "proofgate-report";
  let baseRef: string | null = null;
  let headRef: string | null = null;
  let summaryPath: string | null = null;
  let failOn: FailOn = "none";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (): string | null => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) return null;
      index += 1;
      return next;
    };

    switch (arg) {
      case "--diff": {
        const value = takeValue();
        if (!value) return { ok: false, message: "Missing value for --diff." };
        diffPath = value;
        break;
      }
      case "--out-dir": {
        const value = takeValue();
        if (!value) return { ok: false, message: "Missing value for --out-dir." };
        outDir = value;
        break;
      }
      case "--base": {
        const value = takeValue();
        if (!value) return { ok: false, message: "Missing value for --base." };
        baseRef = value;
        break;
      }
      case "--head": {
        const value = takeValue();
        if (!value) return { ok: false, message: "Missing value for --head." };
        headRef = value;
        break;
      }
      case "--summary": {
        const value = takeValue();
        if (!value) return { ok: false, message: "Missing value for --summary." };
        summaryPath = value;
        break;
      }
      case "--fail-on": {
        const value = takeValue();
        if (!value) return { ok: false, message: "Missing value for --fail-on." };
        if (!isFailOn(value)) {
          return {
            ok: false,
            message: `--fail-on must be one of: ${FAIL_ON_VALUES.join(", ")}.`,
          };
        }
        failOn = value;
        break;
      }
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        return { ok: false, message: `Unknown argument "${arg}".` };
    }
  }

  if (help) {
    return {
      ok: true,
      args: {
        diffPath: diffPath ?? "",
        outDir,
        baseRef,
        headRef,
        summaryPath,
        failOn,
        help: true,
      },
    };
  }

  if (!diffPath) return { ok: false, message: "--diff is required." };

  return {
    ok: true,
    args: { diffPath, outDir, baseRef, headRef, summaryPath, failOn, help: false },
  };
}

export interface CiRunOptions {
  diffPath: string;
  outDir: string;
  baseRef?: string | null;
  headRef?: string | null;
  summaryPath?: string | null;
  failOn?: FailOn;
  /** Injectable clock for deterministic tests. */
  generatedAt?: string;
  /** Injectable environment; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

export interface CiRunResult {
  exitCode: 0 | 1 | 2;
  message: string;
  files?: { markdown: string; json: string; summary: string };
  result?: AnalysisResult;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function listFindings(result: AnalysisResult, limit = 20): string[] {
  return result.findings.slice(0, limit).map((finding) => {
    const location =
      finding.line === null
        ? finding.file
        : `${finding.file}:${finding.line} (${finding.side})`;
    return `  ${finding.severity.toUpperCase().padEnd(6)} ${finding.ruleId}  ${location}`;
  });
}

/**
 * Runs the CI analysis and writes the reports. Pure file I/O; no network and
 * no execution of the diff content.
 */
export function runCiAnalysis(options: CiRunOptions): CiRunResult {
  const diffPath = path.resolve(options.diffPath);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(diffPath);
  } catch {
    return { exitCode: 2, message: `Diff file not found: ${diffPath}` };
  }

  if (!stats.isFile()) {
    return { exitCode: 2, message: `Diff path is not a file: ${diffPath}` };
  }

  if (stats.size > MAX_DIFF_BYTES) {
    return {
      exitCode: 2,
      message: `Diff file is ${formatBytes(stats.size)}; the limit is ${formatBytes(MAX_DIFF_BYTES)}.`,
    };
  }

  let diff: string;
  try {
    diff = fs.readFileSync(diffPath, "utf8");
  } catch {
    return { exitCode: 2, message: `Diff file could not be read: ${diffPath}` };
  }

  let result: AnalysisResult;
  try {
    result = analyzeDiff(diff, { generatedAt: options.generatedAt });
  } catch (error) {
    if (error instanceof DiffParseError) {
      return {
        exitCode: 2,
        message: `${error.code}: ${error.message}\n${error.hint}`,
      };
    }
    return { exitCode: 2, message: "The diff could not be analysed." };
  }

  const meta: CiMetadata = {
    baseRef: options.baseRef ?? null,
    headRef: options.headRef ?? null,
  };

  const markdown = buildCiMarkdownReport(result, meta);
  const json = buildCiJsonReportText(result, meta);
  const summary = buildCiSummaryMarkdown(result, meta);

  const outDir = path.resolve(options.outDir);
  const files = {
    markdown: path.join(outDir, "proofgate-report.md"),
    json: path.join(outDir, "proofgate-report.json"),
    summary: path.join(outDir, "proofgate-summary.md"),
  };

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(files.markdown, markdown, "utf8");
    fs.writeFileSync(files.json, json, "utf8");
    fs.writeFileSync(files.summary, summary, "utf8");
  } catch {
    return { exitCode: 2, message: `Reports could not be written to ${outDir}.` };
  }

  const env = options.env ?? process.env;
  const envSummary =
    typeof env.GITHUB_STEP_SUMMARY === "string" &&
    env.GITHUB_STEP_SUMMARY.trim().length > 0
      ? env.GITHUB_STEP_SUMMARY
      : null;
  const summaryTarget = options.summaryPath ?? envSummary;

  if (summaryTarget) {
    const resolvedTarget = path.resolve(summaryTarget);
    if (resolvedTarget !== files.summary) {
      try {
        fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
        fs.appendFileSync(resolvedTarget, `\n${summary}`, "utf8");
      } catch {
        return {
          exitCode: 2,
          message: `Reports were written, but the job summary could not be appended to ${resolvedTarget}.`,
        };
      }
    }
  }

  const threshold = options.failOn ?? "none";
  const triggered =
    threshold === "none" ? 0 : countAtOrAbove(result, threshold as Severity);

  const lines: string[] = [];
  lines.push("");
  lines.push("ProofGate diff review");
  lines.push(`diff        ${diffPath}`);
  lines.push(
    `comparison  ${meta.baseRef ?? "n/a"} -> ${meta.headRef ?? "n/a"}`,
  );
  lines.push(
    `parsed      ${result.summary.changedFiles} files · +${result.summary.additions} · -${result.summary.deletions}`,
  );
  lines.push(
    `heuristic   ${result.summary.countsBySeverity.high} high · ${result.summary.countsBySeverity.medium} medium · ${result.summary.countsBySeverity.low} low · ${result.summary.total} total`,
  );
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("No ruled pattern matched this diff. This is not evidence of safety.");
  } else {
    lines.push(...listFindings(result));
    if (result.findings.length > 20) {
      lines.push(`  … and ${result.findings.length - 20} more in the full report`);
    }
  }
  lines.push("");
  lines.push(`reports     ${files.markdown}`);
  lines.push(`            ${files.json}`);
  lines.push(`summary     ${files.summary}`);
  lines.push("");
  lines.push("Analysis completed. No code was executed and no tests were run.");
  lines.push("Findings are HEURISTIC and NOT VERIFIED. This run does not approve the pull request.");

  if (triggered > 0) {
    lines.push("");
    lines.push(
      `Threshold met: ${triggered} finding(s) at or above "${threshold}". This is a heuristic gate, not a test failure.`,
    );
    return { exitCode: 1, message: lines.join("\n"), files, result };
  }

  return { exitCode: 0, message: lines.join("\n"), files, result };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const parsed = parseCiArgs(process.argv.slice(2));

  if (!parsed.ok) {
    process.stderr.write(`\n${parsed.message}\n\n${HELP}`);
    process.exitCode = 2;
  } else if (parsed.args.help) {
    process.stdout.write(HELP);
    process.exitCode = 0;
  } else {
    const run = runCiAnalysis({
      diffPath: parsed.args.diffPath,
      outDir: parsed.args.outDir,
      baseRef: parsed.args.baseRef,
      headRef: parsed.args.headRef,
      summaryPath: parsed.args.summaryPath,
      failOn: parsed.args.failOn,
    });
    const stream = run.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(`${run.message}\n`);
    process.exitCode = run.exitCode;
  }
}