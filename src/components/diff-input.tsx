import { useMemo } from "react";

import { MAX_DIFF_BYTES } from "@/lib/engine/parse-diff";

import type { AnalyzeApiError } from "@/lib/client/analyze-client";

import { AlertIcon, PlayIcon, TrashIcon } from "./icons";

export type AnalysisStatus = "idle" | "loading" | "error" | "success";

interface DiffInputProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  onLoadExample: () => void;
  onClear: () => void;
  status: AnalysisStatus;
  error: AnalyzeApiError | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function DiffInput({
  value,
  onChange,
  onAnalyze,
  onLoadExample,
  onClear,
  status,
  error,
}: DiffInputProps) {
  const bytes = useMemo(
    () => new TextEncoder().encode(value).length,
    [value],
  );
  const lineCount = useMemo(
    () => (value.length === 0 ? 0 : value.split("\n").length),
    [value],
  );
  const tooLarge = bytes > MAX_DIFF_BYTES;
  const isEmpty = value.trim().length === 0;
  const isLoading = status === "loading";
  const canAnalyze = !isEmpty && !tooLarge && !isLoading;

  return (
    <form
      className="panel overflow-hidden"
      onSubmit={(event) => {
        event.preventDefault();
        if (canAnalyze) onAnalyze();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <label
            htmlFor="diff-input"
            className="text-sm font-medium text-ink"
          >
            Unified diff
          </label>
          <p id="diff-hint" className="mt-0.5 text-xs text-faint">
            Paste the output of <code className="font-mono text-muted">git diff</code>.
            The diff is parsed and checked locally — it is never executed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLoadExample}
            className="rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Load example
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={isEmpty}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div className="relative">
        <textarea
          id="diff-input"
          name="diff"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (canAnalyze) onAnalyze();
            }
          }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          rows={16}
          placeholder={"diff --git a/src/example.ts b/src/example.ts\n@@ -1,4 +1,4 @@\n-old line\n+new line"}
          aria-describedby="diff-hint diff-metrics"
          aria-invalid={tooLarge || error !== null}
          className="diff-grid block w-full resize-y bg-transparent px-4 py-3 pl-[4.25rem] font-mono text-[12.5px] leading-[1.65] text-ink placeholder:text-faint/70 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-elevated/40 px-4 py-3">
        <div id="diff-metrics" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
          <span className="tabular-nums">
            {formatBytes(bytes)} / {formatBytes(MAX_DIFF_BYTES)} limit
          </span>
          <span className="tabular-nums">{lineCount} lines</span>
          {tooLarge ? (
            <span className="text-rose-300">
              Over the 200 KB limit — trim the diff before analysing.
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-faint sm:inline">
            Ctrl / ⌘ + Enter
          </span>
          <button
            type="submit"
            disabled={!canAnalyze}
            className="inline-flex items-center gap-2 rounded-md bg-accent-strong px-3.5 py-2 text-xs font-semibold text-accent-ink transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isLoading ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink"
              />
            ) : (
              <PlayIcon className="h-3.5 w-3.5" />
            )}
            {isLoading ? "Analysing…" : "Analyse diff"}
          </button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 border-t border-rose-400/25 bg-rose-500/[0.07] px-4 py-3 text-xs leading-relaxed text-rose-100/90"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div className="min-w-0">
            <div className="font-semibold">
              {error.message}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-rose-300/80">
                {error.code}
              </span>
            </div>
            {error.line ? (
              <div className="mt-0.5 font-mono text-[11px] text-rose-200/70">
                line {error.line}
              </div>
            ) : null}
            <div className="mt-1 text-rose-100/70">{error.hint}</div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
