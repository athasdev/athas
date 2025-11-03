/**
 * Editor Overlay - Two-layer editor architecture
 * Combines transparent input layer with syntax-highlighted background
 * with adaptive debouncing and incremental tokenization
 */

import "../styles/overlay-editor.css";
import { useCallback, useEffect, useRef } from "react";
import { useTokenizer } from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { AdaptiveDebouncer } from "../utils/adaptive-debounce";
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
  const bufferUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const cursorUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const adaptiveDebouncer = useRef<AdaptiveDebouncer>(new AdaptiveDebouncer(50, 150));

  const bufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();
  const { updateBufferContent } = useBufferStore.use.actions();
  const { setCursorPosition } = useEditorStateStore.use.actions();
  const cursor = useEditorStateStore.use.cursorPosition();

  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const tabSize = useEditorSettingsStore.use.tabSize();

  const buffer = buffers.find((b) => b.id === bufferId);
  const content = buffer?.content || "";
  const lines = content.split("\n");
  const lineHeight = fontSize * 1.4;

  // Viewport tracking for incremental tokenization
  const {
    viewportRange,
    handleScroll: handleViewportScroll,
    initializeViewport,
  } = useViewportLines({
    lineHeight,
  });

  // Tokenization with incremental support
  const { tokens, tokenize } = useTokenizer({
    filePath: buffer?.path,
    incremental: true,
  });

  // Handle input changes with adaptive debouncing
  const handleInput = useCallback(
    (newContent: string) => {
      const lineCount = newContent.split("\n").length;

      // Debounce buffer store update to prevent re-render cascade
      if (bufferUpdateTimer.current) {
        clearTimeout(bufferUpdateTimer.current);
      }
      bufferUpdateTimer.current = setTimeout(() => {
        if (bufferId) {
          updateBufferContent(bufferId, newContent);
        }
      }, 16); // 16ms = 1 frame, keeps store reasonably in sync

      // Debounce cursor position update to reduce overhead
      if (cursorUpdateTimer.current) {
        clearTimeout(cursorUpdateTimer.current);
      }
      cursorUpdateTimer.current = setTimeout(() => {
        if (inputRef.current) {
          const selectionStart = inputRef.current.selectionStart;
          const lines = newContent.split("\n");
          const position = calculateCursorPosition(selectionStart, lines);
          setCursorPosition(position);
        }
      }, 100); // Update cursor position every 100ms instead of every keystroke

      // Adaptive debounced tokenization with incremental support
      adaptiveDebouncer.current.debounce(() => {
        tokenize(newContent, viewportRange);
      }, lineCount);
    },
    [bufferId, updateBufferContent, setCursorPosition, tokenize, viewportRange],
  );

  // Handle Tab key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
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
    [tabSize, handleInput],
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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      adaptiveDebouncer.current.cancel();
      if (bufferUpdateTimer.current) {
        clearTimeout(bufferUpdateTimer.current);
      }
      if (cursorUpdateTimer.current) {
        clearTimeout(cursorUpdateTimer.current);
      }
    };
  }, []);

  // Initialize viewport on mount
  useEffect(() => {
    if (inputRef.current) {
      initializeViewport(inputRef.current, lines.length);
    }
  }, [initializeViewport]);

  // Tokenize on buffer change or when file loads
  useEffect(() => {
    if (content && buffer?.path) {
      // Use simple full tokenization without viewport for now
      // Incremental will kick in during typing via handleInput
      tokenize(content);
    }
  }, [bufferId, content, buffer?.path, tokenize]);

  if (!buffer) return null;

  return (
    <div className="relative flex size-full">
      {showLineNumbers && (
        <Gutter
          ref={gutterRef}
          lines={lines}
          activeLine={cursor.line}
          fontSize={fontSize}
          fontFamily={fontFamily}
        />
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
