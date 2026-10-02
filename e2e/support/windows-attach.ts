import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Capabilities } from "selenium-webdriver";
import { DEBUGGER_ADDRESS } from "./driver.ts";
import { appBinary, artifactsDir, workspaceDir } from "./paths.ts";

const DEVTOOLS_TIMEOUT = 60_000;

let app: ChildProcess | undefined;

/** The browser answers before the main window's page exists; wait for both. */
async function devToolsReady() {
  try {
    const version = await fetch(`http://${DEBUGGER_ADDRESS}/json/version`);
    if (!version.ok) return false;
    const list = await fetch(`http://${DEBUGGER_ADDRESS}/json/list`);
    const targets = (await list.json()) as Array<{ type?: string }>;
    return targets.some((target) => target.type === "page");
  } catch {
    return false;
  }
}

/**
 * Launches the e2e build with the workspace as a plain argument and waits for
 * its DevTools endpoint, then returns capabilities that attach msedgedriver to
 * it. See ATTACH_TO_APP in driver.ts for why Windows does not let the driver
 * launch the app.
 */
export async function launchAppForAttach(logName: string) {
  const logsDir = path.join(artifactsDir, "app-output");
  mkdirSync(logsDir, { recursive: true });
  const output = createWriteStream(path.join(logsDir, `${logName}.log`));

  const child = spawn(appBinary, [workspaceDir], { stdio: ["ignore", "pipe", "pipe"] });
  app = child;
  child.stdout?.pipe(output);
  child.stderr?.pipe(output);

  let exited: string | undefined;
  child.once("error", (error) => (exited = `failed to start: ${error}`));
  child.once("exit", (code) => (exited = `exited with ${code}`));

  const deadline = Date.now() + DEVTOOLS_TIMEOUT;
  while (!(await devToolsReady())) {
    if (exited) throw new Error(`The e2e app ${exited} before opening DevTools`);
    if (Date.now() > deadline) {
      throw new Error(`The e2e app did not open DevTools on ${DEBUGGER_ADDRESS} in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const capabilities = new Capabilities();
  capabilities.setBrowserName("webview2");
  capabilities.set("ms:edgeOptions", { debuggerAddress: DEBUGGER_ADDRESS });
  return capabilities;
}

/** Kills the app started by launchAppForAttach; callers still sweep strays. */
export function killAttachedApp() {
  app?.kill();
  app = undefined;
}
