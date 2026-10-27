import type { ImportedEvidence } from "@/lib/evidence/types";

import beforeSample from "./samples/demo-before-fix.json";
import afterSample from "./samples/demo-after-fix.json";

import { parseEvidenceReport } from "@/lib/evidence/schema";

/**
 * Bundled DEMO DATA.
 *
 * Both files are the unmodified output of `npm run verify:demo` against
 * `examples/phase2-fix`, with machine-specific absolute paths redacted for
 * publication. Statuses, exit codes, timestamps, durations, commit SHAs and
 * captured output are exactly what the CLI recorded. They are not live results
 * and the UI labels them DEMO DATA.
 */

export const DEMO_PROVENANCE =
  "Real output of `npm run verify:demo` against examples/phase2-fix (failing before the fix, passing after). Absolute machine paths were redacted; statuses, exit codes, durations, commits and captured output are unmodified. This is not a live run.";

export const DEMO_LABEL = "Demo data · Phase 2 fixture";

export type DemoEvidenceResult =
  | { ok: true; before: ImportedEvidence; after: ImportedEvidence }
  | { ok: false; error: string };

export function loadDemoEvidence(): DemoEvidenceResult {
  const before = parseEvidenceReport(beforeSample);
  if (!before.ok) {
    return { ok: false, error: `The bundled before-fix sample is invalid: ${before.error.message}` };
  }

  const after = parseEvidenceReport(afterSample);
  if (!after.ok) {
    return { ok: false, error: `The bundled after-fix sample is invalid: ${after.error.message}` };
  }

  const source = { kind: "demo" as const, label: DEMO_LABEL, provenance: DEMO_PROVENANCE };

  return {
    ok: true,
    before: { report: before.report, source, warnings: before.warnings },
    after: { report: after.report, source, warnings: after.warnings },
  };
}