import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

interface CapabilityConfig {
  permissions: string[];
}

interface WindowsConfig {
  app: {
    windows: Array<{
      additionalBrowserArgs?: string;
      transparent?: boolean;
    }>;
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as T;
}

describe("Windows runtime configuration", () => {
  it("grants every capability used by the custom window controls", () => {
    const capability = readJson<CapabilityConfig>("src-tauri/capabilities/main.json");

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-close",
        "core:window:allow-maximize",
        "core:window:allow-minimize",
        "core:window:allow-set-fullscreen",
        "core:window:allow-toggle-maximize",
      ]),
    );
  });

  it("uses an opaque window without overriding WebView2 browser safeguards", () => {
    const config = readJson<WindowsConfig>("src-tauri/tauri.windows.conf.json");
    const mainWindow = config.app.windows.find((window) => window.transparent === false);

    expect(mainWindow).toBeDefined();
    expect(mainWindow).not.toHaveProperty("additionalBrowserArgs");
  });
});
