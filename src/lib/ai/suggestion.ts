/**
 * Validation of provider output.
 *
 * The model returns text; ProofGate accepts only a strict JSON object with the
 * four documented fields. Extra fields are dropped, missing or non-string
 * fields are rejected, and over-long fields are truncated to the display cap.
 */

import { AI_SUGGESTION_LIMITS } from "./types";
import type { AiSuggestion } from "./types";

export interface SuggestionFailure {
  ok: false;
  message: string;
  hint: string;
}

export type SuggestionResult = { ok: true; suggestion: AiSuggestion } | SuggestionFailure;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*/, "");
  return withoutOpening.replace(/```\s*$/, "").trim();
}

/**
 * Parses the assistant message into a bounded suggestion.
 * Never throws and never partially trusts the output.
 */
export function parseSuggestion(content: unknown): SuggestionResult {
  if (typeof content !== "string" || content.trim().length === 0) {
    return {
      ok: false,
      message: "The model returned an empty response.",
      hint: "Try the request again, or review the finding without AI assistance.",
    };
  }

  const candidate = stripCodeFence(content);
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) {
    return {
      ok: false,
      message: "The model response was not the required JSON object.",
      hint: "The output was discarded. Review the finding manually.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    return {
      ok: false,
      message: "The model response was not valid JSON.",
      hint: "The output was discarded. Review the finding manually.",
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      message: "The model response JSON was not an object.",
      hint: "The output was discarded. Review the finding manually.",
    };
  }

  const record = parsed as Record<string, unknown>;
  let truncated = false;
  const out: Partial<Record<keyof typeof AI_SUGGESTION_LIMITS, string>> = {};

  for (const key of Object.keys(AI_SUGGESTION_LIMITS) as Array<keyof typeof AI_SUGGESTION_LIMITS>) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      return {
        ok: false,
        message: `The model response is missing a usable "${key}" field.`,
        hint: "The output was discarded. Review the finding manually.",
      };
    }
    const cleaned = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
    const max = AI_SUGGESTION_LIMITS[key];
    if (cleaned.length > max) {
      truncated = true;
      out[key] = cleaned.slice(0, max);
    } else {
      out[key] = cleaned;
    }
  }

  return {
    ok: true,
    suggestion: {
      likelyRisk: out.likelyRisk ?? "",
      suggestedCorrection: out.suggestedCorrection ?? "",
      recommendedTest: out.recommendedTest ?? "",
      limitations: out.limitations ?? "",
      truncated,
    },
  };
}