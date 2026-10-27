import { describe, expect, it } from "vitest";

import {
  compareReports,
  displayStatusOfRun,
  outcomeForTask,
  taskOutcomes,
} from "../src/lib/evidence/compare";
import { loadDemoEvidence } from "../src/lib/evidence/samples";
import { parseEvidenceReport } from "../src/lib/evidence/schema";
import type {
  EvidenceReport,
  EvidenceRun,
  EvidenceSkippedCheck,
} from "../src/lib/evidence/types";
import { MAX_EVIDENCE_BYTES } from "../src/lib/evidence/types";

import beforeSample from "../src/lib/evidence/samples/demo-before-fix.json";
import afterSample from "../src/lib/evidence/samples/demo-after-fix.json";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function documentFrom(sample: unknown): Record<string, unknown> {
  return clone(sample) as Record<string, unknown>;
}

const beforeParse = parseEvidenceReport(JSON.stringify(beforeSample));
const afterParse = parseEvidenceReport(JSON.stringify(afterSample));
if (!beforeParse.ok || !afterParse.ok) {
  throw new Error("The bundled demo samples must validate for these tests to run.");
}
const BEFORE = beforeParse.report;
const AFTER = afterParse.report;

function baseRun(): EvidenceRun {
  return clone(BEFORE.verified.runs[0]);
}

function summarise(runs: EvidenceRun[]) {
  return {
    total: runs.length,
    passed: runs.filter((run) => run.status === "passed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    timedOut: runs.filter((run) => run.status === "timed-out").length,
    spawnErrors: runs.filter((run) => run.status === "spawn-error").length,
  };
}

function reportWith(
  base: EvidenceReport,
  runs: EvidenceRun[],
  skippedChecks: EvidenceSkippedCheck[] = [],
  commit = base.repository.commit,
): EvidenceReport {
  return {
    ...clone(base),
    repository: { ...base.repository, commit },
    verified: { runs, summary: summarise(runs) },
    skippedChecks,
  };
}

describe("evidence schema validation", () => {
  it("accepts both bundled demo reports", () => {
    expect(beforeParse.ok).toBe(true);
    expect(afterParse.ok).toBe(true);
    expect(BEFORE.schemaVersion).toBe("2.0");
    expect(BEFORE.verified.runs).toHaveLength(1);
    expect(AFTER.verified.runs).toHaveLength(1);
  });

  it("recomputes the summary from the recorded runs", () => {
    expect(BEFORE.verified.summary).toEqual({
      total: 1,
      passed: 0,
      failed: 1,
      timedOut: 0,
      spawnErrors: 0,
    });
    expect(AFTER.verified.summary).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      timedOut: 0,
      spawnErrors: 0,
    });
  });

  it("rejects empty input", () => {
    const result = parseEvidenceReport("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EMPTY_INPUT");
  });

  it("rejects malformed JSON", () => {
    const result = parseEvidenceReport('{"schemaVersion": "2.0",');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_JSON");
  });

  it("rejects a non-object document", () => {
    const result = parseEvidenceReport("[1, 2, 3]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_FIELD");
  });

  it("rejects oversized input before parsing", () => {
    const result = parseEvidenceReport("x".repeat(MAX_EVIDENCE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TOO_LARGE");
      expect(result.error.message).toContain("MB");
    }
  });

  it("rejects an unsupported schema version", () => {
    const document = documentFrom(beforeSample);
    document.schemaVersion = "9.9";
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_SCHEMA");
      expect(result.error.path).toBe("schemaVersion");
    }
  });

  it("rejects an unknown field", () => {
    const document = documentFrom(beforeSample);
    document.shellCommand = "rm -rf /";
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SCHEMA");
  });

  it("rejects a missing required field with a path", () => {
    const document = documentFrom(beforeSample);
    delete document.generatedAt;
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FIELD");
      expect(result.error.path).toBe("generatedAt");
    }
  });

  it("rejects a summary that does not match its runs", () => {
    const document = documentFrom(beforeSample) as {
      verified: { summary: Record<string, number> };
    };
    document.verified.summary.passed = 1;
    document.verified.summary.failed = 0;
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FIELD");
      expect(result.error.path).toBe("verified.summary");
    }
  });

  it("rejects a run that claims a pass with a non-zero exit code", () => {
    const document = documentFrom(beforeSample) as {
      verified: { runs: Array<Record<string, unknown>> };
    };
    document.verified.runs[0].status = "passed";
    document.verified.runs[0].exitCode = 1;
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_FIELD");
  });

  it("rejects a timed-out run that does not set timedOut", () => {
    const document = documentFrom(beforeSample) as {
      verified: { runs: Array<Record<string, unknown>> };
      summary: Record<string, number>;
    };
    document.verified.runs[0].status = "timed-out";
    document.verified.runs[0].timedOut = false;
    document.verified.runs[0].exitCode = null;
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FIELD");
      expect(result.error.message).toContain("timedOut");
    }
  });

  it("rejects a non-hex commit", () => {
    const document = documentFrom(beforeSample) as {
      repository: Record<string, unknown>;
    };
    document.repository.commit = "not-a-sha";
    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_FIELD");
  });

  it("skips malformed heuristic findings and reports a warning", () => {
    const document = documentFrom(beforeSample) as {
      heuristic: Record<string, unknown>;
    };
    document.heuristic = {
      status: "included",
      classification: "HEURISTIC",
      source: "phase-1-deterministic-rules",
      diffPath: "change.diff",
      diffSha256: "a".repeat(64),
      findings: [
        {
          ruleId: "PG-001",
          ruleTitle: "Validation or guard removed",
          severity: "medium",
          file: "src/example.ts",
          line: 4,
          evidence: "-  if (!value) {",
          explanation: "A guard was removed.",
          suggestedTest: "Add a test for the rejected input.",
        },
        { notAFinding: true },
      ],
      note: "Pattern matches from the diff.",
    };

    const result = parseEvidenceReport(document);
    expect(result.ok).toBe(true);
    if (result.ok && result.report.heuristic.status === "included") {
      expect(result.report.heuristic.findings).toHaveLength(1);
      expect(result.report.heuristic.invalidFindingCount).toBe(1);
      expect(result.warnings.join(" ")).toContain("skipped");
    }
  });
});

