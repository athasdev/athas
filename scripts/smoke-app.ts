#!/usr/bin/env bun

import { $ } from "bun";
import process from "node:process";
import path from "node:path";
import { existsSync } from "node:fs";

type Channel = "stable" | "preview" | "smoke";

// Examples:
//   bun smoke
//   bun smoke preview
//   bun smoke stable
//   bun smoke smoke
//   bun smoke:preview
//   bun smoke:stable
//   bun smoke:fast
//   bun smoke:open

const args = process.argv.slice(2);
const openOnly = args.includes("--open-only");
const channelArg = (args.find((arg) => !arg.startsWith("--")) ?? "preview").toLowerCase();

if (channelArg !== "stable" && channelArg !== "preview" && channelArg !== "smoke") {
  console.error("Usage: bun smoke [preview|stable|smoke] [--open-only]");
  process.exit(1);
}

const channel = channelArg as Channel;

const targets: Record<Channel, { config?: string; macosAppName: string }> = {
  stable: {
    macosAppName: "Athas.app",
  },
  preview: {
    config: "src-tauri/tauri.preview.conf.json",
    macosAppName: "Athas Preview.app",
  },
  smoke: {
    config: "src-tauri/tauri.smoke.conf.json",
    macosAppName: "Athas Smoke.app",
  },
};

const getLaunchPath = () => {
  switch (process.platform) {
    case "darwin":
      return `target/debug/bundle/macos/${targets[channel].macosAppName}`;
    case "linux":
      return path.join(process.cwd(), "target", "debug", "athas");
    case "win32":
      return path.join(process.cwd(), "target", "debug", "athas.exe");
    default:
      return null;
  }
};

const launchTarget = async () => {
  const launchPath = getLaunchPath();

  if (!launchPath) {
    console.log("Smoke build completed.");
    return;
  }

  if (openOnly && !existsSync(launchPath)) {
    console.error(`Smoke target does not exist: ${launchPath}`);
    console.error(`Run "bun run smoke:${channel === "smoke" ? "fast" : channel}" first.`);
    process.exit(1);
  }

  switch (process.platform) {
    case "darwin":
      await $`open -n ${launchPath}`.cwd(process.cwd());
      break;
    case "linux": {
      const child = Bun.spawn([launchPath], {
        cwd: process.cwd(),
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.unref();
      break;
    }
    case "win32": {
      const child = Bun.spawn(["cmd", "/c", "start", "", launchPath], {
        cwd: process.cwd(),
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.unref();
      break;
    }
  }
};

if (openOnly) {
  await launchTarget();
  process.exit(0);
}

const target = targets[channel];
const buildArgs = ["tauri", "build", "--debug"];

if (process.platform === "darwin") {
  buildArgs.push("--bundles", "app");
} else {
  buildArgs.push("--no-bundle");
}

if (process.platform === "darwin") {
  buildArgs.push("--skip-stapling");
}

if (target.config) {
  buildArgs.push("--config", target.config);
}

await $`bunx ${buildArgs}`.cwd(process.cwd());

await launchTarget();
