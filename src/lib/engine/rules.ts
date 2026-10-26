/**
 * Deterministic heuristic rules.
 *
 * Every rule inspects the parsed diff only. No rule executes code, no rule
 * talks to a model and no rule claims that a finding is a confirmed defect.
 * Findings are always labelled HEURISTIC.
 */

import type {
  DiffLine,
  EvidenceLine,
  FileChange,
  Finding,
  Hunk,
  RuleCategory,
  Severity,
} from "./types";
import { HEURISTIC_LABEL } from "./types";
import { isTestPath } from "./parse-diff";

export interface RuleDefinition {
  id: string;
  title: string;
  category: RuleCategory;
  /** Default severity; a rule may escalate it based on the matched line. */
  severity: Severity;
  description: string;
}

export interface RuleMatch {
  ruleId: string;
  file: string;
  side: "old" | "new";
  line: number | null;
  hunk: string | null;
  evidence: string;
  explanation: string;
  suggestedTest: string;
  severity?: Severity;
  /** Optional pre-computed context lines. */
  context?: EvidenceLine[];
}

/* -------------------------------------------------------------------------- */
/* Shared lexical helpers                                                      */
/* -------------------------------------------------------------------------- */

const MONEY_TERMS = [
  "amount",
  "apr",
  "balance",
  "cost",
  "credit",
  "currency",
  "debt",
  "deposit",
  "dti",
  "duty",
  "eligible",
  "eligibility",
  "fee",
  "income",
  "installment",
  "interest",
  "limit",
  "loan",
  "ltv",
  "money",
  "mortgage",
  "payment",
  "principal",
  "price",
  "rate",
  "refund",
  "salary",
  "score",
  "tax",
  "total",
  "threshold",
  "wage",
];

const AUTHORIZATION_TERMS = [
  "acl",
  "admin",
  "authenticate",
  "authoriz",
  "can(",
  "currentuser",
  "forbidden",
  "haspermission",
  "isadmin",
  "owner",
  "permission",
  "policy",
  "role",
  "scope",
  "session",
  "tenant",
  "unauthorized",
  "user.role",
];

/**
 * Terms are matched with a word-ish boundary: the character before the term
 * must not be a letter and the character after it must not be a lowercase
 * letter. That keeps `creditScore` and `debtToIncomeRatio` matching while
 * rejecting `generate` for the term `rate`.
 */
const TERM_REGEX_CACHE = new Map<string, RegExp[]>();

function termRegexes(term: string): RegExp[] {
  const cached = TERM_REGEX_CACHE.get(term);
  if (cached) return cached;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const variants = new Set<string>([
    escaped,
    escaped.charAt(0).toUpperCase() + escaped.slice(1),
    escaped.toUpperCase(),
  ]);

  const regexes = [...variants].map(
    (variant) => new RegExp(`(?<![A-Za-z])${variant}(?![a-z])`),
  );
  TERM_REGEX_CACHE.set(term, regexes);
  return regexes;
}

function containsTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => termRegexes(term).some((regex) => regex.test(text)));
}

function isMoneyText(text: string): boolean {
  return containsTerm(text, MONEY_TERMS);
}

/** File paths are matched loosely: `loans/` should count as a money path. */
function isMoneyPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MONEY_TERMS.some((term) => lower.includes(term));
}

function isAuthorizationText(text: string): boolean {
  return containsTerm(text, AUTHORIZATION_TERMS);
}

