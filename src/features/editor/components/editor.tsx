import "../styles/overlay-editor.css";
import { ArrowBendDownLeft as CornerDownLeft, X } from "@phosphor-icons/react";
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
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { EDITOR_CONSTANTS } from "../config/constants";
import EditorContextMenu from "../context-menu/context-menu";
import { editorAPI } from "../extensions/api";
import { SYNTAX_HIGHLIGHTING_REFRESH_EVENT } from "../extensions/builtin/syntax-highlighting";
import { useAutocomplete } from "../hooks/use-autocomplete";
import { useBufferSwitch } from "../hooks/use-buffer-switch";
import { useContextMenu } from "../hooks/use-context-menu";
import { isDragScrolling, useDragScroll } from "../hooks/use-drag-scroll";
import { useEditorKeyDown } from "../hooks/use-editor-keydown";
import { useEditorOperations } from "../hooks/use-editor-operations";
import { useEditorScroll } from "../hooks/use-editor-scroll";
import { useFoldTransform } from "../hooks/use-fold-transform";
import { useInlineDiff } from "../hooks/use-inline-diff";
import { useInlineEdit } from "../hooks/use-inline-edit";
import { usePerformanceMonitor } from "../hooks/use-performance";
import { useResolvedEditorSettings } from "../hooks/use-resolved-settings";
import { useSelectionScope } from "../hooks/use-selection-scope";
import {
  getLanguageId,
  resolveSyntaxTokensForContent,
  retargetTokensForContentEdit,
  useTokenizer,
  type SyntaxTokenSnapshot,
} from "../hooks/use-tokenizer";
import { useViewportLines } from "../hooks/use-viewport-lines";
import type { InlayHint } from "../lsp/use-inlay-hints";
import type { SemanticTokenState } from "../lsp/use-semantic-tokens";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { useBufferStore } from "../stores/buffer-store";
import { useFoldStore } from "../stores/fold-store";
import { useMinimapStore } from "../stores/minimap-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import { useInlineEditToolbarStore } from "../stores/inline-edit-toolbar-store";
import type { Position, Range } from "../types/editor";
import {
  applyVirtualEdit,
  calculateActualOffset,
  transformTokensForFolding,
} from "../utils/fold-transformer";
import { fileOpenBenchmark } from "../utils/file-open-benchmark";
import { buildLineOffsetMap, normalizeLineEndings } from "../utils/html";
import {
  countLines,
  createSparseLineArray,
  getLargeEditorModeInfo,
  getLineOffset,
  isTooLargeForEditorServices,
} from "../utils/large-file";
import { calculateLineHeight, splitLines } from "../utils/lines";
import {
  calculateCursorPosition,
  calculateCursorPositionFromContent,
  getAccurateCursorX,
} from "../utils/position";
import {
  canApplySemanticTokenState,
  mergeTokenLayers,
  semanticTokensToEditorTokens,
} from "../utils/token-layers";
import {
  buildEditorViewLayout,
  type EditorCoordinateResolver,
  type EditorViewZone,
  type EditorModelPositionResolver,
} from "../view-model/view-layout";
import {
  calculateInlineDiffHeight,
  getInlineDiffLinesToShow,
  InlineDiff,
} from "./diff/inline-diff";
import { Gutter } from "./gutter/gutter";
import { InlineEditModelSelector } from "./inline-edit-model-selector";
import { DefinitionLinkLayer } from "./layers/definition-link-layer";
import { GitBlameLayer } from "./layers/git-blame-layer";
import { HighlightLayer } from "./layers/highlight-layer";
import { InputLayer } from "./layers/input-layer";
import { MultiCursorLayer } from "./layers/multi-cursor-layer";
import { PrimaryCursorLayer } from "./layers/primary-cursor-layer";
import { SearchHighlightLayer } from "./layers/search-highlight-layer";
import { SelectionLayer } from "./layers/selection-layer";
import { VimCursorLayer } from "./layers/vim-cursor-layer";
import { Minimap } from "./minimap/minimap";

interface EditorProps {
  bufferId?: string;
  viewStateKey?: string;
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
  highlightMatches?: Array<{ start: number; end: number }>;
  currentHighlightIndex?: number;
  lineNumberStart?: number;
  lineNumberMap?: Array<number | null>;
  onContentChange?: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
  ) => void;
  inlayHints?: InlayHint[];
  semanticTokens?: SemanticTokenState;
  largeContentMode?: boolean;
  largeContentLineCount?: number;
  onCoordinateResolverChange?: (resolver: EditorCoordinateResolver | null) => void;
  onModelPositionResolverChange?: (resolver: EditorModelPositionResolver | null) => void;
}

const LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD = 20000;
const LARGE_FILE_SCROLL_TOKENIZE_DEBOUNCE_MS = 120;
const INLAY_HINT_TYPING_SUPPRESS_MS = 650;
const INLINE_EDIT_VIEW_ZONE_HEIGHT = 96;

function estimateInlayHintWidth(
  label: string,
  fontSize: number,
  fontFamily: string,
  tabSize: number,
) {
  return getAccurateCursorX(label, label.length, fontSize * 0.85, fontFamily, tabSize) + 12;
}

