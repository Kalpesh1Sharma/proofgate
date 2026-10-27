/**
 * Strict runtime validation for imported verification evidence.
 *
 * Imported files are untrusted. This module:
 *  - enforces a size cap before parsing;
 *  - refuses unsupported schema versions;
 *  - validates every field the UI relies on and rejects unknown fields;
 *  - recomputes the summary and rejects a report whose summary disagrees with
 *    its own runs, so a tampered file cannot claim outcomes it did not record.
 *
 * Parsing is pure: it never evaluates, imports or fetches anything.
 */

import {
  EVIDENCE_SCHEMA_VERSION,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_COMMANDS,
  MAX_EVIDENCE_FINDINGS,
  MAX_EVIDENCE_LIMITATIONS,
  MAX_EVIDENCE_OUTPUT_CHARS,
  MAX_EVIDENCE_RUNS,
  MAX_EVIDENCE_SKIPPED,
} from "./types";
import type {
  EvidenceHeuristic,
  EvidenceParseErrorInfo,
  EvidenceParseResult,
  EvidenceReport,
  EvidenceRun,
  EvidenceSummary,
  HeuristicFindingView,
  RunStatus,
} from "./types";
import { EvidenceParseError } from "./types";

const RUN_STATUSES: RunStatus[] = ["passed", "failed", "timed-out", "spawn-error"];
const APPROVAL_METHODS = ["cli-flag", "cli-flag-and-prompt"] as const;
const HEURISTIC_STATUSES = ["included", "not-requested", "failed"] as const;

function fail(
  code: EvidenceParseErrorInfo["code"],
  message: string,
  path: string | null,
  hint: string,
): never {
  throw new EvidenceParseError({ code, message, path, hint });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail("INVALID_FIELD", `${path || "The report"} must be a JSON object.`, path || null, "Import a report produced by `npm run verify -- --json`.");
  }
  return value;
}

function assertNoUnknownKeys(
  object: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      const location = path ? `${path}.${key}` : key;
      fail(
        "UNSUPPORTED_SCHEMA",
        `Unexpected field "${location}".`,
        location,
        "This report has fields this version of ProofGate does not understand. Use a Phase 2 report with schemaVersion 2.0.",
      );
    }
  }
}

function expectString(value: unknown, path: string, maxLength = 20_000): string {
  if (typeof value !== "string") {
    fail("INVALID_FIELD", `${path} must be a string.`, path, "Re-import a genuine report; do not edit the file by hand.");
  }
  if (value.length > maxLength) {
    fail("INVALID_FIELD", `${path} is longer than the ${maxLength} character limit.`, path, "Re-import a genuine report.");
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string, maxLength = 20_000): string {
  const text = expectString(value, path, maxLength);
  if (text.trim().length === 0) {
    fail("INVALID_FIELD", `${path} must not be empty.`, path, "Re-import a genuine report.");
  }
  return text;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail("INVALID_FIELD", `${path} must be true or false.`, path, "Re-import a genuine report.");
  }
  return value;
}

function expectFiniteNumber(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("INVALID_FIELD", `${path} must be a finite number.`, path, "Re-import a genuine report.");
  }
  if (options.integer && !Number.isInteger(value)) {
    fail("INVALID_FIELD", `${path} must be a whole number.`, path, "Re-import a genuine report.");
  }
  if (options.min !== undefined && value < options.min) {
    fail("INVALID_FIELD", `${path} must be at least ${options.min}.`, path, "Re-import a genuine report.");
  }
  if (options.max !== undefined && value > options.max) {
    fail("INVALID_FIELD", `${path} must be at most ${options.max}.`, path, "Re-import a genuine report.");
  }
  return value;
}

function expectArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) {
    fail("INVALID_FIELD", `${path} must be an array.`, path, "Re-import a genuine report.");
  }
  if (value.length > max) {
    fail("INVALID_FIELD", `${path} contains more than ${max} entries.`, path, "Re-import a smaller report.");
  }
  return value;
}

function expectNullableString(value: unknown, path: string, maxLength = 20_000): string | null {
  if (value === null) return null;
  return expectString(value, path, maxLength);
}

function expectIsoDate(value: unknown, path: string): string {
  const text = expectString(value, path, 64);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    fail("INVALID_FIELD", `${path} is not a valid ISO timestamp.`, path, "Re-import a genuine report.");
  }
  return text;
}

function expectEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const text = expectString(value, path, 64) as T;
  if (!allowed.includes(text)) {
    fail("INVALID_FIELD", `${path} must be one of: ${allowed.join(", ")}.`, path, "Re-import a genuine report.");
  }
  return text;
}

function expectStringArray(value: unknown, path: string, max: number, maxItemLength = 20_000): string[] {
  const items = expectArray(value, path, max);
  return items.map((item, index) => expectString(item, `${path}[${index}]`, maxItemLength));
}

function parseFinding(value: unknown, index: number): HeuristicFindingView | null {
  if (!isPlainObject(value)) return null;
  const ruleId = typeof value.ruleId === "string" ? value.ruleId : null;
  if (!ruleId) return null;

  const readString = (key: string): string | null =>
    typeof value[key] === "string" ? (value[key] as string) : null;

  const lineValue = value.line;
  const line =
    typeof lineValue === "number" && Number.isFinite(lineValue) ? lineValue : null;

  const result: HeuristicFindingView = {
    ruleId,
    ruleTitle: readString("ruleTitle"),
    severity: readString("severity"),
    file: readString("file"),
    line,
    evidence: readString("evidence"),
    explanation: readString("explanation"),
    suggestedTest: readString("suggestedTest"),
  };

  void index;
  return result;
}

function parseHeuristic(value: unknown): { heuristic: EvidenceHeuristic; warnings: string[] } {
  const object = expectObject(value, "heuristic");
  const status = expectEnum(object.status, "heuristic.status", HEURISTIC_STATUSES);

  if (status === "not-requested" || status === "failed") {
    assertNoUnknownKeys(object, ["status", "note"], "heuristic");
    return { heuristic: { status, note: expectString(object.note, "heuristic.note") }, warnings: [] };
  }

  assertNoUnknownKeys(
    object,
    ["status", "classification", "source", "diffPath", "diffSha256", "findings", "note"],
    "heuristic",
  );

  const classification = expectEnum(object.classification, "heuristic.classification", ["HEURISTIC"]);
  const findings = expectArray(object.findings, "heuristic.findings", MAX_EVIDENCE_FINDINGS);

  const parsed: HeuristicFindingView[] = [];
  let invalidFindingCount = 0;
  for (const [index, finding] of findings.entries()) {
    const view = parseFinding(finding, index);
    if (view) parsed.push(view);
    else invalidFindingCount += 1;
  }

  const warnings: string[] = [];
  if (invalidFindingCount > 0) {
    warnings.push(
      `${invalidFindingCount} heuristic finding${invalidFindingCount === 1 ? "" : "s"} in this report did not match the expected shape and were skipped.`,
    );
  }

  const cheapDiffSha = expectString(object.diffSha256, "heuristic.diffSha256", 64);
  if (!/^[a-f0-9]{8,64}$/.test(cheapDiffSha)) {
    fail("INVALID_FIELD", "heuristic.diffSha256 must be a hex digest.", "heuristic.diffSha256", "Re-import a genuine report.");
  }

  return {
    heuristic: {
      status: "included",
      classification,
      source: expectString(object.source, "heuristic.source"),
      diffPath: expectString(object.diffPath, "heuristic.diffPath"),
      diffSha256: cheapDiffSha,
      findings: parsed,
      invalidFindingCount,
      note: expectString(object.note, "heuristic.note"),
    },
    warnings,
  };
}

