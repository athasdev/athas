#!/usr/bin/env bun

import { $ } from "bun";
import process from "node:process";
import path from "node:path";
import { existsSync } from "node:fs";
import { getSmokeLaunchPath, parseSmokeOptions, smokeTargets } from "./config";

// Examples:
//   bun run smoke:macos
//   bun run smoke:linux
//   bun run smoke:windows
//   bun run smoke:macos -- --identity preview
//   bun run smoke:macos -- --identity stable --open-only

const args = process.argv.slice(2);

const usage = () => {
  console.error(
    "Usage: bun scripts/smoke-app.ts --platform macos|linux|windows [--identity smoke|preview|stable] [--open-only]",
  );
};

let options: ReturnType<typeof parseSmokeOptions>;
try {
  options = parseSmokeOptions(args, process.platform);
} catch (error) {
  if (error instanceof Error && !error.message.startsWith("Invalid smoke")) {
    console.error(error.message);
  }
  usage();
  process.exit(1);
}
const { identity, openOnly, targetPlatform } = options;

const getLaunchPath = () => getSmokeLaunchPath(process.cwd(), targetPlatform, identity);

const getExpectedMacosExecutablePath = (launchPath: string) =>
  path.resolve(process.cwd(), launchPath, "Contents", "MacOS", "athas");

const getRunningMacosProcessForPath = async (executablePath: string) => {
  const processList = await $`ps -axo pid=,command=`.quiet().text();
  const expectedCommand = `${executablePath}`;

  for (const line of processList.split("\n")) {
    const trimmedLine = line.trim();

    if (!trimmedLine.includes(expectedCommand)) {
      continue;
    }

    const match = trimmedLine.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    return {
      pid: match[1],
      command: match[2],
    };
  }

  return null;
};

const verifyMacosLaunch = async (launchPath: string) => {
  const executablePath = getExpectedMacosExecutablePath(launchPath);
  const timeoutMs = 10_000;
  const intervalMs = 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const processInfo = await getRunningMacosProcessForPath(executablePath);

    if (processInfo) {
      console.log(`Smoke app launched from expected bundle (pid ${processInfo.pid}).`);
      return;
    }

    await Bun.sleep(intervalMs);
  }

  console.error(`Smoke app did not launch from expected bundle: ${launchPath}`);
  console.error(
    "If the production app appeared instead, close the app with the same bundle identifier or use the smoke channel.",
  );
  process.exit(1);
};

const launchTarget = async () => {
  const launchPath = getLaunchPath();

  if (!launchPath) {
    console.log("Smoke build completed.");
    return;
  }

  if (openOnly && !existsSync(launchPath)) {
    console.error(`Smoke target does not exist: ${launchPath}`);
    console.error(`Run "bun run smoke:${targetPlatform}" first.`);
    process.exit(1);
  }

  switch (targetPlatform) {
    case "macos":
      await $`open -n ${launchPath}`.cwd(process.cwd());
      await verifyMacosLaunch(launchPath);
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
    case "windows": {
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

const target = smokeTargets[identity];
const buildArgs = ["tauri", "build", "--debug"];

if (targetPlatform === "macos") {
  buildArgs.push("--bundles", "app");
  buildArgs.push("--no-sign");
} else {
  buildArgs.push("--no-bundle");
}

if (targetPlatform === "macos") {
  buildArgs.push("--skip-stapling");
}

if (target.config) {
  buildArgs.push("--config", target.config);
}

buildArgs.push(
  "--config",
  JSON.stringify({
    bundle: {
      createUpdaterArtifacts: false,
      macOS: {
        signingIdentity: null,
      },
    },
    plugins: {
      updater: {
        active: false,
      },
    },
  }),
);

if (targetPlatform === "linux") {
  await $`cargo ${buildArgs} -- --no-default-features --features linux`.cwd(process.cwd());
} else {
  await $`bunx ${buildArgs}`.cwd(process.cwd());
}

await launchTarget();
