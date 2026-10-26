/**
 * Core types for the ProofGate deterministic analysis engine.
 *
 * Everything in this folder is pure and side-effect free: it never executes
 * the code it inspects, never performs I/O against user supplied content and
 * never calls out to a network service.
 */

export type Severity = "high" | "medium" | "low";

export type RuleCategory = "validation" | "authorization" | "money" | "testing";

/**
 * Every finding produced by this engine carries this literal label.
 * ProofGate reports heuristic signals, never confirmed defects.
 */
export const HEURISTIC_LABEL = "HEURISTIC" as const;

export type FindingClassification = typeof HEURISTIC_LABEL;

export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content without the leading diff marker. */
  content: string;
  /** 1-based line number in the original (pre-change) file, if the line exists there. */
  oldLine: number | null;
  /** 1-based line number in the updated (post-change) file, if the line exists there. */
  newLine: number | null;
}

export interface Hunk {
  /** Raw hunk header, e.g. `@@ -12,7 +12,6 @@ export function check()`. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Optional text that trails the `@@` marker in the hunk header. */
  section: string;
  lines: DiffLine[];
  /** True when the hunk body carried a `\ No newline at end of file` marker. */
  noNewlineAtEof: boolean;
}

export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  /** Path before the change; `null` for newly added files. */
  oldPath: string | null;
  /** Path after the change; `null` for deleted files. */
  newPath: string | null;
  /** Canonical path used for display and reporting. */
  path: string;
  changeType: ChangeType;
  hunks: Hunk[];
  additions: number;
  deletions: number;
  /** Heuristic classification of the path as a test file. */
  isTest: boolean;
}

export interface DiffStats {
  files: number;
  hunks: number;
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: FileChange[];
  stats: DiffStats;
}

/** A single line of evidence shown next to a finding. */
export interface EvidenceLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface Finding {
  /** Stable, deterministic identifier derived from rule, file and line. */
  id: string;
  ruleId: string;
  ruleTitle: string;
  classification: FindingClassification;
  severity: Severity;
  category: RuleCategory;
  /** Repository path the finding refers to. */
  file: string;
  /** 1-based line number on the given side; `null` when the finding is file scoped. */
  line: number | null;
  /** `old` refers to the pre-change file, `new` to the post-change file. */
  side: "old" | "new";
  /** Hunk header the evidence was taken from, when available. */
  hunk: string | null;
  /** Exact source line that triggered the rule. */
  evidence: string;
  /** Surrounding lines for context. */
  context: EvidenceLine[];
  /** Why the rule matched, in plain language. */
  explanation: string;
  /** A concrete, deterministic test the developer can write to close the gap. */
  suggestedTest: string;
}

export interface RuleSummary {
  ruleId: string;
  title: string;
  count: number;
}

export interface AnalysisSummary {
  classification: FindingClassification;
  /** One-line, honest description of the outcome. */
  headline: string;
  /** Longer statement that states what the numbers do and do not mean. */
  statement: string;
  total: number;
  countsBySeverity: Record<Severity, number>;
  byRule: RuleSummary[];
  changedFiles: number;
  filesWithFindings: number;
  additions: number;
  deletions: number;
  testFilesChanged: number;
}

export interface AnalysisResult {
  tool: {
    name: string;
    version: string;
    engine: string;
  };
  generatedAt: string;
  input: {
    bytes: number;
    /** SHA-256 of the exact diff that was analysed, for reproducibility. */
    sha256: string;
  };
  parsed: ParsedDiff;
  findings: Finding[];
  summary: AnalysisSummary;
  /** Explicit limits of what this analysis does and does not establish. */
  limitations: string[];
}
