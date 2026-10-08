import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  resolveEditorSettings,
  useEditorSettingOverridesStore,
} from "../stores/editor-setting-overrides.store";
import type { EditorSettings } from "../types/editor-extension.types";

const settings = {
  fontSize: 14,
  editorLineHeight: 1.4,
  tabSize: 2,
  lineNumbers: true,
  wordWrap: false,
  horizontalTabScroll: false,
  renderWhitespace: "none" as const,
  renderIndentGuides: true,
};

describe("editor setting overrides", () => {
  afterEach(() => {
    useEditorSettingOverridesStore.getState().actions.clearOverrides();
  });

  it("uses the user's settings when nothing is overridden", () => {
    expect(resolveEditorSettings(settings, {})).toEqual({
      fontSize: 14,
      lineHeight: 1.4,
      tabSize: 2,
      lineNumbers: true,
      wordWrap: false,
      renderWhitespace: "none",
      renderIndentGuides: true,
    });
  });

  it("keeps horizontal tab scrolling wrapping unless an override turns wrap off", () => {
    const sideBySide = { ...settings, horizontalTabScroll: true };

    expect(resolveEditorSettings(sideBySide, {}).wordWrap).toBe(true);
    expect(resolveEditorSettings(sideBySide, { wordWrap: false }).wordWrap).toBe(false);
    expect(resolveEditorSettings(settings, { wordWrap: true }).wordWrap).toBe(true);
  });

  it("merges overrides, ignores undefined values and the theme, and clears them", () => {
    const { setOverrides, clearOverrides } = useEditorSettingOverridesStore.getState().actions;

    setOverrides({ fontSize: 18 });
    const fromExtension: Partial<EditorSettings> = {
      tabSize: 8,
      fontSize: undefined,
      theme: "one-dark",
    };
    setOverrides(fromExtension);
    expect(useEditorSettingOverridesStore.getState().overrides).toEqual({
      fontSize: 18,
      tabSize: 8,
    });

    const before = useEditorSettingOverridesStore.getState().overrides;
    setOverrides({ fontSize: 18 });
    expect(useEditorSettingOverridesStore.getState().overrides).toBe(before);

    clearOverrides();
    expect(useEditorSettingOverridesStore.getState().overrides).toEqual({});
  });

  it("drops only the override fed by a setting the user changed", () => {
    const { setOverrides, clearOverrideForSetting } =
      useEditorSettingOverridesStore.getState().actions;
    setOverrides({ wordWrap: true, lineHeight: 2, tabSize: 8 });

    clearOverrideForSetting("wordWrap");
    clearOverrideForSetting("editorLineHeight");
    expect(useEditorSettingOverridesStore.getState().overrides).toEqual({ tabSize: 8 });

    const before = useEditorSettingOverridesStore.getState().overrides;
    clearOverrideForSetting("showMinimap");
    clearOverrideForSetting("wordWrap");
    expect(useEditorSettingOverridesStore.getState().overrides).toBe(before);
  });
});
