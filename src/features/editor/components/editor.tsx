import "../styles/overlay-editor.css";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useDeferredValue,
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
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { EDITOR_CONSTANTS } from "../config/constants";
import EditorContextMenu from "../context-menu/context-menu";
import { editorAPI } from "../extensions/api";
import { SYNTAX_HIGHLIGHTING_REFRESH_EVENT } from "../extensions/builtin/syntax-highlighting";
import { useAutocomplete } from "../hooks/use-autocomplete";
import { useBufferSwitch } from "../hooks/use-buffer-switch";
import { useContextMenu } from "../hooks/use-context-menu";
import { useDragScroll } from "../hooks/use-drag-scroll";
import { useEditorCursorSelection } from "../hooks/use-editor-cursor-selection";
import { useEditorKeyDown } from "../hooks/use-editor-keydown";
import { useEditorOperations } from "../hooks/use-editor-operations";
import { useEditorScroll } from "../hooks/use-editor-scroll";
import { useEditorSurfaceResolvers } from "../hooks/use-editor-surface-resolvers";
import { useEditorTextareaInput } from "../hooks/use-editor-textarea-input";
import { useEditorWheelForwarding } from "../hooks/use-editor-wheel-forwarding";
import { useEnsureCursorVisible } from "../hooks/use-ensure-cursor-visible";
import { useFoldRegionScheduler } from "../hooks/use-fold-region-scheduler";
import { useFoldTransform } from "../hooks/use-fold-transform";
import { useInlineDiff } from "../hooks/use-inline-diff";
import { useEditorLineModel } from "../hooks/use-editor-line-model";
import { useInlayHintSuppression } from "../hooks/use-inlay-hint-suppression";
import { useLargeEditorInput } from "../hooks/use-large-editor-input";
import { useInlineEdit } from "../hooks/use-inline-edit";
import { useEditorMouseInteractions } from "../hooks/use-editor-mouse-interactions";
import { usePerformanceMonitor } from "../hooks/use-performance";
import { useResolvedEditorSettings } from "../hooks/use-resolved-settings";
import { useSelectionScope } from "../hooks/use-selection-scope";
import { useTokenizationScheduler } from "../hooks/use-tokenization-scheduler";
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
import {
  applyIncrementalLineOffsetEdit,
  buildLineOffsetMap,
  normalizeLineEndings,
} from "../utils/html";
import { resolveInlineAutocompletePreview } from "../utils/inline-autocomplete-preview";
import {
  calculatePositionFromLineOffsets,
  getLargeContentColumnForX,
  getLargeContentLineText,
  getLargeContentOffsetAtPosition,
  getLineOffset,
} from "../utils/large-file";
import { calculateLineHeight } from "../utils/lines";
import {
  calculateCursorPosition,
  calculateCursorPositionFromContent,
  calculateCursorPositionFromLineOffsets,
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
import { applyEditorScrollTransform } from "../utils/scroll-layers";
import {
  calculateInlineDiffHeight,
  getInlineDiffLinesToShow,
  InlineDiff,
} from "./diff/inline-diff";
import { Gutter } from "./gutter/gutter";
import { InlineAutocompleteHint, InlineAutocompletePreview } from "./inline-autocomplete-preview";
import { InlineEditPopover } from "./inline-edit-popover";
import { LargeEditorSurface } from "./large-editor-surface";
import { BracketMatchLayer } from "./layers/bracket-match-layer";
import { CurrentLineLayer } from "./layers/current-line-layer";
import { DefinitionLinkLayer } from "./layers/definition-link-layer";
import { GitBlameLayer } from "./layers/git-blame-layer";
import { HighlightLayer } from "./layers/highlight-layer";
import { IndentGuideLayer } from "./layers/indent-guide-layer";
import { InputLayer } from "./layers/input-layer";
import { MultiCursorLayer } from "./layers/multi-cursor-layer";
import { PrimaryCursorLayer } from "./layers/primary-cursor-layer";
import { SearchHighlightLayer } from "./layers/search-highlight-layer";
import { SelectionLayer } from "./layers/selection-layer";
import { VimCursorLayer } from "./layers/vim-cursor-layer";
import { WordHighlightLayer } from "./layers/word-highlight-layer";
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
  largeContentLineOffsets?: number[];
  onCoordinateResolverChange?: (resolver: EditorCoordinateResolver | null) => void;
  onModelPositionResolverChange?: (resolver: EditorModelPositionResolver | null) => void;
}

