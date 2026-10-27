# ProofGate

An open-source verification layer for AI-generated code changes. ProofGate takes a unified diff, produces deterministic **HEURISTIC** review signals, and — when you explicitly opt in — runs an allowlisted test/lint command against a trusted local checkout and records the real result as reproducible evidence.

It never executes the code in a diff. Deterministic analysis stays in-process. The optional AI Fix Advisor sends only a single finding excerpt to Groq, and only after a per-finding consent prompt.

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

**v0.3 · Verification Evidence Center (dashboard)**

- A **Evidence** tab that imports those JSON reports from local files, read-only.
- Strict, size-limited runtime validation: unsupported schemas, tampered summaries, impossible exit codes and unknown fields are rejected with a path and a hint.
- Shows command status (PASSED / FAILED / TIMED OUT / NOT RUN), exit codes, timestamps, durations, commit, bounded stdout/stderr and recorded limitations.
- Compares a before/after pair task by task and shows the failure-to-pass transition with both commit SHAs.
- Keeps heuristic diff findings visually separate from verified command outcomes.
- Ships a bundled **DEMO DATA** pair generated from the real Phase 2 demo.

**v0.4 · AI Fix Advisor (optional)**

- An **Explain with AI** action on each heuristic finding card.
- Shows exactly which fields will be sent and requires approval before any request.
- Calls Groq's `POST https://api.groq.com/openai/v1/chat/completions` from a server-only route using `GROQ_API_KEY` and the configured `GROQ_MODEL`.
- Requires a strict JSON response with `likelyRisk`, `suggestedCorrection`, `recommendedTest` and `limitations`, validates it at runtime and truncates over-long fields.
- Displays the result in a separate panel labelled **AI SUGGESTION — NOT VERIFIED**, with copy for the suggested correction.
- Disabled automatically when either environment variable is missing; no model ID is ever substituted.

**v0.5 · GitHub Actions diff review**

- A `pull_request` workflow that runs the deterministic engine on the PR diff and writes Markdown and JSON reports.
- A standalone `npm run ci:analyze` entrypoint that reads a local diff file only — no network calls, no Groq, no code execution.
- A GitHub job summary with severity counts, evidence locations and the HEURISTIC / NOT VERIFIED disclaimer.
- Limited to `contents: read`, no secrets, no `pull_request_target`, and never runs code from the PR.

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

## Evidence Center walkthrough

This is the reproducible path from a local run to the dashboard. It needs no network access.

1. Generate a real before/after pair:

   ```bash
   npm run verify:demo -- --keep
   ```

   The demo prints a workspace path and writes two reports to it:

   ```
   <workspace>\report-before-fix.json    # PASSED? no — the fixture test really fails
   <workspace>\report-after-fix.json     # the same command really passes after the fix
   ```

   Both files are genuine CLI output. Nothing about them is simulated.

2. Start the dashboard and open the **Evidence** tab:

   ```bash
   npm run dev
   ```

3. Import the pair. Either:

   - click **Load demo pair** to use the bundled **DEMO DATA** copy of exactly these two runs, or
   - click **Choose JSON file** in the *Before* slot and select `report-before-fix.json`, then do the same in the *After* slot with `report-after-fix.json`.

4. Read the result:

   - the **Before → after comparison** table shows `test` moving from `FAILED` (exit 1) to `PASSED` (exit 0), with both commit SHAs and duration delta;
   - each report panel lists the real command, exit code, timestamps, duration and captured output;
   - heuristic diff findings appear in a separate amber section labelled HEURISTIC, next to the note that a passing command does not confirm or clear them;
   - the limits recorded by the CLI are shown verbatim.

5. Optional: import only one report to inspect a single run. The comparison appears once both slots hold a report.

### Bundled DEMO DATA

`src/lib/evidence/samples/demo-before-fix.json` and `demo-after-fix.json` are the real output of the demo, copied in by:

```bash
node scripts/emit-evidence-samples.mjs --from <kept-demo-workspace>
```

Publication redaction replaces machine-specific absolute paths (`<demo-workspace>/shop`, `node`, `<npm-cli.js>`) only. Statuses, exit codes, timestamps, durations, commit SHAs, output and limitations are unmodified. The bundled files record the CLI version that produced them (0.2.0); they are kept as evidence and are not rewritten on later releases. The UI always marks these files **Demo data** and states that they are not a live run.

