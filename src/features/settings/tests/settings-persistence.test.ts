import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";

const storeMocks = vi.hoisted(() => ({
  entries: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: storeMocks.load,
}));

describe("settings persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    storeMocks.entries.mockReset();
    storeMocks.load.mockReset();
    storeMocks.save.mockReset();
    storeMocks.set.mockReset();
  });

  it("loads an initialized settings store with one entries call and no writes", async () => {
    const { loadSettingsFromStore } = await import("@/features/settings/lib/settings-persistence");
    const settings = getDefaultSettingsSnapshot();
    const store = {
      entries: storeMocks.entries,
      save: storeMocks.save,
      set: storeMocks.set,
    };
    storeMocks.entries.mockResolvedValue(Object.entries(settings));
    storeMocks.load.mockResolvedValue(store);

    await expect(loadSettingsFromStore()).resolves.toEqual(settings);
    expect(storeMocks.entries).toHaveBeenCalledTimes(1);
    expect(storeMocks.set).not.toHaveBeenCalled();
    expect(storeMocks.save).not.toHaveBeenCalled();
  });

  it("migrates the legacy shared sidebar width to the right sidebar", async () => {
    const { loadSettingsFromStore } = await import("@/features/settings/lib/settings-persistence");
    const settings = getDefaultSettingsSnapshot();
    const legacyEntries = Object.entries(settings).filter(([key]) => key !== "rightSidebarWidth");
    const sidebarWidth = 340;
    const store = {
      entries: storeMocks.entries,
      save: storeMocks.save,
      set: storeMocks.set,
    };
    storeMocks.entries.mockResolvedValue(
      legacyEntries.map(([key, value]) => [key, key === "sidebarWidth" ? sidebarWidth : value]),
    );
    storeMocks.load.mockResolvedValue(store);

    const loaded = await loadSettingsFromStore();

    expect(loaded.sidebarWidth).toBe(sidebarWidth);
    expect(loaded.rightSidebarWidth).toBe(sidebarWidth);
    expect(storeMocks.set).toHaveBeenCalledWith("rightSidebarWidth", sidebarWidth);
    expect(storeMocks.save).toHaveBeenCalledTimes(1);
  });

  it("initializes the persisted Outline preference for existing settings", async () => {
    const { loadSettingsFromStore } = await import("@/features/settings/lib/settings-persistence");
    const settings = getDefaultSettingsSnapshot();
    const legacyEntries = Object.entries(settings).filter(([key]) => key !== "showOutline");
    const store = {
      entries: storeMocks.entries,
      save: storeMocks.save,
      set: storeMocks.set,
    };
    storeMocks.entries.mockResolvedValue(legacyEntries);
    storeMocks.load.mockResolvedValue(store);

    const loaded = await loadSettingsFromStore();

    expect(loaded.showOutline).toBe(false);
    expect(storeMocks.set).toHaveBeenCalledWith("showOutline", false);
    expect(storeMocks.save).toHaveBeenCalledTimes(1);
  });
});
