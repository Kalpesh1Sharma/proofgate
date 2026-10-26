import type { AnalysisResult } from "@/lib/engine/types";

export interface AnalyzeApiError {
  code: string;
  message: string;
  hint: string;
  line: number | null;
}

export type AnalyzeOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; error: AnalyzeApiError };

function isErrorPayload(value: unknown): value is { error: AnalyzeApiError } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AnalysisResult>;
  return (
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.findings) &&
    typeof candidate.summary === "object" &&
    candidate.summary !== null &&
    typeof candidate.tool === "object" &&
    candidate.tool !== null &&
    typeof candidate.tool.version === "string" &&
    typeof candidate.parsed === "object" &&
    candidate.parsed !== null
  );
}

/**
 * Sends the pasted diff to the local analysis route. The only network request
 * is to this application's own API; no source code leaves the deployment.
 */
export async function requestAnalysis(diff: string): Promise<AnalyzeOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diff }),
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "The analysis service could not be reached.",
        hint: "Check that the app is running, then retry the analysis.",
        line: null,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "The analysis service returned an unreadable response.",
        hint: "Retry once. If it persists, restart the development server.",
        line: null,
      },
    };
  }

  if (!response.ok) {
    if (isErrorPayload(payload)) {
      return { ok: false, error: payload.error };
    }
    return {
      ok: false,
      error: {
        code: "ANALYSIS_FAILED",
        message: "The analysis failed.",
        hint: "Retry once with a smaller diff.",
        line: null,
      },
    };
  }

  if (!isAnalysisResult(payload)) {
    return {
      ok: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "The analysis response did not match the expected shape.",
        hint: "Restart the development server and retry.",
        line: null,
      },
    };
  }

  return { ok: true, result: payload };
}