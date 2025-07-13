import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { useCodeHighlighting } from "../../hooks/use-code-highlighting";
import { useEditorScroll } from "../../hooks/use-editor-scroll";
import { useEditorSync } from "../../hooks/use-editor-sync";
import { useHover } from "../../hooks/use-hover";
import { useLspCompletion } from "../../hooks/use-lsp-completion";
import { useVim } from "../../hooks/use-vim";
import { useCodeEditorStore } from "../../stores/code-editor-store";
import { useEditorConfigStore } from "../../stores/editor-config";
import { useEditorInstanceStore } from "../../stores/editor-instance";
import { requestCompletion } from "../../utils/ai-completion";
import { CompletionDropdown } from "./completion-dropdown";
import { EditorContent } from "./editor-content";
import { EditorStyles } from "./editor-styles";
import { HoverTooltip } from "./hover-tooltip";
import { LineNumbers } from "./line-numbers";
import { QuickEditInline } from "./quick-edit-inline";
import { VimCommandLine } from "./vim-command-line";
// import type { VimCommandLineRef } from "../vim-command-line"; // Unused for now

// Import language definitions
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-csharp";

// Import custom theme CSS that adapts to app themes
import "../../styles/prism-theme.css";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  filename?: string;
  vimEnabled?: boolean;
  vimMode?: "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command";
  searchQuery?: string;
  searchMatches?: { start: number; end: number }[];
  currentMatchIndex?: number;
  filePath?: string;
  fontSize?: number;
  tabSize?: number;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  aiCompletion?: boolean;
  // LSP functions passed from parent
  getCompletions?: (filePath: string, line: number, character: number) => Promise<CompletionItem[]>;
  getHover?: (filePath: string, line: number, character: number) => Promise<any>;
  isLanguageSupported?: (filePath: string) => boolean;
  openDocument?: (filePath: string, content: string) => Promise<void>;
  changeDocument?: (filePath: string, content: string) => Promise<void>;
  closeDocument?: (filePath: string) => Promise<void>;
}

export interface CodeEditorRef {
  editor: HTMLDivElement | null;
  textarea: HTMLDivElement | null;
}

