#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const metadata = Bun.spawnSync(["cargo", "metadata", "--no-deps", "--format-version", "1"], {
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "pipe",
});

if (metadata.exitCode !== 0) {
  console.error(metadata.stderr.toString().trim());
  process.exit(metadata.exitCode);
}

const { target_directory: targetDirectory } = JSON.parse(metadata.stdout.toString()) as {
  target_directory: string;
};
const binary = resolve(
  targetDirectory,
  process.env.CARGO_BUILD_TARGET ?? "",
  "debug",
  process.platform === "win32" ? "athas.exe" : "athas",
);

if (!existsSync(binary)) {
  console.error(
    "The Athas development binary is not built yet. Start bun dev, then retry bun run cli.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const validation = Bun.spawnSync([binary, "--validate-cli", ...args], {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
if (validation.exitCode !== 0) process.exit(validation.exitCode);
if (["help", "--help", "-h"].includes(args[0])) process.exit(0);

const child = Bun.spawn([binary, ...args], {
  cwd: process.cwd(),
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
});
child.unref();
