/**
 * Optional provider seam for future explanation providers.
 *
 * The v0.4 AI Fix Advisor is implemented in `src/lib/ai` with one Groq
 * adapter, gated by per-finding consent and disabled without credentials.
 * This interface remains for adding other providers later; it is not used by
 * the current dashboard and must never upgrade model output to verification.
 */

import type { Finding } from "../engine/types";

export interface ExplanationRequest {
  finding: Finding;
  /** The developer must have chosen to share this evidence explicitly. */
  consent: {
    granted: true;
    grantedAt: string;
  };
}

export interface Explanation {
  findingId: string;
  text: string;
  providerId: string;
  modelId: string;
  generatedAt: string;
  /** Model output can never upgrade a heuristic finding to a verified defect. */
  classification: "MODEL_COMMENTARY";
}

export interface ExplanationProvider {
  readonly id: string;
  readonly label: string;
  readonly availability: "disabled" | "available";
  explain(request: ExplanationRequest, signal?: AbortSignal): Promise<Explanation>;
}

export class DisabledExplanationProvider implements ExplanationProvider {
  readonly id = "phase-3-open-model";
  readonly label = "Open-model explanations";
  readonly availability = "disabled" as const;

  async explain(): Promise<Explanation> {
    throw new Error(
      "This provider is not enabled. Use the consent-gated AI Fix Advisor on a finding card instead.",
    );
  }
}

/**
 * Placeholder used by the UI to document the future integration point without
 * importing a provider SDK or reading any credentials.
 */
export const explanationProvider = new DisabledExplanationProvider();