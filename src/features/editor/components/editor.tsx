import "../styles/overlay-editor.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useGitGutter } from "@/features/version-control/git/controllers/use-gutter";
import { useZoomStore } from "@/stores/zoom-store";
import EditorContextMenu from "../context-menu/context-menu";
import { editorAPI } from "../extensions/api";
import { useContextMenu } from "../hooks/use-context-menu";
import { useEditorOperations } from "../hooks/use-editor-operations";
import { useFoldTransform } from "../hooks/use-fold-transform";
import { useInlineDiff } from "../hooks/use-inline-diff";
import { getLanguageId, useTokenizer } from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import { useLspStore } from "../lsp/lsp-store";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorDecorationsStore } from "../stores/decorations-store";
import { useFoldStore } from "../stores/fold-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import type { Decoration } from "../types/editor";
import { applyVirtualEdit, calculateActualOffset } from "../utils/fold-transformer";
import { calculateLineHeight, calculateLineOffset, splitLines } from "../utils/lines";
import { applyMultiCursorBackspace, applyMultiCursorEdit } from "../utils/multi-cursor";
import { calculateCursorPosition } from "../utils/position";
import { scrollLogger } from "../utils/scroll-logger";
import { InlineDiff } from "./diff/inline-diff";
import { Gutter } from "./gutter/gutter";
import { GitBlameLayer } from "./layers/git-blame-layer";
import { HighlightLayer } from "./layers/highlight-layer";
import { InputLayer } from "./layers/input-layer";
import { MultiCursorLayer } from "./layers/multi-cursor-layer";

