import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  initializeExtensionStore: vi.fn(),
  ensureInitialized: vi.fn(),
  setExtensionState: vi.fn(),
  activateExtensionContributions: vi.fn(),
  initializeGeneratedUIExtensions: vi.fn(),
  loggerError: vi.fn(),
  registryExtensions: new Map<string, unknown>(),
  candidates: [] as Array<{ manifest: { id: string; displayName: string }; path?: string }>,
}));

vi.mock("@/utils/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock("@/extensions/registry/extension-store", () => ({
  initializeExtensionStore: mocks.initializeExtensionStore,
  useExtensionStore: { getState: () => ({ availableExtensions: new Map() }) },
}));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: {
    ensureInitialized: mocks.ensureInitialized,
    getAllExtensions: () => [],
    getExtension: (id: string) => mocks.registryExtensions.get(id),
    setExtensionState: mocks.setExtensionState,
  },
}));
vi.mock("@/extensions/ui/services/generated/generated-ui-extension-installer", () => ({
  initializeGeneratedUIExtensions: mocks.initializeGeneratedUIExtensions,
}));
vi.mock("@/extensions/runtime/extension-contribution-runtime", () => ({
  activateExtensionContributions: mocks.activateExtensionContributions,
}));
vi.mock("@/extensions/runtime/extension-runtime-candidates", () => ({
  buildExtensionRuntimeCandidates: () => mocks.candidates,
}));

async function loadRuntime() {
  vi.resetModules();
  return import("@/extensions/runtime/extension-runtime");
}

beforeEach(() => {
  mocks.calls = [];
  mocks.registryExtensions = new Map([["athas.bundled", {}]]);
  mocks.candidates = [
    { manifest: { id: "athas.bundled", displayName: "Bundled" }, path: "/bundled" },
    { manifest: { id: "athas.broken", displayName: "Broken" } },
    { manifest: { id: "athas.market", displayName: "Market" } },
  ];
  const track = (name: string) => async () => {
    mocks.calls.push(name);
  };
  mocks.initializeExtensionStore.mockReset().mockImplementation(track("store"));
  mocks.ensureInitialized.mockReset().mockImplementation(track("registry"));
  mocks.initializeGeneratedUIExtensions.mockReset().mockImplementation(track("generated"));
  mocks.activateExtensionContributions.mockReset().mockImplementation(async (id: string) => {
    if (id === "athas.broken") throw new Error("bad manifest");
    mocks.calls.push(`activate:${id}`);
  });
  mocks.setExtensionState.mockReset();
  mocks.loggerError.mockReset();
});

describe("integration runtime startup", () => {
  it("loads the store and registry before activating integrations, then generated UI", async () => {
    const { initializeExtensionRuntime } = await loadRuntime();

    await initializeExtensionRuntime();

    expect(mocks.calls[0]).toBe("store");
    expect(mocks.calls[1]).toBe("registry");
    expect(mocks.calls.slice(2, -1).sort()).toEqual([
      "activate:athas.bundled",
      "activate:athas.market",
    ]);
    expect(mocks.calls[mocks.calls.length - 1]).toBe("generated");
    expect(mocks.activateExtensionContributions).toHaveBeenCalledWith(
      "athas.bundled",
      mocks.candidates[0]?.manifest,
      "/bundled",
    );
  });

  it("marks only registry integrations as activated", async () => {
    const { initializeExtensionRuntime } = await loadRuntime();

    await initializeExtensionRuntime();

    expect(mocks.setExtensionState).toHaveBeenCalledTimes(1);
    expect(mocks.setExtensionState).toHaveBeenCalledWith("athas.bundled", "activated");
  });

  it("logs a failing integration without stopping the others", async () => {
    const { initializeExtensionRuntime } = await loadRuntime();

    await expect(initializeExtensionRuntime()).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "ExtensionRuntime",
      "Failed to activate integration Broken:",
      expect.objectContaining({ message: "bad manifest" }),
    );
    expect(mocks.calls).toContain("activate:athas.market");
  });

  it("initializes only once no matter how many callers wait for it", async () => {
    const { initializeExtensionRuntime, waitForExtensionRuntimeInitialization } =
      await loadRuntime();

    const first = initializeExtensionRuntime();
    expect(initializeExtensionRuntime()).toBe(first);
    await Promise.all([first, waitForExtensionRuntimeInitialization()]);

    expect(mocks.initializeExtensionStore).toHaveBeenCalledTimes(1);
    expect(mocks.initializeGeneratedUIExtensions).toHaveBeenCalledTimes(1);
  });
});
