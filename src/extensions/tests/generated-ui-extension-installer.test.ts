// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  initializeGeneratedUIExtensions,
  installGeneratedUIExtension,
} from "../ui/services/generated/generated-ui-extension-installer";
import {
  readStoredGeneratedExtensions,
  type GeneratedUIExtension,
} from "../ui/services/generated/generated-ui-extension-storage";
import { uiExtensionHost } from "../ui/services/ui-extension-host";
import { useUIExtensionStore } from "../ui/stores/ui-extension-store";
import type { ExtensionManifest } from "../types/extension-manifest";

vi.hoisted(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(null),
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
});

enableMapSet();

const weather: GeneratedUIExtension = {
  id: "Weather Panel!",
  name: "Weather",
  description: "Shows the weather",
  contributionType: "sidebar",
  code: 'const forecast = await api.http.request({ url: "https://api.weather.example/today" });',
  permissions: { network: ["https://api.weather.example"] },
};

let loaded: Array<{ manifest: ExtensionManifest; source: string }>;
const loadedIds = new Set<string>();

const state = (id: string) => useUIExtensionStore.getState().extensions.get(id);

beforeEach(() => {
  localStorage.clear();
  loaded = [];
  loadedIds.clear();
  vi.spyOn(uiExtensionHost, "isLoaded").mockImplementation((id) => loadedIds.has(id));
  vi.spyOn(uiExtensionHost, "unloadExtension").mockImplementation(async (id) => {
    loadedIds.delete(id);
  });
  vi.spyOn(uiExtensionHost, "loadGeneratedExtension").mockImplementation(
    async (manifest: ExtensionManifest, source: string) => {
      loaded.push({ manifest, source });
      loadedIds.add(manifest.id);
    },
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const id of Array.from(useUIExtensionStore.getState().extensions.keys())) {
    useUIExtensionStore.getState().actions.unregisterExtension(id);
  }
  vi.restoreAllMocks();
});

describe("installing generated UI integrations", () => {
  it("loads the wrapped source in the worker host with only the granted permissions", async () => {
    const { extensionId } = await installGeneratedUIExtension(weather);

    expect(extensionId).toBe("generated.weather-panel");
    expect(loaded[0].manifest).toMatchObject({
      id: "generated.weather-panel",
      main: "generated.js",
      publisher: "athas.generated",
      permissions: { network: ["https://api.weather.example"] },
    });
    expect(loaded[0].source).toContain("export async function activate(api)");
    expect(loaded[0].source).toContain(weather.code);
    expect(state(extensionId)?.state).toBe("active");
    expect(readStoredGeneratedExtensions().map((extension) => extension.id)).toEqual([
      "Weather Panel!",
    ]);
  });

  it("does not persist when asked not to", async () => {
    await installGeneratedUIExtension(weather, { persist: false });

    expect(readStoredGeneratedExtensions()).toEqual([]);
  });

  it("refuses permissions the code does not use", async () => {
    await expect(installGeneratedUIExtension({ ...weather, code: "const x = 1;" })).rejects.toThrow(
      "Generated integration requests unused network permission",
    );
    expect(loaded).toEqual([]);
  });

  it("refuses code that uses capabilities it did not request", async () => {
    await expect(
      installGeneratedUIExtension({ ...weather, permissions: undefined }),
    ).rejects.toThrow(/network/);

    expect(loaded).toEqual([]);
    expect(state("generated.weather-panel")).toMatchObject({ state: "error" });
    expect(readStoredGeneratedExtensions()).toEqual([]);
  });

  it("refuses code that reaches for browser globals", async () => {
    await expect(
      installGeneratedUIExtension({
        ...weather,
        permissions: undefined,
        code: "fetch('https://evil.example')",
      }),
    ).rejects.toThrow("Generated integration source must not use direct network or worker APIs");
    expect(loaded).toEqual([]);
  });

  it("replaces an already loaded version and reports load failures", async () => {
    await installGeneratedUIExtension(weather);
    vi.mocked(uiExtensionHost.loadGeneratedExtension).mockRejectedValueOnce(
      new Error("worker failed to start"),
    );

    await expect(installGeneratedUIExtension(weather)).rejects.toThrow("worker failed to start");

    expect(uiExtensionHost.unloadExtension).toHaveBeenCalledWith("generated.weather-panel");
    expect(state("generated.weather-panel")).toMatchObject({
      state: "error",
      error: "worker failed to start",
    });
  });

  it("cleans up a registered but unloaded extension before reinstalling", async () => {
    useUIExtensionStore.getState().actions.registerExtension({
      extensionId: "generated.weather-panel",
      manifestId: "generated.weather-panel",
      name: "Old",
      state: "error",
    });

    await installGeneratedUIExtension(weather);

    expect(state("generated.weather-panel")).toMatchObject({ name: "Weather", state: "active" });
  });

  it("reinstalls stored integrations on startup and keeps going past broken ones", async () => {
    localStorage.setItem(
      "athas.generated-ui-extensions",
      JSON.stringify([
        { ...weather, id: "broken" },
        { ...weather, id: "over-privileged", code: "const x = 1;" },
        { ...weather, id: "clock", code: "const now = 1;", permissions: undefined },
      ]),
    );
    vi.mocked(uiExtensionHost.loadGeneratedExtension).mockImplementation(
      async (manifest: ExtensionManifest, source: string) => {
        if (manifest.id === "generated.broken") throw new Error("bad bundle");
        loaded.push({ manifest, source });
      },
    );

    await initializeGeneratedUIExtensions();

    expect(loaded.map(({ manifest }) => manifest.id)).toEqual(["generated.clock"]);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to initialize generated UI integration:",
      expect.any(Error),
    );
  });
});
