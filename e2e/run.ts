// Runs the e2e specs with `bun test`. Spec files end in `.e2e.ts`, which
// `bun test` and Vitest never discover on their own, so they are passed here as
// explicit paths. Extra arguments (for example `-t "editor"`) are forwarded.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const e2eDir = import.meta.dir;
const repoRoot = path.resolve(e2eDir, "..");
const toRepoPath = (file: string) => `./${path.relative(repoRoot, file).split(path.sep).join("/")}`;

const specsDir = path.join(e2eDir, "specs");
const specs = readdirSync(specsDir)
  .filter((file) => file.endsWith(".e2e.ts"))
  .sort()
  .map((file) => toRepoPath(path.join(specsDir, file)));

const result = spawnSync(
  process.execPath,
  [
    "test",
    "--preload",
    toRepoPath(path.join(e2eDir, "support", "setup.ts")),
    "--timeout",
    "180000",
    ...process.argv.slice(2),
    ...specs,
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
