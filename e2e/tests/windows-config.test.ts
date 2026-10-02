import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcTauri = path.resolve(import.meta.dirname, "../../src-tauri");

function mainWindow(file: string) {
  const config = JSON.parse(readFileSync(path.join(srcTauri, file), "utf8"));
  return config.app.windows[0] as Record<string, unknown>;
}

describe("Windows e2e config overlay", () => {
  // Tauri merges configs as JSON merge patches, so the overlay's window list
  // replaces the app's whole list. It must stay a copy of the Windows window
  // plus the browser arguments that open the DevTools port for WebDriver.
  it("keeps the Windows main window and only adds browser arguments", () => {
    const { additionalBrowserArgs, ...window } = mainWindow("tauri.e2e.windows.conf.json");

    expect(window).toEqual(mainWindow("tauri.windows.conf.json"));
    expect(additionalBrowserArgs).toBe(
      "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9222",
    );
  });
});
