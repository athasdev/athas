// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  ensureSettingsSyncStarted: vi.fn(async () => {}),
  updateSetting: vi.fn(async () => {}),
  loadAvailableFonts: vi.fn(async () => {}),
}));

vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create: createStore } = await import("zustand");
  const useSettingsStore = createStore(() => ({
    isLoaded: false,
    settings: {
      fontFamily: "Missing Mono",
      terminalFontFamily: "Missing Mono",
      uiFontFamily: "Missing Sans",
    },
    actions: { updateSetting: mocks.updateSetting },
  }));
  return { useSettingsStore };
});
vi.mock("@/features/settings/lib/settings-sync", () => ({
  ensureSettingsSyncStarted: mocks.ensureSettingsSyncStarted,
  initializeSettingsSyncPreferences: vi.fn(),
}));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ user: { id: "user" }, isAuthenticated: true, subscription: null }),
}));
vi.mock("@/features/auth/utils/product-capabilities", () => ({
  hasProductCapability: () => true,
}));
vi.mock("@/features/ai/intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: {
    getState: () => ({ actions: { setUser: vi.fn(), refresh: vi.fn() } }),
  },
}));
vi.mock("@/features/settings/stores/font.store", () => ({
  useFontStore: Object.assign(() => undefined, {
    use: { actions: () => ({ loadAvailableFonts: mocks.loadAvailableFonts }) },
    getState: () => ({ availableFonts: [] }),
  }),
}));

const { useSettingsStore } = await import("@/features/settings/stores/settings.store");
const { useSettingsSync } = await import("../hooks/use-settings-sync");
const { useFontLoading } = await import("../hooks/use-font-loading");

function StartupHooks() {
  useSettingsSync();
  useFontLoading();
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.ensureSettingsSyncStarted.mockClear();
  mocks.updateSetting.mockClear();
  mocks.loadAvailableFonts.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettingsStore.setState({ isLoaded: false });
  vi.unstubAllGlobals();
});

describe("startup settings write-back", () => {
  it("writes nothing back while the saved settings are not loaded", async () => {
    await act(async () => root.render(<StartupHooks />));

    expect(mocks.loadAvailableFonts).toHaveBeenCalledOnce();
    expect(mocks.updateSetting).not.toHaveBeenCalled();
    expect(mocks.ensureSettingsSyncStarted).not.toHaveBeenCalled();
  });

  it("starts settings sync once the saved settings load", async () => {
    await act(async () => root.render(<StartupHooks />));
    await act(async () => useSettingsStore.setState({ isLoaded: true }));

    expect(mocks.ensureSettingsSyncStarted).toHaveBeenCalledWith({
      isAuthenticated: true,
      isPro: true,
    });
  });

  it("falls back from unavailable fonts when the saved settings are loaded", async () => {
    useSettingsStore.setState({ isLoaded: true });
    await act(async () => root.render(<StartupHooks />));

    expect(mocks.updateSetting).toHaveBeenCalledWith("fontFamily", expect.any(String));
    expect(mocks.updateSetting).toHaveBeenCalledWith("uiFontFamily", expect.any(String));
  });
});
