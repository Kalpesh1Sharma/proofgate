/**
 * CI report builders for the GitHub Actions diff review.
 *
 * These functions are pure and reuse the Phase 1 engine output verbatim. They
 * add CI provenance (base/head comparison) and a short job summary, but they
 * never add test results, confidence scores or approval language.
 */

import { DISCLAIMER } from "../engine/limits";
import type { AnalysisResult, Finding, Severity } from "../engine/types";
import type { JsonReport } from "../reports/build-report";
import { buildJsonReport, buildMarkdownReport } from "../reports/build-report";

export const CI_WORKFLOW = "github-actions" as const;

export interface CiMetadata {
  /** Base commit/ref compared against, when known. */
  baseRef: string | null;
  /** Head commit/ref that was analysed, when known. */
  headRef: string | null;
}

export interface CiJsonReport extends JsonReport {
  ci: {
    workflow: typeof CI_WORKFLOW;
    baseRef: string | null;
    headRef: string | null;
    analysisStatus: "completed";
    testsRun: false;
  };
}

export function buildCiJsonReport(result: AnalysisResult, meta: CiMetadata): CiJsonReport {
  return {
    ...buildJsonReport(result),
    ci: {
      workflow: CI_WORKFLOW,
      baseRef: meta.baseRef,
      headRef: meta.headRef,
      analysisStatus: "completed",
      testsRun: false,
    },
  };
}

export function buildCiJsonReportText(result: AnalysisResult, meta: CiMetadata): string {
  return `${JSON.stringify(buildCiJsonReport(result, meta), null, 2)}\n`;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Counts findings at or above the requested severity. */
export function countAtOrAbove(result: AnalysisResult, threshold: Severity): number {
  return result.findings.filter(
    (finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold],
  ).length;
}

function escapeInline(value: string, max = 100): string {
  const singleLine = value.replace(/\s+/g, " ").replace(/`/g, "'").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

function locationOf(finding: Finding): string {
  if (finding.line === null) return `${finding.file} (file level)`;
  return `${finding.file} (${finding.side === "old" ? "old" : "new"} line ${finding.line})`;
}

function safePath(value: string): string {
  return value.replace(/`/g, "'");
}

function comparisonLabel(meta: CiMetadata): string {
  if (meta.baseRef && meta.headRef) return `\`${meta.baseRef}\` → \`${meta.headRef}\``;
  if (meta.baseRef) return `Compared against \`${meta.baseRef}\``;
  return "Local diff file";
}

const MAX_SUMMARY_FINDINGS = 30;

/**
 * Builds the GitHub Actions step summary: counts, evidence locations and the
 * HEURISTIC / NOT VERIFIED disclaimer. It never says the pull request is safe
 * or that tests passed.
 */
export function buildCiSummaryMarkdown(result: AnalysisResult, meta: CiMetadata): string {
  const lines: string[] = [];
  const counts = result.summary.countsBySeverity;

  lines.push("## ProofGate diff review");
  lines.push("");
  lines.push(
    "> **HEURISTIC — NOT VERIFIED.** Deterministic pattern review of the pull request diff. This is not a test result and it does not approve or clear the pull request.",
  );
  lines.push("");
  lines.push(`- **Analysis status:** completed`);
  lines.push(`- **Application tests:** not run by ProofGate`);
  lines.push(`- **Comparison:** ${comparisonLabel(meta)}`);
  lines.push(
    `- **Tool:** ${result.tool.name} ${result.tool.version} (${result.tool.engine})`,
  );
  lines.push(`- **Generated:** ${result.generatedAt}`);
  lines.push(`- **Diff SHA-256:** \`${result.input.sha256}\``);
  lines.push(
    `- **Parsed changes:** ${result.summary.changedFiles} files · +${result.summary.additions} · −${result.summary.deletions}`,
  );
  lines.push("");

  lines.push("| High | Medium | Low | Total |");
  lines.push("| ---: | ---: | ---: | ---: |");
  lines.push(
    `| ${counts.high} | ${counts.medium} | ${counts.low} | ${result.summary.total} |`,
  );
  lines.push("");
  lines.push(
    `**Risk counts:** ${counts.high} high · ${counts.medium} medium · ${counts.low} low · ${result.summary.total} total across ${result.summary.filesWithFindings} file${result.summary.filesWithFindings === 1 ? "" : "s"}.`,
  );
  lines.push("");

  lines.push("### Evidence locations");
  lines.push("");

  if (result.findings.length === 0) {
    lines.push(
      "No ruled pattern matched this diff. This is **not** evidence that the change is correct or safe.",
    );
    lines.push("");
  } else {
    for (const finding of result.findings.slice(0, MAX_SUMMARY_FINDINGS)) {
      const excerpt = finding.evidence.trim();
      lines.push(
        `- **${finding.severity.toUpperCase()}** \`${finding.ruleId}\` ${finding.ruleTitle} — \`${safePath(locationOf(finding))}\``,
      );
      if (excerpt.length > 0) {
        lines.push(`  - evidence: \`${escapeInline(excerpt)}\``);
      }
    }
    if (result.findings.length > MAX_SUMMARY_FINDINGS) {
      lines.push("");
      lines.push(
        `_Showing ${MAX_SUMMARY_FINDINGS} of ${result.findings.length} findings. The full list is in \`proofgate-report.md\`._`,
      );
    }
    lines.push("");
  }

  lines.push("### What this does and does not establish");
  lines.push("");
  lines.push("- No code from the pull request was executed and no application tests were run.");
  lines.push("- Every finding is a deterministic text-pattern match and may be a false positive.");
  lines.push("- Absence of findings is not evidence that the change is safe.");
  lines.push(
    "- Successful analysis is not a passing test result, not approval to merge and not a security review.",
  );
  lines.push(
    "- These heuristic findings are separate from any verified command outcomes the local ProofGate CLI may produce.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(DISCLAIMER);
  lines.push("");

  return lines.join("\n");
}

/**
 * Full Markdown report with a CI provenance block inserted before the summary.
 * The deterministic content is exactly what `buildMarkdownReport` produced.
 */
export function buildCiMarkdownReport(result: AnalysisResult, meta: CiMetadata): string {
  const base = buildMarkdownReport(result);
  const context = [
    "## CI context",
    "",
    `- **Workflow:** GitHub Actions (\`pull_request\`)`,
    `- **Comparison:** ${comparisonLabel(meta)}`,
    `- **Analysis status:** completed. Application tests were not run.`,
    `- **Diff SHA-256:** \`${result.input.sha256}\``,
    "",
  ].join("\n");

  const marker = "\n## Summary";
  const index = base.indexOf(marker);
  if (index === -1) return `${base}\n\n${context}`;
  return `${base.slice(0, index)}\n\n${context}${base.slice(index)}`;
}