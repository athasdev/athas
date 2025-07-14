import type { RefObject } from "react";
import { create, type ExtractState } from "zustand";
import { combine } from "zustand/middleware";

const initialState = {
  // Content
  value: "",
  onChange: (() => {}) as (value: string) => void,

  // File info
  filePath: "",
  filename: "",

  // Refs - these are set per editor instance
  editorRef: null as RefObject<HTMLDivElement | null> | null,
  highlightRef: null as RefObject<HTMLPreElement | null> | null,
  lineNumbersRef: null as RefObject<HTMLDivElement | null> | null,

  // LSP completion state
  isLspCompletionVisible: false,
  lspCompletions: [] as any[],
  selectedLspIndex: 0,
  completionPosition: { x: 0, y: 0 },

  // Hover state
  hoverInfo: null as any,

  // Vim command line state
  isVimCommandLineVisible: false,
  vimCommandLineInitialCommand: "",

  // Inline assistant state
  isInlineAssistantVisible: false,
  selectedText: "",
  assistantCursorPosition: { x: 0, y: 0 },

  // Event handlers
  handleUserInteraction: (() => {}) as () => void,
  handleScroll: (() => {}) as (e: React.UIEvent<HTMLDivElement>) => void,
  handleHover: (() => {}) as (e: React.MouseEvent<HTMLDivElement>) => void,
  handleMouseEnter: (() => {}) as (e: React.MouseEvent<HTMLDivElement>) => void,
  handleMouseLeave: (() => {}) as (e: React.MouseEvent<HTMLDivElement>) => void,
  onCursorPositionChange: undefined as ((position: number) => void) | undefined,
  onKeyDown: undefined as ((e: React.KeyboardEvent<HTMLDivElement>) => void) | undefined,

  // LSP
  isLanguageSupported: undefined as ((filePath: string) => boolean) | undefined,
  handleLspCompletion: (() => {}) as (
    pos: number,
    editorRef: RefObject<HTMLDivElement | null>,
  ) => void,

  // Inline assistant
  setSelectedText: (() => {}) as (text: string) => void,
  setAssistantCursorPosition: (() => {}) as (pos: { x: number; y: number }) => void,
  setIsInlineAssistantVisible: (() => {}) as (visible: boolean) => void,

  // Vim
  vimEngine: undefined as any,

  // UI props
  placeholder: undefined as string | undefined,
  disabled: false,
  className: undefined as string | undefined,
};

// Current editor instance store
export const useEditorInstanceStore = create(
  combine(initialState, set => ({
    // Actions
    setRefs: (refs: {
      editorRef: RefObject<HTMLDivElement | null>;
      highlightRef: RefObject<HTMLPreElement | null>;
      lineNumbersRef: RefObject<HTMLDivElement | null>;
    }) => set(refs),
    setContent: (value: string, onChange: (value: string) => void) => set({ value, onChange }),
    setFileInfo: (filePath: string, filename: string) => set({ filePath, filename }),
    setHandlers: (
      handlers: Partial<{
        handleUserInteraction: () => void;
        handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
        handleHover: (e: React.MouseEvent<HTMLDivElement>) => void;
        handleMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => void;
        handleMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void;
        onCursorPositionChange: (position: number) => void;
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
        isLanguageSupported: (filePath: string) => boolean;
        handleLspCompletion: (pos: number, editorRef: RefObject<HTMLDivElement | null>) => void;
        setSelectedText: (text: string) => void;
        setAssistantCursorPosition: (pos: { x: number; y: number }) => void;
        setIsInlineAssistantVisible: (visible: boolean) => void;
        vimEngine: any;
      }>,
    ) => set(handlers),
    setUIProps: (props: { placeholder?: string; disabled: boolean; className?: string }) =>
      set(props),

    // LSP actions
    setLspCompletion: (
      visible: boolean,
      completions: any[] = [],
      selectedIndex: number = 0,
      position: { x: number; y: number } = { x: 0, y: 0 },
    ) =>
      set({
        isLspCompletionVisible: visible,
        lspCompletions: completions,
        selectedLspIndex: selectedIndex,
        completionPosition: position,
      }),

    // Hover actions
    setHoverInfo: (info: any) => set({ hoverInfo: info }),

    // Vim command line actions
    setVimCommandLine: (visible: boolean, initialCommand: string = "") =>
      set({
        isVimCommandLineVisible: visible,
        vimCommandLineInitialCommand: initialCommand,
      }),

    // Inline assistant actions
    setInlineAssistant: (
      visible: boolean,
      selectedText: string = "",
      position: { x: number; y: number } = { x: 0, y: 0 },
    ) =>
      set({
        isInlineAssistantVisible: visible,
        selectedText,
        assistantCursorPosition: position,
      }),
  })),
);

export type EditorInstanceState = ExtractState<typeof useEditorInstanceStore>;
