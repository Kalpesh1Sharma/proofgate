/** Builds valid unified diffs for tests so hunk counts are never hand-written. */

export interface DiffOptions {
  oldStart?: number;
  newStart?: number;
  section?: string;
  /** Override the `---` header path, e.g. `/dev/null` for a new file. */
  headerOldPath?: string;
  /** Override the `+++` header path, e.g. `/dev/null` for a deleted file. */
  headerNewPath?: string;
}

export function makeHunk(
  lines: string[],
  oldStart = 1,
  newStart = 1,
  section = "",
): string {
  const oldLines = lines.filter((line) => !line.startsWith("+")).length;
  const newLines = lines.filter((line) => !line.startsWith("-")).length;
  const suffix = section.length > 0 ? ` ${section}` : "";
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${suffix}\n${lines.join("\n")}`;
}

export function makeDiff(
  path: string,
  lines: string[],
  options: DiffOptions = {},
): string {
  const {
    oldStart = 1,
    newStart = 1,
    section = "",
    headerOldPath = path,
    headerNewPath = path,
  } = options;

  const oldHeader =
    headerOldPath === "/dev/null" ? "/dev/null" : `a/${headerOldPath}`;
  const newHeader =
    headerNewPath === "/dev/null" ? "/dev/null" : `b/${headerNewPath}`;

  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- ${oldHeader}`,
    `+++ ${newHeader}`,
    makeHunk(lines, oldStart, newStart, section),
    "",
  ].join("\n");
}