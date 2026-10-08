import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { tauriWindow, platformState } = vi.hoisted(() => ({
  tauriWindow: {
    isFullscreen: vi.fn(async () => false),
    setFullscreen: vi.fn(async (_fullscreen: boolean) => {}),
    minimize: vi.fn(async () => {}),
    maximize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
  },
  platformState: { mac: true },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => tauriWindow,
}));

vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMac: () => platformState.mac,
}));

import { windowCommands } from "../commands/window-commands";

async function runCommand(id: string) {
  const command = windowCommands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Missing command ${id}`);
  await command.execute();
}

describe("window commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformState.mac = true;
  });

  it("toggles native fullscreen from the current state", async () => {
    tauriWindow.isFullscreen.mockResolvedValueOnce(false);
    await runCommand("window.toggleFullscreen");
    await vi.waitFor(() => expect(tauriWindow.setFullscreen).toHaveBeenCalledWith(true));

    tauriWindow.isFullscreen.mockResolvedValueOnce(true);
    await runCommand("window.toggleFullscreen");
    await vi.waitFor(() => expect(tauriWindow.setFullscreen).toHaveBeenLastCalledWith(false));
  });

  it("minimizes the window from the palette entry on every platform", async () => {
    await runCommand("window.minimize");
    platformState.mac = false;
    await runCommand("window.minimize");

    await vi.waitFor(() => expect(tauriWindow.minimize).toHaveBeenCalledTimes(2));
  });

  it("toggles maximize from the palette entry", async () => {
    await runCommand("window.toggleMaximize");

    await vi.waitFor(() => expect(tauriWindow.toggleMaximize).toHaveBeenCalledTimes(1));
  });

  it("keeps platform-specific shortcut variants on their own platform", async () => {
    platformState.mac = true;
    await runCommand("window.minimize.mac");
    await runCommand("window.minimize.alt");
    await runCommand("window.maximize");
    await runCommand("window.toggleFullscreenMac");

    await vi.waitFor(() => expect(tauriWindow.minimize).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(tauriWindow.setFullscreen).toHaveBeenCalledTimes(1));
    expect(tauriWindow.maximize).not.toHaveBeenCalled();

    vi.clearAllMocks();
    platformState.mac = false;
    await runCommand("window.minimize.mac");
    await runCommand("window.minimize.alt");
    await runCommand("window.maximize");
    await runCommand("window.toggleFullscreenMac");

    await vi.waitFor(() => expect(tauriWindow.minimize).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(tauriWindow.maximize).toHaveBeenCalledTimes(1));
    expect(tauriWindow.setFullscreen).not.toHaveBeenCalled();
  });
});
