# ProofGate

An open-source verification layer for AI-generated code changes. ProofGate takes a unified diff, produces deterministic **HEURISTIC** review signals, and — when you explicitly opt in — runs an allowlisted test/lint command against a trusted local checkout and records the real result as reproducible evidence.

It never executes the code in a diff and never sends your source to an external model.

## What it does

**Phase 1 · diff review (in the dashboard)**

- Accepts a standard two-way unified diff up to 200 KB.
- Parses file paths, hunks, additions, deletions and both old/new line numbers.
- Rejects malformed hunks, combined diffs, binary diffs and oversized input with a specific error.
- Flags removed validation, removed authorization, removed or weakened money boundaries, removed rounding, and source changes without a matching test change.
- Every finding is labelled `HEURISTIC` and carries a rule ID, severity, file, line, evidence, explanation and a suggested test.
- Exports a Markdown report and a JSON report, both containing the parsed changes, the tool version and the limits of verification.

**Phase 2 · verified local commands (CLI)**

- `npm run verify -- --repo <path> --task test,lint --approve`
- Validates that the path is a Git work tree and the reference resolves to a commit.
- Runs only allowlisted npm scripts, via `spawn` with `shell: false` and an argument array.
- Captures exit code, timestamps, duration, and bounded stdout/stderr, and distinguishes
  `passed`, `failed`, `timed-out` and `spawn-error`.
- Writes a JSON report that keeps verified command outcomes and heuristic diff findings in separate sections.

## Requirements

- Node.js 20.9+ (Next.js 16 requirement; developed on Node 24)
- npm
- Git (only needed for the Phase 2 CLI)

## Install and run the dashboard

```bash
npm install
npm run dev
```

Open http://localhost:3000, then:

1. Choose **Load example** — a loan eligibility service that loses an identity check, widens two money thresholds, drops rounding and removes a role guard, with no test changes.
2. Choose **Analyse diff**.
3. Open **Findings**: filter by severity, filter by file, expand a finding to see its evidence, context and suggested test.
4. Open **Report**: switch between Markdown and JSON, copy or download either.

Other commands:

```bash
npm test          # Vitest unit tests
npm run lint      # ESLint
npm run build     # Production build
npm run typecheck # tsc --noEmit
```

## Phase 2 · verification CLI

```bash
npm run verify -- --repo <path> --ref HEAD --task test,lint --approve
```

Options:

| Flag | Meaning |
| --- | --- |
| `--repo <path>` | Trusted local Git checkout. Required. |
| `--ref <git-ref>` | Branch, tag or SHA. Default `HEAD`. |
| `--task <id,...>` | `test`, `lint`, or both. Default `test`. Repeatable. |
| `--approve` | Explicit approval to run the allowlisted commands. Required. |
| `--diff <file>` | Attach Phase 1 heuristic findings for a diff file. |
| `--out <file>` | Write the JSON report to a file. |
| `--json` | Print the JSON report to stdout. |

What actually runs:

| Task | Command |
| --- | --- |
| `test` | `npm run test` |
| `lint` | `npm run lint` |

There is no flag for passing a command. Unknown tasks and unknown arguments are rejected. On Windows the CLI runs `node <npm-cli.js> run <script>` rather than `npm.cmd`, so `shell: false` can be kept end to end.

### Demo: failing test before the fix, passing test after

```bash
npm run verify:demo          # runs against a temporary fixture repository
npm run verify:demo -- --keep  # keeps the workspace and both reports
```

The demo copies `examples/phase2-fix/before` into a temp directory, commits it, and runs the real CLI. The fixture test fails (`applyDiscount(100, 0.9)` returns 10 instead of 70). The demo then copies the fixed implementation, commits, and runs the same allowlisted command again, which passes. Both JSON reports are real command outputs.

### Demo against this repository

```bash
npm run verify -- --repo . --task lint --approve --out proofgate-lint-report.json
```

To include heuristic findings in the same report, export a diff first and pass `--diff`.

## Trust boundary and security

ProofGate draws a hard line between *parsing* and *executing*:

- **Diff content is never executed.** It is parsed as text and matched against rules.
- **No HTTP endpoint executes commands.** `/api/analyze` only parses and analyses a diff. The verification CLI is a local process and has no server route.
- **Fixed allowlist.** The CLI accepts a task id, not a command. Each id maps to one executable and one argument list in `src/lib/verification/allowlist.ts`.
- **`shell: false`, argument arrays.** No string is ever handed to a shell.
- **Validated inputs.** The repository path must exist, be a directory and be a Git work tree; the reference must resolve to a commit and is restricted to Git's ref character set.
- **Bounded execution.** Per-task timeouts and per-stream output caps; the report records truncation and timeouts explicitly.
- **No third-party model calls.** There is no provider SDK, API key or network call to an AI service in Phase 1 or Phase 2.

