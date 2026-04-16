import "../styles/overlay-editor.css";
import { CornerDownLeft, X } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { useGitGutter } from "@/features/git/hooks/use-git-gutter";
import { isEditorContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { EDITOR_CONSTANTS } from "../config/constants";
import EditorContextMenu from "../context-menu/context-menu";
import { editorAPI } from "../extensions/api";
import { useAutocomplete } from "../hooks/use-autocomplete";
import { useBufferSwitch } from "../hooks/use-buffer-switch";
import { useContextMenu } from "../hooks/use-context-menu";
import { useDragScroll } from "../hooks/use-drag-scroll";
import { useEditorKeyDown } from "../hooks/use-editor-keydown";
import { useEditorOperations } from "../hooks/use-editor-operations";
import { useEditorScroll } from "../hooks/use-editor-scroll";
import { useFoldTransform } from "../hooks/use-fold-transform";
import { useInlineDiff } from "../hooks/use-inline-diff";
import { useInlineEdit } from "../hooks/use-inline-edit";
import { usePerformanceMonitor } from "../hooks/use-performance";
import { useResolvedEditorSettings } from "../hooks/use-resolved-settings";
import { useSelectionScope } from "../hooks/use-selection-scope";
import { getLanguageId, useTokenizer } from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { useBufferStore } from "../stores/buffer-store";
import { useFoldStore } from "../stores/fold-store";
import { useMinimapStore } from "../stores/minimap-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import {
  applyVirtualEdit,
  calculateActualOffset,
  transformTokensForFolding,
} from "../utils/fold-transformer";
import { fileOpenBenchmark } from "../utils/file-open-benchmark";
import { calculateLineHeight, calculateLineOffset, splitLines } from "../utils/lines";
import { calculateCursorPosition, getAccurateCursorX } from "../utils/position";
import { InlineDiff } from "./diff/inline-diff";
import { Gutter } from "./gutter/gutter";
import { InlineEditModelSelector } from "./inline-edit-model-selector";
import { DefinitionLinkLayer } from "./layers/definition-link-layer";
import { GitBlameLayer } from "./layers/git-blame-layer";
import { HighlightLayer } from "./layers/highlight-layer";
import { InputLayer } from "./layers/input-layer";
import { MultiCursorLayer } from "./layers/multi-cursor-layer";
import { SearchHighlightLayer } from "./layers/search-highlight-layer";
import { SelectionLayer } from "./layers/selection-layer";
import { VimCursorLayer } from "./layers/vim-cursor-layer";
import { Minimap } from "./minimap/minimap";

