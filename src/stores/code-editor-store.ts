import type { CompletionItem } from "vscode-languageserver-protocol";
import { create, type ExtractState } from "zustand";
import { combine } from "zustand/middleware";
import type { CompletionResponse } from "../utils/ai-completion";

// Types
type SearchMatch = {
  start: number;
  end: number;
};

type HoverInfo = {
  content: string;
  position: { top: number; left: number };
};

type CompletionPosition = {
  top: number;
  left: number;
};

type VimMode = "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command";

const initialState = {
  // Core Editor State
  value: "",
  language: "text",
  filename: "",
  filePath: "",
  cursorPosition: 0,
  selectionStart: 0,
  selectionEnd: 0,

  // Editor Settings
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  lineNumbers: true,
  disabled: false,

  // LSP State
  lspCompletions: [] as CompletionItem[],
  selectedLspIndex: 0,
  isLspCompletionVisible: false,
  completionPosition: { top: 0, left: 0 } as CompletionPosition,
  hoverInfo: null as HoverInfo | null,
  isHovering: false,

  // AI Completion State
  currentCompletion: null as CompletionResponse | null,
  showCompletion: false,
  aiCompletion: false,

  // Search State
  searchQuery: "",
  searchMatches: [] as SearchMatch[],
  currentMatchIndex: -1,

  // Vim State
  vimEnabled: false,
  vimMode: "normal" as VimMode,
  vimRegister: "",

  // UI State
  isTyping: false,
};

export const useCodeEditorStore = create(
  combine(initialState, (set, get) => ({
    // Core Editor Actions
    setValue: (value: string) => set({ value }),
    setLanguage: (language: string) => set({ language }),
    setFilename: (filename: string) => set({ filename }),
    setFilePath: (filePath: string) => set({ filePath }),
    setCursorPosition: (position: number) => set({ cursorPosition: position }),
    setSelection: (start: number, end: number) => set({ selectionStart: start, selectionEnd: end }),

    // Editor Settings Actions
    setFontSize: (size: number) => set({ fontSize: size }),
    setTabSize: (size: number) => set({ tabSize: size }),
    setWordWrap: (wrap: boolean) => set({ wordWrap: wrap }),
    setLineNumbers: (show: boolean) => set({ lineNumbers: show }),
    setDisabled: (disabled: boolean) => set({ disabled }),

    // LSP Actions
    setLspCompletions: (completions: CompletionItem[]) => set({ lspCompletions: completions }),
    setSelectedLspIndex: (index: number) => set({ selectedLspIndex: index }),
    setIsLspCompletionVisible: (visible: boolean) => set({ isLspCompletionVisible: visible }),
    setCompletionPosition: (position: CompletionPosition) => set({ completionPosition: position }),
    setHoverInfo: (info: HoverInfo | null) => set({ hoverInfo: info }),
    setIsHovering: (hovering: boolean) => set({ isHovering: hovering }),

    // AI Completion Actions
    setCurrentCompletion: (completion: CompletionResponse | null) =>
      set({ currentCompletion: completion }),
    setShowCompletion: (show: boolean) => set({ showCompletion: show }),
    setAiCompletion: (enabled: boolean) => set({ aiCompletion: enabled }),

    // Search Actions
    setSearchQuery: (query: string) => set({ searchQuery: query }),
    setSearchMatches: (matches: SearchMatch[]) => set({ searchMatches: matches }),
    setCurrentMatchIndex: (index: number) => set({ currentMatchIndex: index }),

    // Vim Actions
    setVimEnabled: (enabled: boolean) => set({ vimEnabled: enabled }),
    setVimMode: (mode: VimMode) => set({ vimMode: mode }),
    setVimRegister: (register: string) => set({ vimRegister: register }),

    // UI Actions
    setIsTyping: (typing: boolean) => set({ isTyping: typing }),

    // Helper Actions
    clearCompletions: () =>
      set({
        lspCompletions: [],
        selectedLspIndex: 0,
        isLspCompletionVisible: false,
        currentCompletion: null,
        showCompletion: false,
      }),

    clearHover: () =>
      set({
        hoverInfo: null,
        isHovering: false,
      }),

    clearSearch: () =>
      set({
        searchQuery: "",
        searchMatches: [],
        currentMatchIndex: -1,
      }),

    resetVim: () =>
      set({
        vimEnabled: false,
        vimMode: "normal",
        vimRegister: "",
      }),

    // Complex Actions
    nextSearchMatch: () => {
      const { searchMatches, currentMatchIndex } = get();
      if (searchMatches.length > 0) {
        const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
        set({ currentMatchIndex: nextIndex });
      }
    },

    prevSearchMatch: () => {
      const { searchMatches, currentMatchIndex } = get();
      if (searchMatches.length > 0) {
        const prevIndex = currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
        set({ currentMatchIndex: prevIndex });
      }
    },

    nextLspCompletion: () => {
      const { lspCompletions, selectedLspIndex } = get();
      if (lspCompletions.length > 0) {
        const nextIndex = (selectedLspIndex + 1) % lspCompletions.length;
        set({ selectedLspIndex: nextIndex });
      }
    },

    prevLspCompletion: () => {
      const { lspCompletions, selectedLspIndex } = get();
      if (lspCompletions.length > 0) {
        const prevIndex = selectedLspIndex <= 0 ? lspCompletions.length - 1 : selectedLspIndex - 1;
        set({ selectedLspIndex: prevIndex });
      }
    },
  })),
);

export type CodeEditorState = ExtractState<typeof useCodeEditorStore>;
