import { describe, expect, it } from "vitest";

import { analyzeDiff } from "../src/lib/engine/analyze";
import { LOAN_ELIGIBILITY_EXAMPLE_DIFF } from "../src/lib/examples/loan-eligibility";
import { makeDiff } from "./fixtures";

const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function analyze(diff: string) {
  return analyzeDiff(diff, { generatedAt: FIXED_TIME });
}

function findingsFor(diff: string, ruleId: string) {
  return analyze(diff).findings.filter((finding) => finding.ruleId === ruleId);
}

describe("heuristic rules", () => {
  it("PG-001 flags a removed validation guard as HEURISTIC", () => {
    const diff = makeDiff("src/validate.ts", [
      " export function parse(value: string) {",
      '-  if (!value) {',
      '-    throw new Error("value is required");',
      "-  }",
      "   return value.trim();",
      " }",
    ]);

    const [finding] = findingsFor(diff, "PG-001");
    expect(finding).toBeDefined();
    expect(finding.classification).toBe("HEURISTIC");
    expect(finding.category).toBe("validation");
    expect(finding.severity).toBe("medium");
    expect(finding.file).toBe("src/validate.ts");
    expect(finding.line).toBe(2);
    expect(finding.side).toBe("old");
    expect(finding.evidence).toContain("if (!value)");
    expect(finding.explanation.length).toBeGreaterThan(20);
    expect(finding.suggestedTest.length).toBeGreaterThan(20);
    expect(finding).not.toHaveProperty("confidence");
  });

  it("PG-001 escalates to high for money-related source files", () => {
    const diff = makeDiff("src/loan/income.ts", [
      " export function checkIncome(value: number) {",
      "-  if (!Number.isFinite(value)) {",
      '-    throw new Error("invalid income");',
      "-  }",
      "   return value;",
      " }",
    ]);

    const [finding] = findingsFor(diff, "PG-001");
    expect(finding.severity).toBe("high");
  });

  it("PG-002 flags a removed authorization condition", () => {
    const diff = makeDiff("src/api/admin/route.ts", [
      " export async function POST(request: Request) {",
      "   const user = await getSession(request);",
      '-  if (user.role !== "admin") {',
      '-    throw new ForbiddenError("forbidden");',
      "-  }",
      "   return handle(request, user);",
      " }",
    ]);

    const findings = findingsFor(diff, "PG-002");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      classification: "HEURISTIC",
      category: "authorization",
      severity: "high",
      side: "old",
      line: 3,
    });
    expect(findings[0].evidence).toContain("user.role");
    expect(findingsFor(diff, "PG-001")).toHaveLength(0);
    expect(findingsFor(diff, "PG-003")).toHaveLength(0);
  });

  it("PG-003 flags a removed money threshold and rounding", () => {
    const thresholdDiff = makeDiff("src/pricing.ts", [
      " export function priceFor(plan: Plan) {",
      "-  if (plan.total > 5000) {",
      '     throw new Error("total exceeds maximum");',
      "   }",
      "   return plan.total;",
      " }",
    ]);
    const [threshold] = findingsFor(thresholdDiff, "PG-003");
    expect(threshold).toMatchObject({
      classification: "HEURISTIC",
      category: "money",
      severity: "high",
      line: 2,
    });
    expect(threshold.evidence).toContain("plan.total > 5000");

    const roundingDiff = makeDiff("src/checkout.ts", [
      " export function settle(amount: number) {",
      "-  const rounded = Math.round(amount * 100) / 100;",
      "+  const rounded = amount;",
      "   return rounded;",
      " }",
    ]);
    const [rounding] = findingsFor(roundingDiff, "PG-003");
    expect(rounding).toBeDefined();
    expect(rounding.evidence).toContain("Math.round");
  });

  it("PG-003 does not fire when a comparison is replaced in the same hunk", () => {
    const diff = makeDiff("src/loan/rate.ts", [
      " export function checkRate(rate: number) {",
      "-  if (rate > 0.05) {",
      "+  if (rate > 0.08) {",
      "     return reject();",
      "   }",
      "   return accept();",
      " }",
    ]);

    expect(findingsFor(diff, "PG-003")).toHaveLength(0);
    expect(findingsFor(diff, "PG-004")).toHaveLength(1);
  });

  it("PG-004 flags an operator boundary that loosened", () => {
    const diff = makeDiff("src/loan/eligibility.ts", [
      " export function eligible(income: number) {",
      "-  if (income >= 50000) {",
      "+  if (income > 50000) {",
      "     return true;",
      "   }",
      "   return false;",
      " }",
    ]);

    const [finding] = findingsFor(diff, "PG-004");
    expect(finding).toBeDefined();
    expect(finding.classification).toBe("HEURISTIC");
    expect(finding.severity).toBe("high");
    expect(finding.side).toBe("new");
    expect(finding.evidence).toContain("income > 50000");
    expect(finding.explanation).toContain(">=");
  });

  it("PG-004 flags a numeric threshold that moved outward", () => {
    const diff = makeDiff("src/loan/dti.ts", [
      " export function checkDti(ratio: number) {",
      "-  if (ratio > 0.43) {",
      "+  if (ratio > 0.55) {",
      "     return reject();",
      "   }",
      "   return accept();",
      " }",
    ]);

    const [finding] = findingsFor(diff, "PG-004");
    expect(finding).toBeDefined();
    expect(finding.explanation).toContain("0.43");
    expect(finding.explanation).toContain("0.55");
  });

  it("PG-004 does not flag a stricter boundary", () => {
    const diff = makeDiff("src/range.ts", [
      " export function inRange(value: number) {",
      "-  if (value > 10) {",
      "+  if (value >= 10) {",
      "     return true;",
      "   }",
      "   return false;",
      " }",
    ]);

    expect(findingsFor(diff, "PG-004")).toHaveLength(0);
  });

  it("PG-005 flags a changed source file with no corresponding test change", () => {
    const diff = makeDiff("src/loan/eligibility.ts", [
      " export function eligible() {",
      "-  return false;",
      "+  return true;",
      " }",
    ]);

    const findings = findingsFor(diff, "PG-005");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      classification: "HEURISTIC",
      category: "testing",
      severity: "low",
      line: null,
      file: "src/loan/eligibility.ts",
    });
    expect(findings[0].explanation).toContain("No test file was changed");
  });

  it("PG-005 is suppressed when a paired test file changed", () => {
    const diff =
      makeDiff("src/loan/eligibility.ts", [
        " export function eligible() {",
        "-  return false;",
        "+  return true;",
        " }",
      ]) +
      makeDiff("src/loan/eligibility.test.ts", [
        " describe('eligible', () => {",
        "-  expect(eligible()).toBe(false);",
        "+  expect(eligible()).toBe(true);",
        " });",
      ]);

    expect(findingsFor(diff, "PG-005")).toHaveLength(0);
  });

  it("PG-005 recognises tests in a sibling __tests__ directory", () => {
    const diff =
      makeDiff("src/loan/eligibility.ts", [
        " export function eligible() {",
        "-  return false;",
        "+  return true;",
        " }",
      ]) +
      makeDiff("src/loan/__tests__/eligibility.test.ts", [
        " test('eligible', () => {",
        "-  expect(eligible()).toBe(false);",
        "+  expect(eligible()).toBe(true);",
        " });",
      ]);

    expect(findingsFor(diff, "PG-005")).toHaveLength(0);
  });

  it("does not report one removed block multiple times", () => {
    const diff = makeDiff("src/auth/session.ts", [
      " export function assertSession(user: User) {",
      "-  if (!user.session) {",
      '-    throw new UnauthorizedError("no session");',
      "-  }",
      "   return user;",
      " }",
    ]);

    // The line matches both validation and authorization patterns. PG-002 owns
    // it, and the contiguous block produces exactly one finding.
    expect(findingsFor(diff, "PG-002")).toHaveLength(0);
    expect(findingsFor(diff, "PG-001")).toHaveLength(1);
  });
});

