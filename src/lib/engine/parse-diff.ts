/**
 * Strict unified-diff parser.
 *
 * The parser is intentionally conservative: anything it cannot map to a real
 * unified diff is rejected with a typed error instead of being guessed at.
 * It never evaluates, imports or executes the content it reads.
 */

import type {
  ChangeType,
  DiffLine,
  FileChange,
  Hunk,
  ParsedDiff,
} from "./types";

/** Maximum accepted diff size: 200 KB. */
export const MAX_DIFF_BYTES = 200 * 1024;

/** Guard rails so a hostile paste cannot turn into unbounded work. */
export const MAX_DIFF_FILES = 500;
export const MAX_DIFF_HUNKS = 5000;

export type DiffErrorCode =
  | "EMPTY_INPUT"
  | "DIFF_TOO_LARGE"
  | "BINARY_INPUT"
  | "BINARY_DIFF_UNSUPPORTED"
  | "MALFORMED_DIFF"
  | "UNSUPPORTED_DIFF_FORMAT"
  | "PREAMBLE_UNSUPPORTED"
  | "DIFF_TOO_COMPLEX";

export class DiffParseError extends Error {
  readonly code: DiffErrorCode;
  /** 1-based line number in the pasted diff, when known. */
  readonly line: number | null;
  /** Actionable hint for the developer. */
  readonly hint: string;

  constructor(
    code: DiffErrorCode,
    message: string,
    options: { line?: number | null; hint?: string } = {},
  ) {
    super(message);
    this.name = "DiffParseError";
    this.code = code;
    this.line = options.line ?? null;
    this.hint =
      options.hint ??
      "Provide the output of `git diff` (or `git diff --no-color HEAD`).";
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Rejects input that is empty, oversized or binary before any parsing work.
 */
export function validateDiffInput(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new DiffParseError("MALFORMED_DIFF", "The diff must be provided as text.", {
      hint: "Paste the raw output of `git diff` into the diff box.",
    });
  }

  if (raw.trim().length === 0) {
    throw new DiffParseError("EMPTY_INPUT", "The diff is empty.", {
      hint: "Paste a unified diff, or load the bundled example to see ProofGate in action.",
    });
  }

  if (byteLength(raw) > MAX_DIFF_BYTES) {
    throw new DiffParseError(
      "DIFF_TOO_LARGE",
      `The diff is ${formatBytes(byteLength(raw))}; the limit is ${formatBytes(MAX_DIFF_BYTES)}.`,
      {
        hint: "Split the change into smaller diffs, or narrow the diff to the files you want reviewed.",
      },
    );
  }

  if (raw.includes("\u0000")) {
    throw new DiffParseError(
      "BINARY_INPUT",
      "The pasted diff contains NUL bytes, so it is treated as binary data.",
      { hint: "ProofGate only analyses text diffs. Re-generate the diff with `git diff --text` if the file is text." },
    );
  }

  if (/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(raw)) {
    throw new DiffParseError(
      "BINARY_INPUT",
      "The pasted diff contains control characters, so it is treated as binary data.",
      { hint: "ProofGate only analyses text diffs." },
    );
  }

  return raw;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Decodes a git style C-quoted path, e.g. `"src/caf\303\251.ts"`. */
function decodeQuotedPath(value: string): string {
  const body = value.slice(1, -1);
  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = body[index + 1];
    index += 1;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "v":
        out += "\v";
        break;
      case "a":
        out += "\u0007";
        break;
      case '"':
      case "\\":
        out += next;
        break;
      case undefined:
        out += "\\";
        break;
      default:
        if (/[0-7]/.test(next)) {
          const octal = body.slice(index, index + 3);
          if (/^[0-7]{1,3}$/.test(octal)) {
            out += String.fromCharCode(parseInt(octal, 8));
            index += 2;
            break;
          }
        }
        out += next;
    }
  }
  return out;
}