interface EditorProps {
  className?: string;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  onMouseEnter?: () => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function Editor({
  className,
  onMouseMove,
  onMouseLeave,
  onMouseEnter,
  onClick,
}: EditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const multiCursorRef = useRef<HTMLDivElement>(null);

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
  const onChange = useEditorStateStore.use.onChange();

  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const zoomLevel = useZoomStore.use.editorZoomLevel();

  // Apply zoom by scaling font size instead of CSS transform
  // This ensures text and positioned elements use the same rendering path
  const fontSize = baseFontSize * zoomLevel;
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const tabSize = useEditorSettingsStore.use.tabSize();

  const buffer = buffers.find((b) => b.id === bufferId);
  const content = buffer?.content || "";
  const filePath = buffer?.path;

  useGitGutter({
    filePath: filePath || "",
    content,
    enabled: !!filePath,
  });

  const foldActions = useFoldStore.use.actions();

  useEffect(() => {
    if (filePath && content) {
      foldActions.computeFoldRegions(filePath, content);
    }
  }, [filePath, content, foldActions]);

  const foldTransform = useFoldTransform(filePath, content);

  const hasSyntaxHighlighting = useMemo(() => {
    if (!filePath) return false;
    return getLanguageId(filePath) !== null;
  }, [filePath]);

  const contextMenu = useContextMenu();
  const inlineDiff = useInlineDiff(filePath, content);

  const actualLines = useMemo(() => splitLines(content), [content]);
  const lines = foldTransform.hasActiveFolds ? foldTransform.virtualLines : actualLines;
  const displayContent = foldTransform.hasActiveFolds ? foldTransform.virtualContent : content;
  // Use consistent line height for both textarea and gutter
  // This ensures they stay synchronized at all zoom levels
  const lineHeight = useMemo(() => calculateLineHeight(fontSize), [fontSize]);

  const {
    viewportRange,
    handleScroll: handleViewportScroll,
    initializeViewport,
  } = useViewportLines({
    lineHeight,
  });

  const { tokens, tokenize, forceFullTokenize } = useTokenizer({
    filePath,
    incremental: true,
    enabled: hasSyntaxHighlighting,
  });

  // Listen for extension installation to re-trigger tokenization
  useEffect(() => {
    const handleExtensionInstalled = (event: Event) => {
      const customEvent = event as CustomEvent<{ extensionId: string; filePath: string }>;
      if (customEvent.detail.filePath === filePath && content) {
        forceFullTokenize(content);
      }
    };

    window.addEventListener("extension-installed", handleExtensionInstalled);
    return () => {
      window.removeEventListener("extension-installed", handleExtensionInstalled);
    };
  }, [filePath, content, forceFullTokenize]);

  const visualCursorLine = useMemo(() => {
    if (foldTransform.hasActiveFolds) {
      return foldTransform.mapping.actualToVirtual.get(cursorPosition.line) ?? cursorPosition.line;
    }
    return cursorPosition.line;
  }, [cursorPosition.line, foldTransform]);

  const handleInput = useCallback(
    (newVirtualContent: string) => {
      if (!bufferId || !inputRef.current) return;

      let newActualContent: string;
      if (foldTransform.hasActiveFolds) {
        newActualContent = applyVirtualEdit(content, newVirtualContent, foldTransform.mapping);
      } else {
        newActualContent = newVirtualContent;
      }

      updateBufferContent(bufferId, newActualContent);
      onChange(newActualContent);

      const selectionStart = inputRef.current.selectionStart;
      const virtualLines = splitLines(newVirtualContent);
      const position = calculateCursorPosition(selectionStart, virtualLines);

      if (foldTransform.hasActiveFolds) {
        const actualLine =
          foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
        const actualOffset = calculateActualOffset(
          splitLines(newActualContent),
          actualLine,
          position.column,
        );
        setCursorPosition({
          line: actualLine,
          column: position.column,
          offset: actualOffset,
        });
      } else {
        setCursorPosition(position);
      }

      if (hasSyntaxHighlighting) {
        // Tokenize the content that will be displayed (full tokenize on input for accuracy)
        const contentToTokenize = foldTransform.hasActiveFolds
          ? newVirtualContent
          : newActualContent;
        tokenize(contentToTokenize);
      }
    },
    [
      bufferId,
      updateBufferContent,
      setCursorPosition,
      tokenize,
      hasSyntaxHighlighting,
      content,
      foldTransform,
    ],
  );

  const editorOps = useEditorOperations({
    inputRef,
    content,
    bufferId,
    updateBufferContent,
    handleInput,
  });

  const handleCursorChange = useCallback(() => {
    if (!bufferId || !inputRef.current) return;

    const selectionStart = inputRef.current.selectionStart;
    const selectionEnd = inputRef.current.selectionEnd;

    const position = calculateCursorPosition(selectionStart, lines);

    if (foldTransform.hasActiveFolds) {
      const actualLine = foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
      const actualOffset = calculateActualOffset(actualLines, actualLine, position.column);
      setCursorPosition({
        line: actualLine,
        column: position.column,
        offset: actualOffset,
      });
    } else {
      setCursorPosition(position);
    }

    if (selectionStart !== selectionEnd) {
      const startPos = calculateCursorPosition(selectionStart, lines);
      const endPos = calculateCursorPosition(selectionEnd, lines);

      if (foldTransform.hasActiveFolds) {
        const actualStartLine =
          foldTransform.mapping.virtualToActual.get(startPos.line) ?? startPos.line;
        const actualEndLine = foldTransform.mapping.virtualToActual.get(endPos.line) ?? endPos.line;
        setSelection({
          start: {
            line: actualStartLine,
            column: startPos.column,
            offset: calculateActualOffset(actualLines, actualStartLine, startPos.column),
          },
          end: {
            line: actualEndLine,
            column: endPos.column,
            offset: calculateActualOffset(actualLines, actualEndLine, endPos.column),
          },
        });
      } else {
        setSelection({ start: startPos, end: endPos });
      }
    } else {
      setSelection(undefined);
    }
  }, [bufferId, lines, actualLines, setCursorPosition, setSelection, foldTransform]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!bufferId || !inputRef.current) return;

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();

        const selectionStart = inputRef.current.selectionStart;
        const selectionEnd = inputRef.current.selectionEnd;
        const contentLines = splitLines(content);

        const clickedPosition = calculateCursorPosition(selectionStart, contentLines);

        const selection =
          selectionStart !== selectionEnd
            ? {
                start: calculateCursorPosition(selectionStart, contentLines),
                end: calculateCursorPosition(selectionEnd, contentLines),
              }
            : undefined;

        if (!multiCursorState) {
          // Enable multi-cursor mode - this creates a cursor at current position
          enableMultiCursor();
          // Only add a new cursor if clicked position is different from current cursor
          const isDifferentPosition =
            clickedPosition.line !== cursorPosition.line ||
            clickedPosition.column !== cursorPosition.column;
          if (isDifferentPosition) {
            addCursor(clickedPosition, selection);
          }
        } else {
          // Already in multi-cursor mode, just add the cursor
          addCursor(clickedPosition, selection);
        }
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        clearSecondaryCursors();
      }
    },
    [
      bufferId,
      content,
      multiCursorState,
      cursorPosition,
      enableMultiCursor,
      addCursor,
      clearSecondaryCursors,
    ],
  );

  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const { setSelectedLspIndex, setIsLspCompletionVisible } = useEditorUIStore.use.actions();
  const lspActions = useLspStore.use.actions();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.altKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const decorations = useEditorDecorationsStore.getState().decorations;
        const changedLines: number[] = [];

        decorations.forEach((dec: Decoration & { id: string }) => {
          if (dec.type === "gutter" && dec.className?.includes("git-gutter")) {
            changedLines.push(dec.range.start.line);
          }
        });

        if (changedLines.length === 0) return;

        changedLines.sort((a, b) => a - b);

        const currentLine = cursorPosition.line;

        if (e.key === "]") {
          const nextChange = changedLines.find((line) => line > currentLine);
          if (nextChange !== undefined) {
            const lineStart = calculateLineOffset(lines, nextChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(calculateCursorPosition(lineStart, lines));
          }
        } else {
          const prevChanges = changedLines.filter((line) => line < currentLine);
          if (prevChanges.length > 0) {
            const prevChange = prevChanges[prevChanges.length - 1];
            const lineStart = calculateLineOffset(lines, prevChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(calculateCursorPosition(lineStart, lines));
          }
        }
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        if (e.key === "Backspace") {
          e.preventDefault();

          const { newContent, newCursors } = applyMultiCursorBackspace(
            content,
            multiCursorState.cursors,
          );

          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          tokenize(newContent);
          return;
        }

        if (e.key.length === 1 || e.key === "Enter") {
          e.preventDefault();

          const text = e.key === "Enter" ? "\n" : e.key;
          const { newContent, newCursors } = applyMultiCursorEdit(
            content,
            multiCursorState.cursors,
            text,
          );

          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          tokenize(newContent);
          return;
        }
      }

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

            textarea.value = result.newValue;
            textarea.selectionStart = textarea.selectionEnd = result.newCursorPos;

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

      if (e.key === "Escape" && multiCursorState && multiCursorState.cursors.length > 1) {
        e.preventDefault();
        clearSecondaryCursors();
        return;
      }

      if (e.key === "Tab") {
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const spaces = " ".repeat(tabSize);
        const currentContent = textarea.value;

        const newContent =
          currentContent.substring(0, start) + spaces + currentContent.substring(end);

        textarea.value = newContent;

        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;

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
      cursorPosition.line,
      setCursorPosition,
      lines,
    ],
  );

  const scrollRafRef = useRef<number | null>(null);
  const lastScrollRef = useRef({ top: 0, left: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      const scrollTop = e.currentTarget.scrollTop;
      const scrollLeft = e.currentTarget.scrollLeft;

      // Skip if scroll hasn't changed
      if (lastScrollRef.current.top === scrollTop && lastScrollRef.current.left === scrollLeft) {
        return;
      }

      lastScrollRef.current = { top: scrollTop, left: scrollLeft };
      isScrollingRef.current = true;

      // Clear existing scroll timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Log scroll event for debugging
      scrollLogger.log(scrollTop, scrollLeft, "editor-scroll");

      // Single RAF for both transform updates and viewport tracking
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(() => {
          const { top, left } = lastScrollRef.current;

          // Update highlight layer transform for visual sync
          if (highlightRef.current) {
            highlightRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update multi-cursor layer transform for visual sync
          if (multiCursorRef.current) {
            multiCursorRef.current.style.transform = `translate(-${left}px, -${top}px)`;
          }

          // Update state store for Vim motions and cursor visibility
          useEditorStateStore.getState().actions.setScroll(top, left);

          // Update viewport tracking in the same RAF
          handleViewportScroll(top, lines.length);

          scrollRafRef.current = null;
        });
      }

      // Mark scrolling as finished after 150ms of no scroll events
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    },
    [handleViewportScroll, lines.length],
  );

  useEffect(() => {
    if (inputRef.current) {
      initializeViewport(inputRef.current, lines.length);
    }
  }, [initializeViewport, lines.length]);

  // Set textarea ref in editorAPI for operations like selectAll
  useEffect(() => {
    editorAPI.setTextareaRef(inputRef.current);
    return () => {
      editorAPI.setTextareaRef(null);
    };
  }, [inputRef]);

  // Cleanup scroll RAF and timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Native wheel handler for textarea - required for Tauri/WebView
  // React's onWheel doesn't support passive: false which is needed for proper scroll control
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      textarea.scrollTop += e.deltaY;
      textarea.scrollLeft += e.deltaX;
    };

    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, []);

  // Track viewport height for cursor visibility calculations
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const updateViewportHeight = () => {
      const height = textarea.clientHeight;
      if (height > 0) {
        useEditorStateStore.getState().actions.setViewportHeight(height);
      }
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(textarea);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Debounced tokenization to avoid blocking during scroll
  const tokenizeTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!buffer?.content || !buffer?.path) return;

    // Clear any pending tokenization
    if (tokenizeTimerRef.current) {
      clearTimeout(tokenizeTimerRef.current);
    }

    const contentToTokenize = foldTransform.hasActiveFolds ? displayContent : buffer.content;

    // If actively scrolling, debounce the tokenization
    if (isScrollingRef.current) {
      tokenizeTimerRef.current = setTimeout(() => {
        tokenize(contentToTokenize, viewportRange);
      }, 200);
    } else {
      // Not scrolling, tokenize immediately
      tokenize(contentToTokenize, viewportRange);
    }

    return () => {
      if (tokenizeTimerRef.current) {
        clearTimeout(tokenizeTimerRef.current);
      }
    };
  }, [
    bufferId,
    buffer?.path,
    buffer?.content,
    tokenize,
    foldTransform.hasActiveFolds,
    displayContent,
    viewportRange,
  ]);

  useEffect(() => {
    if (inputRef.current && bufferId) {
      setTimeout(() => {
        if (inputRef.current && bufferId) {
          const offset = cursorPosition.offset || 0;
          const maxOffset = inputRef.current.value.length;
          const safeOffset = Math.min(offset, maxOffset);
          if (inputRef.current.selectionStart === inputRef.current.selectionEnd) {
            inputRef.current.selectionStart = safeOffset;
            inputRef.current.selectionEnd = safeOffset;
          }
          inputRef.current.focus();
        }
      }, 0);
    }
  }, [bufferId, cursorPosition.offset]);

  const handleLineClick = useCallback(
    (lineIndex: number) => {
      if (!inputRef.current) return;

      const lineStart = calculateLineOffset(lines, lineIndex);
      const lineEnd = lineStart + lines[lineIndex].length;

      inputRef.current.selectionStart = lineStart;
      inputRef.current.selectionEnd = lineEnd;
      inputRef.current.focus();

      const startPos = calculateCursorPosition(lineStart, lines);
      const endPos = calculateCursorPosition(lineEnd, lines);
      setCursorPosition(startPos);
      setSelection({ start: startPos, end: endPos });
    },
    [lines, setCursorPosition, setSelection],
  );

  const handleRevertChange = useCallback(
    (lineIndex: number, originalContent: string) => {
      if (!bufferId) return;
      const newLines = [...lines];
      newLines[lineIndex] = originalContent;
      const newContent = newLines.join("\n");
      updateBufferContent(bufferId, newContent);
      if (inputRef.current) {
        inputRef.current.value = newContent;
      }
      tokenize(newContent);
    },
    [lines, bufferId, updateBufferContent, tokenize],
  );

  if (!buffer) return null;

  return (
    <div className="absolute inset-0 flex">
      {showLineNumbers && (
        <Gutter
          totalLines={lines.length}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          textareaRef={inputRef}
          filePath={filePath}
          onLineClick={handleLineClick}
          onGitIndicatorClick={inlineDiff.toggle}
          foldMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
        />
      )}

      <div
        className={`overlay-editor-container relative min-h-0 min-w-0 flex-1 bg-primary-bg ${className || ""}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        {hasSyntaxHighlighting && (
          <HighlightLayer
            ref={highlightRef}
            content={displayContent}
            tokens={tokens}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            viewportRange={viewportRange}
          />
        )}
        <InputLayer
          textareaRef={inputRef}
          content={displayContent}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onSelect={handleCursorChange}
          onClick={handleClick}
          onContextMenu={contextMenu.open}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          bufferId={bufferId || undefined}
          showText={!hasSyntaxHighlighting}
        />
        {multiCursorState && (
          <MultiCursorLayer
            ref={multiCursorRef}
            cursors={multiCursorState.cursors}
            primaryCursorId={multiCursorState.primaryCursorId}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            content={displayContent}
          />
        )}

        {filePath && (
          <GitBlameLayer
            filePath={filePath}
            cursorLine={cursorPosition.line}
            visualCursorLine={visualCursorLine}
            visualContent={displayContent}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
          />
        )}

        {inlineDiff.state.isOpen && (
          <InlineDiff
            lineNumber={inlineDiff.state.lineNumber}
            type={inlineDiff.state.type}
            diffLines={inlineDiff.state.diffLines}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            onClose={inlineDiff.close}
            onRevert={handleRevertChange}
          />
        )}
      </div>
      {contextMenu.state.isOpen &&
        createPortal(
          <EditorContextMenu
            isOpen={contextMenu.state.isOpen}
            position={contextMenu.state.position}
            onClose={contextMenu.close}
            onCopy={editorOps.copy}
            onCut={editorOps.cut}
            onPaste={editorOps.paste}
            onSelectAll={editorOps.selectAll}
            onDelete={editorOps.deleteSelection}
          />,
          document.body,
        )}
    </div>
  );
}
