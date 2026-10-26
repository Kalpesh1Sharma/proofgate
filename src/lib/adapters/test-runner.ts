/**
 * Phase 2 seam: trusted local repository test runner.
 *
 * Phase 1 intentionally ships no implementation. Executing tests is only
 * acceptable after Phase 2 adds:
 *  - a trusted local checkout that the user explicitly selects;
 *  - an allowlisted, fixed command set (no arbitrary shell strings);
 *  - isolated, resource-limited execution with a timeout and output cap;
 *  - a clear record that the result came from a real run.
 *
 * Nothing here is wired to an HTTP endpoint.
 */

export interface TrustedCheckout {
  /** Opaque identifier chosen by the local runtime, not a user supplied path. */
  id: string;
  /** Absolute path resolved by the local runtime and verified to be a git worktree. */
  root: string;
  /** Commit the user selected; the runner must refuse to run on a dirty tree. */
  commit: string;
}

export interface AllowedCommand {
  id: string;
  label: string;
  /** Executable allowlist entry, never interpolated with user input. */
  executable: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface TestRunnerRequest {
  checkout: TrustedCheckout;
  commands: AllowedCommand[];
}

export interface CommandEvidence {
  commandId: string;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface TestRunnerResult {
  runnerId: string;
  checkoutId: string;
  commit: string;
  commands: CommandEvidence[];
}

export interface TestRunner {
  readonly id: string;
  readonly availability: "unavailable" | "available";
  run(request: TestRunnerRequest, signal?: AbortSignal): Promise<TestRunnerResult>;
}

export class PhaseUnavailableError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available in ProofGate Phase 1.`);
    this.name = "PhaseUnavailableError";
  }
}

/**
 * Placeholder used until Phase 2. It refuses to run and therefore cannot be
 * abused if something accidentally calls it.
 */
export class UnavailableTestRunner implements TestRunner {
  readonly id = "phase-2-test-runner";
  readonly availability = "unavailable" as const;

  async run(): Promise<TestRunnerResult> {
    throw new PhaseUnavailableError("Executing tests against a local repository");
  }
}

/**
 * Guard that a Phase 2 implementation must apply to every request. Kept here
 * so the policy is visible next to the seam instead of buried in a runner.
 */
export function assertTrustedCheckout(checkout: TrustedCheckout): void {
  if (!checkout.id || !checkout.root || !checkout.commit) {
    throw new Error("A trusted checkout id, root and commit are required.");
  }
  if (checkout.root.includes("\u0000") || checkout.commit.includes("\u0000")) {
    throw new Error("Checkout metadata contains invalid characters.");
  }
}