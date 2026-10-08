import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/settings/services/settings-persistence", () => ({
  debouncedSaveSettingsToStore: vi.fn(),
  loadSettingsFromStore: vi.fn(),
  saveSettingsToStore: vi.fn(async () => {}),
}));
vi.mock("@/features/settings/lib/settings-effects", () => ({
  applySettingSideEffect: vi.fn(),
  applySettingsSideEffects: vi.fn(),
}));

const { useSettingsStore } = await import("@/features/settings/stores/settings.store");
const { useEditorSettingOverridesStore } =
  await import("@/features/editor/stores/editor-setting-overrides.store");
const { toggleWordWrap } = await import("@/features/keymaps/commands/view-command-actions");

const overrides = () => useEditorSettingOverridesStore.getState().overrides;

describe("user setting changes over extension overrides", () => {
  afterEach(() => {
    useEditorSettingOverridesStore.getState().actions.clearOverrides();
  });

  it("clears the override that masks a setting the user changes", async () => {
    useEditorSettingOverridesStore.getState().actions.setOverrides({ tabSize: 8, fontSize: 20 });

    await useSettingsStore.getState().actions.updateSetting("tabSize", 4);

    expect(useSettingsStore.getState().settings.tabSize).toBe(4);
    expect(overrides()).toEqual({ fontSize: 20 });
  });

  it("toggles word wrap from what the editor shows, not the masked setting", async () => {
    await useSettingsStore.getState().actions.updateSetting("wordWrap", false);
    useEditorSettingOverridesStore.getState().actions.setOverrides({ wordWrap: true });

    toggleWordWrap();

    expect(useSettingsStore.getState().settings.wordWrap).toBe(false);
    expect(overrides().wordWrap).toBeUndefined();

    toggleWordWrap();
    expect(useSettingsStore.getState().settings.wordWrap).toBe(true);
  });
});
