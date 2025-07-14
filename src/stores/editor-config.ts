import { create } from "zustand";

interface EditorConfig {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  theme: string;
  vimEnabled: boolean;
  vimMode: "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command";
  aiCompletion: boolean;
}

interface EditorConfigState extends EditorConfig {
  // Actions
  setFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setLineNumbers: (show: boolean) => void;
  setTheme: (theme: string) => void;
  setVimEnabled: (enabled: boolean) => void;
  setVimMode: (
    mode: "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command",
  ) => void;
  setAiCompletion: (enabled: boolean) => void;

  // Bulk configuration update
  updateConfig: (config: Partial<EditorConfig>) => void;
}

// Global editor configuration store
export const useEditorConfigStore = create<EditorConfigState>(set => ({
  // Default configuration
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  theme: "auto",
  vimEnabled: false,
  vimMode: "normal",
  aiCompletion: true,

  // Actions
  setFontSize: size => set({ fontSize: size }),
  setTabSize: size => set({ tabSize: size }),
  setWordWrap: wrap => set({ wordWrap: wrap }),
  setLineNumbers: show => set({ lineNumbers: show }),
  setTheme: theme => set({ theme }),
  setVimEnabled: enabled => set({ vimEnabled: enabled }),
  setVimMode: mode => set({ vimMode: mode }),
  setAiCompletion: enabled => set({ aiCompletion: enabled }),

  updateConfig: config => set(state => ({ ...state, ...config })),
}));