### Evidence Center security

- Imports are parsed in the browser against a strict schema with a 2 MB cap; unsupported versions, unknown fields, tampered summaries and contradictory statuses are rejected with a message.
- Nothing in a report is executed, resolved or fetched. A path inside a report is displayed as text, never opened.
- The tab has no command input, no repository path input and no network calls.
- Public deployments still cannot run repository code: the CLI is local-only and there is no server route that executes it.

## AI Fix Advisor (optional)

The advisor is off unless the server has both variables. It reads them only from server-side code; no `NEXT_PUBLIC_` variant is used or read.

```bash
# .env.local (never commit this file)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
```

`.env.example` documents the two names with placeholders. On Vercel, set the same variables for the environment you deploy (server-only scope). A missing or invalid `GROQ_MODEL` disables the feature with a visible note; ProofGate never silently substitutes a model. Use a model ID your Groq account can call — the deployment's configured value is sent verbatim.

### Consent and privacy

- The action is per finding. Clicking **Explain with AI** first shows a consent panel listing exactly what would leave the app.
- Only after **Send to Groq** does the browser call `/api/ai/explain`.
- The payload contains the selected finding: rule id/title/severity/category, file path and line, the evidence line, up to 20 surrounding diff context lines, the rule explanation and the engine-suggested test. The rest of the diff and repository are not sent.
- The server re-bounds every string and the assembled prompt, and sends the request with a 12 second timeout, `max_tokens: 700`, and `response_format: json_object`.
- ProofGate does not store the excerpt or the response, does not log request bodies, and never returns the API key. Groq's own terms and privacy policy apply to its processing.
- The UI and the API are separate from the deterministic engine. AI output cannot confirm a defect, upgrade a heuristic finding, verify a fix, or claim that tests passed.

### Request limits

| Limit | Value | Notes |
| --- | --- | --- |
| Provider timeout | 12 s | Returns `504` with a safe error |
| Output tokens | 700 | Bounded model output |
| Transport body | 64 KB | Rejected with `413` before parsing deeper |
| Assembled prompt | 8 KB | Rejected with `413` |
| Per client | 5 requests / 60 s | In-memory, keyed by `x-forwarded-for` |
| Per instance | 20 requests / 60 s | In-memory |

**The rate limit is best-effort and per instance.** On serverless deployments such as Vercel, instances are isolated and short-lived, so these counters are not a global quota. For a hard limit, add shared storage or a platform-level WAF/rate-limit rule. The route returns `429` with `Retry-After` and passes an upstream Groq `429` through as `429`.

### Failure behaviour

| Condition | Response |
| --- | --- |
| `GROQ_API_KEY` or `GROQ_MODEL` missing/invalid | `503 NOT_CONFIGURED`; UI shows a disabled note |
| Consent missing or withheld | `403 CONSENT_REQUIRED`; no provider call |
| Invalid or oversized payload | `422` / `413`; no provider call |
| Groq 429 | `429` with `Retry-After` when provided |
| Groq 5xx, network failure | `502` safe message; provider body is not echoed |
| Timeout | `504` |
| Non-JSON or incomplete model output | `502 INVALID_OUTPUT`; output discarded |

No live provider call happens during automated tests; the suite mocks `fetch`.

### Known limitations

- The advisor is commentary, not verification. It can be wrong, incomplete or over-confident, and it only sees one finding excerpt.
- Model selection, availability and quotas are controlled by Groq; a misconfigured model id disables the feature rather than falling back.
- The in-memory rate limit does not protect a fleet. Add a shared limiter for public traffic.
- Server-side environment variables must be configured on every deployment; preview and production environments are separate.
- The AI path is deliberately not part of the CLI evidence report, so it is not evidence of a test outcome.

## GitHub Actions PR review (v0.5)

`.github/workflows/proofgate.yml` runs ProofGate's deterministic diff review on every pull request. It produces a job summary and downloadable reports.

### What the workflow does

