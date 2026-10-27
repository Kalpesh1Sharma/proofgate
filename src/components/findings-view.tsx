import { useMemo } from "react";

import type { AnalysisResult, Severity } from "@/lib/engine/types";

import { useAiStatus } from "./ai/use-ai-status";
import { FindingCard } from "./finding-card";
import { FileCodeIcon, FilterIcon } from "./icons";
import { Callout, HeuristicBadge, SEVERITY_META, SeverityBadge, Stat } from "./ui";

export type SeverityFilter = "all" | Severity;

const SEVERITIES: Severity[] = ["high", "medium", "low"];

interface FindingsViewProps {
  result: AnalysisResult;
  severityFilter: SeverityFilter;
  onSeverityFilter: (filter: SeverityFilter) => void;
  fileFilter: string;
  onFileFilter: (file: string) => void;
  isStale: boolean;
  onReanalyze: () => void;
}

export function FindingsView({
  result,
  severityFilter,
  onSeverityFilter,
  fileFilter,
  onFileFilter,
  isStale,
  onReanalyze,
}: FindingsViewProps) {
  const aiStatus = useAiStatus();
  const fileCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of result.parsed.files) counts.set(file.path, 0);
    for (const finding of result.findings) {
      counts.set(finding.file, (counts.get(finding.file) ?? 0) + 1);
    }
    return counts;
  }, [result]);

  const filtered = useMemo(
    () =>
      result.findings.filter((finding) => {
        if (severityFilter !== "all" && finding.severity !== severityFilter) return false;
        if (fileFilter !== "all" && finding.file !== fileFilter) return false;
        return true;
      }),
    [result, severityFilter, fileFilter],
  );

  const activeFileCount =
    fileFilter === "all" ? result.parsed.files.length : 1;

  return (
    <div className="space-y-5">
      {isStale ? (
        <Callout tone="warning" title="The diff changed after this analysis">
          The findings below describe the diff that was submitted earlier. Re-run the
          analysis to review the current text.
          <button
            type="button"
            onClick={onReanalyze}
            className="ml-1 font-semibold underline decoration-amber-300/40 underline-offset-2 hover:decoration-amber-300"
          >
            Re-run analysis
          </button>
        </Callout>
      ) : null}

      <section className="panel overflow-hidden" aria-label="Analysis summary">
        <div className="flex flex-col gap-5 border-b border-line px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <HeuristicBadge />
              <span className="label-mono">Deterministic review · Phase 1</span>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
              {result.summary.headline}
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
              {result.summary.statement}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-2 sm:min-w-[280px]">
            <Stat label="High" value={result.summary.countsBySeverity.high} />
            <Stat label="Medium" value={result.summary.countsBySeverity.medium} />
            <Stat label="Low" value={result.summary.countsBySeverity.low} />
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-line border-b border-line sm:grid-cols-4">
          <div className="px-4 py-3">
            <div className="label-mono">Changed files</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">
              {result.summary.changedFiles}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="label-mono">Additions</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-200/90">
              +{result.summary.additions}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="label-mono">Deletions</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-rose-200/90">
              −{result.summary.deletions}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="label-mono">Test files changed</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">
              {result.summary.testFilesChanged}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 font-mono text-[11px] text-faint">
          <span>
            {result.tool.name} {result.tool.version}
          </span>
          <span>{result.tool.engine}</span>
          <span title={result.input.sha256}>
            sha256 {result.input.sha256.slice(0, 16)}…
          </span>
          <span>{result.parsed.stats.hunks} hunks parsed</span>
          <span>{new Date(result.generatedAt).toLocaleString()}</span>
        </div>
      </section>

      {result.findings.length === 0 ? (
        <Callout tone="info" title="No ruled pattern matched this diff">
          That is not a verification that the change is correct or safe. The Phase 1 rules
          only look for a narrow set of removed validation, authorization and money checks
          inside the diff.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Filter findings by severity"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            aria-pressed={severityFilter === "all"}
            onClick={() => onSeverityFilter("all")}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              severityFilter === "all"
                ? "border-line-strong bg-raised text-ink"
                : "border-line bg-elevated/50 text-muted hover:text-ink"
            }`}
          >
            All
            <span className="font-mono text-[10px] tabular-nums text-faint">
              {result.summary.total}
            </span>
          </button>
          {SEVERITIES.map((severity) => {
            const meta = SEVERITY_META[severity];
            const count = result.summary.countsBySeverity[severity];
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={severityFilter === severity}
                onClick={() =>
                  onSeverityFilter(severityFilter === severity ? "all" : severity)
                }
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  severityFilter === severity
                    ? meta.chip
                    : "border-line bg-elevated/50 text-muted hover:text-ink"
                }`}
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
                <span className="font-mono text-[10px] tabular-nums text-faint">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs text-faint">
          <FilterIcon className="h-3.5 w-3.5" />
          <span className="tabular-nums">
            Showing {filtered.length} of {result.summary.total} findings across{" "}
            {activeFileCount} {activeFileCount === 1 ? "file" : "files"}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="panel h-fit overflow-hidden" aria-label="Affected files">
          <div className="border-b border-line px-3 py-2.5">
            <div className="label-mono">Affected files</div>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              aria-pressed={fileFilter === "all"}
              onClick={() => onFileFilter("all")}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${
                fileFilter === "all"
                  ? "bg-raised text-ink"
                  : "text-muted hover:bg-white/[0.03] hover:text-ink"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileCodeIcon className="h-3.5 w-3.5 shrink-0 text-faint" />
                All files
              </span>
              <span className="font-mono text-[10px] tabular-nums text-faint">
                {result.summary.total}
              </span>
            </button>
            {result.parsed.files.map((file) => {
              const count = fileCounts.get(file.path) ?? 0;
              const active = fileFilter === file.path;
              return (
                <button
                  key={`${file.path}-${file.changeType}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFileFilter(active ? "all" : file.path)}
                  className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                    active
                      ? "bg-raised text-ink"
                      : count === 0
                        ? "text-faint hover:bg-white/[0.02] hover:text-muted"
                        : "text-muted hover:bg-white/[0.03] hover:text-ink"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[11px]" title={file.path}>
                      {file.path}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-faint">
                      {file.changeType} · +{file.additions} −{file.deletions}
                      {file.isTest ? " · test" : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                      count > 0 ? "bg-white/[0.06] text-ink" : "text-faint"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="panel px-5 py-10 text-center">
              <p className="text-sm font-medium text-ink">No findings match these filters.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                {result.findings.length === 0
                  ? "The engine produced no findings for this diff. That is not a verification of safety."
                  : "Clear the filters to see the rest of the heuristic findings."}
              </p>
              {(severityFilter !== "all" || fileFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    onSeverityFilter("all");
                    onFileFilter("all");
                  }}
                  className="mt-3 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            filtered.map((finding, index) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                aiStatus={aiStatus}
                defaultOpen={index === 0 && severityFilter === "all" && fileFilter === "all"}
              />
            ))
          )}

          <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
            <SeverityBadge severity="high" className="opacity-60" />
            <span className="text-[11px] leading-relaxed text-faint">
              Severity reflects the kind of check that disappeared, not a measured
              probability. No confidence scores are produced.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}