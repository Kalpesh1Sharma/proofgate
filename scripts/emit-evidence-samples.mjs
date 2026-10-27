#!/usr/bin/env node
/**
 * Emits the bundled DEMO DATA evidence pair from real demo output.
 *
 * Usage:
 *   npm run verify:demo -- --keep
 *   node scripts/emit-evidence-samples.mjs --from <kept-workspace>
 *
 * The two source reports are genuine output of `npm run verify` against the
 * fixture repository. This script copies them and performs a documented
 * publication redaction:
 *
 *   - the machine-specific temp workspace path is replaced with
 *     `<demo-workspace>/shop`;
 *   - the absolute node/npm executable paths are replaced with `node` and
 *     `<npm-cli.js>`, because they reveal the author's machine layout.
 *
 * Statuses, exit codes, timestamps, durations, commit SHAs, truncation flags
 * and captured output are copied unchanged. No result is invented or altered.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(projectRoot, "src", "lib", "evidence", "samples");

const fromIndex = process.argv.indexOf("--from");
if (fromIndex === -1 || !process.argv[fromIndex + 1]) {
  process.stderr.write(
    "Usage: node scripts/emit-evidence-samples.mjs --from <kept-demo-workspace>\n",
  );
  process.exit(2);
}

const sourceDir = path.resolve(process.argv[fromIndex + 1]);

const pairs = [
  { source: "report-before-fix.json", target: "demo-before-fix.json" },
  { source: "report-after-fix.json", target: "demo-after-fix.json" },
];

function redactString(value, workspaceRoot) {
  return value
    .split(workspaceRoot)
    .join("<demo-workspace>/shop")
    .replace(/[A-Za-z]:\\[^\s"']*node\.exe/gi, "node")
    .replace(/[A-Za-z]:\\[^\s"']*npm-cli\.js/gi, "<npm-cli.js>");
}

/** Redacts machine-specific paths from every string in the document. */
function redactDeep(value, workspaceRoot) {
  if (typeof value === "string") return redactString(value, workspaceRoot);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, workspaceRoot));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = redactDeep(value[key], workspaceRoot);
    }
  }
  return value;
}

fs.mkdirSync(outputDir, { recursive: true });

for (const pair of pairs) {
  const sourcePath = path.join(sourceDir, pair.source);
  if (!fs.existsSync(sourcePath)) {
    process.stderr.write(`Missing ${sourcePath}. Run \`npm run verify:demo -- --keep\` first.\n`);
    process.exit(2);
  }

  const report = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  redactDeep(report, report.repository.root);

  for (const run of report.verified.runs) {
    run.command.executable = path.basename(run.command.executable).replace(/\.exe$/i, "");
  }

  const targetPath = path.join(outputDir, pair.target);
  fs.writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Wrote ${path.relative(projectRoot, targetPath)} (${report.verified.summary.passed} passed, ${report.verified.summary.failed} failed)\n`,
  );
}