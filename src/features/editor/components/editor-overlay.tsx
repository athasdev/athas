/**
 * Editor Overlay - Two-layer editor architecture
 * Combines transparent input layer with syntax-highlighted background
 * Fully immediate updates - zero lag, instant syntax highlighting
 */

import "../styles/overlay-editor.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTokenizer } from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import { useLspStore } from "../lsp/lsp-store";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import { calculateCursorPosition } from "../utils/position";
import { Gutter } from "./gutter";
import { HighlightLayer } from "./highlight-layer";
import { InputLayer } from "./input-layer";

interface EditorOverlayProps {
  className?: string;
}

export function EditorOverlay({ className }: EditorOverlayProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const bufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();
  const { updateBufferContent } = useBufferStore.use.actions();
  const { setCursorPosition } = useEditorStateStore.use.actions();
  const cursorPosition = useEditorStateStore.use.cursorPosition();

  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const tabSize = useEditorSettingsStore.use.tabSize();

  const buffer = buffers.find((b) => b.id === bufferId);
  const content = buffer?.content || "";
  const filePath = buffer?.path;

  // Memoize expensive calculations
  const lines = useMemo(() => content.split("\n"), [content]);
  const lineHeight = useMemo(() => fontSize * 1.4, [fontSize]);

  // Viewport tracking for future incremental tokenization
  const { handleScroll: handleViewportScroll, initializeViewport } = useViewportLines({
    lineHeight,
  });

  // Tokenization with incremental support - NO debouncing for instant syntax highlighting
  const { tokens, tokenize } = useTokenizer({
    filePath,
    incremental: true,
  });

  // Handle input changes with EVERYTHING immediate - no delays!
  const handleInput = useCallback(
    (newContent: string) => {
      if (!bufferId || !inputRef.current) return;

      // 1. Update buffer content IMMEDIATELY
      updateBufferContent(bufferId, newContent);

      // 2. Update cursor position IMMEDIATELY
      const selectionStart = inputRef.current.selectionStart;
      const lines = newContent.split("\n");
      const position = calculateCursorPosition(selectionStart, lines);
      setCursorPosition(position);

      // 3. Tokenize IMMEDIATELY for instant syntax highlighting
      // Tree-sitter is fast enough to handle this on every keystroke
      tokenize(newContent);
    },
    [bufferId, updateBufferContent, setCursorPosition, tokenize],
  );

  // Track cursor position changes even when content doesn't change (arrow keys, mouse clicks, etc.)
  const handleCursorChange = useCallback(() => {
    if (!bufferId || !inputRef.current) return;

    const selectionStart = inputRef.current.selectionStart;
    const lines = content.split("\n");
    const position = calculateCursorPosition(selectionStart, lines);
    setCursorPosition(position);
  }, [bufferId, content, setCursorPosition]);

  // Get completion state
  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const { setSelectedLspIndex, setIsLspCompletionVisible } = useEditorUIStore.use.actions();
  const lspActions = useLspStore.use.actions();

  // Handle keyboard navigation for completions and Tab key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle completion dropdown navigation
      if (isLspCompletionVisible && filteredCompletions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedLspIndex(
            selectedLspIndex < filteredCompletions.length - 1 ? selectedLspIndex + 1 : 0,
          );
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedLspIndex(
            selectedLspIndex > 0 ? selectedLspIndex - 1 : filteredCompletions.length - 1,
          );
          return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selectedCompletion = filteredCompletions[selectedLspIndex]?.item;
          if (selectedCompletion) {
            const textarea = e.currentTarget;
            const currentContent = textarea.value;
            const cursorPos = textarea.selectionStart;

            const result = lspActions.applyCompletion({
              completion: selectedCompletion,
              value: currentContent,
              cursorPos,
            });

            // Update textarea
            textarea.value = result.newValue;
            textarea.selectionStart = textarea.selectionEnd = result.newCursorPos;

            // Trigger buffer update
            handleInput(result.newValue);
          }
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setIsLspCompletionVisible(false);
          return;
        }
      }

      // Handle Tab key for indentation (when completion is not visible)
      if (e.key === "Tab") {
        // Don't handle Tab if Ctrl or Cmd is held (for tab switching)
        if (e.ctrlKey || e.metaKey) {
          return; // Let it bubble up to global keyboard handler
        }

        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const spaces = " ".repeat(tabSize);
        const currentContent = textarea.value;

        // Insert spaces at cursor position
        const newContent =
          currentContent.substring(0, start) + spaces + currentContent.substring(end);

        // Update textarea value directly (uncontrolled)
        textarea.value = newContent;

        // Move cursor after inserted spaces
        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;

        // Trigger buffer update (debounced via handleInput)
        handleInput(newContent);
      }
    },
    [
      tabSize,
      handleInput,
      isLspCompletionVisible,
      filteredCompletions,
      selectedLspIndex,
      setSelectedLspIndex,
      setIsLspCompletionVisible,
      lspActions,
    ],
  );

  // Sync scroll between input and highlight layers + track viewport
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      if (highlightRef.current && gutterRef.current) {
        const scrollTop = e.currentTarget.scrollTop;
        const scrollLeft = e.currentTarget.scrollLeft;
        highlightRef.current.scrollTop = scrollTop;
        highlightRef.current.scrollLeft = scrollLeft;
        gutterRef.current.scrollTop = scrollTop;

        // Update viewport tracking for incremental tokenization
        handleViewportScroll(e, lines.length);
      }
    },
    [handleViewportScroll, lines.length],
  );

  // Initialize viewport on mount
  useEffect(() => {
    if (inputRef.current) {
      initializeViewport(inputRef.current, lines.length);
    }
  }, [initializeViewport]);

  // Tokenize only on buffer change or when file loads (not on every keystroke)
  useEffect(() => {
    if (buffer?.content && buffer?.path) {
      // Initial tokenization when buffer loads
      // handleInput handles tokenization during typing
      tokenize(buffer.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferId, buffer?.path]); // Deliberately exclude content to prevent double tokenization

  // Restore cursor position when switching buffers
  useEffect(() => {
    if (inputRef.current && bufferId && cursorPosition) {
      // Small delay to ensure content is loaded
      setTimeout(() => {
        if (inputRef.current) {
          const offset = cursorPosition.offset || 0;
          // Ensure offset is within bounds
          const maxOffset = inputRef.current.value.length;
          const safeOffset = Math.min(offset, maxOffset);
          inputRef.current.selectionStart = safeOffset;
          inputRef.current.selectionEnd = safeOffset;
          // Focus the textarea
          inputRef.current.focus();
        }
      }, 0);
    }
  }, [bufferId, cursorPosition]);

  if (!buffer) return null;

  return (
    <div className="relative flex size-full">
      {showLineNumbers && (
        <Gutter ref={gutterRef} lines={lines} fontSize={fontSize} fontFamily={fontFamily} />
      )}

      <div className={`overlay-editor-container flex-1 bg-primary-bg ${className || ""}`}>
        <HighlightLayer
          ref={highlightRef}
          content={content}
          tokens={tokens}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
        />
        <InputLayer
          ref={inputRef}
          content={content}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onSelect={handleCursorChange}
          onKeyUp={handleCursorChange}
          onClick={handleCursorChange}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          bufferId={bufferId || undefined}
        />
      </div>
    </div>
  );
}
