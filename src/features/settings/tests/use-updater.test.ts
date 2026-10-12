// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AppUpdateMode } from "@/bindings/commands";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(async () => {}),
  appUpdateMode: vi.fn(async (): Promise<AppUpdateMode> => "self"),
  prepareTransition: vi.fn(async () => true),
  recordUpdateCheck: vi.fn(async () => true),
  openOnboardingBuffer: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.0" }));
vi.mock("@/bindings/commands", () => ({
  commands: { appUpdateMode: mocks.appUpdateMode },
}));
vi.mock("@/features/file-system/services/workspace-project-transition", () => ({
  prepareProjectTransitionWithUnsavedBuffers: mocks.prepareTransition,
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordUpdateCheckTelemetry: mocks.recordUpdateCheck,
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: { updateChannel: "stable" } }) },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: [],
      actions: { openOnboardingBuffer: mocks.openOnboardingBuffer },
    }),
  },
}));

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

function fakeUpdate(overrides: Record<string, unknown> = {}) {
  const events: DownloadEvent[] = [
    { event: "Started", data: { contentLength: 200 } },
    { event: "Progress", data: { chunkLength: 50 } },
    { event: "Progress", data: { chunkLength: 150 } },
    { event: "Finished" },
  ];
  return {
    available: true,
    version: "2.0.0",
    currentVersion: "1.0.0",
    body: "",
    date: "",
    rawJson: { notes: "Faster startup", pub_date: "2026-09-01" },
    downloadAndInstall: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      for (const event of events) onEvent(event);
    }),
    ...overrides,
  };
}

async function load() {
  vi.resetModules();
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const updater = await import("../hooks/use-updater");
  const autoUpdate = await import("../hooks/use-auto-update");
  const preferences = await import("../lib/update-preferences");
  const root = createRoot(document.createElement("div"));
  roots.push({ root, act: React.act });

  function render<T>(useHook: () => T) {
    const result = { current: undefined as T };
    function Harness() {
      result.current = useHook();
      return null;
    }
    React.act(() => root.render(React.createElement(Harness)));
    return result;
  }

  return { act: React.act, render, ...updater, ...autoUpdate, preferences };
}

const roots: Array<{ root: { unmount: () => void }; act: (fn: () => void) => void }> = [];

async function settle(act: (fn: () => Promise<void>) => Promise<void>) {
  await act(async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
  });
}

