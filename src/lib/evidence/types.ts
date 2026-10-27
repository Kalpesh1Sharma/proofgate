/**
 * View-model types for the Verification Evidence Center.
 *
 * These describe the subset of a Phase 2 verification report that the UI
 * displays. Imported reports are untrusted data: they are parsed, validated
 * and rendered as text. Nothing in a report is executed or fetched.
 */

export const EVIDENCE_SCHEMA_VERSION = "2.0";

/** Hard cap for an imported report file (2 MB). */
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

/** Guards against hostile arrays in an imported file. */
export const MAX_EVIDENCE_RUNS = 50;
export const MAX_EVIDENCE_FINDINGS = 500;
export const MAX_EVIDENCE_COMMANDS = 50;
export const MAX_EVIDENCE_LIMITATIONS = 50;
export const MAX_EVIDENCE_SKIPPED = 50;
export const MAX_EVIDENCE_OUTPUT_CHARS = 400_000;

export type RunStatus = "passed" | "failed" | "timed-out" | "spawn-error";

/** What the UI shows. A spawn error never counts as a run. */
export type DisplayStatus = "PASSED" | "FAILED" | "TIMED OUT" | "NOT RUN";

export interface EvidenceCommand {
  executable: string;
  args: string[];
}

export interface EvidenceRun {
  taskId: string;
  label: string;
  command: EvidenceCommand;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  status: RunStatus;
  timedOut: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
  spawnError: string | null;
}

export interface EvidenceSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  spawnErrors: number;
}

export interface EvidenceSkippedCheck {
  taskId: string;
  reason: string;
}

export interface HeuristicFindingView {
  ruleId: string;
  ruleTitle: string | null;
  severity: string | null;
  file: string | null;
  line: number | null;
  evidence: string | null;
  explanation: string | null;
  suggestedTest: string | null;
}

export type EvidenceHeuristic =
  | {
      status: "included";
      classification: "HEURISTIC";
      source: string;
      diffPath: string;
      diffSha256: string;
      findings: HeuristicFindingView[];
      invalidFindingCount: number;
      note: string;
    }
  | { status: "not-requested"; note: string }
  | { status: "failed"; note: string };

export interface EvidenceReport {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  tool: { name: string; version: string; mode: "trusted-local-cli" };
  generatedAt: string;
  repository: { root: string; ref: string; commit: string };
  approval: {
    grantedAt: string;
    method: "cli-flag" | "cli-flag-and-prompt";
    approvedCommands: string[];
  };
  environment: { platform: string; nodeVersion: string };
  verified: { runs: EvidenceRun[]; summary: EvidenceSummary };
  heuristic: EvidenceHeuristic;
  skippedChecks: EvidenceSkippedCheck[];
  limitations: string[];
}

export interface ImportedEvidence {
  report: EvidenceReport;
  /** Where the report came from, for display. */
  source:
    | { kind: "file"; fileName: string }
    | { kind: "demo"; label: string; provenance: string };
  /** Non-fatal validation notes, for example dropped malformed findings. */
  warnings: string[];
}

export type EvidenceParseResult =
  | { ok: true; report: EvidenceReport; warnings: string[] }
  | { ok: false; error: EvidenceParseErrorInfo };

export interface EvidenceParseErrorInfo {
  code:
    | "EMPTY_INPUT"
    | "TOO_LARGE"
    | "INVALID_JSON"
    | "UNSUPPORTED_SCHEMA"
    | "INVALID_FIELD";
  message: string;
  /** Location inside the document, for example `verified.runs[0].exitCode`. */
  path: string | null;
  hint: string;
}

export class EvidenceParseError extends Error {
  readonly info: EvidenceParseErrorInfo;

  constructor(info: EvidenceParseErrorInfo) {
    super(info.message);
    this.name = "EvidenceParseError";
    this.info = info;
  }
}