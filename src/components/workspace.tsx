"use client";

import { useState } from "react";
import type { ComponentType, SVGProps } from "react";

import { requestAnalysis } from "@/lib/client/analyze-client";
import type { AnalyzeApiError } from "@/lib/client/analyze-client";
import type { AnalysisResult } from "@/lib/engine/types";

import { DiffInput, type AnalysisStatus } from "./diff-input";
import { FindingsView, type SeverityFilter } from "./findings-view";
import {
  ArrowRightIcon,
  BookIcon,
  FindingsIcon,
  LogoMark,
  ReportIcon,
  ReviewIcon,
  ShieldCheckIcon,
} from "./icons";
import { EvidenceView } from "./evidence/evidence-view";
import { MethodView } from "./method-view";
import { ReportView } from "./report-view";
import { Callout, EmptyState, HeuristicBadge, SectionHeading } from "./ui";

type View = "review" | "findings" | "evidence" | "report" | "method";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: { id: View; label: string; icon: IconComponent }[] = [
  { id: "review", label: "Review", icon: ReviewIcon },
  { id: "findings", label: "Findings", icon: FindingsIcon },
  { id: "evidence", label: "Evidence", icon: ShieldCheckIcon },
  { id: "report", label: "Report", icon: ReportIcon },
  { id: "method", label: "Method & limits", icon: BookIcon },
];

const VIEW_COPY: Record<View, { eyebrow: string; title: string; description: string }> = {
  review: {
    eyebrow: "Step 1 · Input",
    title: "Paste a unified diff",
    description:
      "ProofGate parses the diff, runs deterministic rules over it and shows you the evidence. The diff is never executed. Deterministic analysis stays in this app; an optional AI suggestion sends only one finding excerpt to Groq, and only after you approve it.",
  },
  findings: {
    eyebrow: "Step 2 · Review",
    title: "Heuristic findings",
    description:
      "Every item below is a pattern match against the diff, labelled HEURISTIC. Open one to see the exact line, the surrounding context and a test that would close the gap.",
  },
  report: {
    eyebrow: "Step 3 · Export",
    title: "Evidence-backed report",
    description:
      "Download the review as Markdown or JSON. The report contains the parsed changes, the heuristic findings, the tool version and the limits of verification — and nothing that was not measured.",
  },
  method: {
    eyebrow: "Reference",
    title: "Method, rules and limits",
    description:
      "What the engine actually does in Phase 1, which rules run, and the explicit boundaries of what this tool can tell you.",
  },
  evidence: {
    eyebrow: "Phase 2 · Evidence center",
    title: "Verified command evidence",
    description:
      "Import JSON reports written by the local verification CLI to inspect real command outcomes, and compare a before/after pair. Imported files are untrusted data: they are validated and displayed, never executed.",
  },
};

const CHECKS = [
  {
    title: "Removed validation",
    body: "Deleted guards, assertions and rejection paths that used to refuse invalid input.",
  },
  {
    title: "Removed authorization",
    body: "Deleted role, permission, ownership or tenant conditions on a code path.",
  },
  {
    title: "Money comparisons",
    body: "Removed amount, rate, balance or eligibility limits, and boundaries that moved outward.",
  },
  {
    title: "Missing test changes",
    body: "Source files that changed in the diff without a corresponding test change.",
  },
];