interface EditorProps {
  bufferId?: string;
  isActiveSurface?: boolean;
  isPreviewMode?: boolean;
  readOnly?: boolean;
  scrollable?: boolean;
  backgroundLayer?: ReactNode;
  onReadonlySurfaceClick?: (position: { line: number; column: number }) => void;
  className?: string;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  onMouseEnter?: () => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD = 20000;
const LARGE_FILE_SCROLL_TOKENIZE_DEBOUNCE_MS = 120;

export function Editor({
  bufferId: propBufferId,
  isActiveSurface = true,
  isPreviewMode = false,
  readOnly = false,
  scrollable = true,
  backgroundLayer,
  onReadonlySurfaceClick,
  className,
  onMouseMove,
  onMouseLeave,
  onMouseEnter,
  onClick,
}: EditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const multiCursorRef = useRef<HTMLDivElement>(null);
  const searchHighlightRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const vimCursorRef = useRef<HTMLDivElement>(null);
  const autocompleteCompletionRef = useRef<HTMLDivElement>(null);
  const inlineEditOverlayRef = useRef<HTMLDivElement>(null);
  const gitBlameRef = useRef<HTMLDivElement>(null);
  const inlineDiffRef = useRef<HTMLDivElement>(null);

  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  const globalActiveBufferId = useBufferStore.use.activeBufferId();
  const bufferId = propBufferId ?? globalActiveBufferId;
  const buffers = useBufferStore.use.buffers();
  const { updateBufferContent, updateBufferTokens } = useBufferStore.use.actions();
  const {
    setCursorPosition,
    setSelection,
    enableMultiCursor,
    addCursor,
    clearSecondaryCursors,
    updateCursor,
  } = useEditorStateStore.use.actions();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const selection = useEditorStateStore.use.selection?.();
  const multiCursorState = useEditorStateStore.use.multiCursorState();
  const onChange = useEditorStateStore.use.onChange();

  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const aiCompletionEnabled = useSettingsStore((state) => state.settings.aiCompletion);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const inlineGitBlameEnabled = useSettingsStore((state) => state.settings.enableInlineGitBlame);
  const gitGutterEnabled = useSettingsStore((state) => state.settings.enableGitGutter);
  const vimMode = useVimStore.use.mode();
  const vimVisualSelection = useVimStore.use.visualSelection();

  const fontSize = baseFontSize * zoomLevel;
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const wordWrap = useEditorSettingsStore.use.wordWrap();

  const rawBuffer = buffers.find((b) => b.id === bufferId);
  const buffer = rawBuffer && isEditorContent(rawBuffer) ? rawBuffer : undefined;
  const content = buffer?.content || "";
  const filePath = buffer?.path;
  const languageIdOverride = buffer?.languageOverride;

  const resolvedSettings = useResolvedEditorSettings(filePath ?? null);
  const tabSize = resolvedSettings.tabSize;

  useGitGutter({
    filePath: filePath || "",
    content,
    enabled: !!filePath && gitGutterEnabled && isActiveSurface && !isPreviewMode,
  });

  const foldActions = useFoldStore.use.actions();
  const fileFoldState = useFoldStore((state) =>
    filePath ? state.foldsByFile.get(filePath) : undefined,
  );

  const minimapEnabled = useSettingsStore((state) => state.settings.showMinimap);
  const minimapScale = useMinimapStore.use.scale();
  const minimapWidth = useMinimapStore.use.width();

  useEffect(() => {
    if (!filePath || !fileOpenBenchmark.has(filePath)) return;
    fileOpenBenchmark.mark(filePath, "editor-mounted");

    const rafId = requestAnimationFrame(() => {
      fileOpenBenchmark.finish(filePath, "editor-ready", `${content.length} chars`);
    });

    return () => cancelAnimationFrame(rafId);
  }, [filePath, content.length]);

  useEffect(() => {
    if (!isActiveSurface || isPreviewMode) return;
    if (filePath && content) {
      if (fileOpenBenchmark.has(filePath)) {
        fileOpenBenchmark.mark(filePath, "fold-start");
      }
      foldActions.computeFoldRegions(filePath, content);
      if (fileOpenBenchmark.has(filePath)) {
        fileOpenBenchmark.mark(filePath, "fold-done");
      }
    }
  }, [filePath, content, foldActions, isActiveSurface, isPreviewMode]);

  const foldTransform = useFoldTransform(filePath, content);
  const collapsedSignature = useMemo(() => {
    if (!fileFoldState) return "";
    return Array.from(fileFoldState.collapsedLines)
      .sort((a, b) => a - b)
      .join(",");
  }, [fileFoldState]);
  const previousFoldViewportRef = useRef<{
    signature: string;
    mapping: typeof foldTransform.mapping;
  } | null>(null);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      previousFoldViewportRef.current = {
        signature: collapsedSignature,
        mapping: foldTransform.mapping,
      };
      return;
    }

    const previous = previousFoldViewportRef.current;
    if (previous && previous.signature !== collapsedSignature) {
      const currentLineHeight = calculateLineHeight(fontSize);
      const previousTopVirtualLine = Math.max(
        0,
        Math.floor(textarea.scrollTop / currentLineHeight),
      );
      const anchorActualLine =
        previous.mapping.virtualToActual.get(previousTopVirtualLine) ?? previousTopVirtualLine;
      const nextVirtualLine =
        foldTransform.mapping.actualToVirtual.get(anchorActualLine) ?? anchorActualLine;
      const intraLineOffset = textarea.scrollTop % currentLineHeight;

      textarea.scrollTop = nextVirtualLine * currentLineHeight + intraLineOffset;
    }

