import type { RefObject } from "react";
import { create } from "zustand";

interface EditorInstanceState {
  // Content
  value: string;
  onChange: (value: string) => void;

  // File info
  filePath: string;
  filename: string;

  // Refs - these are set per editor instance
  editorRef: RefObject<HTMLDivElement | null> | null;
  highlightRef: RefObject<HTMLPreElement | null> | null;
  lineNumbersRef: RefObject<HTMLDivElement | null> | null;

  // LSP completion state
  isLspCompletionVisible: boolean;
  lspCompletions: any[];
  selectedLspIndex: number;
  completionPosition: { x: number; y: number };

  // Hover state
  hoverInfo: any;

  // Vim command line state
  isVimCommandLineVisible: boolean;
  vimCommandLineInitialCommand: string;

  // Inline assistant state
  isInlineAssistantVisible: boolean;
  selectedText: string;
  assistantCursorPosition: { x: number; y: number };

  // Event handlers
  handleUserInteraction: () => void;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  handleHover: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;

  // LSP
  isLanguageSupported?: (filePath: string) => boolean;
  handleLspCompletion: (pos: number, editorRef: RefObject<HTMLDivElement | null>) => void;

  // Inline assistant
  setSelectedText: (text: string) => void;
  setAssistantCursorPosition: (pos: { x: number; y: number }) => void;
  setIsInlineAssistantVisible: (visible: boolean) => void;

  // Vim
  vimEngine?: any;

  // UI props
  placeholder?: string;
  disabled: boolean;
  className?: string;

  // Actions to update instance
  setRefs: (refs: {
    editorRef: RefObject<HTMLDivElement | null>;
    highlightRef: RefObject<HTMLPreElement | null>;
    lineNumbersRef: RefObject<HTMLDivElement | null>;
  }) => void;
  setContent: (value: string, onChange: (value: string) => void) => void;
  setFileInfo: (filePath: string, filename: string) => void;
  setHandlers: (
    handlers: Partial<
      Pick<
        EditorInstanceState,
        | "handleUserInteraction"
        | "handleScroll"
        | "handleHover"
        | "handleMouseEnter"
        | "handleMouseLeave"
        | "onCursorPositionChange"
        | "onKeyDown"
        | "isLanguageSupported"
        | "handleLspCompletion"
        | "setSelectedText"
        | "setAssistantCursorPosition"
        | "setIsInlineAssistantVisible"
        | "vimEngine"
      >
    >,
  ) => void;
  setUIProps: (props: { placeholder?: string; disabled: boolean; className?: string }) => void;

  // LSP actions
  setLspCompletion: (
    visible: boolean,
    completions?: any[],
    selectedIndex?: number,
    position?: { x: number; y: number },
  ) => void;

  // Hover actions
  setHoverInfo: (info: any) => void;

  // Vim command line actions
  setVimCommandLine: (visible: boolean, initialCommand?: string) => void;

  // Inline assistant actions
  setInlineAssistant: (
    visible: boolean,
    selectedText?: string,
    position?: { x: number; y: number },
  ) => void;
}

// Current editor instance store
export const useEditorInstanceStore = create<EditorInstanceState>(set => ({
  // Content
  value: "",
  onChange: () => {},

  // File info
  filePath: "",
  filename: "",

  // Refs
  editorRef: null,
  highlightRef: null,
  lineNumbersRef: null,

  // LSP completion state
  isLspCompletionVisible: false,
  lspCompletions: [],
  selectedLspIndex: 0,
  completionPosition: { x: 0, y: 0 },

  // Hover state
  hoverInfo: null,

  // Vim command line state
  isVimCommandLineVisible: false,
  vimCommandLineInitialCommand: "",

  // Inline assistant state
  isInlineAssistantVisible: false,
  selectedText: "",
  assistantCursorPosition: { x: 0, y: 0 },

  // Event handlers - defaults
  handleUserInteraction: () => {},
  handleScroll: () => {},
  handleHover: () => {},
  handleMouseEnter: () => {},
  handleMouseLeave: () => {},
  handleLspCompletion: () => {},
  setSelectedText: () => {},
  setAssistantCursorPosition: () => {},
  setIsInlineAssistantVisible: () => {},

  // UI props
  disabled: false,

  // Actions
  setRefs: refs => set(refs),
  setContent: (value, onChange) => set({ value, onChange }),
  setFileInfo: (filePath, filename) => set({ filePath, filename }),
  setHandlers: handlers => set(handlers),
  setUIProps: props => set(props),

  // LSP actions
  setLspCompletion: (visible, completions = [], selectedIndex = 0, position = { x: 0, y: 0 }) =>
    set({
      isLspCompletionVisible: visible,
      lspCompletions: completions,
      selectedLspIndex: selectedIndex,
      completionPosition: position,
    }),

  // Hover actions
  setHoverInfo: info => set({ hoverInfo: info }),

  // Vim command line actions
  setVimCommandLine: (visible, initialCommand = "") =>
    set({
      isVimCommandLineVisible: visible,
      vimCommandLineInitialCommand: initialCommand,
    }),

  // Inline assistant actions
  setInlineAssistant: (visible, selectedText = "", position = { x: 0, y: 0 }) =>
    set({
      isInlineAssistantVisible: visible,
      selectedText,
      assistantCursorPosition: position,
    }),
}));
