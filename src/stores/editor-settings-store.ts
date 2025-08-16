import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useSettingsStore } from "@/settings/store";
import { createSelectors } from "@/utils/zustand-selectors";

interface EditorSettingsState {
  fontSize: number;
  fontFamily: string;
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
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setLineNumbers: (show: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setTheme: (theme: string) => void;
}

export const useEditorSettingsStore = createSelectors(
  create<EditorSettingsState>()(
    subscribeWithSelector((set) => ({
      fontSize: 14,
      fontFamily: "JetBrains Mono",
      tabSize: 2,
      wordWrap: true,
      lineNumbers: true,
      disabled: false,
      theme: "auto",
      actions: {
        setFontSize: (size) => set({ fontSize: size }),
        setFontFamily: (family) => set({ fontFamily: family }),
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
  const { fontSize, fontFamily, tabSize, wordWrap, lineNumbers } = state.settings;
  const actions = useEditorSettingsStore.getState().actions;

  actions.setFontSize(fontSize);
  actions.setFontFamily(fontFamily);
  actions.setTabSize(tabSize);
  actions.setWordWrap(wordWrap);
  actions.setLineNumbers(lineNumbers);
});