describe("analyzeDiff", () => {
  it("analyses the bundled loan eligibility example", () => {
    const result = analyze(LOAN_ELIGIBILITY_EXAMPLE_DIFF);

    expect(result.parsed.files).toHaveLength(3);
    expect(result.tool).toEqual({
      name: "ProofGate",
      version: "0.3.0",
      engine: "deterministic-heuristics-v1",
    });
    expect(result.generatedAt).toBe(FIXED_TIME);
    expect(result.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.classification).toBe("HEURISTIC");
    expect(result.summary.total).toBe(result.findings.length);
    expect(result.summary.total).toBeGreaterThanOrEqual(8);
    expect(result.summary.testFilesChanged).toBe(0);

    const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));
    expect(ruleIds).toEqual(
      new Set(["PG-001", "PG-002", "PG-003", "PG-004", "PG-005"]),
    );

    for (const finding of result.findings) {
      expect(finding.classification).toBe("HEURISTIC");
      expect(finding.ruleId).toMatch(/^PG-00[1-5]$/);
      expect(finding.file.length).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(20);
      expect(finding.suggestedTest.length).toBeGreaterThan(20);
      expect(finding).not.toHaveProperty("confidence");
      expect(finding).not.toHaveProperty("verified");
    }

    const severityTotal =
      result.summary.countsBySeverity.high +
      result.summary.countsBySeverity.medium +
      result.summary.countsBySeverity.low;
    expect(severityTotal).toBe(result.summary.total);
  });

  it("is deterministic for a fixed timestamp", () => {
    const first = analyze(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    const second = analyze(LOAN_ELIGIBILITY_EXAMPLE_DIFF);
    expect(second).toEqual(first);
  });

  it("reports zero findings without claiming the change is safe", () => {
    const result = analyze(
      makeDiff("src/old-feature.ts", ["-export const legacy = true;"], {
        headerNewPath: "/dev/null",
      }),
    );

    expect(result.findings).toHaveLength(0);
    expect(result.summary.total).toBe(0);
    expect(result.summary.headline).toBe("No heuristic findings matched this diff");
    expect(result.summary.statement).toContain("not a clean bill of health");
    expect(result.limitations.join(" ")).toContain("No test suite was run");
  });

  it("throws a typed parse error for malformed diffs", () => {
    expect(() => analyzeDiff("not a diff")).toThrow();
  });

  it("records input bytes and a stable hash", () => {
    const diff = makeDiff("src/a.ts", [" const a = 1;"]);
    const result = analyze(diff);
    expect(result.input.bytes).toBe(new TextEncoder().encode(diff).length);
    expect(result.input.sha256).toHaveLength(64);
  });
});