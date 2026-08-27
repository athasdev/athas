#!/usr/bin/env bun

import { withMacosDevSigning } from "./dev/macos-dev-signing";

const children = new Set<ReturnType<typeof Bun.spawn>>();

let stopping = false;

function stopChildProcessTree(child: ReturnType<typeof Bun.spawn>, signal: NodeJS.Signals) {
  if (process.platform === "win32") {
    if (child.exitCode !== null) return;
    Bun.spawnSync(["taskkill", "/pid", String(child.pid), "/t", "/f"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null) child.kill(signal);
  }
}

function stop(signal: NodeJS.Signals = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopChildProcessTree(child, signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

let exitCode = 1;

try {
  children.add(
    Bun.spawn(["bun", "extensions/tooling/serve-cdn.ts"], {
      detached: process.platform !== "win32",
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  children.add(
    Bun.spawn(["tauri", "dev", "--config", "src-tauri/tauri.preview.conf.json"], {
      detached: process.platform !== "win32",
      env: withMacosDevSigning(
        {
          ...process.env,
          VITE_EXTENSION_MARKETPLACE_LOCAL: "true",
          WEBKIT_DISABLE_DMABUF_RENDERER: "1",
        },
        { identifier: "com.code.athas.preview" },
      ),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  exitCode = await Promise.race([...children].map((child) => child.exited));
} finally {
  stop();
  await Promise.allSettled([...children].map((child) => child.exited));
}

process.exit(exitCode);
