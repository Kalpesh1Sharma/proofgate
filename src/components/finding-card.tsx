import { useState } from "react";

import { copyText } from "@/lib/client/download";
import type { Finding } from "@/lib/engine/types";

import { AiSuggestionPanel } from "./ai/ai-suggestion-panel";
import type { AiStatus } from "./ai/use-ai-status";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "./icons";
import { HeuristicBadge, SeverityBadge } from "./ui";

function locationLabel(finding: Finding): string {
  if (finding.line === null) return "file level";
  return `${finding.side === "old" ? "old" : "new"} line ${finding.line}`;
}

export function FindingCard({
  finding,
  defaultOpen = false,
  aiStatus,
}: {
  finding: Finding;
  defaultOpen?: boolean;
  aiStatus: AiStatus;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const panelId = `finding-panel-${finding.id}`;

  async function handleCopy() {
    const ok = await copyText(finding.suggestedTest);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <article className="panel overflow-hidden">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
        >
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              finding.severity === "high"
                ? "bg-rose-400"
                : finding.severity === "medium"
                  ? "bg-amber-300"
                  : "bg-sky-300"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[11px] tracking-tight text-faint">
                {finding.ruleId}
              </span>
              <span className="text-sm font-medium text-ink">{finding.ruleTitle}</span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
              <span className="max-w-full truncate">{finding.file}</span>
              <span className="text-faint">·</span>
              <span className="text-faint">{locationLabel(finding)}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 pt-0.5">
            <SeverityBadge severity={finding.severity} />
            <ChevronDownIcon
              className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </h3>

      <div id={panelId} hidden={!open} className="border-t border-line">
        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <HeuristicBadge />
            <span className="label-mono">Category: {finding.category}</span>
            {finding.hunk ? (
              <span className="label-mono truncate">Hunk: {finding.hunk}</span>
            ) : null}
          </div>

          <div>
            <div className="label-mono mb-2">Evidence</div>
            <div className="overflow-x-auto rounded-lg border border-line bg-canvas/80">
              <div className="flex items-start gap-2.5 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
                <span className="select-none text-faint">
                  {finding.side === "old" ? "−" : "+"}
                </span>
                <span className="whitespace-pre text-ink">
                  {finding.evidence.trim() || "(blank line)"}
                </span>
              </div>
              {finding.context.length > 0 ? (
                <div className="border-t border-line/70 px-3 py-2">
                  <div className="label-mono mb-1.5">Context</div>
                  <ul className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
                    {finding.context.map((line, index) => (
                      <li
                        key={`${finding.id}-ctx-${index}`}
                        className="flex gap-2 whitespace-pre text-muted"
                      >
                        <span className="w-8 shrink-0 text-right text-faint/80 tabular-nums">
                          {line.oldLine ?? ""}
                        </span>
                        <span className="w-8 shrink-0 text-right text-faint/80 tabular-nums">
                          {line.newLine ?? ""}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`w-3 shrink-0 ${
                            line.kind === "addition"
                              ? "text-emerald-300"
                              : line.kind === "deletion"
                                ? "text-rose-300"
                                : "text-faint"
                          }`}
                        >
                          {line.kind === "addition"
                            ? "+"
                            : line.kind === "deletion"
                              ? "−"
                              : " "}
                        </span>
                        <span className="min-w-0 break-all">{line.content}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="label-mono mb-1.5">Why this matched</div>
            <p className="text-[13px] leading-relaxed text-muted">{finding.explanation}</p>
          </div>

          <div className="rounded-lg border border-accent-strong/20 bg-accent-strong/[0.05] px-3.5 py-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="label-mono text-accent/80">Suggested test</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {copied ? (
                  <CheckIcon className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-[13px] leading-relaxed text-ink/90">{finding.suggestedTest}</p>
          </div>

          <AiSuggestionPanel finding={finding} status={aiStatus} />
        </div>
      </div>
    </article>
  );
}
