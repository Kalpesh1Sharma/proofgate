import { useMemo, useState } from "react";

import { copyText, downloadTextFile } from "@/lib/client/download";
import {
  buildJsonReportText,
  buildMarkdownReport,
  reportFileName,
} from "@/lib/reports/build-report";
import type { AnalysisResult } from "@/lib/engine/types";

import { CheckIcon, CopyIcon, DownloadIcon } from "./icons";
import { Callout, HeuristicBadge } from "./ui";

type Format = "markdown" | "json";

export function ReportView({
  result,
  isStale,
  onReanalyze,
}: {
  result: AnalysisResult;
  isStale: boolean;
  onReanalyze: () => void;
}) {
  const [format, setFormat] = useState<Format>("markdown");
  const [copied, setCopied] = useState(false);

  const content = useMemo(
    () =>
      format === "markdown"
        ? buildMarkdownReport(result)
        : buildJsonReportText(result),
    [format, result],
  );

  async function handleCopy() {
    const ok = await copyText(content);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload(target: Format) {
    downloadTextFile(
      reportFileName(result, target),
      target === "markdown" ? "text/markdown" : "application/json",
      target === "markdown" ? buildMarkdownReport(result) : buildJsonReportText(result),
    );
  }

  return (
    <div className="space-y-5">
      {isStale ? (
        <Callout tone="warning" title="The diff changed after this analysis">
          This report describes the diff that was submitted earlier.
          <button
            type="button"
            onClick={onReanalyze}
            className="ml-1 font-semibold underline decoration-amber-300/40 underline-offset-2 hover:decoration-amber-300"
          >
            Re-run analysis
          </button>
        </Callout>
      ) : null}

      <section className="panel overflow-hidden" aria-label="Report metadata">
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Tool", value: `${result.tool.name} ${result.tool.version}` },
            { label: "Engine", value: result.tool.engine },
            { label: "Input size", value: `${result.input.bytes} bytes` },
            { label: "Findings", value: `${result.summary.total} heuristic` },
          ].map((item) => (
            <div key={item.label} className="bg-surface px-4 py-3">
              <div className="label-mono">{item.label}</div>
              <div className="mt-1 truncate font-mono text-xs text-ink" title={item.value}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5 font-mono text-[11px] text-faint">
          <span title={result.input.sha256}>sha256 {result.input.sha256}</span>
          <span>generated {new Date(result.generatedAt).toLocaleString()}</span>
          <span>
            {result.summary.changedFiles} files · +{result.summary.additions} −
            {result.summary.deletions}
          </span>
        </div>
      </section>

      <section className="panel overflow-hidden" aria-label="Report preview">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <HeuristicBadge />
            <div
              role="group"
              aria-label="Report format"
              className="flex items-center gap-1 rounded-lg border border-line bg-elevated p-0.5"
            >
              {(
                [
                  { id: "markdown" as const, label: "Markdown" },
                  { id: "json" as const, label: "JSON" },
                ]
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={format === option.id}
                  onClick={() => setFormat(option.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    format === option.id
                      ? "bg-raised text-ink"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {copied ? (
                <CheckIcon className="h-3.5 w-3.5 text-accent" />
              ) : (
                <CopyIcon className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => handleDownload("markdown")}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              .md
            </button>
            <button
              type="button"
              onClick={() => handleDownload("json")}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              .json
            </button>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-auto bg-canvas/60">
          <pre className="prose-report whitespace-pre px-4 py-4">{content}</pre>
        </div>
      </section>

      <Callout tone="info" title="What this report does not contain">
        No test results, no confidence percentages, no confirmed-defect claims and no
        verified-safety statements. The report reproduces exactly what the deterministic
        engine produced, plus the limits of verification that apply to it.
      </Callout>
    </div>
  );
}
