#!/usr/bin/env bun

import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  process.env.CARGO_BUILD_TARGET ??
  Bun.spawnSync(["rustc", "--print", "host-tuple"], { cwd: root }).stdout.toString().trim();

if (!target) throw new Error("Could not determine the Rust target triple");

const build = Bun.spawnSync(
  [
    "cargo",
    "build",
    "--release",
    "--target",
    target,
    "-p",
    "athas-agent-cli",
    "--bin",
    "athas-agent",
  ],
  { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
if (build.exitCode !== 0) process.exit(build.exitCode);

const metadata = Bun.spawnSync(["cargo", "metadata", "--no-deps", "--format-version", "1"], {
  cwd: root,
  stdout: "pipe",
  stderr: "inherit",
});
if (metadata.exitCode !== 0) process.exit(metadata.exitCode);
const { target_directory: targetDirectory } = JSON.parse(metadata.stdout.toString()) as {
  target_directory: string;
};
const extension = target.includes("windows") ? ".exe" : "";
const source = resolve(targetDirectory, target, "release", `athas-agent${extension}`);
const directory = resolve(root, "src-tauri", "binaries");
mkdirSync(directory, { recursive: true });
const destination = resolve(directory, `athas-agent-${target}${extension}`);
copyFileSync(source, destination);
if (!target.includes("windows")) chmodSync(destination, 0o755);
console.log(`Prepared Agent CLI: ${destination}`);
