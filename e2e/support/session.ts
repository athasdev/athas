import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, it } from "bun:test";
import { Builder, Capabilities, type WebDriver } from "selenium-webdriver";
import { stopAppProcesses } from "./app-process.ts";
import { ATTACH_TO_APP, DRIVER_URL } from "./driver.ts";
import { killAttachedApp, launchAppForAttach } from "./windows-attach.ts";
import { appBinary, appDataDir, artifactsDir, resetSessionState, workspaceDir } from "./paths.ts";

const QUIT_TIMEOUT = 15_000;

let current: WebDriver | undefined;
let currentSpec = "session";

export function driver(): WebDriver {
  if (!current) throw new Error("No app session; call useAppSession() in the spec file");
  return current;
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 120);
}

/** tauri-driver launches the app itself, passing the workspace on the command line. */
function tauriDriverCapabilities() {
  const capabilities = new Capabilities();
  capabilities.setBrowserName("wry");
  capabilities.set("tauri:options", { application: appBinary, args: [workspaceDir] });
  return capabilities;
}

/**
 * Starts a fresh app for the spec file: a wiped app data directory, a
 * pristine fixture project, and a new WebDriver session that opens it.
 */
export function useAppSession(spec: string) {
  beforeAll(async () => {
    currentSpec = spec;
    await stopAppProcesses();
    resetSessionState();
    const capabilities = ATTACH_TO_APP
      ? await launchAppForAttach(safeFileName(spec))
      : tauriDriverCapabilities();
    current = await new Builder().usingServer(DRIVER_URL).withCapabilities(capabilities).build();
  });

  afterAll(async () => {
    const session = current;
    current = undefined;
    if (session) {
      const timeout = new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT));
      await Promise.race([session.quit().catch(() => undefined), timeout]);
    }
    if (ATTACH_TO_APP) killAttachedApp();
    await stopAppProcesses();
    const logsDir = path.join(appDataDir, "logs");
    if (existsSync(logsDir)) {
      cpSync(logsDir, path.join(artifactsDir, "app-logs", safeFileName(spec)), { recursive: true });
    }
  });
}

async function saveFailureArtifacts(testName: string) {
  if (!current) return;
  const dir = path.join(artifactsDir, "failures");
  mkdirSync(dir, { recursive: true });
  const name = safeFileName(`${currentSpec}-${testName}`);
  const screenshot = await current.takeScreenshot().catch(() => undefined);
  if (screenshot) writeFileSync(path.join(dir, `${name}.png`), screenshot, "base64");
  const source = await current.getPageSource().catch(() => "");
  writeFileSync(path.join(dir, `${name}.html`), source);
}

/** A test that saves a screenshot and the page source when it fails. */
export function e2eTest(name: string, run: () => Promise<void>) {
  it(name, async () => {
    try {
      await run();
    } catch (error) {
      await saveFailureArtifacts(name);
      throw error;
    }
  });
}