1. Checks out the **trusted base revision** (`github.event.pull_request.base.sha`).
2. Fetches the PR head as a Git ref **only** and writes `git diff base head` to a temporary file.
3. Installs and runs the ProofGate CLI from the base revision.
4. Appends the summary to `$GITHUB_STEP_SUMMARY` and uploads `proofgate-report/`.

It uses `pull_request`, `permissions: contents: read`, no repository secrets, a fixed Node.js `22.14.0`, and standard `action` runners. It never checks out or executes the PR head, never runs PR tests, and never approves, merges or labels a pull request.

### Reports

The CLI writes three files plus the job summary:

- `proofgate-report.md` — the full deterministic report with a CI context block (base/head, diff SHA-256, "tests not run").
- `proofgate-report.json` — the existing Phase 1 JSON schema plus a `ci` object with `baseRef`, `headRef`, `analysisStatus: "completed"` and `testsRun: false`.
- `proofgate-summary.md` — the same concise summary appended to the GitHub job summary.
- `$GITHUB_STEP_SUMMARY` — risk counts, evidence locations, disclaimer.

### Run it locally on any diff

```bash
git diff origin/main...HEAD > pr.diff
npm run ci:analyze -- \
  --diff pr.diff \
  --out-dir proofgate-report \
  --base "$(git rev-parse origin/main)" \
  --head "$(git rev-parse HEAD)"
```

Options: `--out-dir` (default `proofgate-report`), `--base`, `--head`, `--summary <file>`, and `--fail-on none|high|medium|low` (default `none`). `--fail-on` is an **optional heuristic gate**: a failure means findings matched, not that tests failed. Successful analysis (exit 0) still does not approve the pull request.

### Trust model and limitations

- **The diff is data.** It is parsed, never executed. The workflow runs only ProofGate code from the base revision and its locked dependencies.
- **Fork PRs are untrusted.** The PR head is fetched as a ref and passed to `git diff`; it is never checked out, installed or run. The read-only token is not exposed to PR code.
- **No secrets.** The AI advisor and Groq are not used in CI. No `GROQ_*` variables are needed or read.
- **Workflow-file changes are sensitive.** For `pull_request`, GitHub uses the workflow definition from the PR merge ref. Protect `.github/workflows/` with `CODEOWNERS` and enable "Require approval for outside collaborators" so a workflow edit cannot run unreviewed.
- **Bootstrap.** The base branch must already contain `ci:analyze` and the workflow. Merge this change first; earlier PRs cannot use it.
- **Size.** Diffs over 200 KB are rejected with an actionable error, as are binary and malformed diffs. Split large changes or review them manually.
- **Not a test run and not a security audit.** No application tests are executed, no coverage is measured, and no confidence score is produced. A successful analysis is not a passing test, not a merge approval and not evidence that the change is safe.
- **Base-version analysis.** The rules come from the base revision, so a PR that changes the engine is reviewed with the rules already on the base branch.

## Trust boundary and security

ProofGate draws a hard line between *parsing* and *executing*:

- **Diff content is never executed.** It is parsed as text and matched against rules.
- **No HTTP endpoint executes commands.** `/api/analyze` only parses and analyses a diff. The verification CLI is a local process and has no server route.
- **Fixed allowlist.** The CLI accepts a task id, not a command. Each id maps to one executable and one argument list in `src/lib/verification/allowlist.ts`.
- **`shell: false`, argument arrays.** No string is ever handed to a shell.
- **Validated inputs.** The repository path must exist, be a directory and be a Git work tree; the reference must resolve to a commit and is restricted to Git's ref character set.
- **Bounded execution.** Per-task timeouts and per-stream output caps; the report records truncation and timeouts explicitly.
- **No implicit third-party calls.** Deterministic analysis, reports, the CLI and the Evidence Center make no AI calls. The only outbound AI request is the optional Fix Advisor, which requires per-finding consent and sends only the bounded excerpt described above. There is no provider SDK and no other third party.

**The CLI is not a sandbox.** Running `npm run test` or `npm run lint` executes the repository's own scripts with your user's permissions. Those scripts can run arbitrary code, read and write files, and use the network. Only run ProofGate against repositories you trust. Timeouts stop the direct child process; a script that spawns its own detached children may outlive it. Isolation (containers, restricted users, network egress rules) is the responsibility of the operator.

## Privacy statement