const VALIDATION_PATTERNS: RegExp[] = [
  /\bthrow\b/i,
  /\braise\b/i,
  /\bassert\b/i,
  /\breject\b/i,
  /\breturn\s+(false|null|undefined)\b/i,
  /\bif\s*\(\s*!/,
  /\bif\s*\(\s*not\b/i,
  /\bunless\b/i,
  /\bvalidate\w*/i,
  /\bassert\w*/i,
  /\bsafeparse\b/i,
  /\bschema\.(parse|parsesync|safeParse)\b/i,
  /\bisvalid\b/i,
  /\bguard\b/i,
  /\bsanitiz\w+/i,
  /\bmust\b/i,
  /\brequired\b/i,
  /\binvalid\b/i,
  /\bcheck\w*\s*\(/,
  /\bguardClause\b/i,
];

const GUARD_CONTEXT = /(\bif\b|\breturn\b|\bthrow\b|\braise\b|\bassert\b|\brequire\b|\bcheck\b|\bdeny\b|\bunless\b)/i;

function looksLikeValidation(text: string): boolean {
  return VALIDATION_PATTERNS.some((pattern) => pattern.test(text));
}

/* -------------------------------------------------------------------------- */
/* Comparison analysis (used by the money rules)                               */
/* -------------------------------------------------------------------------- */

type ComparisonOperator = ">=" | "<=" | "==" | "!=" | ">" | "<";

interface Comparison {
  operator: ComparisonOperator;
  left: string;
  right: string;
  rightNumber: number | null;
}

const COMPARISON_PATTERN = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\[[^\]]+\])?)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?|\"[^\"]*\"|'[^']*')/g;

export function extractComparisons(text: string): Comparison[] {
  const results: Comparison[] = [];
  COMPARISON_PATTERN.lastIndex = 0;
  let match = COMPARISON_PATTERN.exec(text);
  while (match !== null) {
    const numeric = Number(match[3]);
    results.push({
      operator: match[2] as ComparisonOperator,
      left: match[1],
      right: match[3],
      rightNumber: Number.isFinite(numeric) ? numeric : null,
    });
    match = COMPARISON_PATTERN.exec(text);
  }
  return results;
}

/**
 * True when the new operator makes a guard reject a strictly smaller set of
 * values than the old one. The rule only applies to guards that reject when
 * their condition holds, so the direction is the opposite of "accepts more".
 */
export function isWeakerGuardOperator(
  before: ComparisonOperator,
  after: ComparisonOperator,
): boolean {
  if (before === after) return false;
  switch (before) {
    case "<=":
      return after === "<";
    case ">=":
      return after === ">";
    case "!=":
      return after === "==";
    default:
      return false;
  }
}

/** True when the numeric threshold moved so the guard rejects fewer values. */
export function isWeakerGuardThreshold(
  operator: ComparisonOperator,
  before: number,
  after: number,
): boolean {
  if (operator === ">" || operator === ">=") return after > before;
  if (operator === "<" || operator === "<=") return after < before;
  return false;
}

function operandsMatch(left: string, right: string): boolean {
  const normalise = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  if (normalise(left) === normalise(right)) return true;
  const leftTail = normalise(left).split(".").pop() ?? "";
  const rightTail = normalise(right).split(".").pop() ?? "";
  return leftTail.length > 2 && leftTail === rightTail;
}

/* -------------------------------------------------------------------------- */
/* Context extraction                                                          */
/* -------------------------------------------------------------------------- */

export function buildContext(
  hunk: Hunk,
  target: DiffLine,
  radius = 2,
): EvidenceLine[] {
  const index = hunk.lines.indexOf(target);
  if (index === -1) {
    return [
      {
        kind: target.kind,
        oldLine: target.oldLine,
        newLine: target.newLine,
        content: target.content,
      },
    ];
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(hunk.lines.length, index + radius + 1);
  return hunk.lines.slice(start, end).map((line) => ({
    kind: line.kind,
    oldLine: line.oldLine,
    newLine: line.newLine,
    content: line.content,
  }));
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

export const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    id: "PG-001",
    title: "Validation or guard removed",
    category: "validation",
    severity: "medium",
    description:
      "A deleted line rejected invalid input, asserted a precondition or returned an error for a failing check.",
  },
  {
    id: "PG-002",
    title: "Authorization condition removed",
    category: "authorization",
    severity: "high",
    description:
      "A deleted line enforced a role, permission, ownership or tenant restriction.",
  },
  {
    id: "PG-003",
    title: "Money or eligibility threshold removed",
    category: "money",
    severity: "high",
    description:
      "A deleted line compared an amount, rate, balance, income or eligibility limit, or removed the rounding of a monetary value.",
  },
  {
    id: "PG-004",
    title: "Comparison boundary weakened",
    category: "money",
    severity: "high",
    description:
      "A comparison boundary moved so that fewer values satisfy the check, for example `>=` becoming `>` or a money threshold moving outward.",
  },
  {
    id: "PG-005",
    title: "No test change accompanies the source change",
    category: "testing",
    severity: "low",
    description:
      "A source file changed but no test file in the diff plausibly covers it, so the behaviour change is unverified.",
  },
];

