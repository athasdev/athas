/**
 * Editor Overlay - Two-layer editor architecture
 * Combines transparent input layer with syntax-highlighted background
 * Fully immediate updates - zero lag, instant syntax highlighting
 */

import "../styles/overlay-editor.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EditorContextMenu from "../context-menu/context-menu";
import { useTokenizer } from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import { useLspStore } from "../lsp/lsp-store";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import { applyMultiCursorBackspace, applyMultiCursorEdit } from "../utils/multi-cursor";
import { calculateCursorPosition } from "../utils/position";
import { Gutter } from "./gutter";
import { HighlightLayer } from "./highlight-layer";
import { InputLayer } from "./input-layer";
import { MultiCursorLayer } from "./multi-cursor-layer";

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
  const {
    setCursorPosition,
    setSelection,
    enableMultiCursor,
    addCursor,
    clearSecondaryCursors,
    updateCursor,
  } = useEditorStateStore.use.actions();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const multiCursorState = useEditorStateStore.use.multiCursorState();

  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const tabSize = useEditorSettingsStore.use.tabSize();

  const buffer = buffers.find((b) => b.id === bufferId);
  const content = buffer?.content || "";
  const filePath = buffer?.path;

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

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
    const selectionEnd = inputRef.current.selectionEnd;
    const lines = content.split("\n");

    // Update cursor position
    const position = calculateCursorPosition(selectionStart, lines);
    setCursorPosition(position);

    // Track selection if text is selected
    if (selectionStart !== selectionEnd) {
      const startPos = calculateCursorPosition(selectionStart, lines);
      const endPos = calculateCursorPosition(selectionEnd, lines);
      setSelection({ start: startPos, end: endPos });
    } else {
      // Clear selection when no text is selected
      setSelection(undefined);
    }
  }, [bufferId, content, setCursorPosition, setSelection]);

  // Handle click events for multi-cursor support
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!bufferId || !inputRef.current) return;

      // Cmd (Mac) or Ctrl (Windows/Linux) + Click adds a new cursor
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();

        const selectionStart = inputRef.current.selectionStart;
        const selectionEnd = inputRef.current.selectionEnd;
        const lines = content.split("\n");

        const position = calculateCursorPosition(selectionStart, lines);

        // Enable multi-cursor if not already enabled
        if (!multiCursorState) {
          enableMultiCursor();
        }

        // Add new cursor at clicked position
        const selection =
          selectionStart !== selectionEnd
            ? {
                start: calculateCursorPosition(selectionStart, lines),
                end: calculateCursorPosition(selectionEnd, lines),
              }
            : undefined;

        addCursor(position, selection);
        return;
      }

      // Regular click: clear secondary cursors if in multi-cursor mode
      if (multiCursorState && multiCursorState.cursors.length > 1) {
        clearSecondaryCursors();
      }
      // Selection/cursor tracking is handled by onSelect event
    },
    [bufferId, content, multiCursorState, enableMultiCursor, addCursor, clearSecondaryCursors],
  );

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenuState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuState({ isOpen: false, position: { x: 0, y: 0 } });
  }, []);

  // Context menu action handlers
  const handleCopy = useCallback(() => {
    if (!inputRef.current) return;
    document.execCommand("copy");
  }, []);

  const handleCut = useCallback(() => {
    if (!inputRef.current) return;
    document.execCommand("cut");
  }, []);

  const handlePaste = useCallback(async () => {
    if (!inputRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      const textarea = inputRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + text + content.substring(end);

      if (bufferId) {
        updateBufferContent(bufferId, newContent);
      }

      textarea.value = newContent;
      const newPosition = start + text.length;
      textarea.selectionStart = textarea.selectionEnd = newPosition;

      handleInput(newContent);
    } catch (error) {
      console.error("Failed to paste:", error);
    }
  }, [content, bufferId, updateBufferContent, handleInput]);

  const handleSelectAll = useCallback(() => {
    if (!inputRef.current) return;
    inputRef.current.select();
  }, []);

  const handleDelete = useCallback(() => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== end) {
      const newContent = content.substring(0, start) + content.substring(end);
      if (bufferId) {
        updateBufferContent(bufferId, newContent);
      }
      textarea.value = newContent;
      textarea.selectionStart = textarea.selectionEnd = start;
      handleInput(newContent);
    }
  }, [content, bufferId, updateBufferContent, handleInput]);

  // Get completion state
  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const { setSelectedLspIndex, setIsLspCompletionVisible } = useEditorUIStore.use.actions();
  const lspActions = useLspStore.use.actions();

  // Handle keyboard navigation for completions and Tab key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle multi-cursor editing (typing, backspace, delete, enter)
      if (multiCursorState && multiCursorState.cursors.length > 1) {
        // Handle backspace
        if (e.key === "Backspace") {
          e.preventDefault();

          const { newContent, newCursors } = applyMultiCursorBackspace(
            content,
            multiCursorState.cursors,
          );

          // Update buffer content
          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          // Update textarea value
          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          // Update all cursor positions
          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          // Update primary cursor in textarea
          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          // Tokenize
          tokenize(newContent);
          return;
        }

        // Handle regular character input and Enter
        if (
          e.key.length === 1 || // Printable character
          e.key === "Enter"
        ) {
          e.preventDefault();

          const text = e.key === "Enter" ? "\n" : e.key;
          const { newContent, newCursors } = applyMultiCursorEdit(
            content,
            multiCursorState.cursors,
            text,
          );

          // Update buffer content
          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          // Update textarea value
          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          // Update all cursor positions
          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          // Update primary cursor in textarea
          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          // Tokenize
          tokenize(newContent);
          return;
        }
      }

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

      // Handle Escape to clear secondary cursors (when completion is not visible)
      if (e.key === "Escape" && multiCursorState && multiCursorState.cursors.length > 1) {
        e.preventDefault();
        clearSecondaryCursors();
        return;
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
      multiCursorState,
      clearSecondaryCursors,
      content,
      bufferId,
      updateBufferContent,
      updateCursor,
      tokenize,
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

  // Restore cursor position when switching buffers ONLY (not on cursor movement)
  useEffect(() => {
    if (inputRef.current && bufferId) {
      // Small delay to ensure content is loaded
      setTimeout(() => {
        if (inputRef.current && bufferId) {
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
    // Only run when buffer changes, NOT when cursor position changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferId]);

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
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          bufferId={bufferId || undefined}
        />
        {multiCursorState && (
          <MultiCursorLayer
            cursors={multiCursorState.cursors}
            primaryCursorId={multiCursorState.primaryCursorId}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            content={content}
          />
        )}
      </div>
      {contextMenuState.isOpen &&
        createPortal(
          <EditorContextMenu
            isOpen={contextMenuState.isOpen}
            position={contextMenuState.position}
            onClose={closeContextMenu}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            onSelectAll={handleSelectAll}
            onDelete={handleDelete}
          />,
          document.body,
        )}
    </div>
  );
}
