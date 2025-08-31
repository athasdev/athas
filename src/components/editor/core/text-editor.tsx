import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { basicEditingExtension } from "@/extensions/basic-editing-extension";
import { editorAPI } from "@/extensions/editor-api";
import { extensionManager } from "@/extensions/extension-manager";
import {
  setSyntaxHighlightingFilePath,
  syntaxHighlightingExtension,
} from "@/extensions/syntax-highlighting-extension";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import {
  useDebouncedFunction,
  usePerformanceMonitor,
  useRAFCallback,
} from "@/hooks/use-performance";
import { useSettingsStore } from "@/settings/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useEditorCompletionStore } from "@/stores/editor-completion-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import { useLspStore } from "@/stores/lsp-store";
import { useSearchResultsStore } from "@/stores/search-results-store";
import type { Position } from "@/types/editor-types";
import { calculateCursorPosition, calculateOffsetFromPosition } from "@/utils/editor-position";
import { CompletionDropdown } from "../overlays/completion-dropdown";
import EditorContextMenu from "../overlays/editor-context-menu";
import { handleKeyboardShortcuts } from "./keyboard-shortcuts";
import { LineBasedEditor } from "./line-based-editor";

export function TextEditor() {
  const tabSize = useEditorSettingsStore.use.tabSize();
  const lines = useEditorViewStore.use.lines();
  const { getContent } = useEditorViewStore.use.actions();
  const { updateBufferContent } = useBufferStore.use.actions();
  const { setCursorVisibility, restorePositionForFile } = useEditorCursorStore.use.actions();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const { onChange, disabled, filePath, editorRef } = useEditorInstanceStore();
  const { setViewportHeight } = useEditorLayoutStore.use.actions();
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const { addDecoration, removeDecoration } = useEditorDecorationsStore();
  const { loadBlameForFile } = useGitBlameStore();
  const { rootFolderPath } = useFileSystemStore();

  // Performance monitoring
  const { start: startRender, end: endRender } = usePerformanceMonitor("TextEditor render");

  const searchResults = useSearchResultsStore((state) => state.activePathsearchResults);
  const searchDecorations = useMemo(() => {
    return searchResults.map((result) => {
      const startOffset = calculateOffsetFromPosition(result.line, result.column, lines);
      const endColumn = result.column + result.match.length;
      const endOffset = calculateOffsetFromPosition(result.line, endColumn, lines);

      return {
        range: {
          start: {
            line: result.line,
            column: result.column,
            offset: startOffset,
          },
          end: { line: result.line, column: endColumn, offset: endOffset },
        },
        className: "search-highlight",
        type: "inline" as const,
        key: `search-${result.line}-${result.column}-${result.match}`,
      };
    });
  }, [searchResults, lines]);

  const searchDecorationIds = useRef<string[]>([]);
  const previousSearchDecorationsRef = useRef<typeof searchDecorations>([]);

  // Use the same layout calculations as the visual editor
  const { lineHeight, gutterWidth: layoutGutterWidth } = useEditorLayout();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const { setCursorPosition, setSelection, setDesiredColumn } = useEditorCursorStore.use.actions();
  const currentDesiredColumn = useEditorCursorStore.use.desiredColumn?.() ?? undefined;
  const lspActions = useLspStore.use.actions();

  // Use the ref from the store or fallback to local ref
  const containerRef = editorRef || localRef;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  // Get content as string when needed
  const content = getContent();

  // Debounced LSP completion request
  const debouncedLSPRequest = useDebouncedFunction(
    (params: {
      filePath: string;
      cursorPos: number;
      value: string;
      editorRef: React.RefObject<HTMLDivElement | null>;
    }) => {
      if (containerRef.current) {
        lspActions.requestCompletion({
          ...params,
          editorRef: containerRef,
        });
      }
    },
    150,
    { leading: false, trailing: true },
  );

  // RAF-optimized scroll handler
  const rafScrollHandler = useRAFCallback((targetLineTop: number, viewport: HTMLElement) => {
    if (targetLineTop < viewport.scrollTop) {
      viewport.scrollTop = targetLineTop;
    } else if (targetLineTop + lineHeight > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = targetLineTop + lineHeight - viewport.clientHeight;
    }
  });

  // Handle textarea input
  const handleTextareaChange = (
    e: React.ChangeEvent<HTMLTextAreaElement> | React.FormEvent<HTMLTextAreaElement>,
  ) => {
    startRender();
    const textarea = e.currentTarget;
    const newValue = textarea.value;

    // Calculate which line changed
    const newLines = newValue ? newValue.split("\n") : [""];
    const { selectionStart, selectionEnd } = textarea;
    const newCursorPosition = calculateCursorPosition(selectionStart, newLines);

    // Find the affected line
    const affectedLines = new Set<number>();
    affectedLines.add(newCursorPosition.line);

    // Update buffer content instead of editor content store
    if (activeBufferId) {
      updateBufferContent(activeBufferId, newValue);
    }
    onChange?.(newValue);

    setCursorPosition(newCursorPosition);

    if (selectionStart !== selectionEnd) {
      setSelection({
        start: calculateCursorPosition(selectionStart, newLines),
        end: calculateCursorPosition(selectionEnd, newLines),
      });
    } else {
      setSelection(undefined);
    }

    // Emit content change with affected lines
    const eventData = { content: newValue, changes: [], affectedLines };
    editorAPI.emitEvent("contentChange", eventData);

    // Trigger LSP completion if we're typing (using debounced version)
    if (newValue.length > content.length && selectionStart === selectionEnd) {
      debouncedLSPRequest({
        filePath: filePath || "",
        cursorPos: selectionStart,
        value: newValue,
        editorRef: containerRef,
      });
    }

    endRender();
  };

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart } = textarea;
    const currentPosition = calculateCursorPosition(selectionStart, lines);
    const completionStore = useEditorCompletionStore.getState();

    // Emit keydown event for extensions (like auto-pairing)
    editorAPI.emitEvent("keydown", {
      event: e.nativeEvent,
      content: textarea.value,
      position: {
        line: currentPosition.line,
        character: currentPosition.column,
        offset: selectionStart,
      },
    });

    // Check for extension keybindings first
    const key = [
      e.ctrlKey && "Ctrl",
      e.metaKey && "Cmd",
      e.altKey && "Alt",
      e.shiftKey && "Shift",
      e.key,
    ]
      .filter(Boolean)
      .join("+");

    const command = extensionManager.getCommandForKeybinding(key);
    if (command && (!command.when || command.when())) {
      e.preventDefault();
      command.execute({ editor: editorAPI });
      return;
    }

    // Handle keyboard shortcuts
    const shortcutHandled = handleKeyboardShortcuts({
      e,
      content,
      lines,
      selectionStart,
      textareaRef,
      onChange,
      updateBufferContent,
      activeBufferId,
      handleSelectionChange,
      handleCut,
    });

    if (shortcutHandled) {
      return;
    }

    // Handle completion navigation
    if (completionStore.isLspCompletionVisible && completionStore.filteredCompletions.length > 0) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const currentIndex = completionStore.selectedLspIndex;
        const maxIndex = completionStore.filteredCompletions.length - 1;

        let newIndex: number;
        if (e.key === "ArrowUp") {
          newIndex = currentIndex > 0 ? currentIndex - 1 : maxIndex;
        } else {
          newIndex = currentIndex < maxIndex ? currentIndex + 1 : 0;
        }

        completionStore.actions.setSelectedLspIndex(newIndex);
        return;
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = completionStore.filteredCompletions[completionStore.selectedLspIndex];
        if (selected) {
          handleApplyCompletion(selected.item);
        }
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        completionStore.actions.setIsLspCompletionVisible(false);
        return;
      }
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Don't prevent default if Shift is held - allow native selection behavior
      if (e.shiftKey) {
        // Reset desired column on selection
        setDesiredColumn(undefined);
        return;
      }

      e.preventDefault();

      const targetLine = e.key === "ArrowUp" ? currentPosition.line - 1 : currentPosition.line + 1;

      // Check bounds
      if (targetLine < 0 || targetLine >= lines.length) {
        return;
      }

      // Use desired column if set, otherwise use current column
      const targetColumn = currentDesiredColumn ?? currentPosition.column;

      // Ensure column doesn't exceed line length
      const actualColumn = Math.min(targetColumn, lines[targetLine].length);

      // Calculate new offset
      const newOffset = calculateOffsetFromPosition(targetLine, actualColumn, lines);

      // Update textarea selection
      textarea.selectionStart = textarea.selectionEnd = newOffset;

      // RAF-optimized viewport scrolling
      if (viewportRef.current) {
        const targetLineTop = targetLine * lineHeight;
        rafScrollHandler(targetLineTop, viewportRef.current);
      }

      // Update cursor position immediately
      handleSelectionChange();

      // Maintain desired column for subsequent arrow key presses
      if (currentDesiredColumn === undefined) {
        setDesiredColumn(currentPosition.column);
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // Don't interfere with Shift+Arrow selection
      if (e.shiftKey) {
        setDesiredColumn(undefined);
        return;
      }

      // Handle horizontal movement with boundary checking
      const isLeft = e.key === "ArrowLeft";

      // Check if we're at a boundary
      if (
        (isLeft && currentPosition.column === 0) ||
        (!isLeft && currentPosition.column === lines[currentPosition.line].length)
      ) {
        // Prevent default to stop cursor from moving to next/prev line
        e.preventDefault();
        return;
      }

      // Reset desired column on horizontal movement
      setDesiredColumn(undefined);
    } else {
      // Reset desired column on any other key
      setDesiredColumn(undefined);
    }
  };

  // Handle cursor position changes
  const handleSelectionChange = useCallback(() => {
    if (!textareaRef.current) return;

    const { selectionStart, selectionEnd } = textareaRef.current;

    if (selectionStart !== selectionEnd) {
      setSelection({
        start: calculateCursorPosition(selectionStart, lines),
        end: calculateCursorPosition(selectionEnd, lines),
      });
    } else {
      setSelection(undefined);
    }

    // Update cursor position after selection change
    const newCursorPosition = calculateCursorPosition(selectionEnd, lines);
    setCursorPosition(newCursorPosition);
  }, [lines, setCursorPosition, setSelection]);

  useEffect(() => {
    const decorationsChanged =
      searchDecorations.length !== previousSearchDecorationsRef.current.length ||
      searchDecorations.some((decoration, index) => {
        const prev = previousSearchDecorationsRef.current[index];
        return !prev || decoration.key !== prev.key;
      });

    if (!decorationsChanged) {
      return;
    }

    requestAnimationFrame(() => {
      searchDecorationIds.current.forEach((id) => removeDecoration(id));
      searchDecorationIds.current = [];

      searchDecorations.forEach((decoration) => {
        const decorationId = addDecoration(decoration);
        searchDecorationIds.current.push(decorationId);
      });

      previousSearchDecorationsRef.current = searchDecorations;
    });

    return () => {
      searchDecorationIds.current.forEach((id) => removeDecoration(id));
      searchDecorationIds.current = [];
    };
  }, [searchDecorations, addDecoration, removeDecoration]);

  useEffect(() => {
    const handleDocumentSelectionChange = () => {
      if (document.activeElement === textareaRef.current) {
        handleSelectionChange();
      }
    };

    document.addEventListener("selectionchange", handleDocumentSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
    };
  }, [handleSelectionChange]);

  // Focus textarea on mount and setup extension system
  useEffect(() => {
    // Set textarea ref in editor API
    editorAPI.setTextareaRef(textareaRef.current);

    // Initialize extension manager with editor API
    extensionManager.setEditor(editorAPI);

    // Load core extensions only once per app lifecycle
    const loadExtensions = async () => {
      try {
        // Initialize extension manager if not already done
        if (!extensionManager.isInitialized()) {
          extensionManager.initialize();
        }

        // Load core extensions if not already loaded (these are lightweight)
        if (!extensionManager.isExtensionLoaded("Syntax Highlighting")) {
          await extensionManager.loadExtension(syntaxHighlightingExtension);
        }

        if (!extensionManager.isExtensionLoaded("Basic Editing")) {
          await extensionManager.loadExtension(basicEditingExtension);
        }

        // Load Auto Pairing extension first (lightweight and immediate user experience)
        if (!extensionManager.isExtensionLoaded("Auto Pairing")) {
          const { autoPairingExtension } = await import(
            "@/extensions/editing/auto-pairing-extension"
          );
          await extensionManager.loadExtension(autoPairingExtension);
        }

        // Set file path for syntax highlighting
        if (filePath) {
          setSyntaxHighlightingFilePath(filePath);
        }

        // Load LSP extension asynchronously without blocking UI
        // This prevents blocking the file picker and other UI interactions
        setTimeout(async () => {
          try {
            if (!extensionManager.isExtensionLoaded("typescript-lsp")) {
              const { typescriptLSPExtension } = await import(
                "@/extensions/language-support/typescript-lsp-extension"
              );
              await extensionManager.loadNewExtension(typescriptLSPExtension);
            }
          } catch (error) {
            console.error("Failed to load LSP extension:", error);
          }
        }, 0);
      } catch (error) {
        console.error("Failed to load extensions:", error);
      }
    };

    loadExtensions();

    // No cleanup needed - extensions are managed globally
  }, []); // Remove filePath dependency to prevent re-running

  // Update syntax highlighting when file path changes
  useEffect(() => {
    if (filePath) {
      setSyntaxHighlightingFilePath(filePath);
    }
  }, [filePath]);

  // Load git blame data when file changes
  useEffect(() => {
    if (filePath && rootFolderPath && activeBufferId) {
      // Only load blame for files within the git repository
      if (filePath.startsWith(rootFolderPath)) {
        loadBlameForFile(rootFolderPath, filePath).catch((error) => {
          console.warn("Failed to load git blame:", error);
        });
      }
    }
  }, [filePath, rootFolderPath, activeBufferId, loadBlameForFile]);

  const restoreCursorPosition = useCallback(
    (bufferId: string) => {
      if (!textareaRef.current) return;

      const restored = restorePositionForFile(bufferId);

      if (restored) {
        const cursorPosition = useEditorCursorStore.getState().cursorPosition;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
          cursorPosition.offset;
      } else {
        textareaRef.current.selectionStart = 0;
        textareaRef.current.selectionEnd = 0;
      }

      handleSelectionChange();
    },
    [content, handleSelectionChange],
  );

  // Restore cursor position when switching to a new file
  useEffect(() => {
    if (activeBufferId) {
      restoreCursorPosition(activeBufferId);
    }
  }, [activeBufferId, restoreCursorPosition]);

  // Update editor API by subscribing to cursor store changes
  useEffect(() => {
    const unsubscribe = useEditorCursorStore.subscribe(
      (state) => ({ cursor: state.cursorPosition, selection: state.selection }),
      ({ cursor, selection }) => {
        editorAPI.updateCursorAndSelection(cursor, selection ?? null);
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Update textarea ref in editor API when it changes
    editorAPI.setTextareaRef(textareaRef.current);

    // Update viewport ref in editor API when it changes
    viewportRef.current && editorAPI.setViewportRef(viewportRef.current);
  }, []);

  // Update viewport height when container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [setViewportHeight]);

  // Sync textarea scroll with viewport scroll
  useEffect(() => {
    if (!viewportRef.current || !textareaRef.current) return;

    const viewport = viewportRef.current;
    const textarea = textareaRef.current;
    let isViewportScrolling = false;
    let isTextareaScrolling = false;

    const handleViewportScroll = () => {
      if (isTextareaScrolling) return;
      isViewportScrolling = true;
      textarea.scrollTop = viewport.scrollTop;
      textarea.scrollLeft = viewport.scrollLeft;
      requestAnimationFrame(() => {
        isViewportScrolling = false;
      });
    };

    const handleTextareaScroll = () => {
      if (isViewportScrolling) return;
      isTextareaScrolling = true;
      viewport.scrollTop = textarea.scrollTop;
      viewport.scrollLeft = textarea.scrollLeft;
      requestAnimationFrame(() => {
        isTextareaScrolling = false;
      });
    };

    viewport.addEventListener("scroll", handleViewportScroll);
    textarea.addEventListener("scroll", handleTextareaScroll);

    return () => {
      viewport.removeEventListener("scroll", handleViewportScroll);
      textarea.removeEventListener("scroll", handleTextareaScroll);
    };
  }, []);

  // Emit content change events to extensions on initial load only
  useEffect(() => {
    // Only emit on initial mount when content is first loaded
    if (content) {
      const eventData = {
        content,
        changes: [],
        affectedLines: new Set<number>(),
      };
      editorAPI.emitEvent("contentChange", eventData);
    }
  }, []); // Empty dependency array - only run once on mount

  // Handlers for line-based rendering interactions
  const handleLineBasedClick = useCallback(
    (position: Position) => {
      if (!textareaRef.current) return;

      // Update textarea selection
      textareaRef.current.selectionStart = textareaRef.current.selectionEnd = position.offset;

      // Focus textarea
      textareaRef.current.focus();

      // Update cursor position
      handleSelectionChange();
    },
    [handleSelectionChange],
  );

  const handleLineBasedSelection = useCallback(
    (start: Position, end: Position) => {
      if (!textareaRef.current) return;

      // Update textarea selection
      const startOffset = Math.min(start.offset, end.offset);
      const endOffset = Math.max(start.offset, end.offset);

      textareaRef.current.selectionStart = startOffset;
      textareaRef.current.selectionEnd = endOffset;

      // Update visual selection
      handleSelectionChange();
    },
    [handleSelectionChange],
  );

  // Handle applying completion
  const handleApplyCompletion = useCallback(
    (completion: any) => {
      if (!textareaRef.current) return;

      const cursorPos = textareaRef.current.selectionStart;
      const { newValue, newCursorPos } = lspActions.applyCompletion({
        completion,
        value: content,
        cursorPos,
      });

      // Update the content
      onChange?.(newValue);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newValue);
      }

      // Update cursor position after React renders the new value
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newCursorPos;
          textareaRef.current.focus();
          handleSelectionChange();
        }
      }, 0);
    },
    [content, onChange, updateBufferContent, activeBufferId, lspActions],
  );

  // Context menu handlers
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      // Check if right-click is at the end of a line to prevent automatic text selection
      if (textareaRef.current) {
        const { selectionStart, selectionEnd, value } = textareaRef.current;
        const selectedText = value.slice(selectionStart, selectionEnd);

        if (selectedText.split("\n").length > 1) {
          // If the selected text is more than one line, clear the selection
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = selectionStart;
          setCursorPosition(calculateCursorPosition(selectionStart, lines));
          setSelection(undefined);
        }
      }

      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [content, lines, setCursorPosition, setSelection],
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 } });
  }, []);

  const handleCopy = useCallback(async () => {
    const selection = useEditorCursorStore.getState().selection;
    if (selection && textareaRef.current) {
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      try {
        await navigator.clipboard.writeText(selectedText);
      } catch (error) {
        console.error("Failed to copy text:", error);
      }
    }
  }, [content]);

  const handleCut = useCallback(async () => {
    const selection = useEditorCursorStore.getState().selection;
    if (selection && textareaRef.current) {
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      try {
        await navigator.clipboard.writeText(selectedText);

        // Remove the selected text
        const newContent =
          content.slice(0, selection.start.offset) + content.slice(selection.end.offset);
        onChange?.(newContent);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, newContent);
        }

        // Update cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
              selection.start.offset;
            handleSelectionChange();
          }
        }, 0);
      } catch (error) {
        console.error("Failed to cut text:", error);
      }
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await readText();
      if (textareaRef.current) {
        const cursorPos = textareaRef.current.selectionStart;
        const selection = useEditorCursorStore.getState().selection;

        let newContent: string;
        let newCursorPos: number;

        if (selection && selection.start.offset !== selection.end.offset) {
          // Replace selection with pasted text
          newContent =
            content.slice(0, selection.start.offset) + text + content.slice(selection.end.offset);
          newCursorPos = selection.start.offset + text.length;
        } else {
          // Insert at cursor position
          newContent = content.slice(0, cursorPos) + text + content.slice(cursorPos);
          newCursorPos = cursorPos + text.length;
        }

        onChange?.(newContent);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, newContent);
        }

        // Update cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newCursorPos;
            handleSelectionChange();
          }
        }, 0);
      }
    } catch (error) {
      console.error("Failed to paste text:", error);
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange]);

  const handleSelectAll = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.select();
      handleSelectionChange();
    }
  }, [handleSelectionChange]);

  // Additional context menu handlers
  const handleDelete = useCallback(() => {
    const selection = useEditorCursorStore.getState().selection;
    if (selection && textareaRef.current && selection.start.offset !== selection.end.offset) {
      const newContent =
        content.slice(0, selection.start.offset) + content.slice(selection.end.offset);
      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }

      // Update cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
            selection.start.offset;
          handleSelectionChange();
        }
      }, 0);
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange]);

  const handleDuplicate = useCallback(() => {
    if (textareaRef.current) {
      const cursorPos = textareaRef.current.selectionStart;
      const selection = useEditorCursorStore.getState().selection;

      if (selection && selection.start.offset !== selection.end.offset) {
        // Duplicate selected text
        const selectedText = content.slice(selection.start.offset, selection.end.offset);
        const newContent =
          content.slice(0, selection.end.offset) +
          selectedText +
          content.slice(selection.end.offset);
        onChange?.(newContent);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, newContent);
        }
      } else {
        // Duplicate current line
        const lineStart = content.lastIndexOf("\n", cursorPos - 1) + 1;
        const lineEnd = content.indexOf("\n", cursorPos);
        const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
        const currentLine = content.slice(lineStart, actualLineEnd);
        const newContent = `${content.slice(0, actualLineEnd)}\n${currentLine}${content.slice(
          actualLineEnd,
        )}`;

        onChange?.(newContent);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, newContent);
        }
      }
    }
  }, [content, onChange, updateBufferContent, activeBufferId]);

  const handleIndent = useCallback(() => {
    const selection = useEditorCursorStore.getState().selection;
    if (!textareaRef.current) return;

    if (selection && selection.start.offset !== selection.end.offset) {
      // Indent selected lines
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      const indentedText = selectedText
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      const newContent =
        content.slice(0, selection.start.offset) +
        indentedText +
        content.slice(selection.end.offset);

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    } else {
      // Insert tab at cursor
      const cursorPos = textareaRef.current.selectionStart;
      const newContent = `${content.slice(0, cursorPos)}  ${content.slice(cursorPos)}`;

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursorPos + 2;
          handleSelectionChange();
        }
      }, 0);
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange]);

  const handleOutdent = useCallback(() => {
    const selection = useEditorCursorStore.getState().selection;
    if (!textareaRef.current) return;

    if (selection && selection.start.offset !== selection.end.offset) {
      // Outdent selected lines
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      const outdentedText = selectedText
        .split("\n")
        .map((line) => {
          if (line.startsWith("  ")) return line.slice(2);
          if (line.startsWith("\t")) return line.slice(1);
          return line;
        })
        .join("\n");
      const newContent =
        content.slice(0, selection.start.offset) +
        outdentedText +
        content.slice(selection.end.offset);

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
  }, [content, onChange, updateBufferContent, activeBufferId]);

  const handleToggleComment = useCallback(() => {
    // Simple toggle comment implementation
    console.log("Toggle comment - not implemented yet");
  }, []);

  const handleFormat = useCallback(async () => {
    if (!content.trim()) return;

    try {
      const { formatter } = useSettingsStore.getState().settings;
      // Determine language from active buffer
      const activeBuffer = useBufferStore.getState().buffers.find((b) => b.id === activeBufferId);
      const language = activeBuffer?.language || "javascript";

      const { success, formatted_content, error } = await invoke<{
        success: boolean;
        formatted_content: string;
        error?: string;
      }>("format_code", {
        request: {
          content,
          language,
          formatter,
        },
      });

      if (success && formatted_content !== content) {
        onChange?.(formatted_content);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, formatted_content);
        }
      } else if (error) {
        console.warn("Format error:", error);
      }
    } catch (error) {
      console.error("Failed to format document:", error);
    }
  }, [content, onChange, updateBufferContent, activeBufferId]);

  const handleToggleCase = useCallback(() => {
    const selection = useEditorCursorStore.getState().selection;
    if (selection && textareaRef.current && selection.start.offset !== selection.end.offset) {
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      const toggledText =
        selectedText === selectedText.toUpperCase()
          ? selectedText.toLowerCase()
          : selectedText.toUpperCase();

      const newContent =
        content.slice(0, selection.start.offset) +
        toggledText +
        content.slice(selection.end.offset);
      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
  }, [content, onChange, updateBufferContent, activeBufferId]);

  const handleMoveLineUp = useCallback(() => {
    const cursorPos = useEditorCursorStore.getState().cursorPosition;
    const line = cursorPos.line;
    const lines = content.split("\n");

    const temp = lines[line] || "";
    if (line === 0) return;
    // Move current line up
    lines[line] = lines[line - 1];
    lines[line - 1] = temp;

    const newContent = lines.join("\n");

    onChange?.(newContent);
    if (activeBufferId) {
      updateBufferContent(activeBufferId, newContent);
    }
  }, [useEditorCursorStore, content, onChange, updateBufferContent, activeBufferId]);

  const handleMoveLineDown = useCallback(() => {
    const cursorPos = useEditorCursorStore.getState().cursorPosition;
    const line = cursorPos.line;
    const lines = content.split("\n");

    const temp = lines[line + 1] || "";
    if (line + 1 >= lines.length) return;
    // Move current line down
    lines[line + 1] = lines[line];
    lines[line] = temp;

    const newContent = lines.join("\n");

    onChange?.(newContent);
    if (activeBufferId) {
      updateBufferContent(activeBufferId, newContent);
    }
  }, [useEditorCursorStore, content, onChange, updateBufferContent, activeBufferId]);

  const handleInsertLine = useCallback(() => {
    if (textareaRef.current) {
      const cursorPos = textareaRef.current.selectionStart;
      const newContent = `${content.slice(0, cursorPos)}\n${content.slice(cursorPos)}`;

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursorPos + 1;
          handleSelectionChange();
        }
      }, 0);
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange]);

  const handleToggleBookmark = useCallback(() => {
    // Toggle bookmark - not implemented yet
    console.log("Toggle bookmark - not implemented yet");
  }, []);

  // Get layout values for proper textarea positioning - use the same values as visual editor
  const gutterWidth = layoutGutterWidth;

  // Line-based rendering
  return (
    <div ref={containerRef} className="virtual-editor-container relative h-full overflow-hidden">
      {/* Gutter area overlay to prevent selection in line numbers */}
      {gutterWidth > 0 && (
        <div
          className="pointer-events-auto absolute top-0 left-0 h-full select-none"
          style={{
            width: `${gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN}px`,
            zIndex: 2,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        />
      )}

      {/* Transparent textarea overlay for input and selection - positioned only over content area */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleTextareaChange}
        onInput={handleTextareaChange}
        onBlur={() => setCursorVisibility(false)}
        onFocus={() => setCursorVisibility(true)}
        onKeyDown={handleKeyDown}
        onSelect={handleSelectionChange}
        onKeyUp={handleSelectionChange}
        onMouseDown={handleSelectionChange}
        onMouseUp={handleSelectionChange}
        onContextMenu={handleContextMenu}
        onScroll={() => {
          /* Handled by useEffect */
        }}
        disabled={disabled}
        className="editor-textarea selection-transparent absolute resize-none overflow-auto border-none bg-transparent text-transparent caret-transparent outline-none"
        style={{
          left: `${gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN}px`,
          top: 0,
          right: 0,
          bottom: 0,
          fontSize: `${fontSize}px`,
          fontFamily: `${fontFamily}, JetBrains Mono, monospace`,
          lineHeight: `${lineHeight}px`,
          padding: 0,
          paddingBottom: `${20 * lineHeight}px`, // Add 20 lines worth of bottom padding
          margin: 0,
          whiteSpace: "pre",
          tabSize: tabSize,
          zIndex: 1,
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        autoSave="off"
        spellCheck={false}
      />

      <LineBasedEditor
        onPositionClick={handleLineBasedClick}
        onSelectionDrag={handleLineBasedSelection}
        viewportRef={viewportRef}
        onContextMenu={handleContextMenu}
      />

      {/* Completion dropdown */}
      <CompletionDropdown onApplyCompletion={handleApplyCompletion} />

      {/* Context menu */}
      {createPortal(
        <EditorContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onSelectAll={handleSelectAll}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onIndent={handleIndent}
          onOutdent={handleOutdent}
          onToggleComment={handleToggleComment}
          onFormat={handleFormat}
          onToggleCase={handleToggleCase}
          onMoveLineUp={handleMoveLineUp}
          onMoveLineDown={handleMoveLineDown}
          onInsertLine={handleInsertLine}
          onToggleBookmark={handleToggleBookmark}
        />,
        document.body,
      )}
    </div>
  );
}
