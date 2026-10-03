import { spawnSync } from "node:child_process";
import { appBinary } from "./paths.ts";

/*
 * Ending a WebDriver session asks the app to close, but the app can outlive it
 * (a close guard, a slow shutdown). A survivor would hold the single-instance
 * lock, so the next spec's launch would be forwarded to it, and it would keep
 * writing into the app data directory while that is being reset. Every
 * process started from the e2e binary is therefore killed, and the harness
 * waits until none is left. Only processes whose executable is this exact
 * build are matched, never an installed Athas.
 */

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function powershell(script: string) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
  });
}

function appProcessIds(): string[] {
  if (process.platform === "win32") {
    const binary = appBinary.replace(/'/g, "''");
    const result = powershell(
      `Get-Process | Where-Object { $_.Path -eq '${binary}' } | ForEach-Object { $_.Id }`,
    );
    return result.stdout.split(/\s+/).filter(Boolean);
  }
  const result = spawnSync("pgrep", ["-f", `^${escapeRegExp(appBinary)}( |$)`], {
    encoding: "utf8",
  });
  return (result.stdout ?? "").split(/\s+/).filter(Boolean);
}

function killProcesses(ids: string[]) {
  if (process.platform === "win32") {
    powershell(`Stop-Process -Force -ErrorAction SilentlyContinue -Id ${ids.join(",")}`);
  } else {
    spawnSync("kill", ["-KILL", ...ids]);
  }
}

export async function stopAppProcesses(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ids = appProcessIds();
    if (ids.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`App processes ${ids.join(", ")} are still running after ${timeoutMs}ms`);
    }
    killProcesses(ids);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