describe("useUpdater", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    mocks.check.mockReset();
    mocks.relaunch.mockClear();
    mocks.appUpdateMode.mockReset();
    mocks.appUpdateMode.mockResolvedValue("self");
    mocks.prepareTransition.mockReset();
    mocks.prepareTransition.mockResolvedValue(true);
    mocks.recordUpdateCheck.mockClear();
    mocks.openOnboardingBuffer.mockClear();
  });

  afterEach(() => {
    for (const { root, act } of roots.splice(0)) act(() => root.unmount());
    vi.useRealTimers();
  });

  describe("checking", () => {
    it("checks on mount and exposes an available update with release notes from raw metadata", async () => {
      mocks.check.mockResolvedValue(fakeUpdate());
      const { render, act, useUpdater } = await load();

      const updater = render(() => useUpdater());
      await settle(act);

      expect(updater.current).toMatchObject({
        available: true,
        checking: false,
        error: null,
        updateInfo: {
          version: "2.0.0",
          currentVersion: "1.0.0",
          body: "Faster startup",
          date: "2026-09-01",
        },
      });
      expect(mocks.recordUpdateCheck).toHaveBeenCalledWith({
        status: "available",
        availableVersion: "2.0.0",
        currentVersion: "1.0.0",
      });
    });

    it("reports up to date when no update is available", async () => {
      mocks.check.mockResolvedValue({ available: false, currentVersion: "1.0.0" });
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));
      expect(mocks.check).not.toHaveBeenCalled();

      let found: boolean | undefined;
      await act(async () => {
        found = await updater.current.checkForUpdates();
      });

      expect(found).toBe(false);
      expect(updater.current).toMatchObject({ available: false, updateInfo: null });
      expect(mocks.recordUpdateCheck).toHaveBeenCalledWith({
        status: "up_to_date",
        availableVersion: null,
        currentVersion: "1.0.0",
      });
    });

    it("surfaces check failures and records them", async () => {
      mocks.check.mockRejectedValue(new Error("Network unreachable"));
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.checkForUpdates().then(() => {}));

      expect(updater.current).toMatchObject({ checking: false, error: "Network unreachable" });
      expect(mocks.recordUpdateCheck).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", error: "Network unreachable" }),
      );
    });

    it("uses a generic message for non-error failures", async () => {
      mocks.check.mockRejectedValue("nope");
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.checkForUpdates().then(() => {}));

      expect(updater.current.error).toBe("Failed to check for updates");
    });

    it("never checks on installs that update outside the app", async () => {
      mocks.appUpdateMode.mockResolvedValue("external");
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      let found: boolean | undefined;
      await act(async () => {
        found = await updater.current.checkForUpdates();
      });

      expect(found).toBe(false);
      expect(mocks.check).not.toHaveBeenCalled();
    });

    it("assumes self-update support when the platform query fails", async () => {
      mocks.appUpdateMode.mockRejectedValue(new Error("unknown command"));
      mocks.check.mockResolvedValue(fakeUpdate());
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.checkForUpdates().then(() => {}));

      expect(updater.current.available).toBe(true);
    });

    it("hides a skipped version unless suppression is ignored", async () => {
      mocks.check.mockResolvedValue(fakeUpdate());
      const { render, act, useUpdater, preferences } = await load();
      preferences.skipUpdateVersion({ version: "2.0.0" });
      const updater = render(() => useUpdater(false));

      let found: boolean | undefined;
      await act(async () => {
        found = await updater.current.checkForUpdates();
      });
      expect(found).toBe(false);
      expect(updater.current.available).toBe(false);
      expect(mocks.recordUpdateCheck).toHaveBeenCalledWith(
        expect.objectContaining({ status: "available", availableVersion: "2.0.0" }),
      );

      await act(async () => {
        found = await updater.current.checkForUpdates({ ignoreSuppression: true });
      });
      expect(found).toBe(true);
      expect(updater.current.available).toBe(true);
    });

    it("forgets a skipped older version once a newer one ships", async () => {
      mocks.check.mockResolvedValue(fakeUpdate({ version: "3.0.0" }));
      const { render, act, useUpdater, preferences } = await load();
      preferences.skipUpdateVersion({ version: "2.0.0" });
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.checkForUpdates().then(() => {}));

      expect(updater.current.available).toBe(true);
      expect(preferences.readUpdatePreferences().skippedVersion).toBeUndefined();
    });
  });

  describe("installing", () => {
    it("tracks download progress, queues release notes and relaunches", async () => {
      const update = fakeUpdate({ body: "Notes" });
      mocks.check.mockResolvedValue(update);
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater());
      await settle(act);

      await act(() => updater.current.downloadAndInstall());

      expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(updater.current).toMatchObject({
        downloading: false,
        installing: true,
        downloadProgress: { contentLength: 200, downloaded: 200, percentage: 100 },
      });
      expect(mocks.relaunch).toHaveBeenCalledTimes(1);
      const whatsNew = JSON.parse(window.localStorage.getItem("athas-whats-new") ?? "{}");
      expect(whatsNew.pending).toMatchObject({
        version: "2.0.0",
        previousVersion: "1.0.0",
        body: "Notes",
      });
    });

    it("reports intermediate percentages while downloading", async () => {
      const update = fakeUpdate();
      let finishDownload: () => void = () => {};
      update.downloadAndInstall.mockImplementation(async (onEvent) => {
        onEvent({ event: "Started", data: { contentLength: 200 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        await new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
        onEvent({ event: "Finished" });
      });
      mocks.check.mockResolvedValue(update);
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      let pending!: Promise<void>;
      await act(async () => {
        pending = updater.current.downloadAndInstall();
        for (let index = 0; index < 5; index++) await Promise.resolve();
      });
      expect(updater.current).toMatchObject({
        downloading: true,
        installing: false,
        downloadProgress: { contentLength: 200, downloaded: 50, percentage: 25 },
      });

      await act(async () => {
        finishDownload();
        await pending;
      });
      expect(updater.current).toMatchObject({ downloading: false, installing: true });
    });

    it("re-checks when there is no cached update and fails when none exists", async () => {
      mocks.check.mockResolvedValue({ available: false, currentVersion: "1.0.0" });
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.downloadAndInstall());

      expect(mocks.check).toHaveBeenCalledTimes(1);
      expect(updater.current).toMatchObject({
        downloading: false,
        installing: false,
        downloadProgress: null,
        error: "No update available",
      });
      expect(mocks.relaunch).not.toHaveBeenCalled();
    });

    it("does not restart when the user cancels saving open files", async () => {
      const update = fakeUpdate();
      mocks.check.mockResolvedValue(update);
      mocks.prepareTransition.mockResolvedValue(false);
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.downloadAndInstall());

      expect(mocks.prepareTransition).toHaveBeenCalledWith("restarting to update", []);
      expect(update.downloadAndInstall).not.toHaveBeenCalled();
      expect(updater.current.downloading).toBe(false);
    });

    it("resets progress and reports the error when installing fails", async () => {
      const update = fakeUpdate();
      update.downloadAndInstall.mockRejectedValue(new Error("Signature mismatch"));
      mocks.check.mockResolvedValue(update);
      const { render, act, useUpdater } = await load();
      const updater = render(() => useUpdater(false));

      await act(() => updater.current.downloadAndInstall());

      expect(updater.current).toMatchObject({
        downloading: false,
        installing: false,
        downloadProgress: null,
        error: "Signature mismatch",
      });
      expect(mocks.relaunch).not.toHaveBeenCalled();
    });
  });

  describe("deferring", () => {
    async function withAvailableUpdate() {
      mocks.check.mockResolvedValue(fakeUpdate());
      const loaded = await load();
      const updater = loaded.render(() => loaded.useUpdater());
      await settle(loaded.act);
      return { ...loaded, updater };
    }

    it("reminds later by hiding the version until the delay passes", async () => {
      const { act, updater, preferences } = await withAvailableUpdate();
      const before = Date.now();

      act(() => updater.current.remindLater(60_000));

      expect(updater.current).toMatchObject({ available: false, updateInfo: null });
      const saved = preferences.readUpdatePreferences();
      expect(saved.remindVersion).toBe("2.0.0");
      expect(saved.remindAfter).toBeGreaterThanOrEqual(before + 60_000);
      expect(preferences.shouldSuppressUpdate({ version: "2.0.0" })).toBe(true);
      expect(preferences.shouldSuppressUpdate({ version: "2.0.0" }, saved.remindAfter! + 1)).toBe(
        false,
      );
    });

    it("skips the version permanently", async () => {
      const { act, updater, preferences } = await withAvailableUpdate();

      act(() => updater.current.skipVersion());

      expect(preferences.readUpdatePreferences()).toEqual({ skippedVersion: "2.0.0" });
      expect(updater.current.available).toBe(false);
    });

    it("ignores remind, skip and release notes when no update is known", async () => {
      mocks.check.mockResolvedValue({ available: false, currentVersion: "1.0.0" });
      const { render, act, useUpdater, preferences } = await load();
      const updater = render(() => useUpdater(false));

      act(() => {
        updater.current.remindLater();
        updater.current.skipVersion();
        updater.current.viewReleaseNotes();
      });

      expect(preferences.readUpdatePreferences()).toEqual({});
      expect(mocks.openOnboardingBuffer).not.toHaveBeenCalled();
    });

    it("opens the release notes for the available version", async () => {
      const { act, updater } = await withAvailableUpdate();

      await act(async () => updater.current.viewReleaseNotes());
      await settle(act);

      expect(mocks.openOnboardingBuffer).toHaveBeenCalledWith({
        mode: "release-notes",
        currentVersion: "2.0.0",
        previousVersion: "1.0.0",
      });
    });
  });
});

