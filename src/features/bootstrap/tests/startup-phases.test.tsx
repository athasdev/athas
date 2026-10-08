// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const state = {
    events: [] as string[],
    fontFamily: "default-font",
    finishSettingsLoad: (_outcome: "loaded" | "failed") => {},
  };

  const recordHook = (name: string) => () => {
    state.events.push(`${name}:${state.fontFamily}`);
  };

  return {
    state,
    initializeSettingsStore: vi.fn(() => {
      state.events.push("settings:start");
      return new Promise<void>((resolve, reject) => {
        state.finishSettingsLoad = (outcome) => {
          if (outcome === "failed") {
            reject(new Error("settings unavailable"));
            return;
          }
          state.fontFamily = "saved-font";
          state.events.push("settings:loaded");
          resolve();
        };
      });
    }),
    recordCrashReport: vi.fn(),
    useSettingsSync: recordHook("settingsSync"),
    useFontLoading: recordHook("fontLoading"),
    useNativeMenuState: recordHook("nativeMenuState"),
    useSystemAccessibility: recordHook("systemAccessibility"),
  };
});

vi.mock("@/features/window/services/window-open-diagnostics", () => ({ traceWindowOpen: vi.fn() }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  initializeSettingsStore: mocks.initializeSettingsStore,
}));
vi.mock("../bootstrap-sync", () => ({
  runSynchronousBootstrapSteps: () => mocks.state.events.push("sync-steps"),
}));
vi.mock("@/extensions/themes/theme-initializer", () => ({
  initializeThemeSystem: async () => {
    mocks.state.events.push("theme");
  },
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  initializeTelemetry: async () => {
    mocks.state.events.push("telemetry");
  },
  recordCrashReport: mocks.recordCrashReport,
}));
vi.mock("@/extensions/runtime/extension-runtime", () => ({
  initializeExtensionRuntime: async () => {
    mocks.state.events.push("extensions");
  },
}));
vi.mock("@/features/ai/intelligence/hooks/use-intelligence-settings-sync", () => ({
  useIntelligenceSettingsSync: () => undefined,
}));
vi.mock("@/features/settings/hooks/use-settings-sync", () => ({
  useSettingsSync: mocks.useSettingsSync,
}));
vi.mock("@/features/settings/hooks/use-font-loading", () => ({
  useFontLoading: mocks.useFontLoading,
}));
vi.mock("@/features/window/hooks/use-native-menu-state", () => ({
  useNativeMenuState: mocks.useNativeMenuState,
}));
vi.mock("@/features/settings/hooks/use-system-accessibility", () => ({
  useSystemAccessibility: mocks.useSystemAccessibility,
}));

async function loadStartupModules() {
  const bootstrap = await import("../services/initialize-app-bootstrap");
  const phaseStore = await import("../stores/bootstrap-phase.store");
  const { SettingsReadyBootstrap } = await import("../components/settings-ready-bootstrap");
  phaseStore.useBootstrapPhaseStore.subscribe((state, previous) => {
    if (state.phase !== previous.phase) mocks.state.events.push(`phase:${state.phase}`);
  });
  return { ...bootstrap, ...phaseStore, SettingsReadyBootstrap };
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.state.events.length = 0;
  mocks.state.fontFamily = "default-font";
  mocks.recordCrashReport.mockClear();
  mocks.initializeSettingsStore.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("startup phases", () => {
  it("reaches each phase in order, after the work it stands for", async () => {
    const { initializeAppBootstrap, startSettingsLoad } = await loadStartupModules();

    void startSettingsLoad();
    const bootstrap = initializeAppBootstrap();
    await vi.waitFor(() => expect(mocks.state.events).toHaveLength(4));
    expect(mocks.state.events.slice(0, 2)).toEqual(["settings:start", "sync-steps"]);
    expect(mocks.state.events.slice(2).sort()).toEqual(["telemetry", "theme"]);

    mocks.state.finishSettingsLoad("loaded");
    await act(() => bootstrap);

    expect(mocks.state.events.slice(4)).toEqual([
      "settings:loaded",
      "phase:settings-ready",
      "phase:workbench-ready",
      "extensions",
      "phase:extensions-ready",
    ]);
    expect(mocks.initializeSettingsStore).toHaveBeenCalledOnce();
  });

  it("mounts the settings-dependent startup hooks only with the saved settings", async () => {
    const { SettingsReadyBootstrap, startSettingsLoad } = await loadStartupModules();

    void startSettingsLoad();
    act(() => root.render(<SettingsReadyBootstrap />));
    await vi.waitFor(() => expect(mocks.state.events).toEqual(["settings:start"]));
    await flush();
    expect(mocks.state.events).toEqual(["settings:start"]);

    mocks.state.finishSettingsLoad("loaded");
    await flush();

    expect(mocks.state.events).toEqual([
      "settings:start",
      "settings:loaded",
      "phase:settings-ready",
      "settingsSync:saved-font",
      "fontLoading:saved-font",
      "nativeMenuState:saved-font",
      "systemAccessibility:saved-font",
    ]);
  });

  it("still reaches every phase when the settings fail to load", async () => {
    const { SettingsReadyBootstrap, initializeAppBootstrap, startSettingsLoad } =
      await loadStartupModules();

    void startSettingsLoad().catch(() => {});
    act(() => root.render(<SettingsReadyBootstrap />));
    const bootstrap = initializeAppBootstrap();
    await vi.waitFor(() => expect(mocks.state.events).toContain("telemetry"));
    mocks.state.finishSettingsLoad("failed");
    await act(() => bootstrap);

    expect(mocks.state.events).toContain("settingsSync:default-font");
    expect(mocks.state.events.filter((event) => event.startsWith("phase:"))).toEqual([
      "phase:settings-ready",
      "phase:workbench-ready",
      "phase:extensions-ready",
    ]);
    expect(mocks.recordCrashReport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "bootstrap_error", step: "settings store" }),
    );
  });
});

describe("startup phase fallbacks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reaches settings-ready when the settings never finish loading", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS, startSettingsLoad, useBootstrapPhaseStore } =
      await loadStartupModules();

    void startSettingsLoad();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS - 1);
    expect(useBootstrapPhaseStore.getState().phase).toBe("booting");

    await vi.advanceTimersByTimeAsync(1);
    expect(useBootstrapPhaseStore.getState().phase).toBe("settings-ready");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stops waiting for a phase that never arrives", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { waitForBootstrapPhase } = await loadStartupModules();
    const done = vi.fn();

    void waitForBootstrapPhase("settings-ready", 500).then(done);
    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("bootstrap phase store", () => {
  it("only moves forward", async () => {
    const { useBootstrapPhaseStore } = await loadStartupModules();
    const { reachPhase } = useBootstrapPhaseStore.getState().actions;

    reachPhase("workbench-ready");
    reachPhase("settings-ready");

    expect(useBootstrapPhaseStore.getState().phase).toBe("workbench-ready");
  });

  it("resolves a wait once the phase is reached", async () => {
    const { useBootstrapPhaseStore, waitForBootstrapPhase } = await loadStartupModules();
    const reached = vi.fn();

    void waitForBootstrapPhase("settings-ready").then(reached);
    await flush();
    expect(reached).not.toHaveBeenCalled();

    useBootstrapPhaseStore.getState().actions.reachPhase("workbench-ready");
    await flush();
    expect(reached).toHaveBeenCalledOnce();
    await expect(waitForBootstrapPhase("booting")).resolves.toBeUndefined();
  });
});
