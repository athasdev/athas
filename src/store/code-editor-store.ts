import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import type { CompletionResponse } from "../utils/ai-completion";

// Types
interface SearchMatch {
  start: number;
  end: number;
}

interface HoverInfo {
  content: string;
  position: { top: number; left: number };
}

interface CompletionPosition {
  top: number;
  left: number;
}

// Add HistoryState interface
interface HistoryState {
  content: string;
  cursorPosition: number;
}

interface CodeEditorState {
  // Core Editor State
  value: string;
  language: string;
  filename: string;
  filePath: string;
  cursorPosition: number;
  selectionStart: number;
  selectionEnd: number;

  // Editor Settings
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  disabled: boolean;
  undoStepSize: number; // Add this setting

  // LSP State
  lspCompletions: CompletionItem[];
  selectedLspIndex: number;
  isLspCompletionVisible: boolean;
  completionPosition: CompletionPosition;
  hoverInfo: HoverInfo | null;
  isHovering: boolean;

  // AI Completion State
  currentCompletion: CompletionResponse | null;
  showCompletion: boolean;
  aiCompletion: boolean;

  // Search State
  searchQuery: string;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;

  // Vim State
  vimEnabled: boolean;
  vimMode: "normal" | "insert" | "visual";
  vimRegister: string;

  // UI State
  minimap: boolean;
  isTyping: boolean;

  // Add undo/redo state
  undoStack: HistoryState[];
  redoStack: HistoryState[];
  pushToHistory: (state: HistoryState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Actions - Core Editor
  setValue: (value: string) => void;
  setLanguage: (language: string) => void;
  setFilename: (filename: string) => void;
  setFilePath: (filePath: string) => void;
  setCursorPosition: (position: number) => void;
  setSelection: (start: number, end: number) => void;

  // Actions - Editor Settings
  setFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setLineNumbers: (show: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setUndoStepSize: (size: number) => void; // Add setter for undoStepSize

  // Actions - LSP
  setLspCompletions: (completions: CompletionItem[]) => void;
  setSelectedLspIndex: (index: number) => void;
  setIsLspCompletionVisible: (visible: boolean) => void;
  setCompletionPosition: (position: CompletionPosition) => void;
  setHoverInfo: (info: HoverInfo | null) => void;
  setIsHovering: (hovering: boolean) => void;

  // Actions - AI Completion
  setCurrentCompletion: (completion: CompletionResponse | null) => void;
  setShowCompletion: (show: boolean) => void;
  setAiCompletion: (enabled: boolean) => void;

  // Actions - Search
  setSearchQuery: (query: string) => void;
  setSearchMatches: (matches: SearchMatch[]) => void;
  setCurrentMatchIndex: (index: number) => void;

  // Actions - Vim
  setVimEnabled: (enabled: boolean) => void;
  setVimMode: (mode: "normal" | "insert" | "visual") => void;
  setVimRegister: (register: string) => void;

  // Actions - UI
  setMinimap: (show: boolean) => void;
  setIsTyping: (typing: boolean) => void;

  // Helper Actions
  clearCompletions: () => void;
  clearHover: () => void;
  clearSearch: () => void;
  resetVim: () => void;

  // Complex Actions
  nextSearchMatch: () => void;
  prevSearchMatch: () => void;
  nextLspCompletion: () => void;
  prevLspCompletion: () => void;
}

export const useCodeEditorStore = create<CodeEditorState>((set, get) => ({
  // Initial Core Editor State
  value: "",
  language: "text",
  filename: "",
  filePath: "",
  cursorPosition: 0,
  selectionStart: 0,
  selectionEnd: 0,

  // Initial Editor Settings
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  lineNumbers: true,
  disabled: false,
  undoStepSize: 1, // Default to 1 character

  // Initial LSP State
  lspCompletions: [],
  selectedLspIndex: 0,
  isLspCompletionVisible: false,
  completionPosition: { top: 0, left: 0 },
  hoverInfo: null,
  isHovering: false,

  // Initial AI Completion State
  currentCompletion: null,
  showCompletion: false,
  aiCompletion: false,

  // Initial Search State
  searchQuery: "",
  searchMatches: [],
  currentMatchIndex: -1,

  // Initial Vim State
  vimEnabled: false,
  vimMode: "normal",
  vimRegister: "",

  // Initial UI State
  minimap: false,
  isTyping: false,

  // Add initial undo/redo state
  undoStack: [],
  redoStack: [],

  // Add undo/redo methods
  pushToHistory: (state: HistoryState) => {
    const { undoStack } = get();
    set({
      undoStack: [...undoStack, state],
      redoStack: [], // Clear redo stack when new change is made
    });
  },

  // Update undo method to handle multiple steps
  undo: () => {
    const { undoStack, redoStack, value, undoStepSize } = get();
    if (undoStack.length === 0) return;

    const currentState = {
      content: value,
      cursorPosition:
        document.activeElement instanceof HTMLTextAreaElement
          ? document.activeElement.selectionStart
          : 0,
    };

    // Take multiple steps based on undoStepSize
    const stepsToUndo = Math.min(undoStepSize, undoStack.length);
    const statesToUndo = undoStack.slice(-stepsToUndo);
    const prevState = statesToUndo[0]; // Use the oldest state in our step size

    set({
      value: prevState.content,
      undoStack: undoStack.slice(0, -stepsToUndo),
      redoStack: [...redoStack, currentState, ...statesToUndo.slice(1).reverse()],
    });

    // Restore cursor position after state update
    requestAnimationFrame(() => {
      const textarea = document.activeElement;
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.setSelectionRange(prevState.cursorPosition, prevState.cursorPosition);
      }
    });
  },

  // Update redo method to handle multiple steps
  redo: () => {
    const { undoStack, redoStack, value, undoStepSize } = get();
    if (redoStack.length === 0) return;

    const currentState = {
      content: value,
      cursorPosition:
        document.activeElement instanceof HTMLTextAreaElement
          ? document.activeElement.selectionStart
          : 0,
    };

    // Take multiple steps based on undoStepSize
    const stepsToRedo = Math.min(undoStepSize, redoStack.length);
    const statesToRedo = redoStack.slice(-stepsToRedo);
    const nextState = statesToRedo[0]; // Use the oldest state in our step size

    set({
      value: nextState.content,
      undoStack: [...undoStack, currentState, ...statesToRedo.slice(1).reverse()],
      redoStack: redoStack.slice(0, -stepsToRedo),
    });

    // Restore cursor position after state update
    requestAnimationFrame(() => {
      const textarea = document.activeElement;
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.setSelectionRange(nextState.cursorPosition, nextState.cursorPosition);
      }
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

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
  setUndoStepSize: (size: number) => set({ undoStepSize: Math.max(1, size) }),

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
  setVimMode: (mode: "normal" | "insert" | "visual") => set({ vimMode: mode }),
  setVimRegister: (register: string) => set({ vimRegister: register }),

  // UI Actions
  setMinimap: (show: boolean) => set({ minimap: show }),
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
}));
