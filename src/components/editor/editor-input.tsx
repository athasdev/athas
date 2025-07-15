import { useEffect, useRef } from "react";
import { getCursorPosition, setCursorPosition } from "../../hooks/use-vim";
import { useCodeEditorStore } from "../../stores/code-editor-store";
import { useEditorConfigStore } from "../../stores/editor-config-store";
import { useEditorInstanceStore } from "../../stores/editor-instance-store";
import { cn } from "../../utils/cn";
import { EditorHistory } from "../../utils/editor-history";
import {
  deleteLine,
  duplicateLine,
  getCurrentLine,
  indentSelection,
  moveLine,
  selectWord,
  toggleComment,
} from "../../utils/editor-shortcuts";

export function EditorInput() {
  const { fontSize, tabSize, wordWrap, vimEnabled, vimMode } = useEditorConfigStore();
  const { value: codeEditorValue, setValue: setCodeEditorValue, language } = useCodeEditorStore();
  const historyRef = useRef<EditorHistory>(new EditorHistory());
  const {
    editorRef,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    className,
    handleUserInteraction,
    handleScroll,
    handleHover,
    handleMouseEnter,
    handleMouseLeave,
    vimEngine,
    handleLspCompletion,
    onCursorPositionChange,
    filePath,
    isLanguageSupported,
    setInlineAssistant,
  } = useEditorInstanceStore();

  const getEditorStyles = {
    fontSize: `${fontSize}px`,
    tabSize: tabSize,
    lineHeight: `${fontSize * 1.4}px`,
  };

  const getEditorClasses = () => {
    let classes = `absolute top-0 bottom-0 right-0 left-0 m-0 font-mono border-none outline-none overflow-auto z-[2] shadow-none rounded-none transition-none`;

    if (vimEnabled) {
      if (vimMode === "normal") {
        classes += " caret-transparent";
      } else {
        classes += " caret-[var(--tw-text)]";
      }
      if (vimMode === "visual") {
        classes += " vim-visual-selection";
      }
    } else {
      classes += " caret-[var(--tw-text)]";
    }

    return classes;
  };

  // Helper to update text and add to history
  const updateTextWithHistory = (
    newText: string,
    newPosition: number,
    addToHistory: boolean = true,
  ) => {
    setCodeEditorValue(newText);
    onChange?.(newText);

    if (addToHistory) {
      historyRef.current.addEntry(newText, newPosition);
    }

    if (editorRef?.current) {
      const editor = editorRef.current;
      setTimeout(() => setCursorPosition(editor, newPosition), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle Undo - Cmd+Z
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey && !vimEnabled) {
      e.preventDefault();
      const entry = historyRef.current.undo();
      if (entry) {
        setCodeEditorValue(entry.text);
        onChange?.(entry.text);
        if (editorRef?.current) {
          const editor = editorRef.current;
          setTimeout(() => setCursorPosition(editor, entry.cursorPosition), 0);
        }
      }
      return;
    }

    // Handle Redo - Cmd+Shift+Z
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z" && !vimEnabled) {
      e.preventDefault();
      const entry = historyRef.current.redo();
      if (entry) {
        setCodeEditorValue(entry.text);
        onChange?.(entry.text);
        if (editorRef?.current) {
          const editor = editorRef.current;
          setTimeout(() => setCursorPosition(editor, entry.cursorPosition), 0);
        }
      }
      return;
    }

    // Handle Cmd+K for inline assistant (but not Cmd+Shift+K)
    if ((e.metaKey || e.ctrlKey) && e.key === "k" && !e.shiftKey) {
      e.preventDefault();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = selection.toString();
        const rect = range.getBoundingClientRect();

        setInlineAssistant(true, selectedText, {
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      } else {
        if (editorRef?.current) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            setInlineAssistant(true, "", {
              x: rect.left,
              y: rect.top,
            });
          }
        }
      }
      return;
    }

    // Handle Enter key for new lines
    if (e.key === "Enter" && !e.shiftKey && !vimEnabled) {
      e.preventDefault();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode("\n"));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        const content = editorRef?.current?.textContent || "";
        setCodeEditorValue(content);
        onChange?.(content);
      }
      return;
    }

    // Handle Tab/Shift+Tab for indentation
    if (e.key === "Tab" && !vimEnabled) {
      e.preventDefault();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && editorRef?.current) {
        const selectionStart = getCursorPosition(editorRef.current);
        const selectionEnd = selectionStart + selection.toString().length;

        if (selectionStart !== selectionEnd) {
          // Indent/outdent selection
          const { newText, newSelectionStart, newSelectionEnd } = indentSelection(
            codeEditorValue,
            selectionStart,
            selectionEnd,
            !e.shiftKey,
          );
          setCodeEditorValue(newText);
          onChange?.(newText);

          // Restore selection after React re-renders
          setTimeout(() => {
            const range = document.createRange();
            const textNode = editorRef.current?.firstChild;
            if (textNode) {
              range.setStart(textNode, newSelectionStart);
              range.setEnd(textNode, newSelectionEnd);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }, 0);
        } else {
          // Insert spaces at cursor
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode("  "));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);

          const content = editorRef?.current?.textContent || "";
          setCodeEditorValue(content);
          onChange?.(content);
        }
      }
      return;
    }

    // Line duplication - Option+Shift+Down/Up
    if (e.altKey && e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const { newText, newPosition } = duplicateLine(codeEditorValue, position);
      updateTextWithHistory(newText, newPosition);
      return;
    }

    // Move line - Option+Up/Down
    if (e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const direction = e.key === "ArrowUp" ? "up" : "down";
      const { newText, newPosition } = moveLine(codeEditorValue, position, direction);
      updateTextWithHistory(newText, newPosition);
      return;
    }

    // Delete line - Cmd+Shift+K
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "k" && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const { newText, newPosition } = deleteLine(codeEditorValue, position);
      updateTextWithHistory(newText, newPosition);
      return;
    }

    // Toggle comment - Cmd+/
    if ((e.metaKey || e.ctrlKey) && e.key === "/" && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const { newText, newPosition } = toggleComment(codeEditorValue, position, language);
      updateTextWithHistory(newText, newPosition);
      return;
    }

    // Select word - Cmd+D
    if ((e.metaKey || e.ctrlKey) && e.key === "d" && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const { start, end } = selectWord(codeEditorValue, position);

      if (start !== end) {
        const selection = window.getSelection();
        const range = document.createRange();
        const textNode = editorRef.current?.firstChild;
        if (textNode && selection) {
          range.setStart(textNode, start);
          range.setEnd(textNode, end);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      return;
    }

    // Jump to line start - Cmd+Left
    if ((e.metaKey || e.ctrlKey) && e.key === "ArrowLeft" && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const line = getCurrentLine(codeEditorValue, position);
      setCursorPosition(editorRef.current, line.start);
      return;
    }

    // Jump to line end - Cmd+Right
    if ((e.metaKey || e.ctrlKey) && e.key === "ArrowRight" && !vimEnabled) {
      e.preventDefault();
      if (!editorRef?.current) return;
      const position = getCursorPosition(editorRef.current);
      const line = getCurrentLine(codeEditorValue, position);
      setCursorPosition(editorRef.current, line.end);
      return;
    }

    // Select all - Cmd+A
    if ((e.metaKey || e.ctrlKey) && e.key === "a" && !vimEnabled) {
      e.preventDefault();
      const selection = window.getSelection();
      const range = document.createRange();
      if (editorRef?.current && selection) {
        range.selectNodeContents(editorRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return;
    }

    if (vimEnabled && vimEngine) {
      const handled = vimEngine.handleKeyDown(e as any, editorRef?.current as any, codeEditorValue);
      if (handled) {
        return;
      }
    }

    onKeyDown?.(e);
  };

  // Sync content with contenteditable when the value from store changes
  useEffect(() => {
    if (editorRef?.current && editorRef.current.textContent !== codeEditorValue) {
      editorRef.current.textContent = codeEditorValue;
    }
  }, [codeEditorValue, editorRef]);

  // Initialize history when content changes externally (e.g., file opened)
  useEffect(() => {
    if (filePath) {
      historyRef.current.clear();
      historyRef.current.addEntry(codeEditorValue, 0);
    }
  }, [filePath]);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleCursorPositionChange = () => {
    if (editorRef?.current) {
      const position = getCursorPosition(editorRef.current);
      onCursorPositionChange?.(position);
    }
  };
  const triggerLsp = () => {
    if (!editorRef?.current) return;
    const position = getCursorPosition(editorRef.current);
    const lastChar = codeEditorValue.charAt(position - 1);
    const delay = /[.::>()<]/.test(lastChar) ? 50 : 300;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const currentPosition = getCursorPosition(editorRef.current!);
      const isRemoteFile = filePath?.startsWith("remote://");
      if (
        !isRemoteFile &&
        handleLspCompletion &&
        isLanguageSupported?.(filePath || "") &&
        (!vimEnabled || vimMode === "insert")
      ) {
        handleLspCompletion(currentPosition, editorRef!);
      }
    }, delay);
  };

  return (
    <div
      ref={editorRef}
      contentEditable={!disabled}
      suppressContentEditableWarning={true}
      onInput={e => {
        handleUserInteraction();
        const content = e.currentTarget.textContent || "";
        setCodeEditorValue(content);
        onChange?.(content);

        // Add to history with debouncing for regular typing
        if (editorRef?.current) {
          const position = getCursorPosition(editorRef.current);
          historyRef.current.addEntryDebounced(content, position);
        }
      }}
      onKeyDown={e => {
        handleUserInteraction();
        handleKeyDown(e);
      }}
      onKeyUp={() => {
        handleCursorPositionChange();
        triggerLsp();
      }}
      onClick={() => {
        handleUserInteraction();
        handleCursorPositionChange();
      }}
      onScroll={handleScroll}
      onMouseMove={handleHover}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        getEditorClasses(),
        "code-editor-content",
        vimEnabled && vimMode === "normal" && "vim-normal-mode",
        vimEnabled && vimMode === "insert" && "vim-insert-mode",
        className,
      )}
      style={{
        ...getEditorStyles,
        padding: "16px",
        minHeight: "100%",
        outline: "none",
        whiteSpace: wordWrap ? "pre-wrap" : "pre",
        display: "inline-block",
        width: "max-content",
        minWidth: "100%",
        wordBreak: wordWrap ? "break-word" : "normal",
        overflowWrap: wordWrap ? "break-word" : "normal",
        color: "var(--tw-text)",
        opacity: 0.3,
        background: "transparent",
        caretColor: "var(--tw-text)",
        border: "none",
        zIndex: 2,
        resize: "none",
      }}
      spellCheck={false}
      autoCapitalize="off"
      data-placeholder={placeholder}
    />
  );
}
