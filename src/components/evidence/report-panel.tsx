import type { ImportedEvidence } from "@/lib/evidence/types";
import { taskOutcomes } from "@/lib/evidence/compare";

import { ChevronDownIcon, ClockIcon, FileCodeIcon, ShieldIcon, TrashIcon } from "../icons";
import { HeuristicBadge } from "../ui";
import { DemoBadge, StatusBadge } from "./status-badge";

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ");
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "n/a";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function Timing({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ClockIcon className="h-3.5 w-3.5 text-faint" />
      <span className="text-faint">{label}</span>
      <time dateTime={value} className="text-muted">
        {new Date(value).toLocaleString()}
      </time>
    </span>
  );
}

export function EvidenceReportPanel({
  evidence,
  label,
  onClear,
}: {
  evidence: ImportedEvidence;
  label: string;
  onClear?: () => void;
}) {
  const { report } = evidence;
  const outcomes = taskOutcomes(report);
  const counts = {
    passed: outcomes.filter((outcome) => outcome.status === "PASSED").length,
    failed: outcomes.filter((outcome) => outcome.status === "FAILED").length,
    timedOut: outcomes.filter((outcome) => outcome.status === "TIMED OUT").length,
    notRun: outcomes.filter((outcome) => outcome.status === "NOT RUN").length,
  };

  const headingId = `evidence-report-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <section className="panel overflow-hidden" aria-labelledby={headingId}>
      <header className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-sm font-semibold text-ink">
              {label}
            </h3>
            {evidence.source.kind === "demo" ? (
              <DemoBadge />
            ) : (
              <span className="label-mono truncate" title={evidence.source.fileName}>
                {evidence.source.fileName}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {evidence.source.kind === "demo"
              ? evidence.source.provenance
              : "Imported from a local file. The content is treated as untrusted data and rendered as text."}
          </p>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-2 divide-line border-b border-line sm:grid-cols-4 sm:divide-x">
        {[
          { label: "Passed", value: counts.passed, tone: "text-emerald-200" },
          { label: "Failed", value: counts.failed, tone: "text-rose-200" },
          { label: "Timed out", value: counts.timedOut, tone: "text-amber-200" },
          { label: "Not run", value: counts.notRun, tone: "text-muted" },
        ].map((item) => (
          <div key={item.label} className="px-4 py-3">
            <div className="label-mono">{item.label}</div>
            <div className={`mt-0.5 text-lg font-semibold tabular-nums ${item.tone}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <dl className="grid gap-px border-b border-line bg-line sm:grid-cols-2">
        {[
          { label: "Repository", value: report.repository.root, mono: true },
          { label: "Git reference", value: report.repository.ref, mono: true },
          { label: "Commit", value: report.repository.commit, mono: true },
          {
            label: "Generated",
            value: new Date(report.generatedAt).toLocaleString(),
            mono: false,
          },
          { label: "Tool", value: `${report.tool.name} ${report.tool.version}`, mono: true },
          {
            label: "Environment",
            value: `${report.environment.platform} · node ${report.environment.nodeVersion}`,
            mono: true,
          },
        ].map((item) => (
          <div key={item.label} className="min-w-0 bg-surface px-4 py-2.5">
            <dt className="label-mono">{item.label}</dt>
            <dd
              className={`mt-0.5 truncate text-xs ${item.mono ? "font-mono" : ""} text-ink`}
              title={item.value}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-b border-line px-4 py-3">
        <h4 className="label-mono">Verified command outcomes</h4>
        <p className="mt-1 text-xs text-muted">
          These results come from commands that actually ran on the developer&apos;s machine and
          were recorded in this report.
        </p>
      </div>

      <ul className="divide-y divide-line">
        {outcomes.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-muted">
            This report records no commands. Nothing was verified.
          </li>
        ) : null}

        {outcomes.map((outcome) => (
          <li key={`${outcome.taskId}-${outcome.run?.startedAt ?? "skipped"}`} className="px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={outcome.status} />
                  <span className="text-sm font-medium text-ink">
                    {outcome.run?.label || outcome.taskId}
                  </span>
                  <span className="font-mono text-[11px] text-faint">{outcome.taskId}</span>
                </div>
                {outcome.run ? (
                  <p className="mt-1 break-all font-mono text-[11.5px] text-muted">
                    {formatCommand(outcome.run.command.executable, outcome.run.command.args)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    {outcome.reason ?? "This task is not present in the report."}
                  </p>
                )}
              </div>
              {outcome.run ? (
                <div className="flex shrink-0 flex-col items-start gap-1 text-right sm:items-end">
                  <span className="font-mono text-[11px] text-muted">
                    exit {outcome.run.exitCode ?? "n/a"}
                  </span>
                  <span className="font-mono text-[11px] text-faint">
                    {formatDuration(outcome.run.durationMs)}
                  </span>
                </div>
              ) : null}
            </div>

            {outcome.run ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                <Timing label="started" value={outcome.run.startedAt} />
                <Timing label="finished" value={outcome.run.finishedAt} />
                {outcome.run.truncated ? (
                  <span className="text-amber-200">output truncated at the byte cap</span>
                ) : null}
                {outcome.run.signal ? (
                  <span className="text-muted">signal {outcome.run.signal}</span>
                ) : null}
              </div>
            ) : null}

            {outcome.run &&
            (outcome.run.stdout.length > 0 || outcome.run.stderr.length > 0) ? (
              <details className="group mt-3 rounded-lg border border-line bg-canvas/60">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-ink">
                  Captured output
                  <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-2 border-t border-line px-3 py-2.5">
                  {outcome.run.stdout.length > 0 ? (
                    <div>
                      <div className="label-mono mb-1">stdout</div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-muted">
                        {outcome.run.stdout}
                      </pre>
                    </div>
                  ) : null}
                  {outcome.run.stderr.length > 0 ? (
                    <div>
                      <div className="label-mono mb-1">stderr</div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-rose-100/80">
                        {outcome.run.stderr}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-4 py-4">
        <section
          className="rounded-xl border border-dashed border-amber-300/30 bg-amber-300/[0.04] p-4"
          aria-label="Heuristic diff findings"
        >
          <div className="flex flex-wrap items-center gap-2">
            <HeuristicBadge />
            <h4 className="text-sm font-semibold text-ink">Heuristic diff findings</h4>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Pattern matches from the diff that accompanied this run. They are not verified
            defects, and a passing command above does not confirm or clear them.
          </p>

          {report.heuristic.status === "not-requested" ? (
            <p className="mt-3 text-xs text-muted">{report.heuristic.note}</p>
          ) : null}

          {report.heuristic.status === "failed" ? (
            <p className="mt-3 text-xs text-rose-200/90">{report.heuristic.note}</p>
          ) : null}

          {report.heuristic.status === "included" ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
                <span>{report.heuristic.findings.length} findings</span>
                <span className="truncate" title={report.heuristic.source}>
                  {report.heuristic.source}
                </span>
                <span title={report.heuristic.diffSha256}>
                  diff sha256 {report.heuristic.diffSha256.slice(0, 12)}…
                </span>
              </div>

              {report.heuristic.findings.length === 0 ? (
                <p className="text-xs text-muted">
                  No rule matched the attached diff. That is not a verification of safety.
                </p>
              ) : null}

              <ul className="space-y-2">
                {report.heuristic.findings.map((finding, index) => (
                  <li key={`${finding.ruleId}-${index}`}>
                    <details className="group rounded-lg border border-amber-300/20 bg-canvas/50">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted transition-colors hover:text-ink">
                        <span className="font-mono text-[11px] text-faint">{finding.ruleId}</span>
                        <span className="font-medium text-ink">
                          {finding.ruleTitle ?? "Heuristic finding"}
                        </span>
                        {finding.severity ? (
                          <span className="label-mono">{finding.severity}</span>
                        ) : null}
                        <ChevronDownIcon className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="space-y-2.5 border-t border-amber-300/20 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
                          <span className="inline-flex items-center gap-1.5">
                            <FileCodeIcon className="h-3.5 w-3.5" />
                            {finding.file ?? "unknown file"}
                            {finding.line !== null ? `:${finding.line}` : ""}
                          </span>
                        </div>
                        {finding.evidence ? (
                          <pre className="overflow-x-auto rounded-md border border-line bg-canvas/80 px-3 py-2 font-mono text-[11.5px] text-ink">
                            {finding.evidence.trim() || "(blank line)"}
                          </pre>
                        ) : null}
                        {finding.explanation ? (
                          <p className="text-xs leading-relaxed text-muted">{finding.explanation}</p>
                        ) : null}
                        {finding.suggestedTest ? (
                          <p className="text-xs leading-relaxed text-ink/90">
                            <span className="label-mono mr-1.5 text-accent/80">Suggested test</span>
                            {finding.suggestedTest}
                          </p>
                        ) : null}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>

              {report.heuristic.invalidFindingCount > 0 ? (
                <p className="text-xs text-amber-200/90">
                  {report.heuristic.invalidFindingCount} finding
                  {report.heuristic.invalidFindingCount === 1 ? "" : "s"} could not be read and{" "}
                  {report.heuristic.invalidFindingCount === 1 ? "was" : "were"} skipped.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <div className="border-t border-line px-4 py-4">
        <h4 className="label-mono">Limits recorded in this report</h4>
        <ul className="mt-2 space-y-1.5">
          {report.limitations.map((limitation) => (
            <li key={limitation} className="flex gap-2 text-xs leading-relaxed text-muted">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" />
              <span>{limitation}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-[11px] text-faint">
          <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Imported evidence was parsed and displayed only. Nothing in this file was executed.
        </p>
      </div>
    </section>
  );
}