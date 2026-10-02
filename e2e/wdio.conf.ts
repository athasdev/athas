import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { SevereServiceError } from "webdriverio";
import {
  appBinary,
  appDataDir,
  artifactsDir,
  repoRoot,
  resetSessionState,
  sandboxDir,
  workspaceDir,
} from "./support/paths.ts";

const DRIVER_HOST = "127.0.0.1";
const DRIVER_PORT = Number(process.env.TAURI_DRIVER_PORT ?? 4444);

let tauriDriver: ChildProcess | undefined;

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
          reject(new Error(`tauri-driver did not listen on port ${port} in time`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

async function startHarness() {
  mkdirSync(artifactsDir, { recursive: true });

  if (process.env.ATHAS_E2E_SKIP_BUILD !== "1") {
    const build = spawnSync("bun", ["run", "e2e:build"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (build.status !== 0) {
      throw new Error(`e2e:build failed with exit code ${build.status}`);
    }
  }

  if (!existsSync(appBinary)) {
    throw new Error(`App binary not found at ${appBinary}. Run \`bun run e2e:build\` first.`);
  }

  const args = ["--port", String(DRIVER_PORT)];
  if (process.env.TAURI_NATIVE_DRIVER) {
    args.push("--native-driver", process.env.TAURI_NATIVE_DRIVER);
  }

  const driverLog = createWriteStream(path.join(artifactsDir, "tauri-driver.log"));
  const driver = spawn(resolveTauriDriver(), args, {
    env: driverEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  tauriDriver = driver;
  driver.stdout?.pipe(driverLog);
  driver.stderr?.pipe(driverLog);

  const driverFailed = new Promise<never>((resolve, reject) => {
    driver.once("error", (error) => reject(new Error(`Failed to start tauri-driver: ${error}`)));
    driver.once("exit", (code) => reject(new Error(`tauri-driver exited early with ${code}`)));
  });
  await Promise.race([waitForPort(DRIVER_PORT, 30_000), driverFailed]);
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 120);
}

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: DRIVER_HOST,
  port: DRIVER_PORT,
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": {
        application: appBinary,
        args: [workspaceDir],
      },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  outputDir: path.join(artifactsDir, "wdio-logs"),
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },

  async onPrepare() {
    // WebdriverIO only aborts the run for a SevereServiceError; any other
    // error would be logged while every spec fails to connect.
    try {
      await startHarness();
    } catch (error) {
      tauriDriver?.kill();
      throw new SevereServiceError(error instanceof Error ? error.message : String(error));
    }
  },

  beforeSession() {
    resetSessionState();
  },

  async afterTest(test, context, { passed }) {
    if (passed) return;
    const dir = path.join(artifactsDir, "failures");
    mkdirSync(dir, { recursive: true });
    const name = safeFileName(`${test.parent}-${test.title}`);
    await browser.saveScreenshot(path.join(dir, `${name}.png`)).catch(() => undefined);
    const source = await browser.getPageSource().catch(() => "");
    writeFileSync(path.join(dir, `${name}.html`), source);
  },

  afterSession(sessionConfig, capabilities, specs) {
    const logsDir = path.join(appDataDir, "logs");
    if (!existsSync(logsDir)) return;
    const spec = safeFileName(path.basename(specs[0] ?? "session"));
    cpSync(logsDir, path.join(artifactsDir, "app-logs", spec), { recursive: true });
  },

  onComplete() {
    tauriDriver?.kill();
  },
};
