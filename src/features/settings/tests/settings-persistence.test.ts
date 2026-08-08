import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";
import { loadSettingsFromStore } from "@/features/settings/lib/settings-persistence";

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
    storeMocks.entries.mockReset();
    storeMocks.load.mockReset();
    storeMocks.save.mockReset();
    storeMocks.set.mockReset();
  });

  it("loads an initialized settings store with one entries call and no writes", async () => {
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
});
