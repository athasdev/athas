import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("@/features/settings/services/settings-persistence", () => ({
  debouncedSaveSettingsToStore: vi.fn(),
  loadSettingsFromStore: vi.fn(),
  saveSettingsToStore: vi.fn(async () => {}),
}));
vi.mock("@/utils/toast", () => ({ showToast: toastMocks.showToast }));
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

  it("turns off Buffer Carousel when word wrap is turned off while it forces wrapping", async () => {
    const { updateSetting } = useSettingsStore.getState().actions;
    await updateSetting("wordWrap", false);
    await updateSetting("horizontalTabScroll", true);
    toastMocks.showToast.mockClear();

    toggleWordWrap();

    const { settings } = useSettingsStore.getState();
    expect(settings.wordWrap).toBe(false);
    expect(settings.horizontalTabScroll).toBe(false);
    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);

    toggleWordWrap();
    expect(useSettingsStore.getState().settings.wordWrap).toBe(true);
    expect(useSettingsStore.getState().settings.horizontalTabScroll).toBe(false);
  });

  it("keeps Buffer Carousel when an extension override is what turns wrapping off", async () => {
    const { updateSetting } = useSettingsStore.getState().actions;
    await updateSetting("wordWrap", false);
    await updateSetting("horizontalTabScroll", true);
    useEditorSettingOverridesStore.getState().actions.setOverrides({ wordWrap: false });

    toggleWordWrap();

    const { settings } = useSettingsStore.getState();
    expect(settings.wordWrap).toBe(true);
    expect(settings.horizontalTabScroll).toBe(true);
    expect(overrides().wordWrap).toBeUndefined();
    await updateSetting("horizontalTabScroll", false);
  });
});