    previousFoldViewportRef.current = {
      signature: collapsedSignature,
      mapping: foldTransform.mapping,
    };
  }, [collapsedSignature, foldTransform.mapping, fontSize]);

  // Track content area width for word wrap gutter measurement
  useEffect(() => {
    const el = contentContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContentWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasSyntaxHighlighting = useMemo(() => {
    if (languageIdOverride) return true;
    if (!filePath) return false;
    return getLanguageId(filePath) !== null;
  }, [filePath, languageIdOverride]);

  const contextMenu = useContextMenu();
  const inlineDiff = useInlineDiff(filePath, content);

  const { startMeasure, endMeasure } = usePerformanceMonitor("Editor");

  const actualLines = useMemo(() => {
    if (filePath && fileOpenBenchmark.has(filePath)) {
      fileOpenBenchmark.mark(filePath, "split-start");
    }
    startMeasure(`splitLines (len: ${content.length})`);
    const res = splitLines(content);
    endMeasure(`splitLines (len: ${content.length})`);
    if (filePath && fileOpenBenchmark.has(filePath)) {
      fileOpenBenchmark.mark(filePath, "split-done", `${res.length} lines`);
    }
    return res;
  }, [content, filePath, startMeasure, endMeasure]);
  const lines = foldTransform.hasActiveFolds ? foldTransform.virtualLines : actualLines;
  const displayContent = foldTransform.hasActiveFolds ? foldTransform.virtualContent : content;

  const lineHeight = useMemo(() => calculateLineHeight(fontSize), [fontSize]);
  const shouldVirtualizeRendering =
    lines.length >= EDITOR_CONSTANTS.RENDER_VIRTUALIZATION_THRESHOLD;
  const useIncrementalTokenization = hasSyntaxHighlighting && shouldVirtualizeRendering;

  const {
    viewportRange,
    handleScroll: handleViewportScroll,
    initializeViewport,
    forceUpdateViewport,
  } = useViewportLines({
    lineHeight,
  });

  const { tokens, tokenizedContent, tokenize, forceFullTokenize, resetForBufferSwitch } =
    useTokenizer({
      filePath,
      bufferId: bufferId || undefined,
      languageIdOverride,
      incremental: useIncrementalTokenization,
      enabled: hasSyntaxHighlighting,
    });
  const baseTokens = tokens.length > 0 ? tokens : (buffer?.tokens ?? []);
  const effectiveTokens = useMemo(() => {
    if (!foldTransform.hasActiveFolds) return baseTokens;
    return transformTokensForFolding(
      content,
      foldTransform.virtualLines,
      foldTransform.mapping,
      baseTokens,
    );
  }, [baseTokens, content, foldTransform]);

  useEffect(() => {
    if (!isActiveSurface) return;
    if (!bufferId || tokens.length === 0) return;
    updateBufferTokens(
      bufferId,
      tokens.map((token) => ({
        ...token,
        token_type: token.class_name,
      })),
    );
  }, [bufferId, tokens, updateBufferTokens, isActiveSurface]);

  // Atomic buffer switch — resets stores, syncs textarea, restores position
  const { switchGuardRef } = useBufferSwitch({
    enabled: isActiveSurface,
    bufferId,
    content: displayContent,
    textareaRef: inputRef,
    forceUpdateViewport,
    totalLines: lines.length,
    resetTokenizer: resetForBufferSwitch,
  });

  // Listen for extension installation to re-trigger tokenization
  useEffect(() => {
    if (!isActiveSurface) return;
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
  }, [filePath, content, forceFullTokenize, isActiveSurface]);

  const visualCursorLine = useMemo(() => {
    if (foldTransform.hasActiveFolds) {
      return foldTransform.mapping.actualToVirtual.get(cursorPosition.line) ?? cursorPosition.line;
    }
    return cursorPosition.line;
  }, [cursorPosition.line, foldTransform]);

  const handleInput = useCallback(
    (newVirtualContent: string) => {
      if (readOnly) return;
      if (!bufferId || !inputRef.current) return;

      const uiActions = useEditorUIStore.getState().actions;
      uiActions.setHoverInfo(null);
      uiActions.setIsHovering(false);
      uiActions.setAutocompleteCompletion(null);

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

      const timestamp = Date.now();
      useEditorUIStore.getState().actions.setLastInputTimestamp(timestamp);
    },
    [bufferId, updateBufferContent, setCursorPosition, content, foldTransform, onChange, readOnly],
  );

  const editorOps = useEditorOperations({
    inputRef,
    content,
    bufferId,
    updateBufferContent,
    handleInput,
  });

  // Inline edit hook
  const inlineEditState = useInlineEdit({
    inputRef,
    buffer: buffer
      ? {
          id: buffer.id,
          content: buffer.content,
          path: buffer.path,
          language: buffer.language ?? "",
        }
      : undefined,
    selection,
    lines,
    fontSize,
    fontFamily,
    lineHeight,
    tabSize,
    lastScrollRef: { current: { top: 0, left: 0 } } as React.RefObject<{
      top: number;
      left: number;
    }>,
    setCursorPosition,
    setSelection,
    updateBufferContent,
  });

  useOnClickOutside(inlineEditState.inlineEditPopoverRef as RefObject<HTMLElement>, (event) => {
    if (!inlineEditState.inlineEditVisible) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".inline-edit-model-selector-menu")) {
      return;
    }
    inlineEditState.inlineEditToolbarActions.hide();
  });

  const handleCursorChange = useCallback(() => {
    if (!bufferId || !inputRef.current) return;

    const selectionStart = inputRef.current.selectionStart;
    const selectionEnd = inputRef.current.selectionEnd;
    const isVisualModeActive = vimModeEnabled && vimMode === "visual";
    const position =
      isVisualModeActive && vimVisualSelection.end
        ? {
            ...vimVisualSelection.end,
            offset:
              calculateLineOffset(lines, vimVisualSelection.end.line) +
              vimVisualSelection.end.column,
          }
        : calculateCursorPosition(selectionStart, lines);

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
      const anchorOffset = Math.max(selectionStart, selectionEnd);
      const anchorPos = calculateCursorPosition(anchorOffset, lines);
      inlineEditState.setInlineEditSelectionAnchor({
        line: anchorPos.line,
        column: anchorPos.column,
      });

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
      if (inlineEditState.inlineEditVisible) {
        inlineEditState.setInlineEditSelectionAnchor({
          line: position.line,
          column: position.column,
        });
      } else {
        inlineEditState.setInlineEditSelectionAnchor(null);
      }
    }

    const uiActions = useEditorUIStore.getState().actions;
    uiActions.setHoverInfo(null);
    uiActions.setIsHovering(false);
  }, [
    bufferId,
    lines,
    actualLines,
    setCursorPosition,
    setSelection,
    foldTransform,
    inlineEditState,
    vimModeEnabled,
    vimMode,
    vimVisualSelection,
  ]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!bufferId || !inputRef.current) return;

      if (e.altKey) {
        e.preventDefault();

        const selectionStart = inputRef.current.selectionStart;
        const selectionEnd = inputRef.current.selectionEnd;
        const contentLines = splitLines(content);

        const clickedPosition = calculateCursorPosition(selectionStart, contentLines);

        const clickSelection =
          selectionStart !== selectionEnd
            ? {
                start: calculateCursorPosition(selectionStart, contentLines),
                end: calculateCursorPosition(selectionEnd, contentLines),
              }
            : undefined;

        if (!multiCursorState) {
          enableMultiCursor();
          const isDifferentPosition =
            clickedPosition.line !== cursorPosition.line ||
            clickedPosition.column !== cursorPosition.column;
          if (isDifferentPosition) {
            addCursor(clickedPosition, clickSelection);
          }
        } else {
          addCursor(clickedPosition, clickSelection);
        }
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        clearSecondaryCursors();
      }

      const selectionStart = inputRef.current.selectionStart;
      const clickedPosition = calculateCursorPosition(selectionStart, lines);
      const clickedLine = lines[clickedPosition.line] || "";
      const accordionMeta = parseDiffAccordionLine(clickedLine);

      if (accordionMeta && filePath) {
        const actualLine = foldTransform.hasActiveFolds
          ? (foldTransform.mapping.virtualToActual.get(clickedPosition.line) ??
            clickedPosition.line)
          : clickedPosition.line;
        foldActions.toggleFold(filePath, actualLine);
        inputRef.current.blur();
        return;
      }

      if (filePath && foldTransform.foldMarkers.has(clickedPosition.line)) {
        const actualLine =
          foldTransform.mapping.virtualToActual.get(clickedPosition.line) ?? clickedPosition.line;
        foldActions.toggleFold(filePath, actualLine);
        inputRef.current.blur();
        return;
      }

      if (readOnly && onReadonlySurfaceClick) {
        onReadonlySurfaceClick({
          line: clickedPosition.line,
          column: clickedPosition.column,
        });
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
      lines,
      filePath,
      foldTransform,
      foldActions,
      onReadonlySurfaceClick,
      readOnly,
    ],
  );

  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const autocompleteCompletion = useEditorUIStore.use.autocompleteCompletion();
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();
  const { setSelectedLspIndex, setIsLspCompletionVisible, setAutocompleteCompletion } =
    useEditorUIStore.use.actions();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();

  useAutocomplete({
    enabled: aiCompletionEnabled && !isPreviewMode && !readOnly,
    model: aiAutocompleteModelId,
    filePath: filePath || null,
    languageId: filePath ? getLanguageId(filePath) : null,
    content,
    cursorOffset: cursorPosition.offset,
    lastInputTimestamp,
    hasActiveFolds: foldTransform.hasActiveFolds,
    setAutocompleteCompletion,
  });

  // Extracted key down handler
  const handleKeyDown = useEditorKeyDown({
    inputRef,
    content,
    bufferId,
    filePath,
    tabSize,
    lines,
    cursorPosition,
    selection,
    multiCursorState,
    isLspCompletionVisible,
    filteredCompletions,
    selectedLspIndex,
    autocompleteCompletion,
    inlineEditVisible: inlineEditState.inlineEditVisible,
    isInlineEditRunning: inlineEditState.isInlineEditRunning,
    handleInput,
    handleApplyInlineEdit: inlineEditState.handleApplyInlineEdit,
    updateBufferContent,
    setCursorPosition,
    setSelection,
    enableMultiCursor,
    addCursor,
    clearSecondaryCursors,
    updateCursor,
    setSelectedLspIndex,
    setIsLspCompletionVisible,
    setAutocompleteCompletion,
  });

  // Extracted scroll handler with switchGuard
  const { handleScroll, isScrollingRef } = useEditorScroll({
    bufferId,
    linesCount: lines.length,
    minimapEnabled,
    switchGuardRef,
    highlightRef,
    multiCursorRef,
    searchHighlightRef,
    selectionLayerRef,
    vimCursorRef,
    autocompleteCompletionRef,
    inlineEditOverlayRef,
    gitBlameRef,
    inlineDiffRef,
    setEditorScrollTop,
    handleViewportScroll,
  });

  useDragScroll(inputRef);
  useSelectionScope(contentContainerRef, isActiveSurface);

  useEffect(() => {
    if (inputRef.current) {
      initializeViewport(inputRef.current, lines.length);
    }
  }, [initializeViewport, lines.length]);

  useEffect(() => {
    editorAPI.setTextareaRef(inputRef.current);
    return () => {
      editorAPI.setTextareaRef(null);
    };
  }, [inputRef]);

  // Non-macOS wheel forwarding
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    if (!scrollable) {
      const handleWheel = (e: WheelEvent) => {
        const scrollContainer = textarea.closest("[data-diff-stack-scroll-container]");
        if (!(scrollContainer instanceof HTMLDivElement)) return;

        const canScrollY =
          (e.deltaY < 0 && scrollContainer.scrollTop > 0) ||
          (e.deltaY > 0 &&
            scrollContainer.scrollTop + scrollContainer.clientHeight <
              scrollContainer.scrollHeight);
        const canScrollX =
          (e.deltaX < 0 && scrollContainer.scrollLeft > 0) ||
          (e.deltaX > 0 &&
            scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth);

        if (!canScrollY && !canScrollX) return;

        scrollContainer.scrollBy({
          left: e.deltaX,
          top: e.deltaY,
          behavior: "auto",
        });
        e.preventDefault();
      };

      textarea.addEventListener("wheel", handleWheel, { passive: false });
      return () => textarea.removeEventListener("wheel", handleWheel);
    }

    if (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        textarea.scrollLeft += e.deltaX;
      } else {
        textarea.scrollTop += e.deltaY;
      }
    };

    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, [scrollable]);

  // Track viewport height
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const updateViewportHeight = () => {
      const height = textarea.clientHeight;
      if (height > 0) {
        useEditorStateStore.getState().actions.setViewportHeight(height);
        setEditorViewportHeight(height);
      }
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(textarea);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Tokenization scheduled via requestAnimationFrame
  const tokenizeRafRef = useRef<number | null>(null);
  const tokenizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!buffer?.content || !buffer?.path) return;

    if (tokenizeRafRef.current !== null) {
      cancelAnimationFrame(tokenizeRafRef.current);
    }
    if (tokenizeTimeoutRef.current !== null) {
      clearTimeout(tokenizeTimeoutRef.current);
    }

    const contentToTokenize = buffer.content;
    const targetViewportRange = useIncrementalTokenization ? viewportRange : undefined;
    const isLargeFile = lines.length >= LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD;

    if (
      !useIncrementalTokenization &&
      tokens.length > 0 &&
      tokenizedContent === contentToTokenize
    ) {
      return;
    }

    if (useIncrementalTokenization && isLargeFile && isScrollingRef.current) {
      tokenizeTimeoutRef.current = setTimeout(() => {
        tokenize(contentToTokenize, targetViewportRange);
        tokenizeTimeoutRef.current = null;
      }, LARGE_FILE_SCROLL_TOKENIZE_DEBOUNCE_MS);

      return () => {
        if (tokenizeTimeoutRef.current !== null) {
          clearTimeout(tokenizeTimeoutRef.current);
        }
      };
    }

    tokenizeRafRef.current = requestAnimationFrame(() => {
      tokenize(contentToTokenize, targetViewportRange);
      tokenizeRafRef.current = null;
    });

    return () => {
      if (tokenizeRafRef.current !== null) {
        cancelAnimationFrame(tokenizeRafRef.current);
      }
      if (tokenizeTimeoutRef.current !== null) {
        clearTimeout(tokenizeTimeoutRef.current);
      }
    };
  }, [
    bufferId,
    buffer?.path,
    buffer?.content,
    tokenizedContent,
    tokens.length,
    tokenize,
    lines.length,
    useIncrementalTokenization,
    viewportRange?.startLine,
    viewportRange?.endLine,
    isScrollingRef,
  ]);

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

      if (foldTransform.hasActiveFolds) {
        const actualStartLine =
          foldTransform.mapping.virtualToActual.get(startPos.line) ?? startPos.line;
        const actualEndLine = foldTransform.mapping.virtualToActual.get(endPos.line) ?? endPos.line;

        const actualStart = {
          line: actualStartLine,
          column: startPos.column,
          offset: calculateActualOffset(actualLines, actualStartLine, startPos.column),
        };
        const actualEnd = {
          line: actualEndLine,
          column: endPos.column,
          offset: calculateActualOffset(actualLines, actualEndLine, endPos.column),
        };

        setCursorPosition(actualStart);
        setSelection({ start: actualStart, end: actualEnd });
        return;
      }

      setCursorPosition(startPos);
      setSelection({ start: startPos, end: endPos });
    },
    [lines, foldTransform, actualLines, setCursorPosition, setSelection],
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
    },
    [lines, bufferId, updateBufferContent],
  );

  const inlineAutocompletePreview = useMemo(() => {
    if (!autocompleteCompletion || isLspCompletionVisible) return null;
    if (autocompleteCompletion.cursorOffset !== cursorPosition.offset) return null;
    if (visualCursorLine < 0 || visualCursorLine >= lines.length) return null;

    const normalized = autocompleteCompletion.text.replace(/\r\n/g, "\n");
    if (!normalized) return null;

    const lineText = lines[visualCursorLine] || "";
    const cursorColumn = Math.min(cursorPosition.column, lineText.length);
    const cursorX = getAccurateCursorX(lineText, cursorColumn, fontSize, fontFamily, tabSize);

    return {
      text: normalized,
      top: visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      left: cursorX + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
    };
  }, [
    autocompleteCompletion,
    isLspCompletionVisible,
    cursorPosition.offset,
    cursorPosition.column,
    visualCursorLine,
    lines,
    fontSize,
    fontFamily,
    tabSize,
    lineHeight,
  ]);

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
          virtualize={shouldVirtualizeRendering}
          filePath={filePath}
          onLineClick={handleLineClick}
          onGitIndicatorClick={inlineDiff.toggle}
          foldMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
          wordWrap={wordWrap}
          lines={lines}
          contentWidth={contentWidth}
        />
      )}

      <div
        ref={contentContainerRef}
        className={`overlay-editor-container relative min-h-0 min-w-0 flex-1 bg-primary-bg ${className || ""}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        {backgroundLayer}
        {hasSyntaxHighlighting && (
          <HighlightLayer
            ref={highlightRef}
            content={displayContent}
            tokens={effectiveTokens}
            foldMarkers={foldTransform.hasActiveFolds ? foldTransform.foldMarkers : undefined}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            wordWrap={wordWrap}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          />
        )}
        <InputLayer
          textareaRef={inputRef}
          content={displayContent}
          filePath={filePath}
          onInput={handleInput}
          onKeyDown={readOnly ? undefined : handleKeyDown}
          onScroll={handleScroll}
          onSelect={handleCursorChange}
          onClick={handleClick}
          onContextMenu={contextMenu.open}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          wordWrap={wordWrap}
          readOnly={readOnly}
          scrollable={scrollable}
          bufferId={bufferId || undefined}
          showText={!hasSyntaxHighlighting}
        />
        <SelectionLayer
          ref={selectionLayerRef}
          textareaRef={inputRef}
          content={displayContent}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          wordWrap={wordWrap}
        />
        {inlineEditState.inlineEditVisible && inlineEditState.popoverPosition && (
          <div ref={inlineEditOverlayRef} className="pointer-events-none absolute inset-0 z-[200]">
            <div
              ref={inlineEditState.inlineEditPopoverRef}
              role="dialog"
              aria-modal="false"
              aria-labelledby="inline-edit-title"
              aria-describedby="inline-edit-description"
              className="pointer-events-auto absolute w-[360px] overflow-hidden rounded-lg border border-border/60 bg-primary-bg shadow-lg"
              style={{
                top: `${inlineEditState.popoverPosition.top}px`,
                left: `${inlineEditState.popoverPosition.left}px`,
              }}
            >
              <div className="px-2 py-1.5">
                <div className="sr-only">
                  <div id="inline-edit-title">Inline edit</div>
                  <div id="inline-edit-description">
                    Describe the code change, then press Enter to apply or Escape to close.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    ref={inlineEditState.inlineEditInstructionRef}
                    autoFocus
                    value={inlineEditState.inlineEditInstruction}
                    onChange={(e) => {
                      inlineEditState.setInlineEditInstruction(e.target.value);
                      if (inlineEditState.inlineEditError) {
                        inlineEditState.setInlineEditError(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void inlineEditState.handleApplyInlineEdit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        if (!inlineEditState.isInlineEditRunning) {
                          inlineEditState.inlineEditToolbarActions.hide();
                        }
                      }
                    }}
                    variant="ghost"
                    size="sm"
                    aria-label="Inline edit instruction"
                    aria-describedby={
                      inlineEditState.inlineEditError
                        ? "inline-edit-description inline-edit-error"
                        : "inline-edit-description"
                    }
                    aria-invalid={inlineEditState.inlineEditError ? true : undefined}
                    className="ui-font h-8 flex-1 bg-transparent px-0 text-xs placeholder:text-text-lighter/80 focus:bg-transparent"
                    placeholder={
                      selection && selection.start.offset !== selection.end.offset
                        ? "Describe the edit for the selection..."
                        : "Describe the edit for the current line..."
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => inlineEditState.inlineEditToolbarActions.hide()}
                    className="text-text-lighter hover:text-text"
                    tooltip="Close inline edit"
                    shortcut="escape"
                  >
                    <X />
                  </Button>
                </div>
                {inlineEditState.inlineEditError && (
                  <div
                    id="inline-edit-error"
                    role="alert"
                    aria-live="assertive"
                    className="ui-font mt-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300"
                  >
                    {inlineEditState.inlineEditError}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between px-2 py-1">
                <div className="min-w-0 flex-1">
                  <InlineEditModelSelector
                    models={inlineEditState.inlineEditModels}
                    value={inlineEditState.aiAutocompleteModelId}
                    onChange={(modelId) =>
                      inlineEditState.updateSetting("aiAutocompleteModelId", modelId)
                    }
                    disabled={inlineEditState.isInlineEditRunning}
                    isLoading={inlineEditState.isInlineEditModelLoading}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void inlineEditState.handleApplyInlineEdit()}
                    disabled={inlineEditState.isInlineEditRunning}
                    className="gap-1 px-1 text-accent hover:bg-transparent hover:text-accent/80"
                    aria-label={
                      inlineEditState.isInlineEditRunning
                        ? "Applying inline edit"
                        : "Apply inline edit"
                    }
                    tooltip="Apply inline edit"
                    shortcut="enter"
                  >
                    <CornerDownLeft />
                    {inlineEditState.isInlineEditRunning ? "Applying..." : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        {inlineAutocompletePreview && (
          <div
            ref={autocompleteCompletionRef}
            className="pointer-events-none absolute inset-0 z-[3]"
          >
            <div
              style={{
                position: "absolute",
                top: `${inlineAutocompletePreview.top}px`,
                left: `${inlineAutocompletePreview.left}px`,
                fontSize: `${fontSize}px`,
                fontFamily,
                lineHeight: `${lineHeight}px`,
                whiteSpace: "pre",
                opacity: 0.42,
                color: "var(--text-lighter, #94a3b8)",
              }}
            >
              {inlineAutocompletePreview.text}
            </div>
          </div>
        )}
        {autocompleteCompletion && !isLspCompletionVisible && !inlineAutocompletePreview && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-40 rounded-md bg-primary-bg/80 px-2 py-1 text-[11px] text-text-lighter/80">
            Tab to accept AI suggestion
          </div>
        )}
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

        {vimModeEnabled && (
          <VimCursorLayer
            ref={vimCursorRef}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            vimMode={vimMode}
          />
        )}

        {searchMatches.length > 0 && (
          <SearchHighlightLayer
            ref={searchHighlightRef}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          />
        )}

        <DefinitionLinkLayer
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          content={displayContent}
          textareaRef={inputRef}
        />

        {filePath && inlineGitBlameEnabled && !inlineEditState.inlineEditVisible && (
          <GitBlameLayer
            ref={gitBlameRef}
            filePath={filePath}
            cursorLine={cursorPosition.line}
            cursorColumn={cursorPosition.column}
            visualCursorLine={visualCursorLine}
            visualContent={displayContent}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            wordWrap={wordWrap}
          />
        )}

        {inlineDiff.state.isOpen && (
          <div
            ref={inlineDiffRef}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 20,
              padding: `var(--editor-padding-top) var(--editor-padding-right) var(--editor-padding-bottom) var(--editor-padding-left)`,
            }}
          >
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
          </div>
        )}
      </div>

      {minimapEnabled && (
        <Minimap
          content={displayContent}
          tokens={effectiveTokens}
          scrollTop={editorScrollTop}
          viewportHeight={editorViewportHeight}
          totalHeight={lines.length * lineHeight}
          lineHeight={lineHeight}
          scale={minimapScale}
          width={minimapWidth}
          onScrollTo={(scrollTop) => {
            if (inputRef.current) {
              inputRef.current.scrollTop = scrollTop;
            }
          }}
        />
      )}

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
            onGoToDefinition={() => {
              keymapRegistry.executeCommand("editor.goToDefinition");
            }}
            onFindReferences={() => {
              keymapRegistry.executeCommand("editor.goToReferences");
            }}
            onRenameSymbol={() => {
              keymapRegistry.executeCommand("editor.renameSymbol");
            }}
          />,
          document.body,
        )}
    </div>
  );
}
