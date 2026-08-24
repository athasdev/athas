#!/usr/bin/env bun

import { rm } from "node:fs/promises";

const children = new Set<ReturnType<typeof Bun.spawn>>();

function stop() {
  for (const child of children) child.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  children.add(child);
  const exitCode = await child.exited;
  children.delete(child);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with code ${exitCode}`);
}

async function resetFrontend() {
  await Promise.all(
    ["dist", "build", "node_modules", "bun.lockb"].map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
  await run(["bun", "install"]);
}

async function resetRust() {
  await run(["cargo", "clean"]);
  await run(["cargo", "build"]);
}

try {
  await Promise.all([resetFrontend(), resetRust()]);
} catch (error) {
  stop();
  throw error;
}
