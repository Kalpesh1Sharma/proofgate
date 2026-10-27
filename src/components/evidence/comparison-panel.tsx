import type { ComparisonResult } from "@/lib/evidence/compare";
import type { ImportedEvidence } from "@/lib/evidence/types";

import { ArrowRightIcon } from "../icons";
import { Callout } from "../ui";
import { StatusBadge } from "./status-badge";

const TRANSITION_TONE: Record<ComparisonResult["tasks"][number]["transition"], string> = {
  fixed: "text-emerald-200",
  regressed: "text-rose-200",
  "stable-pass": "text-muted",
  "stable-failure": "text-rose-200/80",
  "newly-run": "text-sky-200",
  "not-verified": "text-faint",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "n/a";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function EvidenceComparisonPanel({
  before,
  after,
  comparison,
}: {
  before: ImportedEvidence;
  after: ImportedEvidence;
  comparison: ComparisonResult;
}) {
  const tone =
    comparison.direction === "improved"
      ? "success"
      : comparison.direction === "regressed"
        ? "danger"
        : comparison.direction === "mixed"
          ? "warning"
          : "neutral";

  return (
    <section className="panel overflow-hidden" aria-labelledby="evidence-comparison">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="evidence-comparison" className="text-sm font-semibold text-ink">
            Before → after comparison
          </h3>
          <span className="label-mono">task by task</span>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Both reports are compared by task id. Rows show what each file recorded; a change of
          status is not an explanation of cause, and it covers only the allowlisted commands that
          were actually run.
        </p>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-faint">
          <span className="inline-flex items-center gap-2">
            <span className="text-muted" title={before.report.repository.commit}>
              {before.report.repository.commit.slice(0, 12)}
            </span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
            <span className="text-muted" title={after.report.repository.commit}>
              {after.report.repository.commit.slice(0, 12)}
            </span>
          </span>
          {comparison.sameCommit ? (
            <span className="text-amber-200">
              Both reports reference the same commit; this compares working-tree state, not two
              revisions.
            </span>
          ) : null}
        </div>
      </div>

      <div className="border-b border-line px-4 py-4">
        <Callout
          tone={tone === "neutral" ? "neutral" : tone}
          title={
            comparison.direction === "improved"
              ? "A failing check passed after the change"
              : comparison.direction === "regressed"
                ? "A passing check failed after the change"
                : comparison.direction === "mixed"
                  ? "Mixed outcome"
                  : "No status change"
          }
        >
          {comparison.headline}
        </Callout>
      </div>

      {comparison.tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">
          Neither report records a task, so there is nothing to compare.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <caption className="sr-only">
              Verification task status before and after the change
            </caption>
            <thead>
              <tr className="border-b border-line text-faint">
                <th scope="col" className="px-4 py-2 font-medium">
                  Task
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Before
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  After
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Change
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.tasks.map((task) => {
                const delta =
                  task.before.durationMs !== null && task.after.durationMs !== null
                    ? task.after.durationMs - task.before.durationMs
                    : null;
                return (
                  <tr key={task.taskId} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="px-4 py-3 text-left font-mono text-[11px] font-normal text-ink">
                      {task.taskId}
                    </th>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={task.before.status} />
                        <span className="font-mono text-[11px] text-faint">
                          exit {task.before.exitCode ?? "n/a"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={task.after.status} />
                        <span className="font-mono text-[11px] text-faint">
                          exit {task.after.exitCode ?? "n/a"}
                        </span>
                      </div>
                    </td>
                    <td className={`px-4 py-3 font-medium ${TRANSITION_TONE[task.transition]}`}>
                      {task.label}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted">
                      {formatDuration(task.before.durationMs)} →{" "}
                      {formatDuration(task.after.durationMs)}
                      {delta !== null ? (
                        <span className="ml-2 text-faint">
                          ({delta >= 0 ? "+" : ""}
                          {formatDuration(Math.abs(delta))})
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-line px-4 py-3">
        <p className="text-[11px] leading-relaxed text-faint">
          A task that appears as Not run was never executed (it was skipped or the process could
          not start), so it is not evidence of either failure or success.
        </p>
      </div>
    </section>
  );
}