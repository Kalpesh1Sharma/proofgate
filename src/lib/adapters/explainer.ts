/**
 * Phase 3 seam: optional open-model explanations through an explicit provider
 * adapter.
 *
 * Phase 1 never calls a model. Any future adapter must:
 *  - require an explicit developer action for every request;
 *  - send only the minimum selected evidence, never the whole repository;
 *  - be disabled by default and configured by the developer;
 *  - keep the deterministic findings as the source of truth;
 *  - label model output as commentary, never as verification.
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
      "Model explanations are not enabled in Phase 1. No source code was sent anywhere.",
    );
  }
}

/**
 * Placeholder used by the UI to document the future integration point without
 * importing a provider SDK or reading any credentials.
 */
export const explanationProvider = new DisabledExplanationProvider();