function parseRun(value: unknown, index: number): EvidenceRun {
  const path = `verified.runs[${index}]`;
  const object = expectObject(value, path);
  assertNoUnknownKeys(
    object,
    [
      "taskId",
      "label",
      "command",
      "startedAt",
      "finishedAt",
      "durationMs",
      "exitCode",
      "signal",
      "status",
      "timedOut",
      "truncated",
      "stdout",
      "stderr",
      "spawnError",
    ],
    path,
  );

  const command = expectObject(object.command, `${path}.command`);
  assertNoUnknownKeys(command, ["executable", "args"], `${path}.command`);

  const exitCode =
    object.exitCode === null
      ? null
      : expectFiniteNumber(object.exitCode, `${path}.exitCode`, { integer: true });

  const status = expectEnum(object.status, `${path}.status`, RUN_STATUSES);
  const timedOut = expectBoolean(object.timedOut, `${path}.timedOut`);
  const spawnError = expectNullableString(object.spawnError, `${path}.spawnError`);
  const durationMs = expectFiniteNumber(object.durationMs, `${path}.durationMs`, { min: 0 });

  // Cross-field checks keep a tampered report from claiming a contradiction.
  if (status === "passed" && (exitCode !== 0 || timedOut)) {
    fail("INVALID_FIELD", `${path} claims a pass with an impossible exit status.`, path, "Re-import a genuine report.");
  }
  if (status === "timed-out" && !timedOut) {
    fail("INVALID_FIELD", `${path} is timed-out but timedOut is false.`, path, "Re-import a genuine report.");
  }
  if (status === "spawn-error" && spawnError === null) {
    fail("INVALID_FIELD", `${path} is a spawn error but has no error message.`, path, "Re-import a genuine report.");
  }

  return {
    taskId: expectNonEmptyString(object.taskId, `${path}.taskId`, 200),
    label: expectString(object.label, `${path}.label`, 500),
    command: {
      executable: expectString(command.executable, `${path}.command.executable`, 2_000),
      args: expectStringArray(command.args, `${path}.command.args`, 50, 2_000),
    },
    startedAt: expectIsoDate(object.startedAt, `${path}.startedAt`),
    finishedAt: expectIsoDate(object.finishedAt, `${path}.finishedAt`),
    durationMs,
    exitCode,
    signal: expectNullableString(object.signal, `${path}.signal`, 100),
    status,
    timedOut,
    truncated: expectBoolean(object.truncated, `${path}.truncated`),
    stdout: expectString(object.stdout, `${path}.stdout`, MAX_EVIDENCE_OUTPUT_CHARS),
    stderr: expectString(object.stderr, `${path}.stderr`, MAX_EVIDENCE_OUTPUT_CHARS),
    spawnError,
  };
}