export function Editor({
  bufferId: propBufferId,
  viewStateKey,
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
  highlightMatches,
  currentHighlightIndex,
  lineNumberStart = 1,
  lineNumberMap,
  onContentChange,
  inlayHints = [],
  semanticTokens,
  largeContentMode: largeContentModeOverride,
  largeContentLineCount,
  onCoordinateResolverChange,
  onModelPositionResolverChange,
}: EditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const primaryCursorRef = useRef<HTMLDivElement>(null);
  const multiCursorRef = useRef<HTMLDivElement>(null);
  const searchHighlightRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const vimCursorRef = useRef<HTMLDivElement>(null);
  const autocompleteCompletionRef = useRef<HTMLDivElement>(null);
  const inlineEditOverlayRef = useRef<HTMLDivElement>(null);
  const gitBlameRef = useRef<HTMLDivElement>(null);
  const inlineDiffRef = useRef<HTMLDivElement>(null);
  const suppressedNativeHistoryInputRef = useRef<"historyUndo" | "historyRedo" | null>(null);
  const syntaxTokenSnapshotRef = useRef<SyntaxTokenSnapshot | null>(null);

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
  const lineHeightMultiplier = useEditorSettingsStore.use.lineHeight();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const setIsFindVisible = useUIState((state) => state.setIsFindVisible);
  const aiCompletionEnabled = useSettingsStore((state) => state.settings.aiCompletion);
  const aiAutocompleteProvider = useSettingsStore((state) => state.settings.aiAutocompleteProvider);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const aiAutocompleteCustomBaseUrl = useSettingsStore(
    (state) => state.settings.aiAutocompleteCustomBaseUrl,
  );
  const aiAutocompleteCustomModelId = useSettingsStore(
    (state) => state.settings.aiAutocompleteCustomModelId,
  );
  const inlineGitBlameEnabled = useSettingsStore((state) => state.settings.enableInlineGitBlame);
  const gitGutterEnabled = useSettingsStore((state) => state.settings.enableGitGutter);
  const vimMode = useVimStore.use.mode();
  const vimVisualSelection = useVimStore.use.visualSelection();

  const fontSize = baseFontSize * zoomLevel;
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const wordWrapSetting = useEditorSettingsStore.use.wordWrap();

  const rawBuffer = buffers.find((b) => b.id === bufferId);
  const buffer = rawBuffer && isEditorContent(rawBuffer) ? rawBuffer : undefined;
  const content = buffer?.content || "";
  const filePath = buffer?.path;
  const languageIdOverride = buffer?.languageOverride;
  const useGlobalEditorState = isActiveSurface;
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();

  const resolvedSettings = useResolvedEditorSettings(filePath ?? null);
  const tabSize = resolvedSettings.tabSize;
  const [suppressInlayHintsForTyping, setSuppressInlayHintsForTyping] = useState(false);
  const { startMeasure, endMeasure } = usePerformanceMonitor("Editor");

  const actualLineCount = useMemo(
    () => largeContentLineCount ?? countLines(content),
    [content, largeContentLineCount],
  );
  const largeContentMode =
    largeContentModeOverride ??
    isTooLargeForEditorServices({
      contentLength: content.length,
      lineCount: actualLineCount,
    });

  const actualLines = useMemo(() => {
    if (largeContentMode) {
      return createSparseLineArray(actualLineCount);
    }

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
  }, [actualLineCount, content, filePath, largeContentMode, startMeasure, endMeasure]);

  useGitGutter({
    filePath: filePath || "",
    content,
    enabled:
      !!filePath && gitGutterEnabled && isActiveSurface && !isPreviewMode && !largeContentMode,
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
    if (!isActiveSurface || isPreviewMode || largeContentMode) return;
    if (filePath && content) {
      let cancelled = false;
      const computeFolds = () => {
        if (cancelled) return;
        if (fileOpenBenchmark.has(filePath)) {
          fileOpenBenchmark.mark(filePath, "fold-start");
        }
        foldActions.computeFoldRegions(filePath, content);
        if (fileOpenBenchmark.has(filePath)) {
          fileOpenBenchmark.mark(filePath, "fold-done");
        }
      };

      if ("requestIdleCallback" in window) {
        const idleId = window.requestIdleCallback(computeFolds, { timeout: 500 });
        return () => {
          cancelled = true;
          window.cancelIdleCallback(idleId);
        };
      }

      const timeoutId = globalThis.setTimeout(computeFolds, 0);
      return () => {
        cancelled = true;
        globalThis.clearTimeout(timeoutId);
      };
    }
  }, [filePath, content, foldActions, isActiveSurface, isPreviewMode, largeContentMode]);

  const foldTransform = useFoldTransform(
    largeContentMode ? undefined : filePath,
    content,
    actualLines,
  );
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
      const currentLineHeight = calculateLineHeight(fontSize, lineHeightMultiplier);
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
  }, [collapsedSignature, foldTransform.mapping, fontSize, lineHeightMultiplier]);

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

  const wordWrap = largeContentMode ? false : wordWrapSetting;
  const lines = foldTransform.hasActiveFolds ? foldTransform.virtualLines : actualLines;
  const displayContent = foldTransform.hasActiveFolds ? foldTransform.virtualContent : content;
  const textareaContent = largeContentMode ? "" : displayContent;

  const lineHeight = useMemo(
    () => calculateLineHeight(fontSize, lineHeightMultiplier),
    [fontSize, lineHeightMultiplier],
  );
  const measureEditorText = useCallback(
    (text: string) => getAccurateCursorX(text, text.length, fontSize, fontFamily, tabSize),
    [fontSize, fontFamily, tabSize],
  );
  const isInlineEditToolbarVisible = useInlineEditToolbarStore.use.isVisible();
  const viewZones = useMemo(() => {
    const zones: EditorViewZone[] = [];

    if (inlineDiff.state.isOpen && !largeContentMode) {
      const visualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.actualToVirtual.get(inlineDiff.state.lineNumber) ??
          inlineDiff.state.lineNumber)
        : inlineDiff.state.lineNumber;

      if (visualLine >= 0 && visualLine < lines.length) {
        const linesToShow = getInlineDiffLinesToShow(
          inlineDiff.state.diffLines,
          inlineDiff.state.lineNumber,
          inlineDiff.state.type,
        );

        zones.push({
          id: "inline-diff",
          afterLine: visualLine,
          height: calculateInlineDiffHeight(linesToShow.length, lineHeight),
        });
      }
    }

    if (isInlineEditToolbarVisible && !largeContentMode) {
      const visualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.actualToVirtual.get(cursorPosition.line) ?? cursorPosition.line)
        : cursorPosition.line;

      if (visualLine >= 0 && visualLine < lines.length) {
        zones.push({
          id: "inline-edit",
          afterLine: visualLine,
          height: INLINE_EDIT_VIEW_ZONE_HEIGHT,
        });
      }
    }

    return zones;
  }, [
    cursorPosition.line,
    foldTransform.hasActiveFolds,
    foldTransform.mapping,
    inlineDiff.state.diffLines,
    inlineDiff.state.isOpen,
    inlineDiff.state.lineNumber,
    inlineDiff.state.type,
    isInlineEditToolbarVisible,
    largeContentMode,
    lineHeight,
    lines.length,
  ]);
  const viewLayout = useMemo(
    () =>
      buildEditorViewLayout({
        lines,
        lineHeight,
        wordWrap,
        contentWidth,
        measureText: measureEditorText,
        zones: viewZones,
        compact: largeContentMode,
      }),
    [lines, lineHeight, wordWrap, contentWidth, measureEditorText, viewZones, largeContentMode],
  );
  const shouldVirtualizeRendering =
    !wordWrap && lines.length >= EDITOR_CONSTANTS.RENDER_VIRTUALIZATION_THRESHOLD;
  const tokenizationEnabled = hasSyntaxHighlighting && !largeContentMode;
  const useIncrementalTokenization = tokenizationEnabled && shouldVirtualizeRendering;

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
      enabled: tokenizationEnabled,
    });
  const normalizedEditorContent = useMemo(() => normalizeLineEndings(content), [content]);
  const displayLineOffsets = useMemo(
    () =>
      largeContentMode
        ? []
        : foldTransform.hasActiveFolds
          ? buildLineOffsetMap(displayContent)
          : buildLineOffsetMap(normalizedEditorContent),
    [displayContent, foldTransform.hasActiveFolds, largeContentMode, normalizedEditorContent],
  );
  const getVisualLineOffset = useCallback(
    (lineIndex: number) => {
      if (largeContentMode && !foldTransform.hasActiveFolds) {
        return getLineOffset(normalizedEditorContent, lineIndex);
      }

      const clampedLine = Math.max(
        0,
        Math.min(lineIndex, Math.max(displayLineOffsets.length - 1, 0)),
      );
      return displayLineOffsets[clampedLine] ?? displayContent.length;
    },
    [
      displayContent.length,
      displayLineOffsets,
      foldTransform.hasActiveFolds,
      largeContentMode,
      normalizedEditorContent,
    ],
  );
  useEffect(() => {
    if (!bufferId || tokens.length === 0 || !tokenizedContent) return;
    syntaxTokenSnapshotRef.current = {
      bufferId,
      content: tokenizedContent,
      tokens,
    };
  }, [bufferId, tokenizedContent, tokens]);
  const baseTokens = useMemo(
    () =>
      largeContentMode
        ? []
        : resolveSyntaxTokensForContent({
            tokens,
            tokenizedContent,
            normalizedContent: normalizedEditorContent,
            bufferId: bufferId || undefined,
            snapshot: syntaxTokenSnapshotRef.current,
          }),
    [bufferId, largeContentMode, normalizedEditorContent, tokenizedContent, tokens],
  );
  const semanticEditorTokens = useMemo(() => {
    if (largeContentMode) return [];
    if (!canApplySemanticTokenState(semanticTokens, filePath)) return [];

    const semanticContent = semanticTokens.content || normalizedEditorContent;
    const tokensForSemanticContent = semanticTokensToEditorTokens(
      semanticTokens.tokens,
      buildLineOffsetMap(semanticContent),
      semanticContent.length,
    );

    if (semanticContent === normalizedEditorContent) return tokensForSemanticContent;

    return retargetTokensForContentEdit(
      tokensForSemanticContent,
      semanticContent,
      normalizedEditorContent,
    );
  }, [filePath, largeContentMode, normalizedEditorContent, semanticTokens]);
  const layeredTokens = useMemo(
    () => mergeTokenLayers(baseTokens, semanticEditorTokens),
    [baseTokens, semanticEditorTokens],
  );
  const effectiveTokens = useMemo(() => {
    if (!foldTransform.hasActiveFolds) return layeredTokens;
    return transformTokensForFolding(
      content,
      foldTransform.virtualLines,
      foldTransform.mapping,
      layeredTokens,
    );
  }, [content, foldTransform, layeredTokens]);

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
    viewStateKey: viewStateKey ?? bufferId ?? null,
    content: textareaContent,
    textareaRef: inputRef,
    forceUpdateViewport,
    totalLines: lines.length,
    resetTokenizer: resetForBufferSwitch,
  });

  // Listen for extension and language changes to re-trigger tokenization
  useEffect(() => {
    if (!isActiveSurface || !tokenizationEnabled) return;
    const handleSyntaxHighlightingRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<{ extensionId: string; filePath: string }>;
      if (customEvent.detail.filePath === filePath && content) {
        forceFullTokenize(content);
      }
    };

    window.addEventListener("extension-installed", handleSyntaxHighlightingRefresh);
    window.addEventListener(SYNTAX_HIGHLIGHTING_REFRESH_EVENT, handleSyntaxHighlightingRefresh);
    return () => {
      window.removeEventListener("extension-installed", handleSyntaxHighlightingRefresh);
      window.removeEventListener(
        SYNTAX_HIGHLIGHTING_REFRESH_EVENT,
        handleSyntaxHighlightingRefresh,
      );
    };
  }, [filePath, content, forceFullTokenize, isActiveSurface, tokenizationEnabled]);

  const visualCursorLine = useMemo(() => {
    if (foldTransform.hasActiveFolds) {
      return foldTransform.mapping.actualToVirtual.get(cursorPosition.line) ?? cursorPosition.line;
    }
    return cursorPosition.line;
  }, [cursorPosition.line, foldTransform]);
  const cursorViewPosition = useMemo(() => {
    if (visualCursorLine < 0) return undefined;
    const layoutLine = Math.min(visualCursorLine, Math.max(0, lines.length - 1));
    return viewLayout.modelPositionToViewPosition(layoutLine, cursorPosition.column);
  }, [viewLayout, visualCursorLine, cursorPosition.column, lines.length]);
  const resolveEditorCoordinate = useCallback<EditorCoordinateResolver>(
    (clientX, clientY) => {
      const textarea = inputRef.current;
      const container = contentContainerRef.current;
      if (!textarea || !container) return null;

      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + textarea.scrollLeft;
      const y = clientY - rect.top + textarea.scrollTop;
      const position = viewLayout.editorPointToModelPosition(x, y);
      const actualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.virtualToActual.get(position.modelLine) ?? position.modelLine)
        : position.modelLine;

      return {
        ...position,
        line: actualLine,
        modelLine: actualLine,
        height: position.segment.height,
      };
    },
    [foldTransform, viewLayout],
  );
  const resolveModelPosition = useCallback<EditorModelPositionResolver>(
    (line, column) => {
      const virtualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.actualToVirtual.get(line) ?? line)
        : line;

      if (virtualLine < 0 || virtualLine >= lines.length) return null;

      const position = viewLayout.modelPositionToViewPosition(virtualLine, column);

      return {
        ...position,
        line,
        modelLine: line,
        height: position.segment.height,
      };
    },
    [foldTransform, lines.length, viewLayout],
  );

  useEffect(() => {
    onCoordinateResolverChange?.(resolveEditorCoordinate);
    return () => onCoordinateResolverChange?.(null);
  }, [onCoordinateResolverChange, resolveEditorCoordinate]);

  useEffect(() => {
    onModelPositionResolverChange?.(resolveModelPosition);
    return () => onModelPositionResolverChange?.(null);
  }, [onModelPositionResolverChange, resolveModelPosition]);

  useEffect(() => {
    if (!useGlobalEditorState || !cursorViewPosition || isDragScrolling()) return;

    const textarea = inputRef.current;
    if (!textarea) return;

    const targetTop = cursorViewPosition.top;
    const targetBottom = targetTop + cursorViewPosition.segment.height;
    const currentScrollTop = textarea.scrollTop;
    const viewportHeight = textarea.clientHeight || 0;
    if (viewportHeight <= 0) return;

    if (targetTop < currentScrollTop) {
      textarea.scrollTop = targetTop;
    } else if (targetBottom > currentScrollTop + viewportHeight) {
      textarea.scrollTop = Math.max(0, targetBottom - viewportHeight);
    }
  }, [cursorViewPosition, useGlobalEditorState]);

  useEffect(() => {
    if (lastInputTimestamp === 0) return;

    setSuppressInlayHintsForTyping(true);
    const timeout = setTimeout(() => {
      setSuppressInlayHintsForTyping(false);
    }, INLAY_HINT_TYPING_SUPPRESS_MS);

    return () => clearTimeout(timeout);
  }, [lastInputTimestamp]);

  const visualInlayHints = useMemo(() => {
    if (suppressInlayHintsForTyping) return [];

    const mappedHints = foldTransform.hasActiveFolds
      ? inlayHints
          .map((hint) => {
            const visualLine = foldTransform.mapping.actualToVirtual.get(hint.line);
            return visualLine == null ? null : { ...hint, line: visualLine };
          })
          .filter((hint): hint is InlayHint => hint !== null)
      : inlayHints;

    return mappedHints.filter((hint) => hint.line !== visualCursorLine);
  }, [foldTransform, inlayHints, suppressInlayHintsForTyping, visualCursorLine]);

  const setEditorCursorPosition = useCallback(
    (position: Parameters<typeof setCursorPosition>[0]) => {
      setCursorPosition(position, { ensureVisible: !foldTransform.hasActiveFolds });
    },
    [foldTransform.hasActiveFolds, setCursorPosition],
  );

  const getInputOffsetForPosition = useCallback(
    (position: Parameters<typeof setCursorPosition>[0]) => {
      if (!foldTransform.hasActiveFolds) {
        return Math.min(position.offset, displayContent.length);
      }

      const mappedVirtualLine =
        foldTransform.mapping.actualToVirtual.get(position.line) ?? position.line;
      const virtualLine = Math.min(Math.max(mappedVirtualLine, 0), Math.max(lines.length - 1, 0));
      const virtualLineText = lines[virtualLine] ?? "";
      const virtualColumn = Math.min(position.column, virtualLineText.length);

      return Math.min(getVisualLineOffset(virtualLine) + virtualColumn, displayContent.length);
    },
    [
      displayContent.length,
      foldTransform.hasActiveFolds,
      foldTransform.mapping,
      getVisualLineOffset,
      lines,
    ],
  );

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const previousScrollTop = textarea.scrollTop;
    const previousScrollLeft = textarea.scrollLeft;
    const valueChanged = textarea.value !== textareaContent;

    if (valueChanged) {
      textarea.value = textareaContent;
    }

    if (largeContentMode) {
      if (valueChanged) {
        textarea.scrollTop = previousScrollTop;
        textarea.scrollLeft = previousScrollLeft;
      }
      return;
    }

    const selectionStart = selection
      ? getInputOffsetForPosition(selection.start)
      : getInputOffsetForPosition(cursorPosition);
    const selectionEnd = selection ? getInputOffsetForPosition(selection.end) : selectionStart;

    if (textarea.selectionStart !== selectionStart || textarea.selectionEnd !== selectionEnd) {
      textarea.selectionStart = selectionStart;
      textarea.selectionEnd = selectionEnd;
    }

    if (valueChanged) {
      textarea.scrollTop = previousScrollTop;
      textarea.scrollLeft = previousScrollLeft;
    }
  }, [cursorPosition, getInputOffsetForPosition, largeContentMode, selection, textareaContent]);

  const handleInput = useCallback(
    (newVirtualContent: string, event?: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;
      if (!bufferId || !inputRef.current) return;

      const inputType = event ? (event.nativeEvent as InputEvent).inputType : undefined;
      if (inputType === "historyUndo" || inputType === "historyRedo") {
        inputRef.current.value = displayContent;

        if (suppressedNativeHistoryInputRef.current === inputType) {
          suppressedNativeHistoryInputRef.current = null;
          return;
        }

        if (inputType === "historyUndo") {
          editorAPI.undo();
        } else {
          editorAPI.redo();
        }
        return;
      }

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

      const previousActualContent = content;
      const previousCursorPosition = cursorPosition;
      const previousSelection = selection;

      updateBufferContent(bufferId, newActualContent);
      if (onContentChange) {
        onContentChange(
          newActualContent,
          previousActualContent,
          previousCursorPosition,
          previousSelection,
        );
      } else {
        onChange(
          newActualContent,
          previousActualContent,
          previousCursorPosition,
          previousSelection,
          { contentAlreadyApplied: true },
        );
      }

      if (!useGlobalEditorState) return;

      const selectionStart = inputRef.current.selectionStart;
      const position = calculateCursorPositionFromContent(selectionStart, newVirtualContent);

      if (foldTransform.hasActiveFolds) {
        const actualLine =
          foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
        const actualOffset = calculateActualOffset(
          splitLines(newActualContent),
          actualLine,
          position.column,
        );
        setEditorCursorPosition({
          line: actualLine,
          column: position.column,
          offset: actualOffset,
        });
      } else {
        setEditorCursorPosition(position);
      }

      const timestamp = Date.now();
      useEditorUIStore.getState().actions.setLastInputTimestamp(timestamp);
    },
    [
      bufferId,
      updateBufferContent,
      setEditorCursorPosition,
      content,
      cursorPosition,
      displayContent,
      foldTransform,
      onContentChange,
      onChange,
      readOnly,
      selection,
      useGlobalEditorState,
    ],
  );

  const handleBeforeInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;

    if (inputEvent.inputType !== "historyUndo" && inputEvent.inputType !== "historyRedo") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressedNativeHistoryInputRef.current = inputEvent.inputType;

    if (inputEvent.inputType === "historyUndo") {
      editorAPI.undo();
    } else {
      editorAPI.redo();
    }
  }, []);

  const handleLargeModeBeforeInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.inputType === "insertFromPaste") return;

    event.preventDefault();
    event.stopPropagation();

    if (inputEvent.inputType === "historyUndo") {
      editorAPI.undo();
    } else if (inputEvent.inputType === "historyRedo") {
      editorAPI.redo();
    }
  }, []);

  const handleLargeModeInput = useCallback(
    (_content: string, event: React.ChangeEvent<HTMLTextAreaElement>) => {
      event.currentTarget.value = "";
    },
    [],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;
      if (!bufferId || !inputRef.current) return;

      const pastedText = event.clipboardData.getData("text");
      if (!pastedText) return;

      const textarea = inputRef.current;
      const selectionStart = largeContentMode
        ? cursorPosition.offset
        : Math.min(textarea.selectionStart, textarea.selectionEnd);
      const selectionEnd = largeContentMode
        ? cursorPosition.offset
        : Math.max(textarea.selectionStart, textarea.selectionEnd);
      const newVirtualContent =
        displayContent.slice(0, selectionStart) + pastedText + displayContent.slice(selectionEnd);

      if (!getLargeEditorModeInfo(newVirtualContent).largeContentMode) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const newActualContent = foldTransform.hasActiveFolds
        ? applyVirtualEdit(content, newVirtualContent, foldTransform.mapping)
        : newVirtualContent;
      const previousActualContent = content;
      const previousCursorPosition = cursorPosition;
      const previousSelection = selection;
      const nextOffset = selectionStart + pastedText.length;

      textarea.value = "";
      updateBufferContent(bufferId, newActualContent);
      if (onContentChange) {
        onContentChange(
          newActualContent,
          previousActualContent,
          previousCursorPosition,
          previousSelection,
        );
      } else {
        onChange(
          newActualContent,
          previousActualContent,
          previousCursorPosition,
          previousSelection,
          { contentAlreadyApplied: true },
        );
      }

      if (!useGlobalEditorState) return;

      setEditorCursorPosition(calculateCursorPositionFromContent(nextOffset, newActualContent));
      setSelection(undefined);
      useEditorUIStore.getState().actions.setLastInputTimestamp(Date.now());
    },
    [
      bufferId,
      content,
      cursorPosition,
      displayContent,
      foldTransform,
      largeContentMode,
      onChange,
      onContentChange,
      readOnly,
      selection,
      setEditorCursorPosition,
      setSelection,
      updateBufferContent,
      useGlobalEditorState,
    ],
  );

  const editorOps = useEditorOperations({
    inputRef,
    content,
    bufferId,
    handleInput,
    tabSize,
  });

  // Inline edit hook
  const inlineEditState = useInlineEdit({
    enabled: !largeContentMode,
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
    resolveModelPosition,
    setCursorPosition: setEditorCursorPosition,
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
              getVisualLineOffset(vimVisualSelection.end.line) + vimVisualSelection.end.column,
          }
        : largeContentMode
          ? calculateCursorPositionFromContent(selectionStart, displayContent)
          : calculateCursorPosition(selectionStart, lines);

    if (foldTransform.hasActiveFolds) {
      const actualLine = foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
      const actualOffset = calculateActualOffset(actualLines, actualLine, position.column);
      setEditorCursorPosition({
        line: actualLine,
        column: position.column,
        offset: actualOffset,
      });
    } else {
      setEditorCursorPosition(position);
    }

    if (selectionStart !== selectionEnd) {
      const startPos = largeContentMode
        ? calculateCursorPositionFromContent(selectionStart, displayContent)
        : calculateCursorPosition(selectionStart, lines);
      const endPos = largeContentMode
        ? calculateCursorPositionFromContent(selectionEnd, displayContent)
        : calculateCursorPosition(selectionEnd, lines);
      const anchorOffset = Math.max(selectionStart, selectionEnd);
      const anchorPos = largeContentMode
        ? calculateCursorPositionFromContent(anchorOffset, displayContent)
        : calculateCursorPosition(anchorOffset, lines);
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
    displayContent,
    lines,
    actualLines,
    getVisualLineOffset,
    largeContentMode,
    setEditorCursorPosition,
    setSelection,
    foldTransform,
    inlineEditState,
    vimModeEnabled,
    vimMode,
    vimVisualSelection,
  ]);

  const getColumnForInlayAdjustedX = useCallback(
    (lineText: string, lineHints: InlayHint[], x: number) => {
      const sortedHints = [...lineHints]
        .map((hint) => ({
          ...hint,
          character: Math.max(0, Math.min(lineText.length, hint.character)),
        }))
        .sort((a, b) => a.character - b.character || a.label.localeCompare(b.label));

      let bestColumn = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let column = 0; column <= lineText.length; column++) {
        const hintWidth = sortedHints
          .filter((hint) => hint.character <= column)
          .reduce(
            (width, hint) =>
              width + estimateInlayHintWidth(hint.label, fontSize, fontFamily, tabSize),
            0,
          );
        const boundaryX =
          getAccurateCursorX(lineText, column, fontSize, fontFamily, tabSize) + hintWidth;
        const distance = Math.abs(boundaryX - x);

        if (distance < bestDistance) {
          bestDistance = distance;
          bestColumn = column;
        }
      }

      return bestColumn;
    },
    [fontFamily, fontSize, tabSize],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!useGlobalEditorState || readOnly || event.button !== 0) return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.detail > 1) {
        return;
      }

      const textarea = inputRef.current;
      if (!textarea) return;
      if (visualInlayHints.length === 0 && viewLayout.totalZoneHeight === 0) return;

      const rect = textarea.getBoundingClientRect();
      const editorX = event.clientX - rect.left + textarea.scrollLeft;
      const editorY = event.clientY - rect.top + textarea.scrollTop;
      const position = viewLayout.editorPointToModelPosition(editorX, editorY);
      const visualLine = Math.max(0, Math.min(lines.length - 1, position.modelLine));
      const lineHints = visualInlayHints.filter((hint) => hint.line === visualLine);

      event.preventDefault();

      const lineText = lines[visualLine] || "";
      const localX = Math.max(0, editorX - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT);
      const column =
        lineHints.length > 0
          ? getColumnForInlayAdjustedX(lineText, lineHints, localX)
          : position.column;
      const virtualOffset = Math.min(
        getVisualLineOffset(visualLine) + column,
        displayContent.length,
      );

      textarea.focus();
      textarea.selectionStart = virtualOffset;
      textarea.selectionEnd = virtualOffset;

      if (foldTransform.hasActiveFolds) {
        const actualLine = foldTransform.mapping.virtualToActual.get(visualLine) ?? visualLine;
        const actualOffset = calculateActualOffset(actualLines, actualLine, column);
        setEditorCursorPosition({
          line: actualLine,
          column,
          offset: actualOffset,
        });
      } else {
        setEditorCursorPosition({
          line: visualLine,
          column,
          offset: virtualOffset,
        });
      }

      setSelection(undefined);
    },
    [
      actualLines,
      displayContent.length,
      foldTransform,
      getColumnForInlayAdjustedX,
      getVisualLineOffset,
      lines,
      readOnly,
      setEditorCursorPosition,
      setSelection,
      useGlobalEditorState,
      visualInlayHints,
      viewLayout,
    ],
  );

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
      const clickedPosition = largeContentMode
        ? calculateCursorPositionFromContent(selectionStart, displayContent)
        : calculateCursorPosition(selectionStart, lines);
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

      if ((readOnly || (!useGlobalEditorState && e.detail >= 2)) && onReadonlySurfaceClick) {
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
      useGlobalEditorState,
    ],
  );

  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const autocompleteCompletion = useEditorUIStore.use.autocompleteCompletion();
  const { setSelectedLspIndex, setIsLspCompletionVisible, setAutocompleteCompletion } =
    useEditorUIStore.use.actions();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();

  useAutocomplete({
    enabled:
      aiCompletionEnabled &&
      !isPreviewMode &&
      !readOnly &&
      !inlineEditState.inlineEditVisible &&
      !largeContentMode,
    provider: aiAutocompleteProvider,
    model:
      aiAutocompleteProvider === "custom" ? aiAutocompleteCustomModelId : aiAutocompleteModelId,
    customBaseUrl: aiAutocompleteCustomBaseUrl,
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
    setCursorPosition: setEditorCursorPosition,
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
    viewStateKey: viewStateKey ?? bufferId ?? null,
    linesCount: lines.length,
    minimapEnabled: minimapEnabled && !largeContentMode,
    lockVerticalScroll: !scrollable,
    switchGuardRef,
    highlightRef,
    primaryCursorRef,
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

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const transform = `translate(-${textarea.scrollLeft}px, -${textarea.scrollTop}px)`;
    const overlayRefs = [
      highlightRef,
      primaryCursorRef,
      multiCursorRef,
      searchHighlightRef,
      selectionLayerRef,
      vimCursorRef,
      autocompleteCompletionRef,
      inlineEditOverlayRef,
      gitBlameRef,
      inlineDiffRef,
    ];

    for (const overlayRef of overlayRefs) {
      if (overlayRef.current) {
        overlayRef.current.style.transform = transform;
      }
    }
  });

  useDragScroll(inputRef);
  useSelectionScope(contentContainerRef, isActiveSurface);

  useEffect(() => {
    if (inputRef.current) {
      initializeViewport(inputRef.current, lines.length);
    }
  }, [initializeViewport, lines.length]);

  useEffect(() => {
    if (!isActiveSurface) return;
    editorAPI.setTextareaRef(inputRef.current);
    return () => {
      editorAPI.setTextareaRef(null);
    };
  }, [inputRef, isActiveSurface]);

  // Wheel forwarding for embedded editors and non-macOS textarea scrolling.
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    if (!scrollable) {
      const scrollContainer =
        textarea.closest("[data-editor-outer-scroll]") ??
        textarea.closest("[data-diff-stack-scroll-container]");
      if (!(scrollContainer instanceof HTMLElement)) return;

      const handleWheel = (e: WheelEvent) => {
        const isHorizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
        const deltaTop = isHorizontalIntent ? 0 : e.deltaY;
        const deltaLeft =
          isHorizontalIntent && e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)
            ? e.deltaY
            : isHorizontalIntent
              ? e.deltaX
              : 0;
        const canScrollY =
          (deltaTop < 0 && scrollContainer.scrollTop > 0) ||
          (deltaTop > 0 &&
            scrollContainer.scrollTop + scrollContainer.clientHeight <
              scrollContainer.scrollHeight);
        const canScrollX =
          (deltaLeft < 0 && scrollContainer.scrollLeft > 0) ||
          (deltaLeft > 0 &&
            scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth);

        if (textarea.scrollTop !== 0) {
          textarea.scrollTop = 0;
        }

        if (!canScrollY && !canScrollX) {
          if (deltaTop !== 0 || deltaLeft !== 0) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        if (canScrollY) {
          scrollContainer.scrollTop += deltaTop;
        }
        if (canScrollX) {
          scrollContainer.scrollLeft += deltaLeft;
        }
        e.preventDefault();
        e.stopPropagation();
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
    if (!tokenizationEnabled || !buffer?.content || !buffer?.path) return;

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
      tokenizedContent === normalizeLineEndings(contentToTokenize)
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

    if (!useGlobalEditorState) {
      tokenizeTimeoutRef.current = setTimeout(() => {
        tokenize(contentToTokenize, targetViewportRange);
        tokenizeTimeoutRef.current = null;
      }, 120);

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
    useGlobalEditorState,
    tokenizationEnabled,
  ]);

  const handleLineClick = useCallback(
    (lineIndex: number) => {
      if (!inputRef.current) return;

      if (!useGlobalEditorState && onReadonlySurfaceClick) {
        onReadonlySurfaceClick({ line: lineIndex, column: 0 });
        return;
      }

      const lineStart = getVisualLineOffset(lineIndex);
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

        setEditorCursorPosition(actualStart);
        setSelection({ start: actualStart, end: actualEnd });
        return;
      }

      setEditorCursorPosition(startPos);
      setSelection({ start: startPos, end: endPos });
    },
    [
      lines,
      getVisualLineOffset,
      foldTransform,
      actualLines,
      setEditorCursorPosition,
      setSelection,
      useGlobalEditorState,
      onReadonlySurfaceClick,
    ],
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
    const textAfterCursorOnLine = lineText.slice(cursorColumn);
    if (textAfterCursorOnLine.trim().length > 0) return null;

    const previewLines: Array<{ text: string; index: number }> = [];

    for (const [index, text] of normalized.split("\n").entries()) {
      if (index > 0 && lines[visualCursorLine + index]?.trim()) {
        break;
      }
      previewLines.push({ text, index });
    }

    if (previewLines.every((line) => line.text.length === 0)) return null;

    return {
      lines: previewLines,
      top:
        cursorViewPosition?.top ??
        visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      firstLineLeft:
        cursorViewPosition?.left ??
        getAccurateCursorX(lineText, cursorColumn, fontSize, fontFamily, tabSize) +
          EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      continuationLeft: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
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
    cursorViewPosition,
  ]);

  const inlineDiffTop = useMemo(() => {
    if (!inlineDiff.state.isOpen) return undefined;
    const zone = viewLayout.zones.find((entry) => entry.id === "inline-diff");
    if (zone) return zone.top;

    const visualLine = foldTransform.hasActiveFolds
      ? (foldTransform.mapping.actualToVirtual.get(inlineDiff.state.lineNumber) ??
        inlineDiff.state.lineNumber)
      : inlineDiff.state.lineNumber;

    if (visualLine < 0 || visualLine >= lines.length) return undefined;

    const lineText = lines[visualLine] ?? "";
    const segment = viewLayout.getSegmentForModelPosition(visualLine, lineText.length);
    return segment.top + segment.height;
  }, [
    foldTransform.hasActiveFolds,
    foldTransform.mapping,
    inlineDiff.state.isOpen,
    inlineDiff.state.lineNumber,
    lines,
    viewLayout,
  ]);

  const inlineEditZoneTop = useMemo(() => {
    const zone = viewLayout.zones.find((entry) => entry.id === "inline-edit");
    return zone?.top;
  }, [viewLayout]);

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
          filePath={largeContentMode ? undefined : filePath}
          onLineClick={largeContentMode ? undefined : handleLineClick}
          onGitIndicatorClick={largeContentMode ? undefined : inlineDiff.toggle}
          foldMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
          wordWrap={wordWrap}
          lines={lines}
          contentWidth={contentWidth}
          lineNumberStart={lineNumberStart}
          lineNumberMap={lineNumberMap}
          viewZones={viewLayout.zones}
        />
      )}

      <div
        ref={contentContainerRef}
        data-editor-content-container
        className={`overlay-editor-container relative min-h-0 min-w-0 flex-1 bg-primary-bg ${className || ""}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        {backgroundLayer}
        <HighlightLayer
          ref={highlightRef}
          filePath={largeContentMode ? undefined : filePath}
          content={displayContent}
          lines={lines}
          lineCount={lines.length}
          lineOffsets={displayLineOffsets}
          lazyLineSlicing={largeContentMode}
          tokens={effectiveTokens}
          foldMarkers={foldTransform.hasActiveFolds ? foldTransform.foldMarkers : undefined}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          wordWrap={wordWrap}
          viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          lineMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
          viewZones={viewLayout.zones}
          inlayHints={largeContentMode ? [] : visualInlayHints}
        />
        <InputLayer
          textareaRef={inputRef}
          content={textareaContent}
          filePath={filePath}
          onInput={largeContentMode ? handleLargeModeInput : handleInput}
          onBeforeInput={
            readOnly || !useGlobalEditorState
              ? undefined
              : largeContentMode
                ? handleLargeModeBeforeInput
                : handleBeforeInput
          }
          onKeyDown={
            readOnly || !useGlobalEditorState || largeContentMode ? undefined : handleKeyDown
          }
          onScroll={handleScroll}
          onSelect={useGlobalEditorState ? handleCursorChange : undefined}
          onClick={
            !largeContentMode && (useGlobalEditorState || readOnly || onReadonlySurfaceClick)
              ? handleClick
              : undefined
          }
          onMouseDown={useGlobalEditorState && !largeContentMode ? handleMouseDown : undefined}
          onContextMenu={useGlobalEditorState && !largeContentMode ? contextMenu.open : undefined}
          onPaste={useGlobalEditorState ? handlePaste : undefined}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          wordWrap={wordWrap}
          readOnly={readOnly}
          scrollable={scrollable}
          customCaret={useGlobalEditorState && !readOnly && !largeContentMode}
          nativeSelection={largeContentMode}
          scrollPaddingBottom={
            largeContentMode ? viewLayout.totalHeight : viewLayout.totalZoneHeight
          }
          bufferId={bufferId || undefined}
        />
        {useGlobalEditorState && !readOnly && !largeContentMode && (
          <PrimaryCursorLayer
            ref={primaryCursorRef}
            cursorPosition={cursorPosition}
            visualLine={visualCursorLine}
            cursorViewPosition={cursorViewPosition}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            textareaRef={inputRef}
            hidden={vimModeEnabled && (vimMode === "normal" || vimMode === "visual")}
          />
        )}
        {useGlobalEditorState && !largeContentMode && (
          <SelectionLayer
            ref={selectionLayerRef}
            textareaRef={inputRef}
            content={displayContent}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            wordWrap={wordWrap}
            viewLayout={viewLayout}
          />
        )}
        {!largeContentMode &&
          inlineEditState.inlineEditVisible &&
          inlineEditState.popoverPosition && (
            <div
              ref={inlineEditOverlayRef}
              className="pointer-events-none absolute inset-0 z-[200]"
            >
              <div
                ref={inlineEditState.inlineEditPopoverRef}
                role="dialog"
                aria-modal="false"
                aria-labelledby="inline-edit-title"
                aria-describedby="inline-edit-description"
                className="pointer-events-auto absolute right-4 max-w-[720px] overflow-hidden rounded-md border border-border/60 bg-primary-bg shadow-lg"
                style={{
                  top: `${inlineEditZoneTop ?? inlineEditState.popoverPosition.top}px`,
                  left: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px`,
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
        {!largeContentMode && inlineAutocompletePreview && (
          <div
            ref={autocompleteCompletionRef}
            className="pointer-events-none absolute inset-0 z-[3]"
          >
            <div
              style={{
                position: "absolute",
                top: `${inlineAutocompletePreview.top}px`,
                left: 0,
                fontSize: `${fontSize}px`,
                fontFamily,
                lineHeight: `${lineHeight}px`,
                whiteSpace: "pre",
                opacity: 0.42,
                color: "var(--text-lighter, #94a3b8)",
              }}
            >
              {inlineAutocompletePreview.lines.map((line) => {
                if (line.text.length === 0) return null;
                return (
                  <div
                    key={line.index}
                    style={{
                      position: "absolute",
                      top: `${line.index * lineHeight}px`,
                      left:
                        line.index === 0
                          ? `${inlineAutocompletePreview.firstLineLeft}px`
                          : `${inlineAutocompletePreview.continuationLeft}px`,
                    }}
                  >
                    {line.text}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!largeContentMode &&
          autocompleteCompletion &&
          !isLspCompletionVisible &&
          !inlineAutocompletePreview && (
            <div className="pointer-events-none absolute right-3 bottom-3 z-40 rounded-md bg-primary-bg/80 px-2 py-1 text-[11px] text-text-lighter/80">
              Tab to accept AI suggestion
            </div>
          )}
        {useGlobalEditorState && !largeContentMode && multiCursorState && (
          <MultiCursorLayer
            ref={multiCursorRef}
            cursors={multiCursorState.cursors}
            primaryCursorId={multiCursorState.primaryCursorId}
            lineHeight={lineHeight}
            content={displayContent}
            measureText={measureEditorText}
            viewLayout={wordWrap ? viewLayout : undefined}
          />
        )}

        {useGlobalEditorState && !largeContentMode && vimModeEnabled && (
          <VimCursorLayer
            ref={vimCursorRef}
            visualLine={visualCursorLine}
            cursorViewPosition={cursorViewPosition}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            vimMode={vimMode}
          />
        )}

        {!largeContentMode && (highlightMatches?.length || searchMatches.length > 0) && (
          <SearchHighlightLayer
            ref={searchHighlightRef}
            searchMatches={highlightMatches ?? searchMatches}
            currentMatchIndex={currentHighlightIndex ?? currentMatchIndex}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            content={displayContent}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
            viewLayout={wordWrap ? viewLayout : undefined}
          />
        )}

        {useGlobalEditorState && !largeContentMode && (
          <DefinitionLinkLayer
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            content={displayContent}
            textareaRef={inputRef}
            viewLayout={wordWrap ? viewLayout : undefined}
          />
        )}

        {useGlobalEditorState &&
          filePath &&
          inlineGitBlameEnabled &&
          !largeContentMode &&
          !autocompleteCompletion &&
          !isLspCompletionVisible &&
          !(foldTransform.hasActiveFolds && foldTransform.foldMarkers.has(visualCursorLine)) &&
          !inlineEditState.inlineEditVisible && (
            <GitBlameLayer
              ref={gitBlameRef}
              filePath={filePath}
              cursorLine={cursorPosition.line}
              visualCursorLine={visualCursorLine}
              visualContent={displayContent}
              fontSize={fontSize}
              fontFamily={fontFamily}
              lineHeight={lineHeight}
              tabSize={tabSize}
              wordWrap={wordWrap}
              cursorViewPosition={cursorViewPosition}
            />
          )}

        {!largeContentMode && inlineDiff.state.isOpen && (
          <div
            ref={inlineDiffRef}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            <InlineDiff
              lineNumber={inlineDiff.state.lineNumber}
              type={inlineDiff.state.type}
              diffLines={inlineDiff.state.diffLines}
              fontSize={fontSize}
              fontFamily={fontFamily}
              lineHeight={lineHeight}
              top={inlineDiffTop}
              onClose={inlineDiff.close}
              onRevert={handleRevertChange}
            />
          </div>
        )}
      </div>

      {minimapEnabled && !largeContentMode && (
        <Minimap
          content={displayContent}
          tokens={effectiveTokens}
          scrollTop={editorScrollTop}
          viewportHeight={editorViewportHeight}
          totalHeight={viewLayout.totalHeight}
          lineHeight={lineHeight}
          scale={minimapScale}
          width={minimapWidth}
          cursorLine={cursorViewPosition?.viewLine ?? visualCursorLine}
          searchMatches={highlightMatches ?? searchMatches}
          currentSearchMatchIndex={currentHighlightIndex ?? currentMatchIndex}
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
            onFind={() => setIsFindVisible(true)}
            onGoToLine={() => {
              void keymapRegistry.executeCommand("editor.goToLine");
            }}
            onDuplicate={() => {
              void keymapRegistry.executeCommand("editor.duplicateLine");
            }}
            onIndent={editorOps.indent}
            onOutdent={editorOps.outdent}
            onToggleComment={() => {
              void keymapRegistry.executeCommand("editor.toggleComment");
            }}
            onFormat={() => {
              void keymapRegistry.executeCommand("editor.formatDocument");
            }}
            onToggleCase={editorOps.toggleCase}
            onMoveLineUp={() => {
              void keymapRegistry.executeCommand("editor.moveLineUp");
            }}
            onMoveLineDown={() => {
              void keymapRegistry.executeCommand("editor.moveLineDown");
            }}
            onGoToDefinition={() => {
              void keymapRegistry.executeCommand("editor.goToDefinition");
            }}
            onFindReferences={() => {
              void keymapRegistry.executeCommand("editor.goToReferences");
            }}
            onRenameSymbol={() => {
              void keymapRegistry.executeCommand("editor.renameSymbol");
            }}
          />,
          document.body,
        )}
    </div>
  );
}