/** Strips git's `a/` and `b/` prefixes and any quoting. */
function normalisePath(value: string): string {
  let path = value.trim();
  if (path.startsWith('"') && path.endsWith('"') && path.length > 1) {
    path = decodeQuotedPath(path);
  }
  if (path === "/dev/null") return path;
  if (path.startsWith("a/") || path.startsWith("b/")) {
    path = path.slice(2);
  }
  return path;
}

/**
 * Extracts both paths from a `diff --git a/x b/y` line.
 * Paths may contain spaces, so quoted pairs are handled first.
 */
function parseDiffGitPaths(rest: string): { oldPath: string; newPath: string } | null {
  const trimmed = rest.trim();

  if (trimmed.startsWith('"')) {
    // `"a/path" "b/path"` — both sides quoted.
    const match = /^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
    if (match) {
      return {
        oldPath: normalisePath(`"${match[1]}"`),
        newPath: normalisePath(`"${match[2]}"`),
      };
    }
    return null;
  }

  // Unquoted: find the ` b/` separator that leaves a `b/` suffix.
  let searchFrom = 0;
  while (searchFrom < trimmed.length) {
    const index = trimmed.indexOf(" b/", searchFrom);
    if (index === -1) break;
    const left = trimmed.slice(0, index);
    const right = trimmed.slice(index + 1);
    if (left.startsWith("a/") && right.startsWith("b/")) {
      return { oldPath: normalisePath(left), newPath: normalisePath(right) };
    }
    searchFrom = index + 1;
  }

  return null;
}

const TEST_PATH_PATTERNS = [
  /(^|\/)__tests__\//i,
  /(^|\/)tests?\//i,
  /(^|\/)spec\//i,
  /\.test\.[a-z0-9]+$/i,
  /\.spec\.[a-z0-9]+$/i,
  /_test\.[a-z0-9]+$/i,
];

export function isTestPath(path: string): boolean {
  const normalised = path.replace(/\\/g, "/");
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(normalised));
}

