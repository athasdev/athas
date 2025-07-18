import { create, type ExtractState } from "zustand";
import { combine } from "zustand/middleware";

type VimMode = "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command";

const initialState = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  theme: "auto",
  vimEnabled: false,
  vimMode: "normal" as VimMode,
  aiCompletion: true,
};

// Global editor configuration store
export const useEditorConfigStore = create(
  combine(initialState, set => ({
    // Actions
    setFontSize: (size: number) => set({ fontSize: size }),
    setTabSize: (size: number) => set({ tabSize: size }),
    setWordWrap: (wrap: boolean) => set({ wordWrap: wrap }),
    setLineNumbers: (show: boolean) => set({ lineNumbers: show }),
    setTheme: (theme: string) => set({ theme }),
    setVimEnabled: (enabled: boolean) => set({ vimEnabled: enabled }),
    setVimMode: (mode: VimMode) => set({ vimMode: mode }),
    setAiCompletion: (enabled: boolean) => set({ aiCompletion: enabled }),
    toggleVim: () => set(state => ({ vimEnabled: !state.vimEnabled })),

    // Bulk configuration update
    updateConfig: (config: Partial<typeof initialState>) => set(state => ({ ...state, ...config })),
  })),
);

export type EditorConfigState = ExtractState<typeof useEditorConfigStore>;
export type EditorConfig = Omit<
  EditorConfigState,
  | "setFontSize"
  | "setTabSize"
  | "setWordWrap"
  | "setLineNumbers"
  | "setTheme"
  | "setVimEnabled"
  | "setVimMode"
  | "setAiCompletion"
  | "updateConfig"
>;
