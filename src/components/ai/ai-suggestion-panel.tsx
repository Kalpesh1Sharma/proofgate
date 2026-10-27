import { useState } from "react";

import { copyText } from "@/lib/client/download";
import type { Finding } from "@/lib/engine/types";

import { CheckIcon, CopyIcon, SparklesIcon } from "../icons";
import type { AiStatus } from "./use-ai-status";

type Stage = "closed" | "consent" | "loading" | "done" | "error";

interface SuggestionView {
  likelyRisk: string;
  suggestedCorrection: string;
  recommendedTest: string;
  limitations: string;
  truncated: boolean;
}

interface AiErrorView {
  code: string;
  message: string;
  hint: string;
  retryAfterSeconds: number | null;
}

const SENT_FIELDS = [
  "rule id, title, severity and category",
  "file path and line number",
  "the evidence line",
  "up to 20 surrounding diff context lines",
  "the rule explanation and engine-suggested test",
];

function buildPayload(finding: Finding) {
  return {
    finding: {
      ruleId: finding.ruleId,
      ruleTitle: finding.ruleTitle,
      severity: finding.severity,
      category: finding.category,
      file: finding.file,
      line: finding.line,
      side: finding.side,
      evidence: finding.evidence,
      context: finding.context.map((line) => ({
        kind: line.kind,
        oldLine: line.oldLine,
        newLine: line.newLine,
        content: line.content,
      })),
      explanation: finding.explanation,
      suggestedTest: finding.suggestedTest,
    },
    consent: { granted: true, grantedAt: new Date().toISOString() },
  };
}

function isSuggestionView(value: unknown): value is SuggestionView {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.likelyRisk === "string" &&
    typeof candidate.suggestedCorrection === "string" &&
    typeof candidate.recommendedTest === "string" &&
    typeof candidate.limitations === "string"
  );
}

