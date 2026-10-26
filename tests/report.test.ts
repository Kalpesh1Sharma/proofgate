import { describe, expect, it } from "vitest";

import { analyzeDiff } from "../src/lib/engine/analyze";
import { LOAN_ELIGIBILITY_EXAMPLE_DIFF } from "../src/lib/examples/loan-eligibility";
import {
  buildJsonReport,
  buildJsonReportText,
  buildMarkdownReport,
  reportFileName,
} from "../src/lib/reports/build-report";

const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function exampleResult() {
  return analyzeDiff(LOAN_ELIGIBILITY_EXAMPLE_DIFF, { generatedAt: FIXED_TIME });
}

describe("report builders", () => {
  it("produces a Markdown report with parsed changes, evidence and limits", () => {
    const result = exampleResult();
    const markdown = buildMarkdownReport(result);

    expect(markdown).toContain("# ProofGate review");
    expect(markdown).toContain("Classification: HEURISTIC");
    expect(markdown).toContain(`**Tool:** ProofGate ${result.tool.version}`);
    expect(markdown).toContain(result.input.sha256);
    expect(markdown).toContain("## Parsed changes");
    expect(markdown).toContain("src/services/loan-eligibility.ts");
    expect(markdown).toContain("## Heuristic findings");
    expect(markdown).toContain("PG-001");
    expect(markdown).toContain("PG-002");
    expect(markdown).toContain("PG-003");
    expect(markdown).toContain("PG-004");
    expect(markdown).toContain("PG-005");
    expect(markdown).toContain("income_must_be_positive");
    expect(markdown).toContain("## Limits of verification");
    expect(markdown).toContain("No test suite was run");

    // The report must not invent verification results or confidence scores.
    expect(markdown).not.toMatch(/tests? passed/i);
    expect(markdown).not.toMatch(/confidence/i);
    expect(markdown.toLowerCase()).not.toContain("verified safe");
  });

  it("produces a machine-readable JSON report with separated findings", () => {
    const result = exampleResult();
    const report = buildJsonReport(result);

    expect(report.schemaVersion).toBe("1.0");
    expect(report.tool.name).toBe("ProofGate");
    expect(report.changes).toHaveLength(3);
    expect(report.changes[0].hunks[0].lines.length).toBeGreaterThan(0);
    expect(report.changes[0].hunks[0].lines[0]).toHaveProperty("oldLine");
    expect(report.findings.length).toBe(result.summary.total);
    expect(report.findings.every((finding) => finding.classification === "HEURISTIC")).toBe(
      true,
    );
    expect(report.summary.total).toBeGreaterThanOrEqual(8);
    expect(report.limitsOfVerification.join(" ")).toContain("did not execute");
    expect(report.disclaimer).toContain("heuristic");

    const text = buildJsonReportText(result);
    const parsed = JSON.parse(text) as typeof report;
    expect(parsed.findings).toHaveLength(report.findings.length);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is byte-for-byte deterministic for a fixed input and timestamp", () => {
    const first = buildMarkdownReport(exampleResult());
    const second = buildMarkdownReport(exampleResult());
    expect(second).toBe(first);

    const firstJson = buildJsonReportText(exampleResult());
    const secondJson = buildJsonReportText(exampleResult());
    expect(secondJson).toBe(firstJson);
  });

  it("uses the expected download filenames", () => {
    const result = exampleResult();
    expect(reportFileName(result, "markdown")).toMatch(
      /^proofgate-report-2026-01-01T00-00-00-000Z\.md$/,
    );
    expect(reportFileName(result, "json")).toMatch(
      /^proofgate-report-2026-01-01T00-00-00-000Z\.json$/,
    );
  });
});