function summariseRuns(runs: EvidenceRun[]): EvidenceSummary {
  return {
    total: runs.length,
    passed: runs.filter((run) => run.status === "passed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    timedOut: runs.filter((run) => run.status === "timed-out").length,
    spawnErrors: runs.filter((run) => run.status === "spawn-error").length,
  };
}

function validateReport(document: unknown): { report: EvidenceReport; warnings: string[] } {
  const object = expectObject(document, "");
  assertNoUnknownKeys(
    object,
    [
      "schemaVersion",
      "tool",
      "generatedAt",
      "repository",
      "approval",
      "environment",
      "verified",
      "heuristic",
      "skippedChecks",
      "limitations",
    ],
    "",
  );

  if (object.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    fail(
      "UNSUPPORTED_SCHEMA",
      `Unsupported schema version "${String(object.schemaVersion)}".`,
      "schemaVersion",
      `This Evidence Center reads schemaVersion ${EVIDENCE_SCHEMA_VERSION} reports produced by the ProofGate Phase 2 CLI.`,
    );
  }

  const tool = expectObject(object.tool, "tool");
  assertNoUnknownKeys(tool, ["name", "version", "mode"], "tool");

  const repository = expectObject(object.repository, "repository");
  assertNoUnknownKeys(repository, ["root", "ref", "commit"], "repository");
  const commit = expectString(repository.commit, "repository.commit", 64);
  if (!/^[a-f0-9]{7,64}$/.test(commit)) {
    fail("INVALID_FIELD", "repository.commit must be a Git commit SHA.", "repository.commit", "Re-import a genuine report.");
  }

  const approval = expectObject(object.approval, "approval");
  assertNoUnknownKeys(approval, ["grantedAt", "method", "approvedCommands"], "approval");

  const environment = expectObject(object.environment, "environment");
  assertNoUnknownKeys(environment, ["platform", "nodeVersion"], "environment");

  const verified = expectObject(object.verified, "verified");
  assertNoUnknownKeys(verified, ["runs", "summary"], "verified");

  const runs = expectArray(verified.runs, "verified.runs", MAX_EVIDENCE_RUNS).map((run, index) =>
    parseRun(run, index),
  );

  const summaryObject = expectObject(verified.summary, "verified.summary");
  assertNoUnknownKeys(
    summaryObject,
    ["total", "passed", "failed", "timedOut", "spawnErrors"],
    "verified.summary",
  );
  const declaredSummary: EvidenceSummary = {
    total: expectFiniteNumber(summaryObject.total, "verified.summary.total", { min: 0, integer: true }),
    passed: expectFiniteNumber(summaryObject.passed, "verified.summary.passed", { min: 0, integer: true }),
    failed: expectFiniteNumber(summaryObject.failed, "verified.summary.failed", { min: 0, integer: true }),
    timedOut: expectFiniteNumber(summaryObject.timedOut, "verified.summary.timedOut", { min: 0, integer: true }),
    spawnErrors: expectFiniteNumber(summaryObject.spawnErrors, "verified.summary.spawnErrors", { min: 0, integer: true }),
  };

  const computedSummary = summariseRuns(runs);
  if (JSON.stringify(computedSummary) !== JSON.stringify(declaredSummary)) {
    fail(
      "INVALID_FIELD",
      "The report summary does not match its own recorded runs.",
      "verified.summary",
      "This report looks edited. Re-import the file the CLI wrote.",
    );
  }

  const skippedChecks = expectArray(object.skippedChecks, "skippedChecks", MAX_EVIDENCE_SKIPPED).map(
    (item, index) => {
      const path = `skippedChecks[${index}]`;
      const entry = expectObject(item, path);
      assertNoUnknownKeys(entry, ["taskId", "reason"], path);
      return {
        taskId: expectNonEmptyString(entry.taskId, `${path}.taskId`, 200),
        reason: expectString(entry.reason, `${path}.reason`),
      };
    },
  );

  const { heuristic, warnings } = parseHeuristic(object.heuristic);

  const report: EvidenceReport = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    tool: {
      name: expectNonEmptyString(tool.name, "tool.name", 200),
      version: expectString(tool.version, "tool.version", 100),
      mode: expectEnum(tool.mode, "tool.mode", ["trusted-local-cli"]),
    },
    generatedAt: expectIsoDate(object.generatedAt, "generatedAt"),
    repository: {
      root: expectNonEmptyString(repository.root, "repository.root", 2_000),
      ref: expectNonEmptyString(repository.ref, "repository.ref", 500),
      commit,
    },
    approval: {
      grantedAt: expectIsoDate(approval.grantedAt, "approval.grantedAt"),
      method: expectEnum(approval.method, "approval.method", APPROVAL_METHODS),
      approvedCommands: expectStringArray(approval.approvedCommands, "approval.approvedCommands", MAX_EVIDENCE_COMMANDS, 2_000),
    },
    environment: {
      platform: expectString(environment.platform, "environment.platform", 100),
      nodeVersion: expectString(environment.nodeVersion, "environment.nodeVersion", 100),
    },
    verified: { runs, summary: computedSummary },
    heuristic,
    skippedChecks,
    limitations: expectStringArray(object.limitations, "limitations", MAX_EVIDENCE_LIMITATIONS, 2_000),
  };

  return { report, warnings };
}

/**
 * Parses an imported evidence report from text or an already parsed object.
 *
 * @returns A discriminated result; it never throws for invalid input.
 */
export function parseEvidenceReport(input: string | unknown): EvidenceParseResult {
  let document: unknown = input;

  if (typeof input === "string") {
    if (input.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: "EMPTY_INPUT",
          message: "The file is empty.",
          path: null,
          hint: "Choose the JSON report written by `npm run verify -- --out <file>`.",
        },
      };
    }

    const bytes = new TextEncoder().encode(input).length;
    if (bytes > MAX_EVIDENCE_BYTES) {
      return {
        ok: false,
        error: {
          code: "TOO_LARGE",
          message: `The file is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`,
          path: null,
          hint: "Import a single verification report, not a concatenation of files.",
        },
      };
    }

    try {
      document = JSON.parse(input) as unknown;
    } catch {
      return {
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "The file is not valid JSON.",
          path: null,
          hint: "Import the exact .json file the CLI wrote, without editing it.",
        },
      };
    }
  }

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return {
      ok: false,
      error: {
        code: "INVALID_FIELD",
        message: "The report must be a JSON object.",
        path: null,
        hint: "Import the exact .json file the CLI wrote.",
      },
    };
  }

  try {
    const { report, warnings } = validateReport(document);
    return { ok: true, report, warnings };
  } catch (error) {
    if (error instanceof EvidenceParseError) {
      return { ok: false, error: error.info };
    }
    return {
      ok: false,
      error: {
        code: "INVALID_FIELD",
        message: "The report could not be validated.",
        path: null,
        hint: "Re-import the file the CLI wrote.",
      },
    };
  }
}