import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useCodeHighlighting } from "../../hooks/use-code-highlighting";
import { useEditorScroll } from "../../hooks/use-editor-scroll";
import { useEditorSync } from "../../hooks/use-editor-sync";
import { useHover } from "../../hooks/use-hover";
import { useLspCompletion } from "../../hooks/use-lsp-completion";
import { useVim } from "../../hooks/use-vim";
import { useAppStore } from "../../stores/app-store";
import { useBufferStore } from "../../stores/buffer-store";
import { useCodeEditorStore } from "../../stores/code-editor-store";
import { useEditorConfigStore } from "../../stores/editor-config-store";
import { useEditorInstanceStore } from "../../stores/editor-instance-store";
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
  // All props are now optional as we get most data from stores
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export interface CodeEditorRef {
  editor: HTMLDivElement | null;
  textarea: HTMLDivElement | null;
}

// Main CodeEditor Component
const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(({ className }, ref) => {
  // Refs - must be called unconditionally
  const editorRef = useRef<HTMLDivElement>(null as any);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  // Get store actions
  const { setRefs, setContent, setFileInfo } = useEditorInstanceStore();

  // Get data from stores
  const activeBuffer = useBufferStore(state => state.getActiveBuffer());
  const { handleContentChange } = useAppStore();
  const { vimEnabled, vimMode, fontSize, tabSize, wordWrap, lineNumbers, aiCompletion } =
    useEditorConfigStore();
  const searchQuery = useCodeEditorStore(state => state.searchQuery);
  const searchMatches = useCodeEditorStore(state => state.searchMatches);
  const currentMatchIndex = useCodeEditorStore(state => state.currentMatchIndex);

  // Extract values from active buffer or use defaults
  const value = activeBuffer?.content || "";
  const filePath = activeBuffer?.path || "";
  const filename = activeBuffer?.name || "";
  const onChange = activeBuffer ? handleContentChange : () => {};

  // Initialize refs in store
  useEffect(() => {
    setRefs({
      editorRef,
      highlightRef,
      lineNumbersRef,
    });
  }, [setRefs]);

  // Sync content and file info with editor instance store
  useEffect(() => {
    setContent(value, onChange);
  }, [value, onChange, setContent]);

  useEffect(() => {
    setFileInfo(filePath, filename);
  }, [filePath, filename, setFileInfo]);

  // Initialize hooks - must be called unconditionally
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
    disabled: false,
    vimEnabled,
    vimMode,
    aiCompletion,
    searchQuery,
    searchMatches,
    currentMatchIndex,
  });

  // LSP completion hook - pass undefined for now as LSP functions come from parent
  useLspCompletion({
    getCompletions: undefined,
    isLanguageSupported: () => false,
    filePath,
    value,
    fontSize,
    lineNumbers,
  });

  // Hover hook - pass undefined for now as LSP functions come from parent
  useHover({
    getHover: undefined,
    isLanguageSupported: () => false,
    filePath,
    fontSize,
    lineNumbers,
  });

  // Vim integration
  const { vimEngine } = useVim(
    editorRef,
    value,
    onChange,
    vimEnabled,
    (_pos: number) => {},
    () => {}, // onModeChange - Already synced via store
    (initialCommand?: string) => {
      // Implementation if needed
      console.log("Vim command:", initialCommand);
    },
  );

  // Scroll management
  const { handleScroll } = useEditorScroll(editorRef, highlightRef, lineNumbersRef);

  // Effect to handle search navigation
  useEffect(() => {
    if (searchMatches.length > 0 && currentMatchIndex >= 0 && vimEngine) {
      const match = searchMatches[currentMatchIndex];
      if (match) {
        vimEngine.setState({ cursorPosition: match.start });
        // Scroll to position
        if (editorRef.current) {
          const editor = editorRef.current;
          const textarea = editor.querySelector('[contenteditable="true"]') as HTMLDivElement;
          if (textarea) {
            textarea.focus();
            // Implement scroll to cursor position
          }
        }
      }
    }
  }, [currentMatchIndex, searchMatches, vimEngine]);

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Imperative handle
  useImperativeHandle(
    ref,
    () => ({
      editor: editorRef.current,
      textarea: editorRef.current?.querySelector('[contenteditable="true"]') as HTMLDivElement,
    }),
    [],
  );

  // Early return if no active buffer - must be after all hooks
  if (!activeBuffer) {
    return (
      <div className="paper-text-secondary flex flex-1 items-center justify-center">
        Select a file to edit...
      </div>
    );
  }

  return (
    <>
      <EditorStyles />
      <div
        ref={editorRef}
        className={`editor-container relative h-full overflow-hidden ${className || ""}`}
        onScroll={handleScroll}
      >
        {/* Hover Tooltip */}
        <HoverTooltip />

        {/* Main editor layout */}
        <div className="flex h-full">
          {/* Line numbers */}
          {lineNumbers && <LineNumbers />}

          {/* Editor content area */}
          <div className="editor-wrapper relative flex-1 overflow-auto">
            <EditorContent />

            {/* Vim command line - positioned absolutely at bottom */}
            {vimEnabled && vimMode === "command" && vimEngine && <VimCommandLine />}

            {/* LSP Completion Dropdown - temporarily disabled */}
            <CompletionDropdown />

            {/* Quick Edit Inline */}
            <QuickEditInline />
          </div>
        </div>
      </div>
    </>
  );
});

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