export function Workspace({ exampleDiff }: { exampleDiff: string }) {
  const [view, setView] = useState<View>("review");
  const [diff, setDiff] = useState("");
  const [analyzedDiff, setAnalyzedDiff] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [error, setError] = useState<AnalyzeApiError | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [fileFilter, setFileFilter] = useState("all");

  const isStale = result !== null && analyzedDiff !== null && diff !== analyzedDiff;

  async function handleAnalyze() {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);

    const outcome = await requestAnalysis(diff);
    if (outcome.ok) {
      setResult(outcome.result);
      setAnalyzedDiff(diff);
      setStatus("success");
      setSeverityFilter("all");
      setFileFilter("all");
      setView("findings");
      return;
    }

    setError(outcome.error);
    setStatus("error");
  }

  function handleChange(value: string) {
    setDiff(value);
    if (status === "error") {
      setStatus("idle");
      setError(null);
    }
  }

  function handleLoadExample() {
    setDiff(exampleDiff);
    setError(null);
    setStatus("idle");
    setView("review");
  }

  function handleClear() {
    setDiff("");
    setError(null);
    setStatus("idle");
    setResult(null);
    setAnalyzedDiff(null);
    setSeverityFilter("all");
    setFileFilter("all");
  }

  const copy = VIEW_COPY[view];

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-strong focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex min-h-screen w-full max-w-[1680px]">
        <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 flex-col border-r border-line bg-surface/50 px-4 py-5 lg:flex">
          <div className="flex items-center gap-2.5 px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent-strong/30 bg-accent-strong/10 text-accent">
              <LogoMark className="h-4.5 w-4.5" />
            </span>
            <div>
              <div className="text-sm font-semibold tracking-tight text-ink">ProofGate</div>
              <div className="label-mono">Verification layer</div>
            </div>
          </div>

          <nav aria-label="Workspace" className="mt-7 flex-1">
            <ul className="space-y-1">
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setView(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-white/[0.045] text-ink"
                          : "text-muted hover:bg-white/[0.02] hover:text-ink"
                      }`}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent-strong"
                        />
                      ) : null}
                      <Icon className="h-4 w-4 shrink-0 text-faint group-hover:text-muted" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.id === "findings" && result ? (
                        <span className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted">
                          {result.summary.total}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex items-center gap-2 px-2 text-[11px] text-faint">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-strong" />
              No execution · AI opt-in
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="w-full rounded-lg border border-line bg-elevated/60 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              Start a new review
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-line bg-canvas/80 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent-strong/30 bg-accent-strong/10 text-accent">
                  <LogoMark className="h-4 w-4" />
                </span>
                <div className="text-sm font-semibold tracking-tight text-ink">ProofGate</div>
              </div>
              <span className="label-mono">No execution · AI opt-in</span>
            </div>
            <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto px-3 pb-3">
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-line-strong bg-raised text-ink"
                        : "border-line bg-elevated/50 text-muted"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                    {item.id === "findings" && result ? (
                      <span className="font-mono text-[10px] tabular-nums text-faint">
                        {result.summary.total}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </header>

          <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            <div className="mx-auto w-full max-w-[1180px] space-y-6">
              <SectionHeading
                eyebrow={copy.eyebrow}
                title={copy.title}
                description={copy.description}
                actions={
                  result ? (
                    <div className="flex items-center gap-2">
                      <HeuristicBadge />
                      <span className="font-mono text-[11px] text-faint">
                        {result.tool.version}
                      </span>
                    </div>
                  ) : null
                }
              />

              <p className="sr-only" role="status" aria-live="polite">
                {status === "loading"
                  ? "Running deterministic analysis."
                  : status === "success" && result
                    ? `Analysis complete. ${result.summary.total} heuristic findings.`
                    : status === "error" && error
                      ? `Analysis failed. ${error.message}`
                      : "Ready."}
              </p>

              {view === "review" ? (
                <div className="space-y-5">
                  <DiffInput
                    value={diff}
                    onChange={handleChange}
                    onAnalyze={handleAnalyze}
                    onLoadExample={handleLoadExample}
                    onClear={handleClear}
                    status={status}
                    error={error}
                  />

                  {status === "loading" ? (
                    <div className="panel px-5 py-6" aria-hidden="true">
                      <div className="flex items-center gap-3">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent-strong" />
                        <span className="text-sm text-muted">
                          Parsing the diff and matching deterministic rules…
                        </span>
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="h-3 w-full animate-pulse rounded bg-elevated" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-elevated" />
                        <div className="h-3 w-2/3 animate-pulse rounded bg-elevated" />
                      </div>
                    </div>
                  ) : null}

                  {result && status !== "loading" ? (
                    <section className="panel flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <HeuristicBadge />
                          <span className="text-sm font-medium text-ink">
                            {result.summary.headline}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                          {result.summary.statement}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setView("findings")}
                          className="inline-flex items-center gap-1.5 rounded-md bg-accent-strong px-3 py-2 text-xs font-semibold text-accent-ink transition-[filter] hover:brightness-110"
                        >
                          Open findings
                          <ArrowRightIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setView("report")}
                          className="rounded-md border border-line bg-elevated px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
                        >
                          View report
                        </button>
                      </div>
                    </section>
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <section className="panel p-4" aria-labelledby="checks-heading">
                      <h2 id="checks-heading" className="text-sm font-semibold text-ink">
                        What Phase 1 checks
                      </h2>
                      <ul className="mt-3 space-y-3">
                        {CHECKS.map((check) => (
                          <li key={check.title} className="flex gap-3">
                            <span
                              aria-hidden="true"
                              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong/70"
                            />
                            <div>
                              <h3 className="text-xs font-semibold text-ink">{check.title}</h3>
                              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                                {check.body}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>

                    <section className="space-y-4">
                      <Callout tone="info" title="Accepted input">
                        A standard two-way unified diff up to 200&nbsp;KB. Binary diffs,
                        combined diffs and malformed hunks are rejected with a specific
                        error instead of being guessed at.
                      </Callout>
                      <Callout tone="neutral" title="Try the bundled example">
                        The example diff weakens a loan eligibility check: it widens a debt
                        ratio, drops an identity check, removes a role check and rounds
                        money differently — with no test changes.
                        <button
                          type="button"
                          onClick={handleLoadExample}
                          className="ml-1 font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                        >
                          Load it into the diff box
                        </button>
                      </Callout>
                    </section>
                  </div>
                </div>
              ) : null}

              {view === "findings" ? (
                result ? (
                  <FindingsView
                    result={result}
                    severityFilter={severityFilter}
                    onSeverityFilter={setSeverityFilter}
                    fileFilter={fileFilter}
                    onFileFilter={setFileFilter}
                    isStale={isStale}
                    onReanalyze={handleAnalyze}
                  />
                ) : (
                  <EmptyState
                    icon={<FindingsIcon className="h-5 w-5" />}
                    title="No analysis yet"
                    description="Paste a unified diff and run the deterministic checks. The findings, their evidence and the suggested tests will appear here."
                    action={
                      <button
                        type="button"
                        onClick={() => setView("review")}
                        className="inline-flex items-center gap-2 rounded-md bg-accent-strong px-3.5 py-2 text-xs font-semibold text-accent-ink transition-[filter] hover:brightness-110"
                      >
                        Go to the diff input
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                )
              ) : null}

              {view === "report" ? (
                result ? (
                  <ReportView result={result} isStale={isStale} onReanalyze={handleAnalyze} />
                ) : (
                  <EmptyState
                    icon={<ReportIcon className="h-5 w-5" />}
                    title="No report to export yet"
                    description="Run an analysis first. The Markdown and JSON exports are generated from the same deterministic result and carry the same limits of verification."
                    action={
                      <button
                        type="button"
                        onClick={() => setView("review")}
                        className="inline-flex items-center gap-2 rounded-md bg-accent-strong px-3.5 py-2 text-xs font-semibold text-accent-ink transition-[filter] hover:brightness-110"
                      >
                        Go to the diff input
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                )
              ) : null}

              {view === "evidence" ? <EvidenceView /> : null}

              {view === "method" ? <MethodView /> : null}
            </div>
          </main>

          <footer className="border-t border-line px-4 py-5 sm:px-6 lg:px-10">
            <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-2 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl leading-relaxed">
                ProofGate produces heuristic review signals from a unified diff. It does not
                execute the submitted code, run tests, or verify that a change is correct or
                safe.
              </p>
              <p className="font-mono">Open source · no execution · AI opt-in</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
