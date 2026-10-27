/**
 * Read-only interpretation of imported evidence.
 *
 * `displayStatus` never invents a run: a spawn error or a skipped check is
 * shown as NOT RUN, because no command actually completed.
 */

import type {
  DisplayStatus,
  EvidenceReport,
  EvidenceRun,
  EvidenceSkippedCheck,
} from "./types";

export interface TaskOutcome {
  taskId: string;
  status: DisplayStatus;
  /** The recorded run, when one exists. */
  run: EvidenceRun | null;
  /** Why the task is NOT RUN, when applicable. */
  reason: string | null;
}

export function displayStatusOfRun(run: EvidenceRun): DisplayStatus {
  switch (run.status) {
    case "passed":
      return "PASSED";
    case "failed":
      return "FAILED";
    case "timed-out":
      return "TIMED OUT";
    case "spawn-error":
      return "NOT RUN";
  }
}

export function runOutcome(run: EvidenceRun): TaskOutcome {
  return {
    taskId: run.taskId,
    status: displayStatusOfRun(run),
    run,
    reason: run.status === "spawn-error" ? run.spawnError : null,
  };
}

export function skippedOutcome(skipped: EvidenceSkippedCheck): TaskOutcome {
  return { taskId: skipped.taskId, status: "NOT RUN", run: null, reason: skipped.reason };
}

/** Every recorded run, plus skipped checks, in report order. */
export function taskOutcomes(report: EvidenceReport): TaskOutcome[] {
  return [
    ...report.verified.runs.map(runOutcome),
    ...report.skippedChecks.map(skippedOutcome),
  ];
}

export function outcomeForTask(report: EvidenceReport, taskId: string): TaskOutcome | null {
  const run = report.verified.runs.find((candidate) => candidate.taskId === taskId);
  if (run) return runOutcome(run);
  const skipped = report.skippedChecks.find((candidate) => candidate.taskId === taskId);
  if (skipped) return skippedOutcome(skipped);
  return null;
}

export function taskIdsOf(report: EvidenceReport): string[] {
  const ids = new Set<string>();
  for (const run of report.verified.runs) ids.add(run.taskId);
  for (const skipped of report.skippedChecks) ids.add(skipped.taskId);
  return [...ids].sort();
}

export interface OutcomeTally {
  total: number;
  counts: Record<DisplayStatus, number>;
  /** Statuses in display order, limited to the ones that actually occurred. */
  present: DisplayStatus[];
  hasFailure: boolean;
  hasNotRun: boolean;
  allPassed: boolean;
}

/**
 * Derives the outcome tally for one validated report.
 *
 * The tally is computed from the recorded runs and skipped checks, never from
 * a claimed summary. A spawn error or a skipped check counts as NOT RUN
 * because no command completed. Returns `null` when no report was imported.
 */
export function summarizeOutcomes(report: EvidenceReport | null): OutcomeTally | null {
  if (!report) return null;

  const counts: Record<DisplayStatus, number> = {
    PASSED: 0,
    FAILED: 0,
    "TIMED OUT": 0,
    "NOT RUN": 0,
  };

  for (const outcome of taskOutcomes(report)) {
    counts[outcome.status] += 1;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const present = (Object.keys(counts) as DisplayStatus[]).filter(
    (status) => counts[status] > 0,
  );

  return {
    total,
    counts,
    present,
    hasFailure: counts.FAILED > 0 || counts["TIMED OUT"] > 0,
    hasNotRun: counts["NOT RUN"] > 0,
    allPassed: total > 0 && counts.PASSED === total,
  };
}

export type Transition =
  | "fixed"
  | "regressed"
  | "stable-pass"
  | "stable-failure"
  | "newly-run"
  | "not-verified";

export interface ComparisonSide {
  commit: string;
  generatedAt: string;
  status: DisplayStatus;
  exitCode: number | null;
  durationMs: number | null;
  reason: string | null;
}

export interface TaskComparison {
  taskId: string;
  before: ComparisonSide;
  after: ComparisonSide;
  transition: Transition;
  label: string;
}

export interface ComparisonResult {
  tasks: TaskComparison[];
  /** Overall direction across every compared task. */
  direction: "improved" | "regressed" | "mixed" | "unchanged" | "empty";
  headline: string;
  sameCommit: boolean;
}

function sideOf(report: EvidenceReport, taskId: string): ComparisonSide {
  const outcome = outcomeForTask(report, taskId);
  return {
    commit: report.repository.commit,
    generatedAt: report.generatedAt,
    status: outcome?.status ?? "NOT RUN",
    exitCode: outcome?.run ? outcome.run.exitCode : null,
    durationMs: outcome?.run ? outcome.run.durationMs : null,
    reason: outcome?.reason ?? (outcome ? null : "This task is not present in the report."),
  };
}

function classify(before: DisplayStatus, after: DisplayStatus): { transition: Transition; label: string } {
  const failedBefore = before === "FAILED" || before === "TIMED OUT";
  const failedAfter = after === "FAILED" || after === "TIMED OUT";

  if (after === "NOT RUN") {
    return { transition: "not-verified", label: "Not verified in the later report" };
  }
  if (before === "NOT RUN") {
    return { transition: "newly-run", label: "First recorded run" };
  }
  if (failedBefore && after === "PASSED") {
    return { transition: "fixed", label: "Failed → passed" };
  }
  if (before === "PASSED" && failedAfter) {
    return { transition: "regressed", label: "Passed → failed" };
  }
  if (before === "PASSED" && after === "PASSED") {
    return { transition: "stable-pass", label: "Passed → passed" };
  }
  return { transition: "stable-failure", label: "Still failing" };
}

/**
 * Compares two imported reports task by task. It reports what the two files
 * recorded; it never infers a cause or a fix.
 */
export function compareReports(before: EvidenceReport, after: EvidenceReport): ComparisonResult {
  const ids = [...new Set([...taskIdsOf(before), ...taskIdsOf(after)])].sort();

  const tasks: TaskComparison[] = ids.map((taskId) => {
    const beforeSide = sideOf(before, taskId);
    const afterSide = sideOf(after, taskId);
    const { transition, label } = classify(beforeSide.status, afterSide.status);
    return { taskId, before: beforeSide, after: afterSide, transition, label };
  });

  const fixed = tasks.filter((task) => task.transition === "fixed").length;
  const regressed = tasks.filter((task) => task.transition === "regressed").length;

  let direction: ComparisonResult["direction"] = "unchanged";
  if (tasks.length === 0) direction = "empty";
  else if (fixed > 0 && regressed > 0) direction = "mixed";
  else if (fixed > 0) direction = "improved";
  else if (regressed > 0) direction = "regressed";

  const headline =
    tasks.length === 0
      ? "No tasks to compare."
      : fixed === 0 && regressed === 0
        ? `No status changes across ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`
        : `${fixed} improved and ${regressed} regressed across ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`;

  return {
    tasks,
    direction,
    headline,
    sameCommit: before.repository.commit === after.repository.commit,
  };
}