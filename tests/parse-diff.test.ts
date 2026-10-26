import { describe, expect, it } from "vitest";

import {
  DiffParseError,
  MAX_DIFF_BYTES,
  parseUnifiedDiff,
  validateDiffInput,
} from "../src/lib/engine/parse-diff";
import { makeDiff } from "./fixtures";

function captureError(action: () => unknown): DiffParseError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DiffParseError);
    return error as DiffParseError;
  }
  throw new Error("Expected a DiffParseError, but no error was thrown.");
}

describe("parseUnifiedDiff", () => {
  it("parses file paths, stats and change types across files", () => {
    const diff =
      makeDiff("src/a.ts", [
        " const a = 1;",
        "-const old = 2;",
        "+const next = 3;",
        " const b = 4;",
      ]) +
      makeDiff("src/b.ts", [
        " export const b = 1;",
        "+export const c = 2;",
      ]);

    const parsed = parseUnifiedDiff(diff);

    expect(parsed.stats).toEqual({
      files: 2,
      hunks: 2,
      additions: 2,
      deletions: 1,
    });
    expect(parsed.files.map((file) => file.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(parsed.files[0].changeType).toBe("modified");
    expect(parsed.files[0].oldPath).toBe("src/a.ts");
    expect(parsed.files[0].newPath).toBe("src/a.ts");
  });

  it("maps additions, deletions and context to the correct old and new lines", () => {
    const parsed = parseUnifiedDiff(
      makeDiff(
        "src/map.ts",
        [" context before", "-removed", "+added", " context after"],
        { oldStart: 10, newStart: 20 },
      ),
    );

    const lines = parsed.files[0].hunks[0].lines;
    expect(lines).toHaveLength(4);

    expect(lines[0]).toMatchObject({
      kind: "context",
      content: "context before",
      oldLine: 10,
      newLine: 20,
    });
    expect(lines[1]).toMatchObject({
      kind: "deletion",
      content: "removed",
      oldLine: 11,
      newLine: null,
    });
    expect(lines[2]).toMatchObject({
      kind: "addition",
      content: "added",
      oldLine: null,
      newLine: 21,
    });
    expect(lines[3]).toMatchObject({
      kind: "context",
      content: "context after",
      oldLine: 12,
      newLine: 22,
    });
  });

  it("maps line numbers independently across multiple hunks", () => {
    const diff = [
      "diff --git a/src/multi.ts b/src/multi.ts",
      "index 1111111..2222222 100644",
      "--- a/src/multi.ts",
      "+++ b/src/multi.ts",
      "@@ -1,3 +1,4 @@",
      " const first = 1;",
      "+const inserted = 2;",
      " const second = 3;",
      " const third = 4;",
      "@@ -10,2 +11,2 @@",
      "-const oldTail = 10;",
      "+const newTail = 10;",
      "",
    ].join("\n");

    const parsed = parseUnifiedDiff(diff);
    const [firstHunk, secondHunk] = parsed.files[0].hunks;

    expect(firstHunk.lines[1]).toMatchObject({ kind: "addition", newLine: 2 });
    expect(secondHunk.oldStart).toBe(10);
    expect(secondHunk.newStart).toBe(11);
    expect(secondHunk.lines[0]).toMatchObject({
      kind: "deletion",
      oldLine: 10,
      newLine: null,
    });
    expect(secondHunk.lines[1]).toMatchObject({
      kind: "addition",
      oldLine: null,
      newLine: 11,
    });
  });

  it("detects a newly added file from /dev/null", () => {
    const parsed = parseUnifiedDiff(
      makeDiff(
        "src/new.ts",
        ["+export const a = 1;", "+export const b = 2;"],
        { oldStart: 0, headerOldPath: "/dev/null" },
      ),
    );

    expect(parsed.files[0]).toMatchObject({
      changeType: "added",
      oldPath: null,
      newPath: "src/new.ts",
      additions: 2,
      deletions: 0,
    });
    expect(parsed.files[0].hunks[0].newStart).toBe(1);
  });

  it("detects a deleted file from /dev/null", () => {
    const parsed = parseUnifiedDiff(
      makeDiff("src/old.ts", ["-export const a = 1;"], {
        headerNewPath: "/dev/null",
      }),
    );

    expect(parsed.files[0]).toMatchObject({
      changeType: "deleted",
      oldPath: "src/old.ts",
      newPath: null,
      additions: 0,
      deletions: 1,
    });
  });

  it("detects renames even without hunks", () => {
    const diff = [
      "diff --git a/src/old-name.ts b/src/new-name.ts",
      "similarity index 100%",
      "rename from src/old-name.ts",
      "rename to src/new-name.ts",
      "",
    ].join("\n");

    const parsed = parseUnifiedDiff(diff);
    expect(parsed.files[0].changeType).toBe("renamed");
    expect(parsed.files[0].path).toBe("src/new-name.ts");
  });

  it("accepts CRLF input", () => {
    const diff = makeDiff("src/crlf.ts", [
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
    ]).replace(/\n/g, "\r\n");

    const parsed = parseUnifiedDiff(diff);
    expect(parsed.stats.deletions).toBe(1);
    expect(parsed.stats.additions).toBe(1);
  });

  it("treats an empty hunk line as empty context", () => {
    const parsed = parseUnifiedDiff(
      makeDiff("src/blank.ts", [" const a = 1;", "", " const b = 2;"]),
    );
    expect(parsed.files[0].hunks[0].lines[1]).toMatchObject({
      kind: "context",
      content: "",
      oldLine: 2,
      newLine: 2,
    });
  });

  it("accepts a diff well below the size limit", () => {
    const body = Array.from({ length: 1500 }, (_, index) => `+const value${index} = ${index};`);
    const parsed = parseUnifiedDiff(
      makeDiff("src/large.ts", body, { oldStart: 0, headerOldPath: "/dev/null" }),
    );
    expect(parsed.files[0].additions).toBe(1500);
  });

  it("rejects empty input", () => {
    expect(captureError(() => parseUnifiedDiff("   \n  ")).code).toBe("EMPTY_INPUT");
    expect(captureError(() => parseUnifiedDiff("")).code).toBe("EMPTY_INPUT");
  });

  it("rejects input over 200 KB", () => {
    const oversized = "x".repeat(MAX_DIFF_BYTES + 1);
    const error = captureError(() => validateDiffInput(oversized));
    expect(error.code).toBe("DIFF_TOO_LARGE");
    expect(error.message).toContain("200.0 KB");
  });

  it("rejects NUL bytes as binary input", () => {
    const error = captureError(() =>
      validateDiffInput("diff --git a/a.ts b/a.ts\n\u0000"),
    );
    expect(error.code).toBe("BINARY_INPUT");
  });

  it("rejects a GIT binary patch", () => {
    const diff = [
      "diff --git a/public/logo.png b/public/logo.png",
      "new file mode 100644",
      "index 0000000..1111111",
      "GIT binary patch",
      "literal 3",
      "",
    ].join("\n");

    expect(captureError(() => parseUnifiedDiff(diff)).code).toBe(
      "BINARY_DIFF_UNSUPPORTED",
    );
  });

  it("rejects a Binary files marker", () => {
    const diff = [
      "diff --git a/public/logo.png b/public/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/public/logo.png and b/public/logo.png differ",
      "",
    ].join("\n");

    expect(captureError(() => parseUnifiedDiff(diff)).code).toBe(
      "BINARY_DIFF_UNSUPPORTED",
    );
  });

  it("rejects a hunk whose body is shorter than its header", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,5 +1,5 @@",
      " const only = 1;",
      "",
    ].join("\n");

    expect(captureError(() => parseUnifiedDiff(diff)).code).toBe("MALFORMED_DIFF");
  });

  it("rejects a hunk whose body is longer than its header", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      " const first = 1;",
      " const second = 2;",
      "",
    ].join("\n");

    expect(captureError(() => parseUnifiedDiff(diff)).code).toBe("MALFORMED_DIFF");
  });

  it("rejects an unrecognised hunk line", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "?not a diff line",
      "",
    ].join("\n");

    expect(captureError(() => parseUnifiedDiff(diff)).code).toBe("MALFORMED_DIFF");
  });

  it("rejects a diff with a commit message preamble", () => {
    const diff = [
      "commit 1234567890abcdef",
      "Author: Example <example@example.com>",
      "",
      makeDiff("src/a.ts", [" const a = 1;"]),
    ].join("\n");

    const error = captureError(() => parseUnifiedDiff(diff));
    expect(error.code).toBe("PREAMBLE_UNSUPPORTED");
    expect(error.line).toBe(1);
  });

  it("rejects a combined diff header", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@@ -1,2 -1,2 +1,2 @@@",
      "",
    ].join("\n");

    expect(captureError(() => parseUnifiedDiff(diff)).code).toBe(
      "UNSUPPORTED_DIFF_FORMAT",
    );
  });

  it("marks test paths using common conventions", () => {
    const parsed = parseUnifiedDiff(
      makeDiff("src/__tests__/loan.test.ts", ["-old", "+new"]),
    );
    expect(parsed.files[0].isTest).toBe(true);
  });
});