import { summarizeOutcomes, taskOutcomes } from "@/lib/evidence/compare";
import type { ImportedEvidence } from "@/lib/evidence/types";

import { ShieldCheckIcon } from "../icons";
import { DemoBadge, StatusBadge } from "./status-badge";

const SIDE_LABEL = { before: "Before", after: "After" } as const;

function formatCounts(tally: NonNullable<ReturnType<typeof summarizeOutcomes>>): string {
  const parts: string[] = [];
  if (tally.counts.PASSED > 0) parts.push(`${tally.counts.PASSED} passed`);
  if (tally.counts.FAILED > 0) parts.push(`${tally.counts.FAILED} failed`);
  if (tally.counts["TIMED OUT"] > 0) parts.push(`${tally.counts["TIMED OUT"]} timed out`);
  if (tally.counts["NOT RUN"] > 0) parts.push(`${tally.counts["NOT RUN"]} not run`);
  return parts.join(" · ");
}

function OutcomeCard({
  side,
  evidence,
}: {
  side: keyof typeof SIDE_LABEL;
  evidence: ImportedEvidence | null;
}) {
  const headingId = `outcome-${side}`;
  const tally = summarizeOutcomes(evidence?.report ?? null);

  return (
    <div
      className={`rounded-xl border p-4 ${
        evidence ? "border-line bg-elevated/60" : "border-dashed border-line bg-surface/40"
      }`}
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="label-mono text-muted">
          {SIDE_LABEL[side]}
        </h3>
        {evidence ? (
          evidence.source.kind === "demo" ? (
            <DemoBadge />
          ) : (
            <span className="label-mono truncate text-faint" title={evidence.source.fileName}>
              {evidence.source.fileName}
            </span>
          )
        ) : null}
      </div>

      {!evidence || !tally ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          No report imported for this side. Nothing is claimed as passed or failed until a report
          is loaded.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-xs text-ink" title={evidence.report.repository.commit}>
              {evidence.report.repository.commit.slice(0, 12)}
            </span>
            <span className="font-mono text-[10px] text-faint">
              {evidence.report.repository.ref}
            </span>
          </div>

          {tally.total === 0 ? (
            <div className="mt-3">
              <StatusBadge status="NOT RUN" />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                The report records no commands, so nothing was verified.
              </p>
            </div>
          ) : (
            <>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {taskOutcomes(evidence.report).map((outcome) => (
                  <li key={`${side}-${outcome.taskId}`} className="min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-canvas/60 px-2 py-1">
                      <StatusBadge status={outcome.status} />
                      <span className="truncate font-mono text-[10px] text-muted">
                        {outcome.taskId}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-faint">{formatCounts(tally)}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Compact before/after outcome summary shown as soon as reports are imported.
 * Values come only from the validated reports; the detailed comparison stays
 * below and remains the source of timestamps, output and durations.
 */
export function EvidenceOutcomeSummary({
  before,
  after,
}: {
  before: ImportedEvidence | null;
  after: ImportedEvidence | null;
}) {
  return (
    <section className="panel overflow-hidden" aria-labelledby="outcome-summary">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 id="outcome-summary" className="text-sm font-semibold text-ink">
            Outcome at a glance
          </h2>
          <p className="mt-0.5 text-xs text-faint">
            Derived from the recorded runs in each validated report.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          <ShieldCheckIcon className="h-3.5 w-3.5" />
          No command was run here
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <OutcomeCard side="before" evidence={before} />
        <OutcomeCard side="after" evidence={after} />
      </div>
    </section>
  );
}