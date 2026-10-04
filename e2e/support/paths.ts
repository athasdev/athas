import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(repoRoot, process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, "target");

export const appBinary = process.env.ATHAS_E2E_APP
  ? path.resolve(process.env.ATHAS_E2E_APP)
  : path.join(targetDir, "debug", process.platform === "win32" ? "athas.exe" : "athas");

// Must match `app > appDirectoriesOverride` in src-tauri/tauri.e2e.conf.json,
// which Tauri resolves relative to the directory containing the executable.
const APP_DATA_DIR_NAME = "e2e-app-data";
export const appDataDir = path.join(path.dirname(appBinary), APP_DATA_DIR_NAME);

export const e2eRoot = path.join(targetDir, "e2e");
export const artifactsDir = path.join(e2eRoot, "artifacts");
export const sandboxDir = path.join(e2eRoot, "sandbox");
export const workspaceDir = path.join(e2eRoot, "workspace", "sample-project");
export const fixtureDir = path.join(repoRoot, "e2e", "fixtures", "sample-project");

export function workspaceFile(...segments: string[]) {
  return path.join(workspaceDir, ...segments);
}

// Settings the app would otherwise collect on first launch. Any recorded
// version skips the first-run onboarding tab so specs start on the workbench.
const SEEDED_SETTINGS = {
  product_onboarding_state_v1: { lastSeenVersion: "e2e" },
};

/**
 * Gives every spec file a fresh app data directory and a pristine copy of the
 * fixture project. Only directories this harness owns are ever removed.
 */
export function resetSessionState() {
  if (path.basename(appDataDir) !== APP_DATA_DIR_NAME) {
    throw new Error(`Refusing to reset unexpected app data directory: ${appDataDir}`);
  }

  rmSync(appDataDir, { recursive: true, force: true });
  mkdirSync(appDataDir, { recursive: true });
  writeFileSync(path.join(appDataDir, "settings.json"), JSON.stringify(SEEDED_SETTINGS, null, 2));

  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(path.dirname(workspaceDir), { recursive: true });
  cpSync(fixtureDir, workspaceDir, { recursive: true });
}