interface FileAccumulator {
  oldPath: string | null;
  newPath: string | null;
  headerOldPath: string | null;
  headerNewPath: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  isNewFile: boolean;
  isDeletedFile: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

function newAccumulator(): FileAccumulator {
  return {
    oldPath: null,
    newPath: null,
    headerOldPath: null,
    headerNewPath: null,
    renameFrom: null,
    renameTo: null,
    isNewFile: false,
    isDeletedFile: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

function finaliseFile(accumulator: FileAccumulator): FileChange {
  const oldPath = accumulator.headerOldPath ?? accumulator.oldPath;
  const newPath = accumulator.headerNewPath ?? accumulator.newPath;

  let changeType: ChangeType = "modified";
  if (accumulator.isNewFile || oldPath === null) changeType = "added";
  else if (accumulator.isDeletedFile || newPath === null) changeType = "deleted";
  else if (
    accumulator.renameFrom &&
    accumulator.renameTo &&
    accumulator.renameFrom !== accumulator.renameTo
  ) {
    changeType = "renamed";
  }

  const path = newPath ?? oldPath ?? "(unknown file)";

  return {
    oldPath: changeType === "added" ? null : (oldPath ?? null),
    newPath: changeType === "deleted" ? null : (newPath ?? null),
    path,
    changeType,
    hunks: accumulator.hunks,
    additions: accumulator.additions,
    deletions: accumulator.deletions,
    isTest: isTestPath(path),
  };
}

function splitLines(raw: string): string[] {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Parses a unified git diff.
 *
 * @throws {DiffParseError} when the input is empty, oversized, binary or not a
 * well formed unified diff.
 */
export function parseUnifiedDiff(rawInput: string): ParsedDiff {
  const raw = validateDiffInput(rawInput);
  const lines = splitLines(raw);

  const files: FileChange[] = [];
  let accumulator: FileAccumulator | null = null;
  let hunkCount = 0;
  let index = 0;

  const commitCurrentFile = () => {
    if (!accumulator) return;
    files.push(finaliseFile(accumulator));
    if (files.length > MAX_DIFF_FILES) {
      throw new DiffParseError(
        "DIFF_TOO_COMPLEX",
        `The diff contains more than ${MAX_DIFF_FILES} files.`,
        { hint: "Review the change in smaller batches." },
      );
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (line.startsWith("diff --git ")) {
      const paths = parseDiffGitPaths(line.slice("diff --git ".length));
      commitCurrentFile();
      const next = newAccumulator();
      next.oldPath = paths?.oldPath ?? null;
      next.newPath = paths?.newPath ?? null;
      accumulator = next;
      index += 1;
      continue;
    }

    if (!accumulator) {
      if (line.trim().length === 0) {
        index += 1;
        continue;
      }
      throw new DiffParseError(
        "PREAMBLE_UNSUPPORTED",
        "Expected a `diff --git` header but found other content.",
        {
          line: lineNumber,
          hint: "Remove any commit message or commentary above the diff, or paste the output of `git diff` only.",
        },
      );
    }

    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      throw new DiffParseError(
        "BINARY_DIFF_UNSUPPORTED",
        "The diff contains a binary file, which ProofGate does not analyse.",
        {
          line: lineNumber,
          hint: "Remove the binary file from the diff, or review it separately. ProofGate only handles text diffs.",
        },
      );
    }

    if (line.startsWith("--- ")) {
      const value = normalisePath(line.slice(4));
      accumulator.headerOldPath = value === "/dev/null" ? null : value;
      if (value === "/dev/null") accumulator.isNewFile = true;
      index += 1;
      continue;
    }

    if (line.startsWith("+++ ")) {
      const value = normalisePath(line.slice(4));
      accumulator.headerNewPath = value === "/dev/null" ? null : value;
      if (value === "/dev/null") accumulator.isDeletedFile = true;
      index += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      const match = HUNK_HEADER.exec(line);
      if (!match) {
        throw new DiffParseError(
          "UNSUPPORTED_DIFF_FORMAT",
          "Unsupported hunk header. Combined diffs (`@@@`) are not supported.",
          {
            line: lineNumber,
            hint: "ProofGate analyses standard two-way unified diffs. Re-generate the diff with `git diff`.",
          },
        );
      }

      hunkCount += 1;
      if (hunkCount > MAX_DIFF_HUNKS) {
        throw new DiffParseError(
          "DIFF_TOO_COMPLEX",
          `The diff contains more than ${MAX_DIFF_HUNKS} hunks.`,
          { hint: "Review the change in smaller batches." },
        );
      }

      const oldStart = Number(match[1]);
      const oldLines = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newLines = match[4] === undefined ? 1 : Number(match[4]);
      const section = (match[5] ?? "").trim();

      const hunk: Hunk = {
        header: line,
        oldStart,
        oldLines,
        newStart,
        newLines,
        section,
        lines: [],
        noNewlineAtEof: false,
      };

      let oldRemaining = oldLines;
      let newRemaining = newLines;
      let oldCursor = oldStart;
      let newCursor = newStart;

      index += 1;

      while (oldRemaining > 0 || newRemaining > 0) {
        if (index >= lines.length) {
          throw new DiffParseError(
            "MALFORMED_DIFF",
            "The diff ended in the middle of a hunk.",
            {
              line: lineNumber,
              hint: "The hunk body does not contain the number of lines its header announces. Re-copy the diff.",
            },
          );
        }

        const body = lines[index];
        if (body.startsWith("\\")) {
          hunk.noNewlineAtEof = true;
          index += 1;
          continue;
        }
        if (body.startsWith("diff --git ") || body.startsWith("@@")) {
          throw new DiffParseError(
            "MALFORMED_DIFF",
            "A hunk ended before the number of lines its header announces.",
            {
              line: index + 1,
              hint: "The hunk body does not contain the number of lines its header announces. Re-copy the diff.",
            },
          );
        }

        const marker = body.length === 0 ? " " : body[0];
        const content = body.length === 0 ? "" : body.slice(1);

        const diffLine: DiffLine = {
          kind: "context",
          content,
          oldLine: null,
          newLine: null,
        };

        if (marker === " ") {
          if (oldRemaining === 0 || newRemaining === 0) {
            throw new DiffParseError(
              "MALFORMED_DIFF",
              "A hunk contains more lines than its header announces.",
              {
                line: index + 1,
                hint: "The hunk body does not match the line counts in its `@@` header. Re-copy the diff.",
              },
            );
          }
          diffLine.kind = "context";
          diffLine.oldLine = oldCursor;
          diffLine.newLine = newCursor;
          oldCursor += 1;
          newCursor += 1;
          oldRemaining -= 1;
          newRemaining -= 1;
        } else if (marker === "+") {
          if (newRemaining === 0) {
            throw new DiffParseError(
              "MALFORMED_DIFF",
              "A hunk contains more lines than its header announces.",
              {
                line: index + 1,
                hint: "The hunk body does not match the line counts in its `@@` header. Re-copy the diff.",
              },
            );
          }
          diffLine.kind = "addition";
          diffLine.newLine = newCursor;
          newCursor += 1;
          newRemaining -= 1;
          accumulator.additions += 1;
        } else if (marker === "-") {
          if (oldRemaining === 0) {
            throw new DiffParseError(
              "MALFORMED_DIFF",
              "A hunk contains more lines than its header announces.",
              {
                line: index + 1,
                hint: "The hunk body does not match the line counts in its `@@` header. Re-copy the diff.",
              },
            );
          }
          diffLine.kind = "deletion";
          diffLine.oldLine = oldCursor;
          oldCursor += 1;
          oldRemaining -= 1;
          accumulator.deletions += 1;
        } else {
          throw new DiffParseError(
            "MALFORMED_DIFF",
            "Unrecognised line inside a hunk.",
            {
              line: index + 1,
              hint: "Diff lines must start with a space, `+` or `-`. Re-copy the diff.",
            },
          );
        }

        hunk.lines.push(diffLine);
        index += 1;
      }

      accumulator.hunks.push(hunk);
      continue;
    }

    // Metadata lines that carry no line content.
    if (line.startsWith("new file mode")) accumulator.isNewFile = true;
    else if (line.startsWith("deleted file mode")) accumulator.isDeletedFile = true;
    else if (line.startsWith("rename from ")) accumulator.renameFrom = line.slice("rename from ".length).trim();
    else if (line.startsWith("rename to ")) accumulator.renameTo = line.slice("rename to ".length).trim();
    else if (line.startsWith("index ") || line.startsWith("similarity index ")) {
      // Metadata only, no effect on the analysis.
    } else if (line.trim().length > 0) {
      throw new DiffParseError(
        "MALFORMED_DIFF",
        "Unrecognised content outside of a hunk.",
        {
          line: lineNumber,
          hint: "ProofGate expects a standard unified diff. Re-copy the output of `git diff`.",
        },
      );
    }

    index += 1;
  }

  if (accumulator) {
    files.push(finaliseFile(accumulator));
  }

  if (files.length === 0) {
    throw new DiffParseError(
      "MALFORMED_DIFF",
      "No file changes were found in the pasted diff.",
      { hint: "Make sure the diff contains at least one `diff --git` section." },
    );
  }

  const stats = files.reduce(
    (accumulatorStats, file) => ({
      files: accumulatorStats.files + 1,
      hunks: accumulatorStats.hunks + file.hunks.length,
      additions: accumulatorStats.additions + file.additions,
      deletions: accumulatorStats.deletions + file.deletions,
    }),
    { files: 0, hunks: 0, additions: 0, deletions: 0 },
  );

  return { files, stats };
}
