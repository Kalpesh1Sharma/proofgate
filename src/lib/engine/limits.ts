/**
 * Shared engine metadata and the explicit limits of verification that appear
 * in every report and in the UI.
 */

export const TOOL_NAME = "ProofGate";
export const TOOL_VERSION = "0.2.0";
export const ENGINE_ID = "deterministic-heuristics-v1";

/**
 * These statements are intentionally concrete. ProofGate reports heuristic
 * signals from a diff; it does not run code or tests and it does not claim a
 * change is safe, correct or vulnerability free.
 */
export const LIMITATIONS: string[] = [
  "ProofGate did not execute any code from the submitted diff.",
  "No test suite was run in Phase 1, so no test results are reported.",
  "Every finding is a deterministic text-pattern match labelled HEURISTIC, not a confirmed defect.",
  "A finding can be a false positive: the flagged change may be intentional and correct.",
  "A missing finding is not evidence that the change is correct, complete or safe.",
  "Only the diff text was analysed. The surrounding repository, dependencies, configuration and runtime behaviour were not available.",
  "No external model or service received the submitted code. Analysis ran only inside this application process.",
  "This is not a security audit, a compliance review or a substitute for code review and testing.",
];

export const DISCLAIMER =
  "ProofGate produces heuristic review signals from a unified diff. It does not verify that a change is correct or safe.";