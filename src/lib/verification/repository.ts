/**
 * Repository validation for the verification CLI.
 *
 * The developer points at a directory on their own machine. We validate that
 * it exists, is a directory, is inside a Git work tree and that the requested
 * reference resolves to a commit. Git runs through spawn with `shell: false`
 * and a fixed argument list; the reference is passed as data and is also
 * restricted to Git's ref character set.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { ApprovedRepository } from "./types";
import { VerificationError } from "./types";

/** Characters Git permits in a ref, plus the `^{commit}` peel suffix we add. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/~^@{}]*$/;

export function normaliseRepositoryPath(input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new VerificationError(
      "INVALID_REPO_PATH",
      "A repository path is required.",
      "Pass --repo <path> pointing at a local Git checkout you trust.",
    );
  }

  if (input.includes("\u0000")) {
    throw new VerificationError(
      "INVALID_REPO_PATH",
      "The repository path contains invalid characters.",
      "Pass a normal filesystem path.",
    );
  }

  const resolved = path.resolve(input);

  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new VerificationError(
      "INVALID_REPO_PATH",
      `The repository path does not exist: ${resolved}`,
      "Check the path and run the command again.",
    );
  }

  if (!stats.isDirectory()) {
    throw new VerificationError(
      "INVALID_REPO_PATH",
      `The repository path is not a directory: ${resolved}`,
      "Point --repo at the repository root.",
    );
  }

  return fs.realpathSync(resolved);
}

export function assertGitCheckout(root: string): void {
  const dotGit = path.join(root, ".git");
  if (!fs.existsSync(dotGit)) {
    throw new VerificationError(
      "NOT_A_GIT_REPOSITORY",
      "The selected directory is not a Git checkout.",
      "Initialize or clone the repository first; ProofGate verifies against a Git reference.",
    );
  }
}

export function assertValidRef(ref: string): void {
  if (!REF_PATTERN.test(ref) || ref.includes("..") || ref.endsWith(".lock")) {
    throw new VerificationError(
      "INVALID_REF",
      `"${ref}" is not a valid Git reference.`,
      "Use a branch, tag or commit SHA, for example HEAD or main.",
    );
  }
}

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runGit(root: string, args: string[], timeoutMs = 10_000): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, ...args], {
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 8192) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Validates the checkout and resolves the reference to a commit SHA.
 *
 * @throws {VerificationError} when the directory is not a Git work tree or the
 * reference does not resolve.
 */
export async function resolveRepository(input: {
  repoPath: string;
  ref: string;
}): Promise<ApprovedRepository> {
  const root = normaliseRepositoryPath(input.repoPath);
  assertGitCheckout(root);
  assertValidRef(input.ref);

  let workTree: GitResult;
  try {
    workTree = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new VerificationError(
      "NOT_A_GIT_REPOSITORY",
      "Git could not be executed while validating the repository.",
      "Install Git and make sure it is on PATH.",
    );
  }

  if (workTree.code !== 0 || workTree.stdout.trim() !== "true") {
    throw new VerificationError(
      "NOT_A_GIT_REPOSITORY",
      "The selected directory is not a Git work tree.",
      "Point --repo at the working tree root of a repository you trust.",
    );
  }

  const resolved = await runGit(root, ["rev-parse", "--verify", `${input.ref}^{commit}`]);
  const commit = resolved.stdout.trim();
  if (resolved.code !== 0 || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(commit)) {
    throw new VerificationError(
      "INVALID_REF",
      `The reference "${input.ref}" could not be resolved to a commit.`,
      "Check the branch, tag or SHA and try again.",
    );
  }

  return { root, ref: input.ref, commit };
}