- **Dashboard:** the diff you paste is sent from your browser to this application's own `/api/analyze` route, which analyses it in-process. It is not stored — there is no database, account system or upload folder — and it is not forwarded to any external service.
- **AI advisor (optional):** only when you click **Send to Groq** on a finding does a bounded excerpt leave the app, as described in [AI Fix Advisor](#ai-fix-advisor-optional). The server does not store or log it.
- **Deployed instance:** the same is true, but "local" then means "the server you deployed". The diff travels over HTTP to that deployment, so use HTTPS and only deploy where you are comfortable processing the code you paste.
- **CLI:** entirely local. It reads the diff file only if you pass `--diff`, and it writes reports only where you tell it to (`--out`) or to the temporary demo workspace.

## Architecture

```
src/
├─ app/
│  ├─ page.tsx                 dashboard entry
│  └─ api/
│     ├─ analyze/route.ts      POST diff → analysis JSON (no execution)
│     └─ ai/
│        ├─ explain/route.ts   POST consent-gated finding → Groq suggestion
│        └─ status/route.ts    GET AI availability (no credentials)
├─ components/                 dashboard, findings, report, method views
│  ├─ ai/                      consent panel, AI suggestion panel, status hook
│  └─ evidence/                Evidence Center (import, compare, render)
├─ cli/
│  ├─ verify.ts                Phase 2 CLI (approval, orchestration, output)
│  └─ ci.ts                    v0.5 CI entrypoint (local diff → reports + summary)
└─ lib/
   ├─ engine/                  pure Phase 1 engine
   │  ├─ types.ts
   │  ├─ parse-diff.ts         strict unified-diff parser
   │  ├─ rules.ts              PG-001..PG-005 deterministic rules
   │  ├─ analyze.ts            server-only orchestration + hashing
   │  └─ limits.ts             tool metadata + limits of verification
   ├─ ai/                      AI Fix Advisor (server-only)
   │  ├─ config.ts             GROQ_API_KEY / GROQ_MODEL, no fallback model
   │  ├─ prompt.ts             request validation, bounds, prompt assembly
   │  ├─ groq.ts               fetch + 12s timeout + failure mapping
   │  ├─ suggestion.ts         strict JSON output validation + truncation
   │  ├─ http.ts               AI error → HTTP status mapping
   │  └─ rate-limit.ts         best-effort per-instance limiter
   ├─ verification/            Phase 2 trusted-local execution
   │  ├─ types.ts
   │  ├─ allowlist.ts          fixed task → command mapping
   │  ├─ repository.ts         path, Git and ref validation
   │  ├─ runner.ts             spawn(shell:false) + timeout + output caps
   │  └─ report.ts             verified vs heuristic JSON evidence report
   ├─ evidence/                Evidence Center parsing and interpretation
   │  ├─ types.ts              view model + limits
   │  ├─ schema.ts             strict runtime validation of imported reports
   │  ├─ compare.ts            status interpretation + before/after comparison
   │  ├─ samples.ts            bundled DEMO DATA pair + provenance
   │  └─ samples/              the real demo JSON reports
   ├─ reports/build-report.ts  Markdown / JSON Phase 1 reports
   ├─ ci/summary.ts            CI provenance, JSON wrapper and job summary
   ├─ adapters/                provider seam (unimplemented, disabled)
   └─ examples/                bundled demo diff
examples/phase2-fix/           before/after fixture repository
.github/workflows/proofgate.yml  pull_request diff review (contents: read)
scripts/phase2-demo.mjs        before/after demo driver
scripts/emit-evidence-samples.mjs  redacts and bundles the demo pair
tests/                         parsing, rules, reports, verification, evidence, AI, CI
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
- **v0.3 (current):** read-only Verification Evidence Center with before/after comparison.
- **v0.4 (current, optional):** consent-gated Groq AI Fix Advisor, labelled as an unverified suggestion.
- **v0.5 (current):** GitHub Actions pull-request diff review with Markdown/JSON reports and a job summary.
- **Future:** replace the best-effort in-memory AI limiter with shared storage or a platform rate limit; add more model providers behind the existing adapter seam. Deterministic findings and verified command outcomes remain the source of truth.

<!-- ProofGate CI workflow test -->