export const RULES_BY_ID: Record<string, RuleDefinition> = Object.fromEntries(
  RULE_DEFINITIONS.map((rule) => [rule.id, rule]),
);

type DeletionOwner = "PG-001" | "PG-002" | "PG-003";

function removesMonetaryRounding(text: string): boolean {
  if (!isMoneyText(text)) return false;
  return /\bmath\.(round|floor|ceil)\b/i.test(text) || /\btoFixed\s*\(/i.test(text);
}

/** True when the line looks like a money limit: a comparison or a rounding. */
function isMoneyRuleCandidate(text: string): boolean {
  return isMoneyText(text) && (extractComparisons(text).length > 0 || removesMonetaryRounding(text));
}

/**
 * A contiguous run of deleted lines is one unit of evidence. When more than
 * one rule matches lines inside that run, the first matching line decides the
 * owner with a fixed precedence — validation, then authorization, then money.
 *
 * This keeps overlap deterministic: one removed block produces one finding.
 * Separate blocks, separated by context lines, stay separate findings.
 */
function deletionRunOwnership(
  hunk: Hunk,
  line: DiffLine,
): { owner: DeletionOwner | null; anchor: DiffLine | null } {
  const index = hunk.lines.indexOf(line);
  if (index === -1) return { owner: null, anchor: null };

  let start = index;
  while (start > 0 && hunk.lines[start - 1].kind === "deletion") start -= 1;

  for (let cursor = start; cursor < hunk.lines.length; cursor += 1) {
    const candidate = hunk.lines[cursor];
    if (candidate.kind !== "deletion") break;
    const text = candidate.content;
    if (looksLikeValidation(text)) return { owner: "PG-001", anchor: candidate };
    if (isAuthorizationText(text)) return { owner: "PG-002", anchor: candidate };
    if (isMoneyRuleCandidate(text)) return { owner: "PG-003", anchor: candidate };
  }

  return { owner: null, anchor: null };
}

/** True when this line is the anchor that owns its removed block. */
function ownsDeletionRun(hunk: Hunk, line: DiffLine, owner: DeletionOwner): boolean {
  const result = deletionRunOwnership(hunk, line);
  return result.owner === owner && result.anchor === line;
}

/** True when the hunk replaces the comparison on the same operand. */
function hasReplacementComparison(hunk: Hunk, deleted: DiffLine): boolean {
  const before = extractComparisons(deleted.content);
  if (before.length === 0) return false;
  return hunk.lines.some(
    (line) =>
      line.kind === "addition" &&
      extractComparisons(line.content).some((after) =>
        before.some((old) => operandsMatch(old.left, after.left)),
      ),
  );
}

function rule001Matches(file: FileChange, hunk: Hunk): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const line of hunk.lines) {
    if (line.kind !== "deletion") continue;
    const text = line.content;
    if (!looksLikeValidation(text)) continue;
    // A removed block is owned by exactly one rule; validation wins overlaps.
    if (!ownsDeletionRun(hunk, line, "PG-001")) continue;

    const moneyRelated = isMoneyText(text) || isMoneyPath(file.path);
    const severity: Severity = moneyRelated ? "high" : "medium";
    const target = line;

    matches.push({
      ruleId: "PG-001",
      file: file.path,
      side: "old",
      line: line.oldLine,
      hunk: hunk.header,
      evidence: text,
      context: buildContext(hunk, target),
      severity,
      explanation: `The diff deletes a line that rejects invalid input ("${text.trim()}"). Removing it can widen what the code accepts, so the previous behaviour is no longer enforced by this change.`,
      suggestedTest: `Add a test that feeds the input this check used to reject and asserts the function still refuses it (for example an input of 0, null or an out-of-range value) and asserts the original error path is taken.`,
    });
  }

  return matches;
}

