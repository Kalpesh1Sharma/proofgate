/**
 * Types and bounds for the optional AI Fix Advisor.
 *
 * Model output is untrusted input: it is validated, length-capped and always
 * labelled as an AI suggestion that cannot confirm a defect or verify a fix.
 */

export const AI_CLASSIFICATION = "AI_SUGGESTION" as const;

/** Groq request budget. The transport cap is enforced before JSON parsing. */
export const AI_TRANSPORT_MAX_BYTES = 64 * 1024;
export const AI_REQUEST_TIMEOUT_MS = 12_000;
export const AI_MAX_OUTPUT_TOKENS = 700;

export const AI_LIMITS = {
  ruleId: 64,
  ruleTitle: 200,
  severity: 32,
  category: 64,
  file: 300,
  evidence: 1_200,
  contextLines: 20,
  contextLine: 400,
  explanation: 1_200,
  suggestedTest: 1_000,
  /** Hard cap for the whole prompt sent to the provider. */
  promptBytes: 8_000,
} as const;

export const AI_SUGGESTION_LIMITS = {
  likelyRisk: 600,
  suggestedCorrection: 2_000,
  recommendedTest: 900,
  limitations: 600,
} as const;

export interface AiContextLine {
  kind: string;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface AiFindingInput {
  ruleId: string;
  ruleTitle: string;
  severity: string;
  category: string;
  file: string;
  line: number | null;
  side: string;
  evidence: string;
  context: AiContextLine[];
  explanation: string;
  suggestedTest: string;
}

export interface AiConsent {
  granted: true;
  grantedAt: string;
}

export interface AiExplainRequest {
  finding: AiFindingInput;
  consent: AiConsent;
}

export interface AiSuggestion {
  likelyRisk: string;
  suggestedCorrection: string;
  recommendedTest: string;
  limitations: string;
  /** True when the provider output was longer than the display cap. */
  truncated: boolean;
}

export interface AiDisclosure {
  /** Field names that were transmitted, for the consent copy and the audit trail. */
  fields: string[];
  contextLines: number;
  promptBytes: number;
}

export interface AiExplainSuccess {
  classification: typeof AI_CLASSIFICATION;
  model: string;
  generatedAt: string;
  suggestion: AiSuggestion;
  disclosure: AiDisclosure;
}

export type AiErrorCode =
  | "NOT_CONFIGURED"
  | "CONSENT_REQUIRED"
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_OUTPUT";

export interface AiFailure {
  code: AiErrorCode;
  message: string;
  hint: string;
  retryAfterSeconds: number | null;
}

export type AiExplainResult =
  | { ok: true; value: AiExplainSuccess }
  | { ok: false; error: AiFailure };