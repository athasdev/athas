import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_MONO_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  resolveEffectiveTheme,
  subscribeSystemThemePreference,
} from "@/features/settings/lib/theme-resolution";
import type { RenderWhitespaceMode } from "@/features/settings/types/settings.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface EditorSettingsState {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  renderWhitespace: RenderWhitespaceMode;
  renderIndentGuides: boolean;
  highlightOccurrences: boolean;
  disabled: boolean;
  theme: string;
  actions: EditorSettingsActions;
}

interface EditorSettingsActions {
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setLineHeight: (lineHeight: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setLineNumbers: (show: boolean) => void;
  setRenderWhitespace: (mode: RenderWhitespaceMode) => void;
  setRenderIndentGuides: (show: boolean) => void;
  setHighlightOccurrences: (show: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setTheme: (theme: string) => void;
}

export const useEditorSettingsStore = createSelectors(
  create<EditorSettingsState>()(
    subscribeWithSelector((set) => ({
      fontSize: DEFAULT_CODE_FONT_SIZE,
      fontFamily: DEFAULT_MONO_FONT_FAMILY,
      lineHeight: EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER,
      tabSize: 2,
      wordWrap: false,
      lineNumbers: true,
      renderWhitespace: "none",
      renderIndentGuides: true,
      highlightOccurrences: true,
      disabled: false,
      theme: "athas-dark",
      actions: {
        setFontSize: (size) => set({ fontSize: size }),
        setFontFamily: (family) => set({ fontFamily: family }),
        setLineHeight: (lineHeight) => set({ lineHeight }),
        setTabSize: (size) => set({ tabSize: size }),
        setWordWrap: (wrap) => set({ wordWrap: wrap }),
        setLineNumbers: (show) => set({ lineNumbers: show }),
        setRenderWhitespace: (mode) => set({ renderWhitespace: mode }),
        setRenderIndentGuides: (show) => set({ renderIndentGuides: show }),
        setHighlightOccurrences: (show) => set({ highlightOccurrences: show }),
        setDisabled: (disabled) => set({ disabled }),
        setTheme: (theme) => set({ theme }),
      },
    })),
  ),
);

const syncEditorSettings = (state: ReturnType<typeof useSettingsStore.getState>) => {
  const {
    fontSize,
    fontFamily,
    editorLineHeight,
    tabSize,
    wordWrap,
    lineNumbers,
    renderWhitespace,
    renderIndentGuides,
    highlightOccurrences,
    horizontalTabScroll,
  } = state.settings;
  const actions = useEditorSettingsStore.getState().actions;

  actions.setFontSize(fontSize);
  actions.setFontFamily(fontFamily);
  actions.setLineHeight(editorLineHeight);
  actions.setTabSize(tabSize);
  actions.setWordWrap(wordWrap || horizontalTabScroll);
  actions.setLineNumbers(lineNumbers);
  actions.setRenderWhitespace(renderWhitespace);
  actions.setRenderIndentGuides(renderIndentGuides);
  actions.setHighlightOccurrences(highlightOccurrences);
  actions.setTheme(resolveEffectiveTheme(state.settings));
};

// Subscribe to settings store and sync all editor settings
useSettingsStore.subscribe(syncEditorSettings);
syncEditorSettings(useSettingsStore.getState());

subscribeSystemThemePreference(() => {
  syncEditorSettings(useSettingsStore.getState());
});
