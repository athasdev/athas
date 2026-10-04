#!/usr/bin/env bun
/**
 * Regenerates the typed IPC bindings in src/bindings/commands.ts from the Rust
 * command signatures, without launching the app.
 *
 *   bun scripts/generate-bindings.ts          write the bindings
 *   bun scripts/generate-bindings.ts --check  fail when the checked-in file is stale
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const bindingsPath = "src/bindings/commands.ts";
const check = process.argv.includes("--check");

const scratch = mkdtempSync(path.join(tmpdir(), "athas-bindings-"));
const rawPath = path.join(scratch, "commands.ts");

try {
  const cargo = Bun.spawnSync(
    [
      "cargo",
      "test",
      "--quiet",
      "-p",
      "athas",
      "--bin",
      "athas",
      "bindings::tests::export_typescript_bindings",
      "--",
      "--ignored",
      "--exact",
    ],
    {
      cwd: root,
      env: { ...process.env, ATHAS_BINDINGS_OUT: rawPath },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (cargo.exitCode !== 0) {
    console.error("[bindings] failed to export bindings from Rust");
    process.exit(cargo.exitCode ?? 1);
  }

  const raw = readFileSync(rawPath);
  const vp = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vp.cmd" : "vp",
  );
  const fmt = Bun.spawnSync([vp, "fmt", `--stdin-filepath=${bindingsPath}`], {
    cwd: root,
    stdin: raw,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (fmt.exitCode !== 0) {
    console.error(fmt.stderr.toString());
    console.error("[bindings] failed to format bindings with vp fmt");
    process.exit(fmt.exitCode ?? 1);
  }
  const formatted = fmt.stdout.toString();
  const target = path.join(root, bindingsPath);

  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {}

  if (check) {
    if (current !== formatted) {
      console.error(
        `[bindings] ${bindingsPath} is out of date. Run \`bun run bindings\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`[bindings] ${bindingsPath} is up to date`);
  } else if (current === formatted) {
    console.log(`[bindings] ${bindingsPath} is already up to date`);
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, formatted);
    console.log(`[bindings] wrote ${bindingsPath}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
