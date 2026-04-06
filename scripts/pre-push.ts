#!/usr/bin/env bun
import { $ } from "bun";

const STASH_MESSAGE = `athas-pre-push-${Date.now()}`;

async function hasWorkingTreeChanges(): Promise<boolean> {
  const status = await $`git status --porcelain`.text();
  return status.trim().length > 0;
}

async function stashWorkingTree(): Promise<boolean> {
  if (!(await hasWorkingTreeChanges())) {
    return false;
  }

  console.log("Stashing local changes before running push checks on a clean snapshot...");
  await $`git stash push --include-untracked --message ${STASH_MESSAGE}`.cwd(process.cwd());
  return true;
}

async function restoreWorkingTree() {
  const stashList = await $`git stash list`.text();
  const stashEntry = stashList
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes(STASH_MESSAGE));

  if (!stashEntry) {
    return;
  }

  const [stashRef] = stashEntry.split(": ", 1);
  if (!stashRef) {
    return;
  }

  console.log("Restoring stashed local changes...");
  await $`git stash pop --index ${stashRef}`.cwd(process.cwd());
}

let stashed = false;

try {
  stashed = await stashWorkingTree();
  await $`bash scripts/check-all.sh`.cwd(process.cwd());
} finally {
  if (stashed) {
    await restoreWorkingTree();
  }
}