function SuggestionSection({
  title,
  body,
  tone = "default",
}: {
  title: string;
  body: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className={
        tone === "accent"
          ? "rounded-lg border border-violet-400/25 bg-violet-400/[0.06] px-3 py-2.5"
          : ""
      }
    >
      <div className={`label-mono mb-1.5 ${tone === "accent" ? "text-violet-200/80" : ""}`}>
        {title}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export function AiSuggestionPanel({
  finding,
  status,
}: {
  finding: Finding;
  status: AiStatus;
}) {
  const [stage, setStage] = useState<Stage>("closed");
  const [suggestion, setSuggestion] = useState<SuggestionView | null>(null);
  const [error, setError] = useState<AiErrorView | null>(null);
  const [copied, setCopied] = useState(false);

  const panelId = `ai-panel-${finding.id}`;
  const model = status.model;

  async function requestSuggestion() {
    setStage("loading");
    setError(null);
    setSuggestion(null);

    let response: Response;
    try {
      response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildPayload(finding)),
      });
    } catch {
      setError({
        code: "NETWORK_ERROR",
        message: "The AI request could not be sent.",
        hint: "Check your connection and try again.",
        retryAfterSeconds: null,
      });
      setStage("error");
      return;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      setError({
        code: "INVALID_RESPONSE",
        message: "The AI response could not be read.",
        hint: "Try again later; the deterministic finding is unaffected.",
        retryAfterSeconds: null,
      });
      setStage("error");
      return;
    }

    if (!response.ok) {
      const envelope =
        typeof payload === "object" && payload !== null && "error" in payload
          ? (payload as { error?: Partial<AiErrorView> }).error
          : undefined;
      setError({
        code: typeof envelope?.code === "string" ? envelope.code : "REQUEST_FAILED",
        message: typeof envelope?.message === "string" ? envelope.message : "The AI request failed.",
        hint: typeof envelope?.hint === "string" ? envelope.hint : "Try again later.",
        retryAfterSeconds:
          typeof envelope?.retryAfterSeconds === "number" ? envelope.retryAfterSeconds : null,
      });
      setStage("error");
      return;
    }

    const body = payload as { classification?: unknown; suggestion?: unknown };
    if (body.classification !== "AI_SUGGESTION" || !isSuggestionView(body.suggestion)) {
      setError({
        code: "INVALID_OUTPUT",
        message: "The AI response did not match the expected shape and was discarded.",
        hint: "Review the finding manually.",
        retryAfterSeconds: null,
      });
      setStage("error");
      return;
    }

    setSuggestion(body.suggestion);
    setStage("done");
  }

  async function handleCopy() {
    if (!suggestion) return;
    const ok = await copyText(suggestion.suggestedCorrection);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (status.state !== "available") {
    const reason =
      status.state === "loading"
        ? "Checking availability…"
        : status.reason === "MISSING_KEY" || status.reason === "MISSING_MODEL" || status.reason === "INVALID_MODEL"
          ? "AI advisor is not configured on this deployment."
          : "AI advisor is unavailable.";
    return (
      <div className="rounded-lg border border-line bg-elevated/40 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SparklesIcon className="h-3.5 w-3.5 text-faint" />
          <span className="label-mono">AI advisor</span>
          <span className="text-[11px] text-faint">{reason}</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          Disabled gracefully: the deterministic finding, the report and the local verification CLI
          all work without it. Nothing was sent anywhere.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-violet-400/25 bg-violet-400/[0.03] px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-violet-200" />
          <span className="text-sm font-medium text-ink">AI Fix Advisor</span>
          <span className="label-mono">Optional · not verification</span>
        </div>
        <button
          type="button"
          onClick={() =>
            setStage(stage === "closed" ? (suggestion ? "done" : "consent") : "closed")
          }
          aria-expanded={stage !== "closed"}
          aria-controls={panelId}
          className="rounded-md border border-violet-400/30 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-100 transition-colors hover:bg-violet-400/20"
        >
          {stage === "closed"
            ? suggestion
              ? "Show AI suggestion"
              : "Explain with AI"
            : "Hide"}
        </button>
      </div>

      <div id={panelId} hidden={stage === "closed"} className="mt-3 space-y-3">
        {stage === "consent" ? (
          <div className="rounded-lg border border-line bg-canvas/60 px-3 py-3">
            <p className="text-xs leading-relaxed text-ink">
              This sends the selected finding to Groq at{" "}
              <code className="font-mono text-muted">api.groq.com</code> for an AI suggestion.
            </p>
            <ul className="mt-2 space-y-1">
              {SENT_FIELDS.map((field) => (
                <li key={field} className="flex gap-2 text-[11px] leading-relaxed text-muted">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" />
                  <span>{field}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              No other part of the diff or repository is sent. ProofGate does not store the excerpt;
              Groq&apos;s own terms and privacy policy apply to its processing.
              {model ? ` Model: ${model}.` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void requestSuggestion()}
                className="rounded-md bg-violet-400 px-3 py-1.5 text-[11px] font-semibold text-violet-950 transition-[filter] hover:brightness-110"
              >
                Send to Groq
              </button>
              <button
                type="button"
                onClick={() => setStage("closed")}
                className="rounded-md border border-line bg-elevated px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {stage === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-xs text-muted">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-200"
            />
            Asking Groq for a suggestion…
          </p>
        ) : null}

        {stage === "error" && error ? (
          <div
            role="alert"
            className="rounded-lg border border-rose-400/25 bg-rose-500/[0.07] px-3 py-2.5 text-xs leading-relaxed text-rose-100/90"
          >
            <div className="font-semibold">
              {error.message}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-rose-300/80">
                {error.code}
              </span>
            </div>
            <div className="mt-1 text-rose-100/70">{error.hint}</div>
            {error.retryAfterSeconds !== null ? (
              <div className="mt-1 font-mono text-[11px] text-rose-200/70">
                retry after {error.retryAfterSeconds}s
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setStage("consent")}
              className="mt-2 rounded-md border border-line bg-elevated px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-ink"
            >
              Try again
            </button>
          </div>
        ) : null}

        {stage === "done" && suggestion ? (
          <div aria-live="polite" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-mono inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-violet-100">
                AI suggestion — not verified
              </span>
              {model ? (
                <span className="font-mono text-[10px] text-faint">{model}</span>
              ) : null}
              <span className="font-mono text-[10px] text-faint">
                {suggestion.truncated ? "truncated to display limit" : "within display limit"}
              </span>
            </div>

            <SuggestionSection title="Likely risk" body={suggestion.likelyRisk} />

            <div className="rounded-lg border border-violet-400/25 bg-violet-400/[0.06] px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="label-mono text-violet-200/80">Suggested correction</span>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  {copied ? (
                    <CheckIcon className="h-3.5 w-3.5 text-violet-200" />
                  ) : (
                    <CopyIcon className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink/90">
                {suggestion.suggestedCorrection}
              </pre>
            </div>

            <SuggestionSection title="Recommended test" body={suggestion.recommendedTest} />
            <SuggestionSection title="Limitations of this suggestion" body={suggestion.limitations} />

            <p className="text-[11px] leading-relaxed text-faint">
              Model output, kept separate from deterministic findings and from verified command
              results. It cannot confirm a defect, verify a fix or claim that tests passed.
              ProofGate executed nothing.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}