const INCREMENTAL_TOKENIZATION_LINE_THRESHOLD = 1000;
const INLAY_HINT_TYPING_SUPPRESS_MS = 650;
const FOLD_RECOMPUTE_TYPING_DEBOUNCE_MS = 250;
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
  largeContentLineOffsets,
  onCoordinateResolverChange,
  onModelPositionResolverChange,
}: EditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const largeEditorScrollRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const currentLineRef = useRef<HTMLDivElement>(null);
  const indentGuideRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const primaryCursorRef = useRef<HTMLDivElement>(null);
  const multiCursorRef = useRef<HTMLDivElement>(null);
  const wordHighlightRef = useRef<HTMLDivElement>(null);
  const searchHighlightRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const bracketMatchRef = useRef<HTMLDivElement>(null);
  const vimCursorRef = useRef<HTMLDivElement>(null);
  const autocompleteCompletionRef = useRef<HTMLDivElement>(null);
  const inlineEditOverlayRef = useRef<HTMLDivElement>(null);
  const gitBlameRef = useRef<HTMLDivElement>(null);
  const inlineDiffRef = useRef<HTMLDivElement>(null);
  const syntaxTokenSnapshotRef = useRef<SyntaxTokenSnapshot | null>(null);
  const displayLineOffsetsCacheRef = useRef<{
    content: string;
    offsets: number[];
  } | null>(null);

  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [contentScrollWidth, setContentScrollWidth] = useState(0);

  const bufferId = useBufferStore((state) => propBufferId ?? state.activeBufferId);
  const rawBuffer = useBufferStore(
    useCallback(
      (state) => (bufferId ? state.buffers.find((candidate) => candidate.id === bufferId) : null),
      [bufferId],
    ),
  );
  const { updateBufferContent, updateBufferTokens } = useBufferStore.use.actions();
  const {
    setCursorPosition,
    setDesiredColumn,
    setSelection,
    enableMultiCursor,
    addCursor,
    clearSecondaryCursors,
    updateCursor,
  } = useEditorStateStore.use.actions();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const desiredColumn = useEditorStateStore((state) => state.desiredColumn);
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
  const renderWhitespace = useEditorSettingsStore.use.renderWhitespace();
  const renderIndentGuides = useEditorSettingsStore.use.renderIndentGuides();
  const highlightOccurrences = useEditorSettingsStore.use.highlightOccurrences();

  const buffer = rawBuffer && isEditorContent(rawBuffer) ? rawBuffer : undefined;
  const content = buffer?.content || "";
  const filePath = buffer?.path;
  const languageIdOverride = buffer?.languageOverride;
  const currentLanguageId = languageIdOverride ?? (filePath ? getLanguageId(filePath) : null);
  const useGlobalEditorState = isActiveSurface;

  const resolvedSettings = useResolvedEditorSettings(filePath ?? null);
  const tabSize = resolvedSettings.tabSize;
  const suppressInlayHintsForTyping = useInlayHintSuppression({
    durationMs: INLAY_HINT_TYPING_SUPPRESS_MS,
  });
  const { startMeasure, endMeasure } = usePerformanceMonitor("Editor");
  const { actualLineCount, largeContentMode, actualLines } = useEditorLineModel({
    content,
    filePath,
    largeContentModeOverride,
    largeContentLineCount,
    startMeasure,
    endMeasure,
  });

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
      fileOpenBenchmark.finish(filePath, "editor-ready", `${content.length} chars`, {
        contentLength: content.length,
        lineCount: actualLineCount,
        largeContentMode,
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [actualLineCount, filePath, content.length, largeContentMode]);

  useFoldRegionScheduler({
    filePath,
    content,
    enabled: isActiveSurface && !isPreviewMode && !largeContentMode,
    typingDebounceMs: FOLD_RECOMPUTE_TYPING_DEBOUNCE_MS,
  });

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
  const visualLineCount = largeContentMode ? actualLineCount : lines.length;
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
  useLayoutEffect(() => {
    const scrollElement = largeContentMode ? largeEditorScrollRef.current : inputRef.current;
    const container = contentContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const updateContentScrollWidth = () => {
      const viewportWidth = container.clientWidth || contentWidth;
      const scrollWidth = scrollElement?.scrollWidth ?? viewportWidth;
      const nextWidth = Math.max(viewportWidth, scrollWidth);
      setContentScrollWidth((previousWidth) =>
        Math.abs(previousWidth - nextWidth) < 1 ? previousWidth : nextWidth,
      );
    };

    updateContentScrollWidth();
    rafId = requestAnimationFrame(updateContentScrollWidth);

    const resizeObserver = new ResizeObserver(updateContentScrollWidth);
    resizeObserver.observe(container);
    if (scrollElement) {
      resizeObserver.observe(scrollElement);
    }

    return () => {
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    content.length,
    contentWidth,
    fontFamily,
    fontSize,
    largeContentMode,
    lineHeight,
    tabSize,
    textareaContent.length,
    wordWrap,
  ]);
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
        lineCount: visualLineCount,
        lineHeight,
        wordWrap,
        contentWidth,
        measureText: measureEditorText,
        zones: viewZones,
        compact: largeContentMode || (!wordWrap && viewZones.length === 0),
      }),
    [
      lines,
      visualLineCount,
      lineHeight,
      wordWrap,
      contentWidth,
      measureEditorText,
      viewZones,
      largeContentMode,
    ],
  );
  const editorBottomSafePadding = useMemo(
    () =>
      Math.max(
        EDITOR_CONSTANTS.COMPLETION_DROPDOWN_SAFE_AREA,
        lineHeight * EDITOR_CONSTANTS.CURSOR_BOTTOM_SAFE_AREA_LINES,
      ),
    [lineHeight],
  );
  const shouldVirtualizeRendering =
    !wordWrap && visualLineCount >= EDITOR_CONSTANTS.RENDER_VIRTUALIZATION_THRESHOLD;
  const tokenizationEnabled = hasSyntaxHighlighting && !largeContentMode;
  const useIncrementalTokenization =
    tokenizationEnabled && visualLineCount >= INCREMENTAL_TOKENIZATION_LINE_THRESHOLD;

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
  const normalizedDisplayContent = useMemo(
    () =>
      foldTransform.hasActiveFolds ? normalizeLineEndings(displayContent) : normalizedEditorContent,
    [displayContent, foldTransform.hasActiveFolds, normalizedEditorContent],
  );
  const displayLineOffsets = useMemo(() => {
    if (largeContentMode) return largeContentLineOffsets ?? [];

    const cached = displayLineOffsetsCacheRef.current;
    if (cached?.content === normalizedDisplayContent) {
      return cached.offsets;
    }

    const incrementalOffsets = cached
      ? applyIncrementalLineOffsetEdit(cached.content, normalizedDisplayContent, cached.offsets)
      : null;
    const offsets = incrementalOffsets ?? buildLineOffsetMap(normalizedDisplayContent);

    displayLineOffsetsCacheRef.current = {
      content: normalizedDisplayContent,
      offsets,
    };
    return offsets;
  }, [largeContentLineOffsets, largeContentMode, normalizedDisplayContent]);
  const getVisualLineOffset = useCallback(
    (lineIndex: number) => {
      if (largeContentMode && !foldTransform.hasActiveFolds) {
        return (
          largeContentLineOffsets?.[lineIndex] ?? getLineOffset(normalizedEditorContent, lineIndex)
        );
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
      largeContentLineOffsets,
      normalizedEditorContent,
    ],
  );
  const getLargeLineText = useCallback(
    (lineIndex: number, sourceContent = content, sourceLineOffsets = displayLineOffsets) =>
      getLargeContentLineText(sourceContent, sourceLineOffsets, lineIndex),
    [content, displayLineOffsets],
  );
  const getLargePositionForOffset = useCallback(
    (offset: number, sourceContent = content, sourceLineOffsets = displayLineOffsets) =>
      calculatePositionFromLineOffsets(sourceContent, sourceLineOffsets, offset),
    [content, displayLineOffsets],
  );
  const getLargeOffsetForPosition = useCallback(
    (
      line: number,
      column: number,
      sourceContent = content,
      sourceLineOffsets = displayLineOffsets,
    ) => getLargeContentOffsetAtPosition(sourceContent, sourceLineOffsets, line, column),
    [content, displayLineOffsets],
  );
  const getLargeColumnForX = useCallback(
    (lineText: string, x: number) => getLargeContentColumnForX(lineText, x, measureEditorText),
    [measureEditorText],
  );
  const mapLargeVirtualContentToActualContent = useCallback(
    (newVirtualContent: string) =>
      foldTransform.hasActiveFolds
        ? applyVirtualEdit(content, newVirtualContent, foldTransform.mapping, actualLines)
        : newVirtualContent,
    [actualLines, content, foldTransform.hasActiveFolds, foldTransform.mapping],
  );
  const getCursorPositionForVisualOffset = useCallback(
    (offset: number) =>
      largeContentMode
        ? calculateCursorPositionFromContent(offset, displayContent)
        : calculateCursorPositionFromLineOffsets(offset, lines, displayLineOffsets),
    [displayContent, displayLineOffsets, largeContentMode, lines],
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
  const deferredMinimapLines = useDeferredValue(lines);
  const deferredMinimapLineOffsets = useDeferredValue(displayLineOffsets);
  const deferredMinimapTokens = useDeferredValue(effectiveTokens);
  const useCustomInsertCaret = largeContentMode;

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
    totalLines: visualLineCount,
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
    if (largeContentMode) {
      const layoutLine = Math.min(visualCursorLine, Math.max(0, visualLineCount - 1));
      const lineText = getLargeLineText(layoutLine);
      const column = Math.max(0, Math.min(cursorPosition.column, lineText.length));
      const segment = {
        viewLine: layoutLine,
        modelLine: layoutLine,
        startColumn: 0,
        endColumn: lineText.length,
        top: layoutLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
        height: lineHeight,
      };

      return {
        viewLine: layoutLine,
        modelLine: layoutLine,
        column,
        top: segment.top,
        left: measureEditorText(lineText.slice(0, column)) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        segment,
      };
    }

    const layoutLine = Math.min(visualCursorLine, Math.max(0, visualLineCount - 1));
    return viewLayout.modelPositionToViewPosition(layoutLine, cursorPosition.column);
  }, [
    cursorPosition.column,
    getLargeLineText,
    largeContentMode,
    lineHeight,
    measureEditorText,
    viewLayout,
    visualCursorLine,
    visualLineCount,
  ]);
  const { resolveModelPosition } = useEditorSurfaceResolvers({
    inputRef,
    contentContainerRef,
    viewLayout,
    hasActiveFolds: foldTransform.hasActiveFolds,
    foldMapping: foldTransform.mapping,
    visualLineCount,
    onCoordinateResolverChange,
    onModelPositionResolverChange,
  });

  useEnsureCursorVisible({
    enabled: useGlobalEditorState,
    inputRef,
    cursorViewPosition,
    lineHeight,
    bottomSafePadding: editorBottomSafePadding,
  });

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
      setCursorPosition(position, { ensureVisible: false });
    },
    [setCursorPosition],
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

  const { handleInput, handleBeforeInput } = useEditorTextareaInput({
    inputRef,
    bufferId,
    readOnly,
    largeContentMode,
    useGlobalEditorState,
    content,
    displayContent,
    textareaContent,
    lines,
    actualLines,
    displayLineOffsets,
    cursorPosition,
    selection,
    foldTransform,
    getInputOffsetForPosition,
    updateBufferContent,
    onContentChange,
    onChange,
    setCursorPosition: setEditorCursorPosition,
    setSelection,
  });

  const largeEditorInput = useLargeEditorInput({
    bufferId,
    content,
    displayContent,
    displayLineOffsets,
    visualLineCount,
    languageId: currentLanguageId,
    largeContentMode,
    readOnly,
    tabSize,
    useGlobalEditorState,
    cursorPosition,
    desiredColumn,
    selection,
    lineHeight,
    scrollRef: largeEditorScrollRef,
    getLineText: getLargeLineText,
    getPositionForOffset: getLargePositionForOffset,
    getOffsetForPosition: getLargeOffsetForPosition,
    getColumnForX: getLargeColumnForX,
    mapVirtualContentToActualContent: mapLargeVirtualContentToActualContent,
    updateBufferContent,
    onContentChange,
    onChange,
    setCursorPosition: setEditorCursorPosition,
    setDesiredColumn,
    setSelection,
  });
  const largeSelectionOffsets = largeEditorInput.selectionOffsets;

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
    lineOffsets: displayLineOffsets,
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

  const handleCursorChange = useEditorCursorSelection({
    inputRef,
    bufferId,
    actualLines,
    foldTransform,
    vimModeEnabled,
    vimMode,
    vimVisualSelection,
    inlineEditVisible: inlineEditState.inlineEditVisible,
    getCursorPositionForVisualOffset,
    getVisualLineOffset,
    setCursorPosition: setEditorCursorPosition,
    setSelection,
    setInlineEditSelectionAnchor: inlineEditState.setInlineEditSelectionAnchor,
  });

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
      let hintIndex = 0;
      let hintWidth = 0;

      for (let column = 0; column <= lineText.length; column++) {
        while (hintIndex < sortedHints.length && sortedHints[hintIndex]?.character <= column) {
          const hint = sortedHints[hintIndex];
          if (hint) {
            hintWidth += estimateInlayHintWidth(hint.label, fontSize, fontFamily, tabSize);
          }
          hintIndex++;
        }

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

  const { handleMouseDown, handleClick } = useEditorMouseInteractions({
    inputRef,
    bufferId,
    filePath,
    readOnly,
    useGlobalEditorState,
    visualInlayHints,
    viewLayout,
    lines,
    actualLines,
    displayContentLength: displayContent.length,
    foldTransform,
    multiCursorState,
    cursorPosition,
    selection,
    getVisualLineOffset,
    getCursorPositionForVisualOffset,
    getColumnForInlayAdjustedX,
    setCursorPosition: setEditorCursorPosition,
    setSelection,
    enableMultiCursor,
    addCursor,
    clearSecondaryCursors,
    toggleFold: foldActions.toggleFold,
    onReadonlySurfaceClick,
  });

  const isLspCompletionVisible = useEditorUIStore.use.isLspCompletionVisible();
  const filteredCompletions = useEditorUIStore.use.filteredCompletions();
  const selectedLspIndex = useEditorUIStore.use.selectedLspIndex();
  const autocompleteCompletion = useEditorUIStore.use.autocompleteCompletion();
  const { setSelectedLspIndex, setIsLspCompletionVisible, setAutocompleteCompletion } =
    useEditorUIStore.use.actions();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const getLastInputTimestamp = useCallback(
    () => useEditorUIStore.getState().lastInputTimestamp,
    [],
  );
  const subscribeToInputTimestamp = useCallback(
    (listener: (timestamp: number) => void) =>
      useEditorUIStore.subscribe((state) => listener(state.lastInputTimestamp)),
    [],
  );

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
    languageId: currentLanguageId,
    content,
    cursorOffset: cursorPosition.offset,
    hasActiveFolds: foldTransform.hasActiveFolds,
    getLastInputTimestamp,
    subscribeToInputTimestamp,
    setAutocompleteCompletion,
  });

  // Extracted key down handler
  const handleKeyDown = useEditorKeyDown({
    inputRef,
    content,
    bufferId,
    filePath,
    languageId: currentLanguageId,
    tabSize,
    lines,
    lineOffsets: displayLineOffsets,
    cursorPosition,
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
    clearSecondaryCursors,
    updateCursor,
    setSelectedLspIndex,
    setIsLspCompletionVisible,
    setAutocompleteCompletion,
  });

  const scrollLayerRefs = useMemo(
    () => [
      currentLineRef,
      indentGuideRef,
      highlightRef,
      primaryCursorRef,
      multiCursorRef,
      wordHighlightRef,
      searchHighlightRef,
      selectionLayerRef,
      bracketMatchRef,
      vimCursorRef,
      autocompleteCompletionRef,
      inlineEditOverlayRef,
      gitBlameRef,
      inlineDiffRef,
    ],
    [
      currentLineRef,
      indentGuideRef,
      highlightRef,
      primaryCursorRef,
      multiCursorRef,
      wordHighlightRef,
      searchHighlightRef,
      selectionLayerRef,
      bracketMatchRef,
      vimCursorRef,
      autocompleteCompletionRef,
      inlineEditOverlayRef,
      gitBlameRef,
      inlineDiffRef,
    ],
  );

  // Extracted scroll handler with switchGuard
  const { handleScroll, isScrollingRef } = useEditorScroll({
    bufferId,
    viewStateKey: viewStateKey ?? bufferId ?? null,
    linesCount: visualLineCount,
    minimapEnabled: minimapEnabled && !largeContentMode,
    lockVerticalScroll: !scrollable,
    switchGuardRef,
    scrollLayerRefs,
    setEditorScrollTop,
    handleViewportScroll,
  });

  useLayoutEffect(() => {
    const scrollElement = largeContentMode ? largeEditorScrollRef.current : inputRef.current;
    if (!scrollElement) return;

    applyEditorScrollTransform(scrollLayerRefs, scrollElement.scrollLeft, scrollElement.scrollTop);
  });

  useDragScroll(inputRef);
  useSelectionScope(contentContainerRef, isActiveSurface && readOnly);

  useEffect(() => {
    const scrollElement = largeContentMode ? largeEditorScrollRef.current : inputRef.current;
    if (scrollElement) {
      initializeViewport(scrollElement, visualLineCount);
    }
  }, [initializeViewport, largeContentMode, visualLineCount]);

  useEffect(() => {
    if (!isActiveSurface) return;
    editorAPI.setTextareaRef(inputRef.current);
    return () => {
      editorAPI.setTextareaRef(null);
    };
  }, [inputRef, isActiveSurface]);

  useEditorWheelForwarding({
    textareaRef: inputRef,
    largeContentMode,
    scrollable,
  });

  // Track viewport height
  useEffect(() => {
    const scrollElement = largeContentMode ? largeEditorScrollRef.current : inputRef.current;
    if (!scrollElement) return;

    const updateViewportHeight = () => {
      const height = scrollElement.clientHeight;
      if (height > 0) {
        useEditorStateStore.getState().actions.setViewportHeight(height);
        setEditorViewportHeight(height);
      }
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [largeContentMode]);

  // Tokenization is intentionally delayed while typing. Rendering uses the previous
  // token snapshot until the editor is idle enough to refresh syntax highlights.
  useTokenizationScheduler({
    bufferId,
    filePath: buffer?.path,
    content: buffer?.content,
    enabled: tokenizationEnabled,
    tokenizedContent,
    tokenCount: tokens.length,
    visualLineCount,
    incremental: useIncrementalTokenization,
    viewportRange,
    isScrollingRef,
    isActiveSurface: useGlobalEditorState,
    tokenize,
  });

  const handleLineClick = useCallback(
    (lineIndex: number) => {
      if (!useGlobalEditorState && onReadonlySurfaceClick) {
        onReadonlySurfaceClick({ line: lineIndex, column: 0 });
        return;
      }

      if (largeContentMode) {
        const lineStart = getVisualLineOffset(lineIndex);
        const lineText = getLargeLineText(lineIndex);
        const lineBreakLength = lineIndex < visualLineCount - 1 ? 1 : 0;
        const lineEnd = Math.min(content.length, lineStart + lineText.length + lineBreakLength);
        const startPos = getLargePositionForOffset(lineStart);
        const endPos = getLargePositionForOffset(lineEnd);

        window.getSelection()?.removeAllRanges();
        largeEditorScrollRef.current?.focus({ preventScroll: true });
        setEditorCursorPosition(endPos);
        setSelection({ start: startPos, end: endPos });
        return;
      }

      if (!inputRef.current) return;

      const lineStart = getVisualLineOffset(lineIndex);
      const lineText = lines[lineIndex] ?? "";
      const lineBreakLength = lineIndex < lines.length - 1 ? 1 : 0;
      const lineEnd = Math.min(
        displayContent.length,
        lineStart + lineText.length + lineBreakLength,
      );

      inputRef.current.setSelectionRange(lineStart, lineEnd, "forward");
      window.getSelection()?.removeAllRanges();
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

        setEditorCursorPosition(actualEnd);
        setSelection({ start: actualStart, end: actualEnd });
        return;
      }

      setEditorCursorPosition(endPos);
      setSelection({ start: startPos, end: endPos });
    },
    [
      lines,
      getVisualLineOffset,
      getLargeLineText,
      getLargePositionForOffset,
      foldTransform,
      actualLines,
      largeContentMode,
      setEditorCursorPosition,
      setSelection,
      useGlobalEditorState,
      onReadonlySurfaceClick,
      content.length,
      visualLineCount,
      displayContent.length,
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
    return resolveInlineAutocompletePreview({
      completion: autocompleteCompletion,
      isLspCompletionVisible,
      cursorOffset: cursorPosition.offset,
      cursorColumn: cursorPosition.column,
      visualCursorLine,
      lines,
      cursorTop: cursorViewPosition?.top,
      cursorLeft: cursorViewPosition?.left,
      lineHeight,
      editorPaddingTop: EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      editorPaddingLeft: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      measureText: measureEditorText,
    });
  }, [
    autocompleteCompletion,
    isLspCompletionVisible,
    cursorPosition.offset,
    cursorPosition.column,
    visualCursorLine,
    lines,
    lineHeight,
    cursorViewPosition,
    measureEditorText,
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
          totalLines={visualLineCount}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          textareaRef={largeContentMode ? largeEditorScrollRef : inputRef}
          virtualize={shouldVirtualizeRendering}
          filePath={largeContentMode ? undefined : filePath}
          onLineClick={handleLineClick}
          onGitIndicatorClick={largeContentMode ? undefined : inlineDiff.toggle}
          foldMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
          wordWrap={wordWrap}
          lines={lines}
          contentWidth={contentWidth}
          lineNumberStart={lineNumberStart}
          lineNumberMap={lineNumberMap}
          viewZones={viewLayout.zones}
          visualCursorLine={visualCursorLine}
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
        {useGlobalEditorState && (
          <CurrentLineLayer
            ref={currentLineRef}
            visualLine={visualCursorLine}
            lineHeight={lineHeight}
            cursorViewPosition={cursorViewPosition}
            hidden={selection !== undefined && selection.start.offset !== selection.end.offset}
          />
        )}
        <IndentGuideLayer
          ref={indentGuideRef}
          enabled={renderIndentGuides}
          lines={lines}
          lineCount={visualLineCount}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          tabSize={tabSize}
          activeLine={visualCursorLine}
          activeColumn={cursorPosition.column}
          lineTextResolver={largeContentMode ? getLargeLineText : undefined}
          viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          viewLayout={viewLayout}
        />
        <HighlightLayer
          ref={highlightRef}
          filePath={largeContentMode ? undefined : filePath}
          content={displayContent}
          lines={lines}
          lineCount={visualLineCount}
          lineOffsets={displayLineOffsets}
          lazyLineSlicing={largeContentMode}
          tokens={effectiveTokens}
          foldMarkers={foldTransform.hasActiveFolds ? foldTransform.foldMarkers : undefined}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          wordWrap={wordWrap}
          renderWhitespace={renderWhitespace}
          viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
          lineMapping={foldTransform.hasActiveFolds ? foldTransform.mapping : undefined}
          viewZones={viewLayout.zones}
          inlayHints={largeContentMode ? [] : visualInlayHints}
        />
        {largeContentMode && (
          <LargeEditorSurface
            ref={largeEditorScrollRef}
            scrollHeight={
              viewLayout.totalHeight +
              EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
              EDITOR_CONSTANTS.EDITOR_PADDING_BOTTOM
            }
            onKeyDown={largeEditorInput.handleKeyDown}
            onPaste={useGlobalEditorState ? largeEditorInput.handleSurfacePaste : undefined}
            onPointerDown={largeEditorInput.handlePointerDown}
            onPointerMove={largeEditorInput.handlePointerMove}
            onPointerUp={largeEditorInput.handlePointerUp}
            onContextMenu={useGlobalEditorState ? contextMenu.open : undefined}
            onScroll={handleScroll}
          />
        )}
        <InputLayer
          textareaRef={inputRef}
          content={textareaContent}
          filePath={filePath}
          onInput={largeContentMode ? largeEditorInput.handleInput : handleInput}
          onBeforeInput={
            readOnly || !useGlobalEditorState
              ? undefined
              : largeContentMode
                ? largeEditorInput.handleBeforeInput
                : handleBeforeInput
          }
          onKeyDown={
            readOnly || !useGlobalEditorState || largeContentMode ? undefined : handleKeyDown
          }
          onScroll={largeContentMode ? undefined : handleScroll}
          onSelect={useGlobalEditorState && !largeContentMode ? handleCursorChange : undefined}
          onClick={
            !largeContentMode && (useGlobalEditorState || readOnly || onReadonlySurfaceClick)
              ? handleClick
              : undefined
          }
          onMouseDown={useGlobalEditorState && !largeContentMode ? handleMouseDown : undefined}
          onContextMenu={useGlobalEditorState && !largeContentMode ? contextMenu.open : undefined}
          onPaste={useGlobalEditorState ? largeEditorInput.handleTextareaPaste : undefined}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          wordWrap={wordWrap}
          readOnly={readOnly}
          scrollable={largeContentMode ? false : scrollable}
          customCaret={useCustomInsertCaret}
          nativeSelection={largeContentMode}
          scrollPaddingBottom={
            largeContentMode ? 0 : viewLayout.totalZoneHeight + editorBottomSafePadding
          }
          bufferId={bufferId || undefined}
        />
        {useCustomInsertCaret && (
          <PrimaryCursorLayer
            ref={primaryCursorRef}
            cursorPosition={cursorPosition}
            visualLine={visualCursorLine}
            cursorViewPosition={cursorViewPosition}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            lineText={
              largeContentMode
                ? getLargeLineText(visualCursorLine)
                : (lines[visualCursorLine] ?? "")
            }
            textareaRef={largeContentMode ? largeEditorScrollRef : inputRef}
            hidden={
              !!largeSelectionOffsets ||
              (vimModeEnabled && (vimMode === "normal" || vimMode === "visual"))
            }
          />
        )}
        {useGlobalEditorState && (
          <SelectionLayer
            ref={selectionLayerRef}
            textareaRef={largeContentMode ? undefined : inputRef}
            lines={lines}
            lineOffsets={displayLineOffsets}
            contentLength={displayContent.length}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            selectionOffsets={largeContentMode ? largeSelectionOffsets : undefined}
            lineBreakFillWidth={Math.max(contentWidth, contentScrollWidth)}
            lineTextResolver={largeContentMode ? getLargeLineText : undefined}
            viewportRange={
              largeContentMode && shouldVirtualizeRendering ? viewportRange : undefined
            }
            wordWrap={!largeContentMode && wordWrap}
            viewLayout={!largeContentMode ? viewLayout : undefined}
          />
        )}
        {useGlobalEditorState && highlightOccurrences && (
          <WordHighlightLayer
            ref={wordHighlightRef}
            content={displayContent}
            cursorOffset={
              largeContentMode ? cursorPosition.offset : getInputOffsetForPosition(cursorPosition)
            }
            hasSelection={largeContentMode ? !!largeSelectionOffsets : !!selection}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            lines={lines}
            lineOffsets={displayLineOffsets}
            contentLength={displayContent.length}
            lineTextResolver={largeContentMode ? getLargeLineText : undefined}
            viewportRange={
              largeContentMode || shouldVirtualizeRendering ? viewportRange : undefined
            }
            viewLayout={!largeContentMode && wordWrap ? viewLayout : undefined}
          />
        )}
        {useGlobalEditorState && (
          <BracketMatchLayer
            ref={bracketMatchRef}
            content={displayContent}
            cursorOffset={
              largeContentMode ? cursorPosition.offset : getInputOffsetForPosition(cursorPosition)
            }
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            lines={lines}
            lineOffsets={displayLineOffsets}
            contentLength={displayContent.length}
            lineTextResolver={largeContentMode ? getLargeLineText : undefined}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
            viewLayout={!largeContentMode && wordWrap ? viewLayout : undefined}
          />
        )}
        {!largeContentMode && (
          <InlineEditPopover
            ref={inlineEditOverlayRef}
            state={inlineEditState}
            selection={selection}
            zoneTop={inlineEditZoneTop}
          />
        )}
        {!largeContentMode && inlineAutocompletePreview && (
          <InlineAutocompletePreview
            ref={autocompleteCompletionRef}
            preview={inlineAutocompletePreview}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
          />
        )}
        {!largeContentMode &&
          autocompleteCompletion &&
          !isLspCompletionVisible &&
          !inlineAutocompletePreview && <InlineAutocompleteHint />}
        {useGlobalEditorState && !largeContentMode && multiCursorState && (
          <MultiCursorLayer
            ref={multiCursorRef}
            cursors={multiCursorState.cursors}
            primaryCursorId={multiCursorState.primaryCursorId}
            lineHeight={lineHeight}
            lines={lines}
            lineOffsets={displayLineOffsets}
            contentLength={displayContent.length}
            measureText={measureEditorText}
            viewLayout={wordWrap ? viewLayout : undefined}
          />
        )}

        {useGlobalEditorState &&
          !largeContentMode &&
          vimModeEnabled &&
          (vimMode === "normal" || vimMode === "visual") && (
            <VimCursorLayer
              ref={vimCursorRef}
              visualLine={visualCursorLine}
              cursorViewPosition={cursorViewPosition}
              cursorPosition={cursorPosition}
              fontSize={fontSize}
              fontFamily={fontFamily}
              lineHeight={lineHeight}
              tabSize={tabSize}
              lineText={lines[visualCursorLine] ?? ""}
              vimMode={vimMode}
            />
          )}

        {(highlightMatches?.length || searchMatches.length > 0) && (
          <SearchHighlightLayer
            ref={searchHighlightRef}
            searchMatches={highlightMatches ?? searchMatches}
            currentMatchIndex={currentHighlightIndex ?? currentMatchIndex}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
            lines={lines}
            lineOffsets={displayLineOffsets}
            contentLength={displayContent.length}
            lineCount={visualLineCount}
            lineTextResolver={largeContentMode ? getLargeLineText : undefined}
            viewportRange={shouldVirtualizeRendering ? viewportRange : undefined}
            viewLayout={!largeContentMode && wordWrap ? viewLayout : undefined}
          />
        )}

        {useGlobalEditorState && !largeContentMode && (
          <DefinitionLinkLayer
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            lines={lines}
            lineOffsets={displayLineOffsets}
            contentLength={displayContent.length}
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
              lines={lines}
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
          lines={deferredMinimapLines}
          lineStarts={deferredMinimapLineOffsets}
          tokens={deferredMinimapTokens}
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
            onCopy={largeContentMode ? largeEditorInput.handleCopy : editorOps.copy}
            onCut={largeContentMode ? largeEditorInput.handleCut : editorOps.cut}
            onPaste={
              largeContentMode
                ? () => {
                    void largeEditorInput.handlePasteFromClipboard();
                  }
                : editorOps.paste
            }
            onSelectAll={largeContentMode ? largeEditorInput.handleSelectAll : editorOps.selectAll}
            onDelete={
              largeContentMode ? largeEditorInput.handleDeleteSelection : editorOps.deleteSelection
            }
            onFind={() => setIsFindVisible(true)}
            onGoToLine={() => {
              void keymapRegistry.executeCommand("editor.goToLine");
            }}
            onDuplicate={() => {
              void keymapRegistry.executeCommand("editor.duplicateLine");
            }}
            onIndent={largeContentMode ? largeEditorInput.handleIndent : editorOps.indent}
            onOutdent={largeContentMode ? largeEditorInput.handleOutdent : editorOps.outdent}
            onToggleComment={() => {
              void keymapRegistry.executeCommand("editor.toggleComment");
            }}
            onFormat={() => {
              void keymapRegistry.executeCommand("editor.formatDocument");
            }}
            onToggleCase={
              largeContentMode ? largeEditorInput.handleToggleCase : editorOps.toggleCase
            }
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