// Main CodeEditor Component
const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  (
    {
      value,
      onChange,
      onKeyDown,
      onCursorPositionChange,
      placeholder,
      disabled = false,
      className,
      filename = "",
      vimEnabled = false,
      vimMode = "normal",
      searchQuery = "",
      searchMatches = [],
      currentMatchIndex = -1,
      filePath = "",
      fontSize = 14,
      tabSize = 2,
      wordWrap = false,
      lineNumbers = true,
      aiCompletion = false,
      getCompletions,
      getHover,
      isLanguageSupported,
      openDocument: _openDocument,
      changeDocument: _changeDocument,
      closeDocument: _closeDocument,
    },
    ref,
  ) => {
    // Refs
    const editorRef = useRef<HTMLDivElement | null>(null);
    const highlightRef = useRef<HTMLPreElement | null>(null);
    const lineNumbersRef = useRef<HTMLDivElement | null>(null);
    const mountedRef = useRef(true);
    // const vimCommandLineRef = useRef<VimCommandLineRef>(null); // Unused for now

    // Store subscriptions - only what we need
    const language = useCodeEditorStore(state => state.language);
    // LSP state - unused for now but kept for future implementation
    // const lspCompletions = useCodeEditorStore(state => state.lspCompletions);
    // const selectedLspIndex = useCodeEditorStore(state => state.selectedLspIndex);
    // const isLspCompletionVisible = useCodeEditorStore(state => state.isLspCompletionVisible);
    // const completionPosition = useCodeEditorStore(state => state.completionPosition);
    // const hoverInfo = useCodeEditorStore(state => state.hoverInfo);

    // Store actions for AI completion
    const setCurrentCompletion = useCodeEditorStore(state => state.setCurrentCompletion);
    const setShowCompletion = useCodeEditorStore(state => state.setShowCompletion);

    // Initialize hooks
    useCodeHighlighting(highlightRef);

    // Sync props with store
    useEditorSync({
      value,
      filename,
      filePath,
      fontSize,
      tabSize,
      wordWrap,
      lineNumbers,
      disabled,
      vimEnabled,
      vimMode,
      aiCompletion,
      searchQuery,
      searchMatches,
      currentMatchIndex,
    });

    // LSP completion hook
    const { handleLspCompletion } = useLspCompletion({
      getCompletions,
      isLanguageSupported,
      filePath,
      value,
      fontSize,
      lineNumbers,
    });

    // Hover hook
    const { handleHover, handleMouseLeave, handleMouseEnter } = useHover({
      getHover,
      isLanguageSupported,
      filePath,
      fontSize,
      lineNumbers,
    });

    // Vim integration
    const { vimEngine } = useVim(
      editorRef as React.RefObject<HTMLDivElement>,
      value,
      onChange,
      vimEnabled,
      (pos: number) => onCursorPositionChange?.(pos),
      () => {}, // Already synced via useEditorSync
      (initialCommand?: string) => {
        const { setVimCommandLine } = useEditorInstanceStore.getState();
        setVimCommandLine(true, initialCommand || "");
      },
    );
    const { handleScroll, handleUserInteraction } = useEditorScroll(
      editorRef,
      highlightRef,
      lineNumbersRef,
    );

    // Initialize Zustand stores
    const { updateConfig } = useEditorConfigStore();
    const { setRefs, setContent, setFileInfo, setHandlers, setUIProps } = useEditorInstanceStore();

    // Sync props with Zustand stores
    useEffect(() => {
      updateConfig({
        fontSize,
        tabSize,
        wordWrap,
        lineNumbers,
        vimEnabled,
        vimMode,
        aiCompletion,
      });
    }, [fontSize, tabSize, wordWrap, lineNumbers, vimEnabled, vimMode, aiCompletion, updateConfig]);

    useEffect(() => {
      setRefs({ editorRef, highlightRef, lineNumbersRef });
    }, [setRefs]);

    useEffect(() => {
      setContent(value, onChange);
    }, [value, onChange, setContent]);

    useEffect(() => {
      setFileInfo(filePath, filename);
    }, [filePath, filename, setFileInfo]);

    useEffect(() => {
      setHandlers({
        handleUserInteraction,
        handleScroll,
        handleHover,
        handleMouseEnter,
        handleMouseLeave,
        onCursorPositionChange,
        onKeyDown,
        isLanguageSupported,
        handleLspCompletion,
        vimEngine,
      });
    }, [
      handleUserInteraction,
      handleScroll,
      handleHover,
      handleMouseEnter,
      handleMouseLeave,
      onCursorPositionChange,
      onKeyDown,
      isLanguageSupported,
      handleLspCompletion,
      vimEngine,
      setHandlers,
    ]);

    useEffect(() => {
      setUIProps({ placeholder, disabled, className });
    }, [placeholder, disabled, className, setUIProps]);

    // Handle imperative ref
    useImperativeHandle(ref, () => ({
      editor: editorRef.current as HTMLDivElement | null,
      textarea: editorRef.current as HTMLDivElement | null,
    }));

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // Handle AI completion
    useEffect(() => {
      if (!aiCompletion || !editorRef.current) return;

      const handleAiCompletion = async () => {
        const editor = editorRef.current;
        if (!editor) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const cursorPos = range.startOffset;
        const textBeforeCursor = value.substring(0, cursorPos);

        if (textBeforeCursor.trim().length < 3) return;

        try {
          requestCompletion(
            {
              code: textBeforeCursor,
              language,
              filename: filename || "",
              cursorPosition: cursorPos,
            },
            completion => {
              if (completion?.completion) {
                setCurrentCompletion(completion);
                setShowCompletion(true);
              }
            },
          );
        } catch (error) {
          console.error("AI completion error:", error);
        }
      };

      const timeoutId = setTimeout(handleAiCompletion, 500);
      return () => clearTimeout(timeoutId);
    }, [value, language, aiCompletion, setCurrentCompletion, setShowCompletion, filename]);

    return (
      <div className="relative flex h-full flex-1 flex-col">
        <EditorStyles />
        <div className="relative flex h-full flex-1 overflow-hidden">
          {/* Line numbers */}
          {lineNumbers && <LineNumbers />}

          {/* Editor content area */}
          <EditorContent />
        </div>

        {/* LSP Completion Dropdown */}
        <CompletionDropdown />

        {/* Hover Tooltip */}
        <HoverTooltip />

        {/* Vim Command Line */}
        <VimCommandLine />

        {/* Inline Assistant */}
        <QuickEditInline />
      </div>
    );
  },
);

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
