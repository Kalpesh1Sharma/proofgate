#!/usr/bin/env node
/**
 * ProofGate verification CLI (Phase 2).
 *
 *   npm run verify -- --repo <path> --ref <git-ref> --task test,lint --approve
 *
 * Optionally attach Phase 1 heuristic findings for a diff file:
 *   ... --diff path/to/change.diff
 *
 * Security model:
 *  - the repository must exist, be a directory and be a Git work tree;
 *  - the reference is validated and resolved to a commit;
 *  - only `npm run test` and `npm run lint` can run, through a fixed allowlist;
 *  - everything is spawned with `shell: false` and an argument array;
 *  - nothing is exposed over HTTP and no diff content is executed.
 *
 * This is not a sandbox: repository scripts run with the developer's
 * permissions. Only run it on repositories you trust.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { analyzeDiff } from "../lib/engine/analyze";
import { DiffParseError, MAX_DIFF_BYTES } from "../lib/engine/parse-diff";
import {
  TASK_ALLOWLIST,
  TASK_IDS,
  buildCommandSpecs,
  parseTaskIds,
} from "../lib/verification/allowlist";
import {
  allVerifiedPassed,
  buildVerificationReport,
  buildVerificationReportText,
} from "../lib/verification/report";
import { resolveRepository } from "../lib/verification/repository";
import { runCommand } from "../lib/verification/runner";
import type {
  ApprovalRecord,
  CommandEvidence,
  HeuristicAttachment,
  VerificationTaskId,
} from "../lib/verification/types";
import { VerificationError } from "../lib/verification/types";

const HELP = `ProofGate verified commands (Phase 2)

Usage:
  npm run verify -- --repo <path> [options]

Required:
  --repo <path>        Path to a trusted local Git checkout.
  --approve            Explicitly approve running the allowlisted commands.

Options:
  --ref <git-ref>      Git reference to verify against. Default: HEAD
  --task <id,...>      Allowlisted tasks: ${TASK_IDS.join(", ")}. Default: test
  --diff <file>        Attach Phase 1 heuristic findings for a unified diff file.
  --out <file>         Write the JSON report to this file.
  --json               Print the JSON report to stdout instead of a summary.
  -h, --help           Show this help.

The allowlist is fixed in code. Arbitrary commands, shell strings and uploaded
diffs are never executed. This CLI is not a sandbox: project scripts run with
your permissions, so only use it on repositories you trust.
`;

interface CliOptions {
  repo: string | null;
  ref: string;
  tasks: VerificationTaskId[];
  approve: boolean;
  diff: string | null;
  out: string | null;
  json: boolean;
  help: boolean;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repo: null,
    ref: "HEAD",
    tasks: [],
    approve: false,
    diff: null,
    out: null,
    json: false,
    help: false,
  };
  const taskValues: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (): string => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Missing value for ${arg}.`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case "--repo":
        options.repo = takeValue();
        break;
      case "--ref":
        options.ref = takeValue();
        break;
      case "--task":
        taskValues.push(takeValue());
        break;
      case "--diff":
        options.diff = takeValue();
        break;
      case "--out":
        options.out = takeValue();
        break;
      case "--approve":
        options.approve = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new UsageError(
          `Unknown argument "${arg}". Commands cannot be passed to this CLI; only allowlisted tasks can run.`,
        );
    }
  }

  if (options.help) return options;
  if (!options.repo) throw new UsageError("--repo is required.");

  options.tasks = parseTaskIds(taskValues.length > 0 ? taskValues : ["test"]);

  return options;
}

function formatCommand(executable: string, args: string[]): string {
  const quoted = [executable, ...args].map((part) =>
    /\s/.test(part) ? JSON.stringify(part) : part,
  );
  return quoted.join(" ");
}

async function confirmApproval(
  commands: string[],
  alreadyApproved: boolean,
): Promise<ApprovalRecord["method"] | null> {
  if (!alreadyApproved) return null;
  if (!process.stdin.isTTY) return "cli-flag";

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("\nAbout to run these allowlisted commands:\n");
    for (const command of commands) process.stdout.write(`  ${command}\n`);
    process.stdout.write(
      "\nThey run with your permissions and are not sandboxed.\n",
    );
    const answer = await rl.question('Type "yes" to continue: ');
    if (answer.trim().toLowerCase() !== "yes") return null;
    return "cli-flag-and-prompt";
  } finally {
    rl.close();
  }
}

function loadHeuristicAttachment(diffPath: string | null): HeuristicAttachment {
  if (!diffPath) {
    return {
      status: "not-requested",
      note: "No diff was attached, so no heuristic code-risk findings were produced for this report.",
    };
  }

  const resolved = path.resolve(diffPath);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new VerificationError(
      "INVALID_DIFF_PATH",
      `The diff file does not exist: ${resolved}`,
      "Pass --diff with a path to a unified diff file, or omit it.",
    );
  }

  if (!stats.isFile()) {
    throw new VerificationError(
      "INVALID_DIFF_PATH",
      `The diff path is not a file: ${resolved}`,
      "Pass --diff with a path to a unified diff file.",
    );
  }

  if (stats.size > MAX_DIFF_BYTES) {
    throw new VerificationError(
      "INVALID_DIFF_PATH",
      `The diff file is larger than the ${MAX_DIFF_BYTES} byte analysis limit.`,
      "Review a smaller diff.",
    );
  }

  const diff = fs.readFileSync(resolved, "utf8");
  try {
    const analysis = analyzeDiff(diff);
    return {
      status: "included",
      classification: "HEURISTIC",
      source: "phase-1-deterministic-rules",
      diffPath: resolved,
      diffSha256: analysis.input.sha256,
      findings: analysis.findings,
      note: "Pattern matches from the diff. These are not confirmed defects and were not verified by running anything.",
    };
  } catch (error) {
    if (error instanceof DiffParseError) {
      throw new VerificationError(
        "INVALID_DIFF_PATH",
        `The attached diff could not be parsed: ${error.message}`,
        error.hint,
      );
    }
    throw error;
  }
}

function printSummary(
  report: ReturnType<typeof buildVerificationReport>,
  runs: CommandEvidence[],
): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(`ProofGate verified commands · ${report.repository.ref}`);
  lines.push(`repository  ${report.repository.root}`);
  lines.push(`commit      ${report.repository.commit}`);
  lines.push("");

  for (const run of runs) {
    const marker =
      run.status === "passed"
        ? "PASS"
        : run.status === "timed-out"
          ? "TIMEOUT"
          : run.status === "spawn-error"
            ? "ERROR"
            : "FAIL";
    lines.push(
      `[${marker}] ${run.label} (${run.taskId}) · exit ${run.exitCode ?? "n/a"} · ${run.durationMs} ms`,
    );
    lines.push(`        ${formatCommand(run.command.executable, run.command.args)}`);
    if (run.truncated) lines.push("        output truncated at the byte cap");
    if (run.status === "timed-out") {
      lines.push(`        did not finish within ${TASK_ALLOWLIST[run.taskId].timeoutMs} ms`);
    }
    if (run.status !== "passed") {
      const detail = (run.stderr || run.stdout).trim().split("\n").slice(-12).join("\n");
      if (detail) {
        for (const line of detail.split("\n")) lines.push(`        ${line}`);
      }
    }
    lines.push("");
  }

  const { summary } = report.verified;
  lines.push(
    `Verified: ${summary.passed}/${summary.total} passed · ${summary.failed} failed · ${summary.timedOut} timed out`,
  );

  if (report.heuristic.status === "included") {
    lines.push(
      `Heuristic: ${report.heuristic.findings.length} diff findings (HEURISTIC, not verified defects)`,
    );
  } else {
    lines.push("Heuristic: no diff attached, so no heuristic findings were produced");
  }

  lines.push("");
  lines.push(
    "Verified outcomes are real command results on this machine. They are not a proof of correctness, and this CLI is not a sandbox.",
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments.";
    process.stderr.write(`\n${message}\n\n${HELP}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (!options.approve) {
    process.stderr.write(
      [
        "",
        "Approval required: ProofGate will not execute repository commands without it.",
        "Re-run with --approve after you have reviewed the commands below.",
        "",
        ...options.tasks.map(
          (task) => `  npm run ${TASK_ALLOWLIST[task].script}   (${task})`,
        ),
        "",
        "This CLI is not a sandbox. Only use it on a trusted repository.",
        "",
      ].join("\n"),
    );
    return 2;
  }

  let repository;
  try {
    repository = await resolveRepository({ repoPath: options.repo!, ref: options.ref });
  } catch (error) {
    if (error instanceof VerificationError) {
      process.stderr.write(`\n${error.message}\n${error.hint}\n`);
      return 2;
    }
    throw error;
  }

  let specs;
  try {
    specs = buildCommandSpecs(options.tasks);
  } catch (error) {
    if (error instanceof VerificationError) {
      process.stderr.write(`\n${error.message}\n${error.hint}\n`);
      return 2;
    }
    throw error;
  }

  const heuristic = loadHeuristicAttachment(options.diff);

  const commands = specs.map((spec) => formatCommand(spec.executable, spec.args));
  const method = await confirmApproval(commands, options.approve);
  if (!method) {
    process.stderr.write("\nApproval declined. Nothing was executed.\n");
    return 2;
  }

  const runs: CommandEvidence[] = [];
  for (const spec of specs) {
    process.stderr.write(`Running ${spec.label.toLowerCase()}…\n`);
    runs.push(await runCommand({ cwd: repository.root, spec }));
  }

  const report = buildVerificationReport({
    repository,
    approval: {
      grantedAt: new Date().toISOString(),
      method,
      approvedCommands: commands,
    },
    runs,
    heuristic,
  });

  if (options.out) {
    const outPath = path.resolve(options.out);
    fs.writeFileSync(outPath, buildVerificationReportText(report), "utf8");
    process.stderr.write(`Report written to ${outPath}\n`);
  }

  if (options.json) {
    process.stdout.write(buildVerificationReportText(report));
  } else {
    printSummary(report, runs);
  }

  return allVerifiedPassed(report) ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `\nVerification failed unexpectedly: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  });