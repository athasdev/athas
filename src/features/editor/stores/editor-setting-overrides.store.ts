import { create } from "zustand";
import { isEditorWordWrapEnabled } from "@/features/settings/services/editor-word-wrap";
import type { Settings } from "@/features/settings/types/settings.types";
import { createSelectors } from "@/utils/zustand-selectors";
import type { EditorSettings } from "../types/editor-extension.types";

type OverridableEditorSettings = Omit<EditorSettings, "theme">;
type EditorSettingOverrides = Partial<OverridableEditorSettings>;

const OVERRIDABLE_KEYS = [
  "fontSize",
  "lineHeight",
  "tabSize",
  "lineNumbers",
  "wordWrap",
  "renderWhitespace",
  "renderIndentGuides",
] as const satisfies ReadonlyArray<keyof OverridableEditorSettings>;

/** The override each user setting feeds; changing the setting drops that override. */
const SETTING_OVERRIDE_KEYS: Partial<Record<keyof Settings, keyof OverridableEditorSettings>> = {
  fontSize: "fontSize",
  editorLineHeight: "lineHeight",
  tabSize: "tabSize",
  lineNumbers: "lineNumbers",
  wordWrap: "wordWrap",
  renderWhitespace: "renderWhitespace",
  renderIndentGuides: "renderIndentGuides",
};

interface EditorSettingOverridesState {
  overrides: EditorSettingOverrides;
  actions: {
    setOverrides: (overrides: EditorSettingOverrides) => void;
    clearOverrides: () => void;
    /** Drops the override masking `setting`, so a value the user just chose takes effect. */
    clearOverrideForSetting: (setting: keyof Settings) => void;
  };
}

/**
 * Editor settings an extension changed for this session. They sit on top of the user's settings
 * until cleared or the app reloads, and are never written to the settings file.
 */
export const useEditorSettingOverridesStore = createSelectors(
  create<EditorSettingOverridesState>()((set) => ({
    overrides: {},
    actions: {
      setOverrides: (next) =>
        set((state) => {
          const changes: EditorSettingOverrides = {};
          for (const key of OVERRIDABLE_KEYS) {
            const value = next[key];
            if (value !== undefined && value !== state.overrides[key]) {
              Object.assign(changes, { [key]: value });
            }
          }
          return Object.keys(changes).length > 0
            ? { overrides: { ...state.overrides, ...changes } }
            : state;
        }),
      clearOverrides: () =>
        set((state) => (Object.keys(state.overrides).length > 0 ? { overrides: {} } : state)),
      clearOverrideForSetting: (setting) =>
        set((state) => {
          const key = SETTING_OVERRIDE_KEYS[setting];
          if (!key || state.overrides[key] === undefined) return state;
          const overrides = { ...state.overrides };
          delete overrides[key];
          return { overrides };
        }),
    },
  })),
);

type EditorSettingSource = Pick<
  Settings,
  | "fontSize"
  | "editorLineHeight"
  | "tabSize"
  | "lineNumbers"
  | "wordWrap"
  | "horizontalTabScroll"
  | "renderWhitespace"
  | "renderIndentGuides"
>;

/** The editor settings in effect: the user's settings with any session overrides applied. */
export function resolveEditorSettings(
  settings: EditorSettingSource,
  overrides: EditorSettingOverrides,
): OverridableEditorSettings {
  return {
    fontSize: overrides.fontSize ?? settings.fontSize,
    lineHeight: overrides.lineHeight ?? settings.editorLineHeight,
    tabSize: overrides.tabSize ?? settings.tabSize,
    lineNumbers: overrides.lineNumbers ?? settings.lineNumbers,
    wordWrap: overrides.wordWrap ?? isEditorWordWrapEnabled(settings),
    renderWhitespace: overrides.renderWhitespace ?? settings.renderWhitespace,
    renderIndentGuides: overrides.renderIndentGuides ?? settings.renderIndentGuides,
  };
}