function rule002Matches(file: FileChange, hunk: Hunk): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const line of hunk.lines) {
    if (line.kind !== "deletion") continue;
    const text = line.content;
    if (!isAuthorizationText(text)) continue;
    if (!GUARD_CONTEXT.test(text) && !/\bthrow\b/i.test(text)) continue;
    if (!ownsDeletionRun(hunk, line, "PG-002")) continue;

    matches.push({
      ruleId: "PG-002",
      file: file.path,
      side: "old",
      line: line.oldLine,
      hunk: hunk.header,
      evidence: text,
      context: buildContext(hunk, line),
      severity: "high",
      explanation: `The diff deletes a line that enforced an access control condition ("${text.trim()}"). Authorization rules that disappear from a diff are not enforced by the new code, which can widen who may perform the operation.`,
      suggestedTest: `Add a test that calls this code path as a user without the required role or permission and asserts the request is rejected, plus a test that a permitted user still succeeds.`,
    });
  }

  return matches;
}

function rule003Matches(file: FileChange, hunk: Hunk): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const line of hunk.lines) {
    if (line.kind !== "deletion") continue;
    const text = line.content;
    if (!isMoneyText(text) && !isMoneyPath(file.path)) continue;
    // Authorization checks are reported by PG-002.
    if (isAuthorizationText(text)) continue;

    const comparisons = extractComparisons(text);
    const removesRounding = /\bmath\.(round|floor|ceil)\b/i.test(text) || /\btoFixed\s*\(/i.test(text);
    if (comparisons.length === 0 && !removesRounding) continue;
    if (!ownsDeletionRun(hunk, line, "PG-003")) continue;
    if (comparisons.length > 0 && hasReplacementComparison(hunk, line)) continue;

    const reason = removesRounding
      ? "the rounding applied to a monetary value"
      : `the comparison "${text.trim()}"`;

    matches.push({
      ruleId: "PG-003",
      file: file.path,
      side: "old",
      line: line.oldLine,
      hunk: hunk.header,
      evidence: text,
      context: buildContext(hunk, line),
      severity: "high",
      explanation: `The diff deletes ${reason}, which is a limit on a money or eligibility value. Without it, values outside the previous limit are no longer rejected.`,
      suggestedTest: `Add a boundary test for this limit: one value just inside the previous limit must still be accepted and one value just outside it must be rejected, asserting the amount stays within the documented range.`,
    });
  }

  return matches;
}

function rule004Matches(file: FileChange, hunk: Hunk): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const deletions = hunk.lines.filter((line) => line.kind === "deletion");
  const additions = hunk.lines.filter((line) => line.kind === "addition");

  for (const deleted of deletions) {
    if (isAuthorizationText(deleted.content)) continue;
    const before = extractComparisons(deleted.content);
    if (before.length === 0) continue;

    for (const added of additions) {
      if (isAuthorizationText(added.content)) continue;
      const after = extractComparisons(added.content);
      if (after.length === 0) continue;

      for (const oldComparison of before) {
        for (const newComparison of after) {
          if (!operandsMatch(oldComparison.left, newComparison.left)) continue;

          const operatorWeakened = isWeakerGuardOperator(
            oldComparison.operator,
            newComparison.operator,
          );
          const thresholdWeakened =
            !operatorWeakened &&
            oldComparison.rightNumber !== null &&
            newComparison.rightNumber !== null &&
            isWeakerGuardThreshold(
              oldComparison.operator,
              oldComparison.rightNumber,
              newComparison.rightNumber,
            );

          if (!operatorWeakened && !thresholdWeakened) continue;

          const moneyRelated = isMoneyText(deleted.content) || isMoneyPath(file.path);
          const detail = operatorWeakened
            ? `\`${oldComparison.operator}\` became \`${newComparison.operator}\`, moving the boundary so fewer values satisfy the check`
            : `the threshold moved from ${oldComparison.right} to ${newComparison.right}, so fewer values satisfy the check`;

          matches.push({
            ruleId: "PG-004",
            file: file.path,
            side: "new",
            line: added.newLine,
            hunk: hunk.header,
            evidence: added.content,
            context: buildContext(hunk, added),
            severity: moneyRelated ? "high" : "medium",
            explanation: `On \`${oldComparison.left}\`, ${detail}. Add a boundary test at the old edge before accepting this change.`,
            suggestedTest: `Add a boundary test for \`${oldComparison.left}\` at the exact value the previous comparison rejected and assert the intended outcome, then add the adjacent value that should pass.`,
          });
        }
      }
    }
  }

  return matches;
}

