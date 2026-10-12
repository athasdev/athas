// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  check: vi.fn(),
  appUpdateMode: vi.fn(),
  openExternalUrl: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: io.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: io.relaunch }));
vi.mock("@/bindings/commands", () => ({
  commands: { appUpdateMode: io.appUpdateMode },
}));
vi.mock("@/utils/external-url", () => ({ openExternalUrl: io.openExternalUrl }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ buffers: [] }) },
}));
vi.mock("@/features/file-system/services/workspace-project-transition", () => ({
  prepareProjectTransitionWithUnsavedBuffers: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordUpdateCheckTelemetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../stores/whats-new.store", () => ({
  useWhatsNewStore: { getState: () => ({ actions: { queuePendingUpdate: vi.fn() } }) },
}));
vi.mock("../stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: { updateChannel: "stable" } }) },
}));
vi.mock("../lib/update-preferences", () => ({
  clearUpdatePreferencesForNewVersion: vi.fn(),
  notifyUpdateDismissed: vi.fn(),
  remindAboutUpdateLater: vi.fn(),
  shouldSuppressUpdate: () => false,
  skipUpdateVersion: vi.fn(),
}));

type Updater = ReturnType<typeof import("../hooks/use-updater").useUpdater>;

let root: Root | null = null;
let updater: Updater | null = null;

const update = {
  available: true,
  version: "2.0.0",
  currentVersion: "1.0.0",
  body: "Notes",
  date: "2026-10-01",
  rawJson: {},
  downloadAndInstall: vi.fn().mockResolvedValue(undefined),
};

async function renderUpdater(mode: "self" | "notify" | "external") {
  vi.resetModules();
  io.appUpdateMode.mockResolvedValue(mode);
  const { useUpdater } = await import("../hooks/use-updater");
  const Probe = () => {
    updater = useUpdater(false);
    return null;
  };

  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(<Probe />);
  });
}

function current() {
  if (!updater) throw new Error("Updater was not rendered");
  return updater;
}

describe("updater install modes", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    io.check.mockReset().mockResolvedValue(update);
    io.openExternalUrl.mockReset().mockResolvedValue(undefined);
    io.relaunch.mockReset().mockResolvedValue(undefined);
    update.downloadAndInstall.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    updater = null;
  });

  it("stays quiet for installs a package manager updates", async () => {
    await renderUpdater("external");

    let found = true;
    await act(async () => {
      found = await current().checkForUpdates();
    });

    expect(found).toBe(false);
    expect(io.check).not.toHaveBeenCalled();
    expect(current().available).toBe(false);
  });

  it("announces new versions and opens the download page instead of installing", async () => {
    await renderUpdater("notify");

    await act(async () => {
      await current().checkForUpdates();
    });

    expect(current().available).toBe(true);
    expect(current().updateMode).toBe("notify");
    expect(current().updateInfo?.version).toBe("2.0.0");

    await act(async () => {
      await current().downloadAndInstall();
    });

    expect(io.openExternalUrl).toHaveBeenCalledWith("https://athas.dev/download");
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(io.relaunch).not.toHaveBeenCalled();
  });

  it("installs the update in place when Athas can replace itself", async () => {
    await renderUpdater("self");

    await act(async () => {
      await current().checkForUpdates();
    });
    await act(async () => {
      await current().downloadAndInstall();
    });

    expect(current().updateMode).toBe("self");
    expect(update.downloadAndInstall).toHaveBeenCalled();
    expect(io.openExternalUrl).not.toHaveBeenCalled();
    expect(io.relaunch).toHaveBeenCalled();
  });
});
