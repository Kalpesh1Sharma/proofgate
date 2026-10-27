import { useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { compareReports } from "@/lib/evidence/compare";
import { loadDemoEvidence } from "@/lib/evidence/samples";
import { parseEvidenceReport } from "@/lib/evidence/schema";
import type {
  EvidenceParseErrorInfo,
  ImportedEvidence,
} from "@/lib/evidence/types";
import { MAX_EVIDENCE_BYTES } from "@/lib/evidence/types";

import { ArrowRightIcon, DatabaseIcon, ShieldCheckIcon, UploadIcon } from "../icons";
import { Callout, EmptyState } from "../ui";
import { EvidenceComparisonPanel } from "./comparison-panel";
import { EvidenceOutcomeSummary } from "./outcome-summary";
import { EvidenceReportPanel } from "./report-panel";
import { DemoBadge } from "./status-badge";

type Slot = "before" | "after";

const SLOT_LABEL: Record<Slot, string> = { before: "Before", after: "After" };

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function ImportSlot({
  slot,
  evidence,
  error,
  busy,
  inputRef,
  onFile,
  onClear,
}: {
  slot: Slot;
  evidence: ImportedEvidence | null;
  error: EvidenceParseErrorInfo | undefined;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputId = `evidence-file-${slot}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {SLOT_LABEL[slot]} report
          </label>
          <p id={hintId} className="mt-0.5 text-xs text-faint">
            JSON evidence written by the Phase 2 CLI. Read-only; nothing is executed.
          </p>
        </div>
        {evidence ? (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Clear
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />

      <div className="mt-3">
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink focus-within:border-accent-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-strong has-[:focus-visible]:outline-offset-2"
        >
          <UploadIcon className="h-3.5 w-3.5" />
          {busy ? "Reading…" : "Choose JSON file"}
        </label>
      </div>

      {error ? (
        <div
          id={errorId}
          role="alert"
          className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/[0.07] px-3 py-2.5 text-xs leading-relaxed text-rose-100/90"
        >
          <div className="font-semibold">
            {error.message}
            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-rose-300/80">
              {error.code}
            </span>
          </div>
          {error.path ? (
            <div className="mt-0.5 font-mono text-[11px] text-rose-200/70">{error.path}</div>
          ) : null}
          <div className="mt-1 text-rose-100/70">{error.hint}</div>
        </div>
      ) : null}

      {evidence ? (
        <div className="mt-3 space-y-1 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {evidence.source.kind === "demo" ? (
              <DemoBadge />
            ) : (
              <span className="label-mono truncate" title={evidence.source.fileName}>
                {evidence.source.fileName}
              </span>
            )}
          </div>
          <dl className="font-mono text-[11px] text-faint">
            <div className="flex items-center gap-2">
              <dt>commit</dt>
              <dd className="truncate text-muted" title={evidence.report.repository.commit}>
                {evidence.report.repository.commit.slice(0, 12)}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>generated</dt>
              <dd className="text-muted">
                {new Date(evidence.report.generatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
          {evidence.warnings.length > 0 ? (
            <ul className="space-y-1 pt-1">
              {evidence.warnings.map((warning) => (
                <li key={warning} className="text-[11px] leading-relaxed text-amber-200/90">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EvidenceView() {
  const [reports, setReports] = useState<Record<Slot, ImportedEvidence | null>>({
    before: null,
    after: null,
  });
  const [errors, setErrors] = useState<Partial<Record<Slot, EvidenceParseErrorInfo>>>({});
  const [busy, setBusy] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const beforeInput = useRef<HTMLInputElement | null>(null);
  const afterInput = useRef<HTMLInputElement | null>(null);

  const comparison = useMemo(
    () =>
      reports.before && reports.after
        ? compareReports(reports.before.report, reports.after.report)
        : null,
    [reports.before, reports.after],
  );

  async function handleFile(slot: Slot, file: File) {
    setNotice(null);

    if (file.size > MAX_EVIDENCE_BYTES) {
      setErrors((previous) => ({
        ...previous,
        [slot]: {
          code: "TOO_LARGE",
          message: `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_EVIDENCE_BYTES)}.`,
          path: null,
          hint: "Import a single report file, not a folder or a concatenation.",
        },
      }));
      setReports((previous) => ({ ...previous, [slot]: null }));
      return;
    }

    setBusy(slot);
    try {
      const text = await file.text();
      const result = parseEvidenceReport(text);

      if (!result.ok) {
        setErrors((previous) => ({ ...previous, [slot]: result.error }));
        setReports((previous) => ({ ...previous, [slot]: null }));
        return;
      }

      setReports((previous) => ({
        ...previous,
        [slot]: {
          report: result.report,
          source: { kind: "file", fileName: file.name },
          warnings: result.warnings,
        },
      }));
      setErrors((previous) => ({ ...previous, [slot]: undefined }));
      setNotice(
        `${SLOT_LABEL[slot]} report imported: ${file.name} · ${result.report.verified.runs.length} recorded command${result.report.verified.runs.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setErrors((previous) => ({
        ...previous,
        [slot]: {
          code: "INVALID_JSON",
          message: "The file could not be read.",
          path: null,
          hint: "Choose a .json report file written by the Phase 2 CLI.",
        },
      }));
      setReports((previous) => ({ ...previous, [slot]: null }));
    } finally {
      setBusy(null);
      const input = slot === "before" ? beforeInput.current : afterInput.current;
      if (input) input.value = "";
    }
  }

  function handleDemo() {
    const demo = loadDemoEvidence();
    if (!demo.ok) {
      setNotice(demo.error);
      return;
    }
    setReports({ before: demo.before, after: demo.after });
    setErrors({});
    setNotice("Bundled DEMO DATA loaded: a real failing run and the real passing run after the fix.");
  }

  function handleSwap() {
    setReports((previous) => ({ before: previous.after, after: previous.before }));
    setNotice("Reports swapped. Before is now the later report.");
  }

  function handleClearAll() {
    setReports({ before: null, after: null });
    setErrors({});
    setNotice("Imported evidence cleared.");
  }

  const hasAny = Boolean(reports.before || reports.after);

  return (
    <div className="space-y-5">
      <Callout tone="info" title="Read-only evidence center">
        Import reports written by <code className="font-mono">npm run verify -- --out report.json</code>.
        Imported content is treated as untrusted data: it is parsed against a strict schema, rendered
        as text, and never executed. This tab cannot run commands, read repositories or fetch any
        path a report mentions.
      </Callout>

      <section className="panel overflow-hidden" aria-labelledby="evidence-import">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="evidence-import" className="text-sm font-semibold text-ink">
              Import evidence
            </h2>
            <p className="mt-1 text-xs text-muted">
              Load one report for details, or a before/after pair to compare the recorded outcomes.
              Maximum file size {formatBytes(MAX_EVIDENCE_BYTES)}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDemo}
              className="inline-flex items-center gap-2 rounded-md bg-accent-strong px-3 py-2 text-xs font-semibold text-accent-ink transition-[filter] hover:brightness-110"
            >
              <DatabaseIcon className="h-3.5 w-3.5" />
              Load demo pair
            </button>
            {hasAny ? (
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-md border border-line bg-elevated px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                Clear all
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-2">
          <ImportSlot
            slot="before"
            evidence={reports.before}
            error={errors.before}
            busy={busy === "before"}
            inputRef={beforeInput}
            onFile={(file) => void handleFile("before", file)}
            onClear={() => {
              setReports((previous) => ({ ...previous, before: null }));
              setErrors((previous) => ({ ...previous, before: undefined }));
            }}
          />
          <ImportSlot
            slot="after"
            evidence={reports.after}
            error={errors.after}
            busy={busy === "after"}
            inputRef={afterInput}
            onFile={(file) => void handleFile("after", file)}
            onClear={() => {
              setReports((previous) => ({ ...previous, after: null }));
              setErrors((previous) => ({ ...previous, after: undefined }));
            }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] text-faint">
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            No network requests are made for imported content.
          </p>
          {reports.before && reports.after ? (
            <button
              type="button"
              onClick={handleSwap}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              Swap before / after
              <ArrowRightIcon className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </section>

      <p role="status" aria-live="polite" className="sr-only">
        {notice ?? ""}
      </p>
      {notice ? <Callout tone="neutral">{notice}</Callout> : null}

      {hasAny ? (
        <EvidenceOutcomeSummary before={reports.before} after={reports.after} />
      ) : null}

      {!hasAny ? (
        <EmptyState
          icon={<ShieldCheckIcon className="h-5 w-5" />}
          title="No evidence imported yet"
          description={
            <span>
              Generate a report with{" "}
              <code className="font-mono text-muted">
                npm run verify:demo -- --keep
              </code>{" "}
              or{" "}
              <code className="font-mono text-muted">
                npm run verify -- --repo . --task test,lint --approve --out report.json
              </code>
              , then import the JSON file above. The bundled demo pair is the real output of the
              Phase 2 fixture: a failing run before the fix and a passing run after it.
            </span>
          }
          action={
            <button
              type="button"
              onClick={handleDemo}
              className="inline-flex items-center gap-2 rounded-md bg-accent-strong px-3.5 py-2 text-xs font-semibold text-accent-ink transition-[filter] hover:brightness-110"
            >
              <DatabaseIcon className="h-3.5 w-3.5" />
              Load the demo pair
            </button>
          }
        />
      ) : null}

      {comparison && reports.before && reports.after ? (
        <EvidenceComparisonPanel
          before={reports.before}
          after={reports.after}
          comparison={comparison}
        />
      ) : null}

      {reports.before ? (
        <EvidenceReportPanel
          evidence={reports.before}
          label="Before"
          onClear={() => setReports((previous) => ({ ...previous, before: null }))}
        />
      ) : null}

      {reports.after ? (
        <EvidenceReportPanel
          evidence={reports.after}
          label="After"
          onClear={() => setReports((previous) => ({ ...previous, after: null }))}
        />
      ) : null}

      {hasAny && !(reports.before && reports.after) ? (
        <Callout tone="neutral" title="Import the second report to compare">
          A single report shows what one run recorded. Import a second report into the other slot
          to see a task-by-task before/after comparison.
        </Callout>
      ) : null}
    </div>
  );
}