import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { appBinary, artifactsDir, repoRoot, sandboxDir } from "./paths.ts";
import { logProcessOutput } from "./process-log.ts";

const DRIVER_HOST = "127.0.0.1";
const DRIVER_PORT = Number(process.env.TAURI_DRIVER_PORT ?? 4444);
export const DRIVER_URL = `http://${DRIVER_HOST}:${DRIVER_PORT}/`;

/*
 * On Windows the harness does not use tauri-driver. WebView2 150+ ignores the
 * `--remote-debugging-port` that msedgedriver passes through
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS once the app sets its own browser
 * arguments (wry always does), and msedgedriver turns every launch argument
 * into a `--switch`. The Windows e2e build therefore opens a fixed DevTools
 * port itself (src-tauri/tauri.e2e.windows.conf.json), the harness launches
 * the app with the workspace as a plain argument, and msedgedriver attaches to
 * that port.
 */
export const ATTACH_TO_APP = process.platform === "win32";
export const DEBUGGER_ADDRESS = "127.0.0.1:9222";

let nativeDriver: ChildProcess | undefined;

function resolveTauriDriver() {
  if (process.env.TAURI_DRIVER_PATH) return process.env.TAURI_DRIVER_PATH;
  const executable = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  const cargoInstalled = path.join(os.homedir(), ".cargo", "bin", executable);
  return existsSync(cargoInstalled) ? cargoInstalled : executable;
}

/**
 * On Linux the app resolves a few fallback paths through XDG variables rather
 * than Tauri's path API. Pointing them at the sandbox keeps those inside the
 * throwaway tree as well. The app inherits this environment from the driver.
 */
function driverEnvironment(): NodeJS.ProcessEnv {
  if (process.platform !== "linux") return process.env;
  const xdg = (name: string) => {
    const dir = path.join(sandboxDir, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    ...process.env,
    XDG_CONFIG_HOME: xdg("config"),
    XDG_DATA_HOME: xdg("data"),
    XDG_CACHE_HOME: xdg("cache"),
    XDG_STATE_HOME: xdg("state"),
  };
}

function waitForPort(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = connect(port, DRIVER_HOST);
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`The WebDriver server did not listen on port ${port} in time`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

function buildApp() {
  const script = ATTACH_TO_APP ? "e2e:build:windows" : "e2e:build";
  const build = spawnSync("bun", ["run", script], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (build.status !== 0) {
    throw new Error(`${script} failed with exit code ${build.status}`);
  }
}

/** tauri-driver on Linux, msedgedriver itself on Windows (see ATTACH_TO_APP). */
function spawnNativeDriver() {
  if (ATTACH_TO_APP) {
    const msedgedriver = process.env.TAURI_NATIVE_DRIVER ?? "msedgedriver.exe";
    return {
      name: "msedgedriver",
      child: spawn(
        msedgedriver,
        [
          `--port=${DRIVER_PORT}`,
          "--verbose",
          `--log-path=${path.join(artifactsDir, "msedgedriver.log")}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    };
  }

  const args = ["--port", String(DRIVER_PORT)];
  if (process.env.TAURI_NATIVE_DRIVER) {
    args.push("--native-driver", process.env.TAURI_NATIVE_DRIVER);
  }
  return {
    name: "tauri-driver",
    child: spawn(resolveTauriDriver(), args, {
      env: driverEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  };
}

/** Builds the e2e binary (unless skipped) and starts the WebDriver server. */
export async function startHarness() {
  mkdirSync(artifactsDir, { recursive: true });

  if (process.env.ATHAS_E2E_SKIP_BUILD !== "1") buildApp();

  if (!existsSync(appBinary)) {
    throw new Error(`App binary not found at ${appBinary}. Run \`bun run e2e:build\` first.`);
  }

  const { name, child } = spawnNativeDriver();
  nativeDriver = child;
  // msedgedriver writes its own verbose log; this keeps its console output apart.
  const logName = ATTACH_TO_APP ? `${name}.out.log` : `${name}.log`;
  logProcessOutput(child, path.join(artifactsDir, logName));

  const driverFailed = new Promise<never>((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`Failed to start ${name}: ${error}`)));
    child.once("exit", (code) => reject(new Error(`${name} exited early with ${code}`)));
  });
  try {
    await Promise.race([waitForPort(DRIVER_PORT, 30_000), driverFailed]);
  } catch (error) {
    stopHarness();
    throw error;
  }
}

export function stopHarness() {
  nativeDriver?.kill();
  nativeDriver = undefined;
}
