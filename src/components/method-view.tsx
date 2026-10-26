import { LIMITATIONS, TOOL_VERSION } from "@/lib/engine/limits";
import { RULE_DEFINITIONS } from "@/lib/engine/rules";

import { BookIcon, FileCodeIcon, ShieldIcon } from "./icons";
import { Callout, HeuristicBadge, SectionHeading, SeverityBadge } from "./ui";

const PIPELINE = [
  {
    step: "01",
    title: "Parse",
    body: "A strict unified-diff parser maps file paths, hunks, additions, deletions and both line numbers. Malformed, oversized and binary diffs are rejected.",
  },
  {
    step: "02",
    title: "Match",
    body: "Typed deterministic rules scan only the parsed diff. Each rule is a documented text pattern, not a model judgement and not a proof.",
  },
  {
    step: "03",
    title: "Report",
    body: "Findings carry a rule ID, severity, evidence, explanation and a suggested test. Markdown and JSON exports include parsed changes and explicit limits.",
  },
];

const SECURITY = [
  {
    title: "No code execution",
    body: "Pasted code is never imported, evaluated or run. Phase 1 has no test runner and no shell surface.",
  },
  {
    title: "No network egress",
    body: "The only request the UI makes is to this app's own /api/analyze route. No model provider is configured or called.",
  },
  {
    title: "No storage",
    body: "There is no database, account or upload store. The diff exists in component state and in the response only.",
  },
];

export function MethodView() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {PIPELINE.map((item) => (
          <div key={item.step} className="panel p-4">
            <div className="label-mono">{item.step}</div>
            <h2 className="mt-2 text-sm font-semibold text-ink">{item.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.body}</p>
          </div>
        ))}
      </div>

      <section className="panel overflow-hidden" aria-labelledby="rules-heading">
        <div className="border-b border-line px-4 py-3">
          <h2 id="rules-heading" className="text-sm font-semibold text-ink">
            Phase 1 rules
          </h2>
          <p className="mt-1 text-xs text-muted">
            Every finding is labelled <HeuristicBadge className="mx-1 align-middle" /> because
            the rule matched text, not because a defect was proven.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-line text-faint">
                <th scope="col" className="px-4 py-2 font-medium">Rule</th>
                <th scope="col" className="px-4 py-2 font-medium">What it looks for</th>
                <th scope="col" className="px-4 py-2 font-medium">Category</th>
                <th scope="col" className="px-4 py-2 font-medium">Default severity</th>
              </tr>
            </thead>
            <tbody>
              {RULE_DEFINITIONS.map((rule) => (
                <tr key={rule.id} className="border-b border-line/60 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-ink">
                    {rule.id}
                    <span className="mt-0.5 block font-sans text-[11px] font-medium text-muted">
                      {rule.title}
                    </span>
                  </td>
                  <td className="max-w-md px-4 py-3 leading-relaxed text-muted">
                    {rule.description}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-faint">
                    {rule.category}
                  </td>
                  <td className="px-4 py-3">
                    <SeverityBadge severity={rule.severity} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="panel p-4" aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <BookIcon className="h-4 w-4 text-faint" />
            Limits of verification
          </h2>
          <p className="mt-1 text-xs text-muted">
            These limits are reproduced verbatim in every generated report.
          </p>
          <ul className="mt-3 space-y-2">
            {LIMITATIONS.map((limitation) => (
              <li key={limitation} className="flex gap-2 text-xs leading-relaxed text-muted">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-4">
          <section className="panel p-4" aria-labelledby="security-heading">
            <h2
              id="security-heading"
              className="flex items-center gap-2 text-sm font-semibold text-ink"
            >
              <ShieldIcon className="h-4 w-4 text-faint" />
              Security posture
            </h2>
            <div className="mt-3 space-y-3">
              {SECURITY.map((item) => (
                <div key={item.title}>
                  <h3 className="text-xs font-semibold text-ink">{item.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          <Callout tone="neutral" title={`Phase 1 · v${TOOL_VERSION}`}>
            Built as an open-source verification layer. The engine, parsers and report
            builders are pure modules with unit tests; the UI is a thin client over the
            local analysis route.
          </Callout>
        </div>
      </div>

      <section className="panel p-4" aria-labelledby="roadmap-heading">
        <h2 id="roadmap-heading" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileCodeIcon className="h-4 w-4 text-faint" />
          Deliberately not implemented yet
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-elevated/50 p-3">
            <div className="label-mono">Phase 2 · seam exists</div>
            <h3 className="mt-1.5 text-xs font-semibold text-ink">Trusted local test runner</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              The adapter types require an explicitly selected local checkout, a clean commit,
              allowlisted commands, a timeout and an output cap. No runner is wired to HTTP.
              Until then, ProofGate reports no test results at all.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-elevated/50 p-3">
            <div className="label-mono">Phase 3 · seam exists</div>
            <h3 className="mt-1.5 text-xs font-semibold text-ink">Open-model explanations</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              A provider interface with a disabled implementation. Future use requires an
              explicit developer action per finding, minimal evidence sharing and a
              classification that never upgrades heuristic output to verification.
            </p>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-dashed border-line-strong px-4 py-4">
        <SectionHeading
          eyebrow="Position"
          title="A verification layer, not an oracle"
          description="ProofGate narrows review attention with reproducible checks and an honest account of what was and was not verified. It should make a reviewer faster, not replace one."
        />
      </div>
    </div>
  );
}