describe("useAutoUpdate", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    mocks.check.mockReset();
    mocks.appUpdateMode.mockResolvedValue("self");
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const { root, act } of roots.splice(0)) act(() => root.unmount());
    vi.useRealTimers();
  });

  async function advance(act: (fn: () => Promise<void>) => Promise<void>, ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("checks five seconds after start and every four hours", async () => {
    mocks.check.mockResolvedValue({ available: false, currentVersion: "1.0.0" });
    const { render, act, useAutoUpdate } = await load();
    render(() => useAutoUpdate());

    await advance(act, 4_999);
    expect(mocks.check).not.toHaveBeenCalled();
    await advance(act, 1);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await advance(act, 4 * 60 * 60 * 1000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it("shows the indicator for an available update and hides it on dismiss", async () => {
    mocks.check.mockResolvedValue(fakeUpdate());
    const { render, act, useAutoUpdate } = await load();
    const auto = render(() => useAutoUpdate());

    await advance(act, 5_000);
    expect(auto.current.showUpdateIndicator).toBe(true);
    expect(auto.current.updateInfo?.version).toBe("2.0.0");

    act(() => auto.current.onDismiss());
    expect(auto.current.showUpdateIndicator).toBe(false);
    expect(auto.current.updateInfo).toBeNull();
  });

  it("hides the indicator when another window skips the version", async () => {
    mocks.check.mockResolvedValue(fakeUpdate());
    const { render, act, useAutoUpdate, preferences } = await load();
    const auto = render(() => useAutoUpdate());
    await advance(act, 5_000);

    act(() => preferences.skipUpdateVersion({ version: "2.0.0" }));

    expect(auto.current.showUpdateIndicator).toBe(false);
    expect(auto.current.updateInfo).toBeNull();
  });

  it("keeps the indicator when preferences change for a different version", async () => {
    mocks.check.mockResolvedValue(fakeUpdate());
    const { render, act, useAutoUpdate, preferences } = await load();
    const auto = render(() => useAutoUpdate());
    await advance(act, 5_000);

    act(() => preferences.skipUpdateVersion({ version: "9.9.9" }));

    expect(auto.current.showUpdateIndicator).toBe(true);
  });

  it("hides the indicator on remind-later and skip", async () => {
    mocks.check.mockResolvedValue(fakeUpdate());
    const { render, act, useAutoUpdate, preferences } = await load();
    const auto = render(() => useAutoUpdate());
    await advance(act, 5_000);

    act(() => auto.current.onRemindLater());
    expect(auto.current.showUpdateIndicator).toBe(false);
    expect(preferences.readUpdatePreferences().remindVersion).toBe("2.0.0");

    await act(async () => {
      await auto.current.checkForUpdates({ ignoreSuppression: true });
    });
    expect(auto.current.showUpdateIndicator).toBe(true);

    act(() => auto.current.onSkipVersion());
    expect(auto.current.showUpdateIndicator).toBe(false);
    expect(preferences.readUpdatePreferences().skippedVersion).toBe("2.0.0");
  });

  it("installs through the download handler", async () => {
    const update = fakeUpdate();
    mocks.check.mockResolvedValue(update);
    const { render, act, useAutoUpdate } = await load();
    const auto = render(() => useAutoUpdate());
    await advance(act, 5_000);

    await act(() => auto.current.onDownload());

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(auto.current.installing).toBe(true);
  });
});