function rule005Matches(files: FileChange[]): RuleMatch[] {
  const changedTestFiles = files.filter((file) => file.isTest);
  const sourceFiles = files.filter(
    (file) => !file.isTest && file.changeType !== "deleted" && file.hunks.length > 0,
  );

  if (sourceFiles.length === 0) return [];

  const matches: RuleMatch[] = [];

  for (const file of sourceFiles) {
    const covered = changedTestFiles.some((testFile) =>
      isPlausibleTestFor(testFile.path, file.path),
    );
    if (covered) continue;

    const sharedContext = changedTestFiles.length > 0
      ? "Test files were changed in this diff, but none of them is paired with this file."
      : "No test file was changed in this diff at all.";

    matches.push({
      ruleId: "PG-005",
      file: file.path,
      side: "new",
      line: null,
      hunk: null,
      evidence: `${file.path} (${file.additions} added, ${file.deletions} deleted)`,
      explanation: `\`${file.path}\` changed behaviour, but ${sharedContext} The new behaviour therefore has no test evidence in this diff, which does not mean it is wrong — it means this diff does not show it being checked.`,
      suggestedTest: `Add or update a test for \`${file.path}\` that asserts the specific behaviour the diff changes, including the previous rejection case that is no longer covered.`,
    });
  }

  return matches;
}

/**
 * Heuristic pairing between a changed source file and a changed test file.
 * A test file is considered related when it lives in the same directory or in a
 * `__tests__`/`tests` folder and shares the source base name.
 */
export function isPlausibleTestFor(testPath: string, sourcePath: string): boolean {
  if (!isTestPath(testPath)) return false;

  const normalise = (value: string) => value.replace(/\\/g, "/");
  const test = normalise(testPath);
  const source = normalise(sourcePath);

  const baseName = (value: string) => {
    const file = value.split("/").pop() ?? value;
    return file.replace(/\.(test|spec)\.[a-z0-9]+$/i, "").replace(/\.[a-z0-9]+$/i, "");
  };

  if (baseName(test) !== baseName(source)) return false;

  const sourceDir = source.split("/").slice(0, -1).join("/");
  const testDir = test.split("/").slice(0, -1).join("/");

  if (testDir === sourceDir) return true;

  const siblingTestsDir = /(^|\/)(__tests__|tests?)$/;
  if (siblingTestsDir.test(testDir)) {
    const parentDir = testDir.replace(/\/?(__tests__|tests?)$/, "");
    if (parentDir === sourceDir) return true;
  }

  return false;
}

/**
 * Runs every rule against a parsed diff.
 */
export function runRules(files: FileChange[]): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      matches.push(...rule001Matches(file, hunk));
      matches.push(...rule002Matches(file, hunk));
      matches.push(...rule003Matches(file, hunk));
      matches.push(...rule004Matches(file, hunk));
    }
  }

  matches.push(...rule005Matches(files));

  return dedupe(matches);
}

function dedupe(matches: RuleMatch[]): RuleMatch[] {
  const seen = new Set<string>();
  const result: RuleMatch[] = [];
  for (const match of matches) {
    const key = `${match.ruleId}|${match.file}|${match.side}|${match.line ?? "file"}|${match.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

/** Builds the public `Finding` shape from raw rule matches. */
export function toFindings(matches: RuleMatch[]): Finding[] {
  return matches.map((match, index) => {
    const rule = RULES_BY_ID[match.ruleId] ?? RULES_BY_ID["PG-001"];
    return {
      id: `${rule.id}-${slug(match.file)}-${match.line ?? "file"}-${index}`,
      ruleId: rule.id,
      ruleTitle: rule.title,
      classification: HEURISTIC_LABEL,
      severity: match.severity ?? rule.severity,
      category: rule.category,
      file: match.file,
      line: match.line,
      side: match.side,
      hunk: match.hunk,
      evidence: match.evidence,
      context: match.context ?? [],
      explanation: match.explanation,
      suggestedTest: match.suggestedTest,
    };
  });
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
