import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_MONO_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useSettingsStore } from "@/features/settings/store";
import { createSelectors } from "@/utils/zustand-selectors";

interface EditorSettingsState {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
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
      disabled: false,
      theme: "athas-dark",
      actions: {
        setFontSize: (size) => set({ fontSize: size }),
        setFontFamily: (family) => set({ fontFamily: family }),
        setLineHeight: (lineHeight) => set({ lineHeight }),
        setTabSize: (size) => set({ tabSize: size }),
        setWordWrap: (wrap) => set({ wordWrap: wrap }),
        setLineNumbers: (show) => set({ lineNumbers: show }),
        setDisabled: (disabled) => set({ disabled }),
        setTheme: (theme) => set({ theme }),
      },
    })),
  ),
);

// Subscribe to settings store and sync all editor settings
useSettingsStore.subscribe((state) => {
  const {
    fontSize,
    fontFamily,
    editorLineHeight,
    tabSize,
    wordWrap,
    lineNumbers,
    horizontalTabScroll,
  } = state.settings;
  const actions = useEditorSettingsStore.getState().actions;

  actions.setFontSize(fontSize);
  actions.setFontFamily(fontFamily);
  actions.setLineHeight(editorLineHeight);
  actions.setTabSize(tabSize);
  actions.setWordWrap(wordWrap || horizontalTabScroll);
  actions.setLineNumbers(lineNumbers);
});
