/**
 * Report builders. Pure functions shared by the server engine and the UI.
 *
 * Reports contain exactly what the deterministic engine produced: parsed
 * changes, heuristic findings, tool metadata and the limits of verification.
 * They deliberately never contain test results, confidence scores or verified
 * safety claims.
 */

import { DISCLAIMER, LIMITATIONS } from "../engine/limits";
import type { AnalysisResult, Finding } from "../engine/types";

export const REPORT_SCHEMA_VERSION = "1.0";

export interface JsonReport {
  schemaVersion: string;
  tool: AnalysisResult["tool"];
  generatedAt: string;
  input: AnalysisResult["input"];
  summary: AnalysisResult["summary"];
  changes: Array<{
    path: string;
    oldPath: string | null;
    newPath: string | null;
    changeType: string;
    additions: number;
    deletions: number;
    hunks: Array<{
      header: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{
        kind: string;
        oldLine: number | null;
        newLine: number | null;
        content: string;
      }>;
    }>;
  }>;
  findings: Finding[];
  limitsOfVerification: string[];
  disclaimer: string;
}

export function buildJsonReport(result: AnalysisResult): JsonReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: result.tool,
    generatedAt: result.generatedAt,
    input: result.input,
    summary: result.summary,
    changes: result.parsed.files.map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      newPath: file.newPath,
      changeType: file.changeType,
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.hunks.map((hunk) => ({
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines.map((line) => ({
          kind: line.kind,
          oldLine: line.oldLine,
          newLine: line.newLine,
          content: line.content,
        })),
      })),
    })),
    findings: result.findings,
    limitsOfVerification: [...LIMITATIONS],
    disclaimer: DISCLAIMER,
  };
}

export function buildJsonReportText(result: AnalysisResult): string {
  return `${JSON.stringify(buildJsonReport(result), null, 2)}\n`;
}

function fenceFor(content: string): string {
  const longest = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map((run) => run.length),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function codeBlock(content: string, language = ""): string {
  const fence = fenceFor(content);
  return `${fence}${language}\n${content}\n${fence}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function location(finding: Finding): string {
  if (finding.line === null) return "file level";
  const side = finding.side === "old" ? "old" : "new";
  return `${side} line ${finding.line}`;
}

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

export function buildMarkdownReport(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push("# ProofGate review");
  lines.push("");
  lines.push(
    "> **Classification: HEURISTIC.** This report lists pattern matches from a unified diff. It is not a confirmed defect report and it does not verify that the change is safe.",
  );
  lines.push("");
  lines.push(
    `- **Generated:** ${result.generatedAt}`,
    `- **Tool:** ${result.tool.name} ${result.tool.version} (${result.tool.engine})`,
    `- **Input SHA-256:** \`${result.input.sha256}\``,
    `- **Input size:** ${result.input.bytes} bytes`,
  );
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(result.summary.headline);
  lines.push("");
  lines.push(result.summary.statement);
  lines.push("");
  lines.push("| Severity | Findings |");
  lines.push("| --- | ---: |");
  lines.push(`| High | ${result.summary.countsBySeverity.high} |`);
  lines.push(`| Medium | ${result.summary.countsBySeverity.medium} |`);
  lines.push(`| Low | ${result.summary.countsBySeverity.low} |`);
  lines.push(`| **Total** | **${result.summary.total}** |`);
  lines.push("");
  lines.push(
    `Changed files: ${result.summary.changedFiles} · Additions: ${result.summary.additions} · Deletions: ${result.summary.deletions} · Test files changed: ${result.summary.testFilesChanged}`,
  );
  lines.push("");

  lines.push("## Parsed changes");
  lines.push("");
  lines.push("| File | Change | Added | Deleted |");
  lines.push("| --- | --- | ---: | ---: |");
  for (const file of result.parsed.files) {
    lines.push(
      `| \`${escapeCell(file.path)}\` | ${file.changeType}${file.isTest ? " (test)" : ""} | ${file.additions} | ${file.deletions} |`,
    );
  }
  lines.push("");

  if (result.summary.byRule.length > 0) {
    lines.push("### Findings by rule");
    lines.push("");
    lines.push("| Rule | Description | Count |");
    lines.push("| --- | --- | ---: |");
    for (const entry of result.summary.byRule) {
      lines.push(
        `| ${entry.ruleId} | ${escapeCell(entry.title)} | ${entry.count} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Heuristic findings");
  lines.push("");

  if (result.findings.length === 0) {
    lines.push(
      "No deterministic rule matched this diff. This is **not** a verification that the change is correct or safe; the rules only cover a narrow set of removed checks.",
    );
    lines.push("");
  } else {
    result.findings.forEach((finding, index) => {
      lines.push(
        `### ${index + 1}. [${SEVERITY_LABEL[finding.severity]}] ${finding.ruleId} · ${finding.ruleTitle}`,
      );
      lines.push("");
      lines.push(
        `- **Classification:** ${finding.classification}`,
        `- **Severity:** ${finding.severity}`,
        `- **Category:** ${finding.category}`,
        `- **File:** \`${finding.file.replace(/`/g, "'")}\` (${location(finding)})`,
      );
      if (finding.hunk) {
        lines.push(`- **Hunk:** \`${finding.hunk.replace(/`/g, "'")}\``);
      }
      lines.push("");
      lines.push("**Evidence**");
      lines.push("");
      lines.push(codeBlock(finding.evidence, "diff"));
      lines.push("");
      if (finding.context.length > 0) {
        lines.push("**Context**");
        lines.push("");
        const context = finding.context
          .map((line) => {
            const marker =
              line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " ";
            const oldLabel = line.oldLine === null ? "   " : String(line.oldLine).padStart(3);
            const newLabel = line.newLine === null ? "   " : String(line.newLine).padStart(3);
            return `${oldLabel} ${newLabel} ${marker}${line.content}`;
          })
          .join("\n");
        lines.push(codeBlock(context, "text"));
        lines.push("");
      }
      lines.push("**Why this matched**");
      lines.push("");
      lines.push(finding.explanation);
      lines.push("");
      lines.push("**Suggested test**");
      lines.push("");
      lines.push(finding.suggestedTest);
      lines.push("");
    });
  }

  lines.push("## Limits of verification");
  lines.push("");
  for (const limitation of result.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(DISCLAIMER);
  lines.push("");

  return lines.join("\n");
}

export function reportFileName(
  result: AnalysisResult,
  format: "markdown" | "json",
): string {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  return `proofgate-report-${stamp}.${format === "markdown" ? "md" : "json"}`;
}