describe("status interpretation", () => {
  it("maps run statuses to display statuses", () => {
    expect(displayStatusOfRun(baseRun())).toBe("FAILED");
    expect(displayStatusOfRun({ ...baseRun(), status: "passed", exitCode: 0 })).toBe("PASSED");
    expect(
      displayStatusOfRun({ ...baseRun(), status: "timed-out", timedOut: true, exitCode: null }),
    ).toBe("TIMED OUT");
    expect(
      displayStatusOfRun({
        ...baseRun(),
        status: "spawn-error",
        spawnError: "ENOENT",
        exitCode: null,
      }),
    ).toBe("NOT RUN");
  });

  it("shows skipped checks as NOT RUN", () => {
    const report = reportWith(BEFORE, [baseRun()], [
      { taskId: "lint", reason: "Script not present in package.json." },
    ]);
    const outcomes = taskOutcomes(report);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["FAILED", "NOT RUN"]);

    const lint = outcomeForTask(report, "lint");
    expect(lint?.status).toBe("NOT RUN");
    expect(lint?.reason).toContain("Script not present");
    expect(lint?.run).toBeNull();
  });

  it("returns null for a task that is not in the report", () => {
    expect(outcomeForTask(BEFORE, "build")).toBeNull();
  });
});

describe("before/after comparison", () => {
  it("shows the real failure-to-pass transition in the demo pair", () => {
    const comparison = compareReports(BEFORE, AFTER);
    expect(comparison.tasks).toHaveLength(1);
    expect(comparison.tasks[0]).toMatchObject({
      taskId: "test",
      transition: "fixed",
    });
    expect(comparison.tasks[0].before.status).toBe("FAILED");
    expect(comparison.tasks[0].after.status).toBe("PASSED");
    expect(comparison.tasks[0].before.exitCode).toBe(1);
    expect(comparison.tasks[0].after.exitCode).toBe(0);
    expect(comparison.direction).toBe("improved");
    expect(comparison.sameCommit).toBe(false);
  });

  it("detects a regression", () => {
    const passing = reportWith(AFTER, [{ ...baseRun(), status: "passed", exitCode: 0 }], [], "b".repeat(40));
    const failing = reportWith(AFTER, [baseRun()], [], "c".repeat(40));
    const comparison = compareReports(passing, failing);

    expect(comparison.tasks[0].transition).toBe("regressed");
    expect(comparison.direction).toBe("regressed");
    expect(comparison.headline).toContain("regressed");
  });

  it("detects an unchanged pass and an unchanged failure", () => {
    const pass1 = reportWith(AFTER, [{ ...baseRun(), status: "passed", exitCode: 0 }], [], "d".repeat(40));
    const pass2 = reportWith(AFTER, [{ ...baseRun(), status: "passed", exitCode: 0 }], [], "e".repeat(40));
    expect(compareReports(pass1, pass2).tasks[0].transition).toBe("stable-pass");

    const fail2 = reportWith(AFTER, [baseRun()], [], "f".repeat(40));
    expect(compareReports(failingReport(), fail2).tasks[0].transition).toBe("stable-failure");
  });

  it("treats a first recorded run and a missing task correctly", () => {
    const withLint = reportWith(
      AFTER,
      [
        { ...baseRun(), status: "passed", exitCode: 0 },
        { ...baseRun(), taskId: "lint", label: "Lint", status: "passed", exitCode: 0 },
      ],
      [],
      "a".repeat(40),
    );
    const single = reportWith(AFTER, [{ ...baseRun(), status: "passed", exitCode: 0 }], [], "b".repeat(40));

    const added = compareReports(single, withLint);
    expect(added.tasks.find((task) => task.taskId === "lint")?.transition).toBe("newly-run");

    const removed = compareReports(withLint, single);
    expect(removed.tasks.find((task) => task.taskId === "lint")?.transition).toBe("not-verified");
    expect(removed.tasks.find((task) => task.taskId === "lint")?.after.status).toBe("NOT RUN");
  });

  it("treats a timeout as a failure direction", () => {
    const timedOut = reportWith(
      AFTER,
      [{ ...baseRun(), status: "timed-out", timedOut: true, exitCode: null }],
      [],
      "9".repeat(40),
    );
    const comparison = compareReports(timedOut, AFTER);
    expect(comparison.tasks[0].transition).toBe("fixed");
    expect(comparison.tasks[0].before.status).toBe("TIMED OUT");
  });

  it("labels both reports with the same commit", () => {
    const a = reportWith(AFTER, [{ ...baseRun(), status: "passed", exitCode: 0 }], [], "1".repeat(40));
    const b = reportWith(AFTER, [{ ...baseRun(), status: "passed", exitCode: 0 }], [], "1".repeat(40));
    expect(compareReports(a, b).sameCommit).toBe(true);
  });
});

function failingReport(): EvidenceReport {
  return reportWith(AFTER, [baseRun()], [], "7".repeat(40));
}

describe("bundled demo data", () => {
  it("loads and labels the demo pair with provenance", () => {
    const demo = loadDemoEvidence();
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;

    expect(demo.before.source.kind).toBe("demo");
    expect(demo.after.source.kind).toBe("demo");
    if (demo.before.source.kind === "demo") {
      expect(demo.before.source.label).toContain("Demo data");
      expect(demo.before.source.provenance).toContain("verify:demo");
      expect(demo.before.source.provenance).toContain("not a live run");
    }

    expect(demo.before.report.verified.summary.failed).toBe(1);
    expect(demo.after.report.verified.summary.passed).toBe(1);
  });

  it("does not contain machine-specific absolute paths", () => {
    const serialised = JSON.stringify(beforeSample) + JSON.stringify(afterSample);
    expect(serialised).not.toMatch(/[A-Za-z]:\\\\Users/);
    expect(serialised).toContain("<demo-workspace>/shop");
  });
});