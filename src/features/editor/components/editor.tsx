/**
 * Main contenteditable editor with syntax highlighting
 * with adaptive debouncing for improved typing performance
 */

import "../styles/token-theme.css";
import { useCallback, useEffect, useRef } from "react";
import { useCursor } from "../hooks/use-cursor";
import { useGutterScroll } from "../hooks/use-gutter-scroll";
import { useTokenizer } from "../hooks/use-tokenizer";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { AdaptiveDebouncer } from "../utils/adaptive-debounce";
import { renderWithTokens } from "../utils/html";
import { calculateCursorPosition } from "../utils/position";
import { Gutter } from "./gutter";

interface EditorProps {
  className?: string;
}

export function Editor({ className }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lastBufferId = useRef<string | null>(null);
  const lastTokenizedContent = useRef<string>("");
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

  // Hooks
  const cursorPos = useCursor(editorRef);
  const { tokens, loading, tokenize } = useTokenizer({
    filePath: buffer?.path,
    incremental: false, // ContentEditable doesn't support incremental well
  });
  useGutterScroll(editorRef, gutterRef);

  const onInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const content = e.currentTarget.textContent || "";
      const lineCount = content.split("\n").length;

      if (bufferId) {
        updateBufferContent(bufferId, content);
      }

      // Update cursor position in store
      const offset = cursorPos.save();
      if (offset !== null) {
        const lines = content.split("\n");
        const position = calculateCursorPosition(offset, lines);
        setCursorPosition(position);
      }

      // Adaptive debounced tokenization
      adaptiveDebouncer.current.debounce(() => {
        lastTokenizedContent.current = content;
        tokenize(content);
      }, lineCount);
    },
    [bufferId, updateBufferContent, setCursorPosition, cursorPos, tokenize],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, " ".repeat(tabSize));
      } else if (e.key === "Enter") {
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    },
    [tabSize],
  );

  // Initial render when buffer changes
  useEffect(() => {
    if (!editorRef.current || !buffer) return;

    // Clear pending tokenization when switching buffers
    adaptiveDebouncer.current.cancel();

    // Only re-render if buffer changed
    if (lastBufferId.current !== buffer.id) {
      lastBufferId.current = buffer.id;
      lastTokenizedContent.current = buffer.content;
      const html = renderWithTokens(buffer.content, tokens);
      editorRef.current.innerHTML = html;
    }
  }, [buffer?.id]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      adaptiveDebouncer.current.cancel();
    };
  }, []);

  // Re-render when content or tokens change
  useEffect(() => {
    if (!editorRef.current || !buffer || loading) return;

    // Only restore cursor when tokens update (after tokenization completes)
    // For immediate content changes, let contenteditable handle it naturally
    const shouldRestoreCursor = lastTokenizedContent.current === buffer.content;

    const offset = shouldRestoreCursor ? cursorPos.save() : null;
    const html = renderWithTokens(buffer.content, tokens);
    editorRef.current.innerHTML = html;

    if (offset !== null && shouldRestoreCursor) {
      requestAnimationFrame(() => cursorPos.restore(offset));
    }
  }, [buffer?.content, tokens, loading, cursorPos, buffer]);

  if (!buffer) return null;

  const lines = buffer.content.split("\n");
  const lineHeight = fontSize * 1.4;

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

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        className={`flex-1 overflow-auto bg-primary-bg px-4 py-2 text-text outline-none ${className || ""}`}
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          tabSize,
        }}
        spellCheck={false}
      />
    </div>
  );
}
