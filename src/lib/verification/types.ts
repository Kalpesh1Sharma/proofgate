/**
 * Types for the Phase 2 trusted-local verification CLI.
 *
 * Two evidence streams are kept strictly apart:
 *  - `verified` outcomes come from real command executions on the developer's
 *    machine and are reproducible;
 *  - `heuristic` findings come from the Phase 1 diff rules and are never
 *    confirmed defects.
 */

export type VerificationTaskId = "test" | "lint";

export type CommandStatus = "passed" | "failed" | "timed-out" | "spawn-error";

export interface CommandSpec {
  taskId: VerificationTaskId;
  label: string;
  /** Absolute executable path resolved by the CLI, never user supplied. */
  executable: string;
  /** Fixed argument list built from the allowlist. */
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CommandEvidence {
  taskId: VerificationTaskId;
  label: string;
  command: {
    executable: string;
    args: string[];
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  status: CommandStatus;
  timedOut: boolean;
  /** Output was cut at the size cap; the tail is missing. */
  truncated: boolean;
  stdout: string;
  stderr: string;
  /** Present when the process could not be started at all. */
  spawnError: string | null;
}

export interface ApprovedRepository {
  /** Absolute path that was validated on this machine. */
  root: string;
  /** The Git reference the developer selected. */
  ref: string;
  /** Commit SHA the reference resolved to. */
  commit: string;
}

export interface ApprovalRecord {
  grantedAt: string;
  /** How approval was obtained: explicit CLI flag plus interactive confirm. */
  method: "cli-flag" | "cli-flag-and-prompt";
  /** The exact commands the developer approved. */
  approvedCommands: string[];
}

export type HeuristicAttachment =
  | {
      status: "included";
      classification: "HEURISTIC";
      source: string;
      diffPath: string;
      diffSha256: string;
      findings: unknown[];
      note: string;
    }
  | { status: "not-requested"; note: string }
  | { status: "failed"; note: string };

export interface VerificationReport {
  schemaVersion: string;
  tool: {
    name: string;
    version: string;
    mode: "trusted-local-cli";
  };
  generatedAt: string;
  repository: ApprovedRepository;
  approval: ApprovalRecord;
  environment: {
    platform: NodeJS.Platform;
    nodeVersion: string;
  };
  verified: {
    runs: CommandEvidence[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      timedOut: number;
      spawnErrors: number;
    };
  };
  heuristic: HeuristicAttachment;
  skippedChecks: Array<{ taskId: string; reason: string }>;
  limitations: string[];
}

export class VerificationError extends Error {
  readonly code:
    | "INVALID_REPO_PATH"
    | "NOT_A_GIT_REPOSITORY"
    | "INVALID_REF"
    | "UNKNOWN_TASK"
    | "APPROVAL_REQUIRED"
    | "NPM_UNAVAILABLE"
    | "INVALID_DIFF_PATH";

  constructor(
    code: VerificationError["code"],
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}