**The CLI is not a sandbox.** Running `npm run test` or `npm run lint` executes the repository's own scripts with your user's permissions. Those scripts can run arbitrary code, read and write files, and use the network. Only run ProofGate against repositories you trust. Timeouts stop the direct child process; a script that spawns its own detached children may outlive it. Isolation (containers, restricted users, network egress rules) is the responsibility of the operator.

## Privacy statement

- **Dashboard:** the diff you paste is sent from your browser to this application's own `/api/analyze` route, which analyses it in-process. It is not stored — there is no database, account system or upload folder — and it is not forwarded to any external service.
- **Deployed instance:** the same is true, but "local" then means "the server you deployed". The diff travels over HTTP to that deployment, so use HTTPS and only deploy where you are comfortable processing the code you paste.
- **CLI:** entirely local. It reads the diff file only if you pass `--diff`, and it writes reports only where you tell it to (`--out`) or to the temporary demo workspace.

## Architecture

```
src/
├─ app/
│  ├─ page.tsx                 dashboard entry
│  └─ api/analyze/route.ts     POST diff → analysis JSON (no execution)
├─ components/                 dashboard, findings, report, method views
├─ cli/verify.ts               Phase 2 CLI (approval, orchestration, output)
└─ lib/
   ├─ engine/                  pure Phase 1 engine
   │  ├─ types.ts
   │  ├─ parse-diff.ts         strict unified-diff parser
   │  ├─ rules.ts              PG-001..PG-005 deterministic rules
   │  ├─ analyze.ts            server-only orchestration + hashing
   │  └─ limits.ts             tool metadata + limits of verification
   ├─ verification/            Phase 2 trusted-local execution
   │  ├─ types.ts
   │  ├─ allowlist.ts          fixed task → command mapping
   │  ├─ repository.ts         path, Git and ref validation
   │  ├─ runner.ts             spawn(shell:false) + timeout + output caps
   │  └─ report.ts             verified vs heuristic JSON evidence report
   ├─ reports/build-report.ts  Markdown / JSON Phase 1 reports
   ├─ adapters/                Phase 2/3 seams (unimplemented, disabled)
   └─ examples/                bundled demo diff
examples/phase2-fix/           before/after fixture repository
scripts/phase2-demo.mjs        before/after demo driver
tests/                         parsing, rules, reports, verification
```

### Verification rules (Phase 1)

| Rule | Looks for | Default severity |
| --- | --- | --- |
| `PG-001` | Removed validation, assertion or rejection path | medium (high in money files) |
| `PG-002` | Removed role, permission, ownership or tenant condition | high |
| `PG-003` | Removed money/material comparison, limit or rounding | high |
| `PG-004` | A comparison boundary that now passes more values | high |
| `PG-005` | Changed source file with no paired test change | low |

Overlapping matches inside one contiguous removed block are resolved deterministically: the block is owned by exactly one rule (validation → authorization → money), so one removal produces one finding.

### Verified outcomes vs heuristic findings

The Phase 2 report never mixes the two:

```jsonc
{
  "verified": {
    "runs": [{ "taskId": "test", "status": "passed", "exitCode": 0, "...": "..." }],
    "summary": { "total": 1, "passed": 1, "failed": 0, "timedOut": 0, "spawnErrors": 0 }
  },
  "heuristic": {
    "status": "included",
    "classification": "HEURISTIC",
    "findings": [{ "ruleId": "PG-004", "...": "..." }]
  },
  "limitations": ["..."]
}
```

A report only counts as a pass when every requested command ran and exited 0. Skipped checks, timeouts and spawn errors all prevent that.

## Constraints

- Phase 1 rules are text heuristics over a diff. They can be wrong in both directions, and a finding is never a confirmed defect.
- No test results, coverage numbers, confidence percentages or safety claims are generated in the dashboard.
- Verification commands always come from the allowlist; there is no plugin mechanism for adding commands at runtime.
- Only npm projects are supported in Phase 2.
- No authentication, database or multi-user support.

## Roadmap

- **Phase 2 (current):** trusted-local test/lint execution with evidence reports.
- **Phase 3 (not implemented):** optional open-model explanations behind an explicit provider adapter (`src/lib/adapters/explainer.ts`), disabled by default, requiring explicit developer action per request. Deterministic findings stay the source of truth.
