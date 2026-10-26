/**
 * Server-side deterministic analysis entry point.
 *
 * This module imports `node:crypto`, so it must stay on the server. The UI
 * talks to it exclusively through the `/api/analyze` route handler.
 */

import { createHash } from "node:crypto";

import { ENGINE_ID, LIMITATIONS, TOOL_NAME, TOOL_VERSION } from "./limits";
import { parseUnifiedDiff } from "./parse-diff";
import { RULE_DEFINITIONS, toFindings, runRules } from "./rules";
import type { AnalysisResult, Finding, Severity } from "./types";
import { HEURISTIC_LABEL } from "./types";

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export interface AnalyzeOptions {
  /** Injectable clock, used by tests to keep output deterministic. */
  generatedAt?: Date | string;
}

/**
 * Parses the diff and applies the deterministic rule set.
 *
 * @throws {DiffParseError} when the diff is empty, oversized, binary or malformed.
 */
export function analyzeDiff(diff: string, options: AnalyzeOptions = {}): AnalysisResult {
  const parsed = parseUnifiedDiff(diff);
  const findings = toFindings(runRules(parsed.files)).sort(compareFindings);

  const countsBySeverity: Record<Severity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const finding of findings) {
    countsBySeverity[finding.severity] += 1;
  }

  const byRule = RULE_DEFINITIONS.map((rule) => ({
    ruleId: rule.id,
    title: rule.title,
    count: findings.filter((finding) => finding.ruleId === rule.id).length,
  })).filter((entry) => entry.count > 0);

  const filesWithFindings = new Set(findings.map((finding) => finding.file)).size;
  const testFilesChanged = parsed.files.filter((file) => file.isTest).length;
  const generatedAt =
    typeof options.generatedAt === "string"
      ? options.generatedAt
      : (options.generatedAt ?? new Date()).toISOString();

  const headline =
    findings.length === 0
      ? "No heuristic findings matched this diff"
      : `${findings.length} heuristic finding${findings.length === 1 ? "" : "s"} across ${filesWithFindings} changed file${filesWithFindings === 1 ? "" : "s"}`;

  const statement =
    findings.length === 0
      ? "No ruled pattern matched this diff. That is not a clean bill of health: these rules cover a narrow set of removed validation, authorization and money checks, and they only see the diff."
      : "These are pattern matches against removed or loosened checks in the diff. They are not confirmed defects, no code was executed and no test results were produced.";

  return {
    tool: {
      name: TOOL_NAME,
      version: TOOL_VERSION,
      engine: ENGINE_ID,
    },
    generatedAt,
    input: {
      bytes: new TextEncoder().encode(diff).length,
      sha256: createHash("sha256").update(diff, "utf8").digest("hex"),
    },
    parsed,
    findings,
    summary: {
      classification: HEURISTIC_LABEL,
      headline,
      statement,
      total: findings.length,
      countsBySeverity,
      byRule,
      changedFiles: parsed.stats.files,
      filesWithFindings,
      additions: parsed.stats.additions,
      deletions: parsed.stats.deletions,
      testFilesChanged,
    },
    limitations: [...LIMITATIONS],
  };
}

function compareFindings(left: Finding, right: Finding): number {
  const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
  if (bySeverity !== 0) return bySeverity;
  if (left.file !== right.file) return left.file.localeCompare(right.file);
  const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;
  if (leftLine !== rightLine) return leftLine - rightLine;
  return left.ruleId.localeCompare(right.ruleId);
}