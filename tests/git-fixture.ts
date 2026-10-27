import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const created: string[] = [];

export function makeTempDir(prefix = "proofgate-verify-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function git(cwd: string, args: string[]): void {
  const result = spawnSync(
    "git",
    ["-C", cwd, "-c", "user.email=test@example.com", "-c", "user.name=ProofGate Test", ...args],
    { encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/** Creates a real Git repository with one commit and returns its path. */
export function makeGitRepo(): string {
  const dir = makeTempDir();
  git(dir, ["init", "--initial-branch=main"]);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "verify-fixture",
        private: true,
        version: "1.0.0",
        scripts: {
          test: 'node -e "process.exit(0)"',
          lint: 'node -e "console.log(\'lint ok\')"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "fixture"]);
  return dir;
}

export function makePlainDir(): string {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "README.md"), "not a repository\n", "utf8");
  return dir;
}