/**
 * Machine-readable verification report.
 *
 * The report keeps two evidence streams apart:
 *   `verified`  — real command executions, reproducible on the same commit;
 *   `heuristic` — Phase 1 diff patterns, explicitly not confirmed defects.
 *
 * It never invents a pass. A task that was not run appears in `skippedChecks`,
 * and a command that timed out is reported as `timed-out`, not as failing code.
 */

import type {
  ApprovalRecord,
  ApprovedRepository,
  CommandEvidence,
  HeuristicAttachment,
  VerificationReport,
} from "./types";

export const VERIFICATION_SCHEMA_VERSION = "2.0";
export const TOOL_VERSION = "0.5.0";

export const VERIFICATION_LIMITATIONS: string[] = [
  "Only the allowlisted npm scripts for the selected tasks were executed.",
  "A passing command means that command exited with code 0 on this machine at this commit. It is not a proof that the change is correct or safe.",
  "Commands run against the working tree, so uncommitted changes are executed as they are on disk; the report records the commit the reference resolved to, not a working-tree snapshot.",
  "A failing command is reproducible evidence of a failure, not an explanation of its cause.",
  "Commands run with the developer's own permissions on a trusted local checkout. This CLI is not a sandbox: project scripts can execute arbitrary code, read files and reach the network.",
  "A timeout means the command did not finish within its limit; it is reported separately from a failure and the process may have left child processes behind.",
  "Output is truncated at a fixed byte limit; the omitted tail is not analysed.",
  "No uploaded diff was executed. If a diff was attached, it was only parsed for Phase 1 heuristic patterns.",
  "Heuristic findings are pattern matches, not verified defects, and the absence of findings is not evidence of safety.",
];

export function summarizeRuns(runs: CommandEvidence[]) {
  return {
    total: runs.length,
    passed: runs.filter((run) => run.status === "passed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    timedOut: runs.filter((run) => run.status === "timed-out").length,
    spawnErrors: runs.filter((run) => run.status === "spawn-error").length,
  };
}

export interface BuildReportInput {
  repository: ApprovedRepository;
  approval: ApprovalRecord;
  runs: CommandEvidence[];
  heuristic: HeuristicAttachment;
  skippedChecks?: Array<{ taskId: string; reason: string }>;
  generatedAt?: Date | string;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
}

export function buildVerificationReport(input: BuildReportInput): VerificationReport {
  const generatedAt =
    typeof input.generatedAt === "string"
      ? input.generatedAt
      : (input.generatedAt ?? new Date()).toISOString();

  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    tool: {
      name: "ProofGate",
      version: TOOL_VERSION,
      mode: "trusted-local-cli",
    },
    generatedAt,
    repository: input.repository,
    approval: input.approval,
    environment: {
      platform: input.platform ?? process.platform,
      nodeVersion: input.nodeVersion ?? process.version,
    },
    verified: {
      runs: input.runs,
      summary: summarizeRuns(input.runs),
    },
    heuristic: input.heuristic,
    skippedChecks: input.skippedChecks ?? [],
    limitations: [...VERIFICATION_LIMITATIONS],
  };
}

export function buildVerificationReportText(report: VerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** True when every requested command actually ran and passed. */
export function allVerifiedPassed(report: VerificationReport): boolean {
  const { summary } = report.verified;
  return (
    summary.total > 0 &&
    summary.passed === summary.total &&
    report.skippedChecks.length === 0
  );
}