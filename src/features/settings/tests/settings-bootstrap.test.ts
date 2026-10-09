// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";
import type { Settings } from "@/features/settings/types/settings.types";

const mocks = vi.hoisted(() => ({
  loadSettingsFromStore: vi.fn(),
  saveSettingsToStore: vi.fn(async () => {}),
  applySettingsSideEffects: vi.fn(),
  getSystemTheme: vi.fn(),
}));

vi.mock("@/features/settings/services/settings-persistence", () => ({
  loadSettingsFromStore: mocks.loadSettingsFromStore,
  saveSettingsToStore: mocks.saveSettingsToStore,
}));
vi.mock("@/features/settings/lib/settings-effects", () => ({
  applySettingsSideEffects: mocks.applySettingsSideEffects,
}));
vi.mock("@/bindings/commands", () => ({
  commands: { getSystemTheme: mocks.getSystemTheme },
}));

const { initializeSettingsState } = await import("../lib/settings-bootstrap");

function stubColorScheme(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: dark })),
  );
}

describe("initializeSettingsState", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubColorScheme(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("applies saved settings without rewriting them when they are already normalized", async () => {
    const saved = { ...getDefaultSettingsSnapshot(), theme: "athas-light", fontSize: 15 };
    mocks.loadSettingsFromStore.mockResolvedValue(saved);
    const apply = vi.fn();

    const result = await initializeSettingsState(apply);

    expect(result).toEqual(saved);
    expect(apply).toHaveBeenCalledWith(saved);
    expect(mocks.applySettingsSideEffects).toHaveBeenCalledWith(saved);
    expect(mocks.saveSettingsToStore).not.toHaveBeenCalled();
    expect(mocks.getSystemTheme).not.toHaveBeenCalled();
  });

  it("picks the native system theme on first launch and saves it", async () => {
    mocks.loadSettingsFromStore.mockResolvedValue({ ...getDefaultSettingsSnapshot(), theme: "" });
    mocks.getSystemTheme.mockResolvedValue("dark");

    const result = await initializeSettingsState(vi.fn());

    expect(result.theme).toBe("athas-dark");
    expect(mocks.saveSettingsToStore).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "athas-dark" }),
    );
  });

  it("falls back to the browser color scheme when native detection is unavailable", async () => {
    stubColorScheme(true);
    mocks.loadSettingsFromStore.mockResolvedValue({ ...getDefaultSettingsSnapshot(), theme: "" });
    mocks.getSystemTheme.mockRejectedValue(new Error("no bridge"));

    const result = await initializeSettingsState(vi.fn());

    expect(result.theme).toBe("athas-dark");
  });

  it("uses the light theme when the native theme is light", async () => {
    stubColorScheme(true);
    mocks.loadSettingsFromStore.mockResolvedValue({ ...getDefaultSettingsSnapshot(), theme: "" });
    mocks.getSystemTheme.mockResolvedValue("light");

    expect((await initializeSettingsState(vi.fn())).theme).toBe("athas-light");
  });

  it("persists settings that needed normalizing", async () => {
    const saved = { ...getDefaultSettingsSnapshot(), theme: "athas-dark", editorLineHeight: 2.6 };
    mocks.loadSettingsFromStore.mockResolvedValue(saved);

    const result = await initializeSettingsState(vi.fn());

    expect(result.editorLineHeight).toBe(2);
    expect(mocks.saveSettingsToStore).toHaveBeenCalledWith(result);
  });

  it("returns defaults when loading fails", async () => {
    mocks.loadSettingsFromStore.mockRejectedValue(new Error("corrupt store"));
    const apply = vi.fn();

    const result: Settings = await initializeSettingsState(apply);

    expect(result).toEqual(getDefaultSettingsSnapshot());
    expect(apply).not.toHaveBeenCalled();
  });
});
