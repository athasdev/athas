import type React from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CsvPreview } from "@/extensions/viewers/csv/csv-preview";
import { useLargeEditorModeInfo } from "@/features/editor/hooks/use-large-editor-mode-info";
import { useLspIntegration } from "@/features/editor/hooks/use-lsp-integration";
import { useEditorScroll } from "@/features/editor/hooks/use-scroll";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { resolveGoToLineTarget } from "@/features/editor/utils/go-to-line";
import { calculateCursorPositionFromContent } from "@/features/editor/utils/position";
import { buildSearchRegex, findLimitedMatchesCooperative } from "@/features/editor/utils/search";
import type {
  EditorCoordinateResolver,
  EditorModelPositionResolver,
} from "@/features/editor/view-model/view-layout";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { CompletionDropdown } from "../completion/completion-dropdown";
import { editorAPI } from "../extensions/api";
import CodeLensOverlay from "../lsp/code-lens-overlay";
import { HoverTooltip } from "../lsp/hover-tooltip";
import { LspClient } from "../lsp/lsp-client";
import RenameInput from "../lsp/rename-input";
import { SignatureHelpTooltip } from "../lsp/signature-help-tooltip";
import { useCodeLens } from "../lsp/use-code-lens";
import { useInlayHints } from "../lsp/use-inlay-hints";
import { useRename } from "../lsp/use-rename";
import { useSemanticTokens } from "../lsp/use-semantic-tokens";
import { MarkdownPreview } from "../markdown/markdown-preview";
import type { Position, Range } from "../types/editor";
import { ScrollDebugOverlay } from "./debug/scroll-debug-overlay";
import { HtmlPreview } from "./html/html-preview";
import { MonacoBackedEditor } from "./monaco-editor";
import { EditorStylesheet } from "./stylesheet";
import Breadcrumb, { type BreadcrumbProps } from "./toolbar/breadcrumb";
import FindBar from "./toolbar/find-bar";

interface CodeEditorProps {
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  paneId?: string;
  bufferId?: string;
  isActiveSurface?: boolean;
  showToolbar?: boolean;
  readOnly?: boolean;
  breadcrumbProps?: BreadcrumbProps;
  scrollable?: boolean;
  backgroundLayer?: ReactNode;
  onReadonlySurfaceClick?: (position: { line: number; column: number }) => void;
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
}

export interface CodeEditorRef {
  editor: HTMLDivElement | null;
  textarea: HTMLDivElement | null;
}

interface GoToLineEventDetail {
  line?: number;
  column?: number;
  path?: string;
}

const SEARCH_DEBOUNCE_MS = 300; // Debounce search regex matching
const LSP_VIEWPORT_LINE_BUFFER = 30;
const MAX_FILE_SEARCH_MATCHES = 20_000;
const AthasEditor = lazy(() =>
  import("@/features/athas-editor/components/editor").then((module) => ({
    default: module.Editor,
  })),
);

const CodeEditor = ({
  className,
  paneId,
  bufferId: propBufferId,
  isActiveSurface = true,
  showToolbar = true,
  readOnly = false,
  breadcrumbProps,
  scrollable = true,
  backgroundLayer,
  onReadonlySurfaceClick,
  highlightMatches,
  currentHighlightIndex,
  lineNumberStart,
  lineNumberMap,
  onContentChange,
}: CodeEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchRunIdRef = useRef(0);
  const codeLensRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef("");
  const lspScrollRafRef = useRef<number | null>(null);
  const editorCoordinateResolverRef = useRef<EditorCoordinateResolver | null>(null);
  const editorModelPositionResolverRef = useRef<EditorModelPositionResolver | null>(null);
  const [lspVisibleLineRange, setLspVisibleLineRange] = useState({
    startLine: 0,
    endLine: 120,
  });
  const { setRefs, setContent, setFileInfo, setActiveEditorViewKey } =
    useEditorStateStore.use.actions();
  const { setDisabled } = useEditorSettingsStore.use.actions();

  const activeBufferId = useBufferStore((state) => propBufferId ?? state.activeBufferId);
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const activeBuffer = useBufferStore(
    useCallback(
      (state) =>
        activeBufferId
          ? state.buffers.find((buffer) => buffer.id === activeBufferId) || null
          : null,
      [activeBufferId],
    ),
  );
  const editorViewKey = paneId && activeBufferId ? `${paneId}:${activeBufferId}` : activeBufferId;
  const { handleContentChange } = useEditorAppStore.use.actions();
  const searchQuery = useEditorUIStore.use.searchQuery();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const searchOptions = useEditorUIStore.use.searchOptions();
  const { setSearchResults } = useEditorUIStore.use.actions();
  const { settings } = useSettingsStore();
  const isFindVisible = useUIState((state) => state.isFindVisible);
  const lspClient = useMemo(() => LspClient.getInstance(), []);

  // Apply zoom to font size for position calculations (must match editor.tsx)
  const zoomedFontSize = settings.fontSize * zoomLevel;
  const zoomedLineHeight = calculateLineHeight(zoomedFontSize, settings.editorLineHeight);

  // Extract values from active buffer or use defaults
  const value = activeBuffer && hasTextContent(activeBuffer) ? activeBuffer.content : "";
  valueRef.current = value;
  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer
    ? (onContentChange ?? (isActiveSurface ? handleContentChange : () => {}))
    : () => {};
  const isPreviewBuffer = activeBuffer?.isPreview ?? false;
  const editorEngine = settings.editorEngine ?? "monaco";
  const useAthasEditor = editorEngine === "athas";
  const enableInteractiveServices = isActiveSurface && !isPreviewBuffer && !readOnly;
  const largeEditorModeInfo = useLargeEditorModeInfo(value);
  const largeContentMode = useAthasEditor && largeEditorModeInfo.largeContentMode;
  const enableRichEditorServices = enableInteractiveServices && !largeContentMode;
  const enableInlayHints = useAthasEditor && enableRichEditorServices && settings.parameterHints;

  const showMarkdownPreview = activeBuffer?.type === "markdownPreview";
  const showHtmlPreview = activeBuffer?.type === "htmlPreview";
  const showCsvPreview = activeBuffer?.type === "csvPreview";

  // Initialize refs in store
  useEffect(() => {
    if (!isActiveSurface) return;
    setRefs({
      editorRef,
    });
  }, [isActiveSurface, setRefs]);

  useEffect(() => {
    if (!isActiveSurface) return;
    setActiveEditorViewKey(editorViewKey ?? null);
  }, [editorViewKey, isActiveSurface, setActiveEditorViewKey]);

  // Focus editor when active buffer changes
  useEffect(() => {
    if (!enableInteractiveServices) return;
    if (!activeBufferId || !editorRef.current) return;

    const focusTarget = largeContentMode
      ? editorRef.current.querySelector<HTMLElement>("[data-large-editor-scroll]")
      : (editorRef.current
          .querySelector<HTMLElement>("[data-monaco-editor-scroll]")
          ?.querySelector<HTMLTextAreaElement>("textarea") ??
        editorRef.current.querySelector<HTMLTextAreaElement>("textarea"));

    if (!focusTarget) return;

    // Small delay to ensure the editor surface is mounted.
    setTimeout(() => {
      focusTarget.focus();
    }, 0);
  }, [activeBufferId, enableInteractiveServices, largeContentMode]);

  // Sync content and file info with editor instance store
  useEffect(() => {
    if (!isActiveSurface) return;
    setContent("", onChange);
  }, [isActiveSurface, onChange, setContent]);

  useEffect(() => {
    if (!isActiveSurface) return;
    setFileInfo(filePath);
  }, [filePath, isActiveSurface, setFileInfo]);

  // Editor view store automatically syncs with active buffer

  // Set disabled state
  useEffect(() => {
    if (!isActiveSurface) return;
    setDisabled(false);
  }, [isActiveSurface, setDisabled]);

  const resolveEditorPosition = useCallback<EditorCoordinateResolver>(
    (clientX, clientY) => editorCoordinateResolverRef.current?.(clientX, clientY) ?? null,
    [],
  );
  const resolveModelPosition = useCallback<EditorModelPositionResolver>(
    (line, column) => editorModelPositionResolverRef.current?.(line, column) ?? null,
    [],
  );
  const handleCoordinateResolverChange = useCallback(
    (resolver: EditorCoordinateResolver | null) => {
      editorCoordinateResolverRef.current = resolver;
    },
    [],
  );
  const handleModelPositionResolverChange = useCallback(
    (resolver: EditorModelPositionResolver | null) => {
      editorModelPositionResolverRef.current = resolver;
    },
    [],
  );

  // Consolidated LSP integration (document lifecycle, completions, hover, go-to-definition)
  const { hoverHandlers, goToDefinitionHandlers, definitionLinkHandlers } = useLspIntegration({
    enabled: enableRichEditorServices,
    enableCompletions: enableRichEditorServices && useAthasEditor,
    filePath,
    value,
    editorRef,
    resolveEditorPosition,
  });

  // Rename symbol support
  const rename = useRename(enableRichEditorServices ? filePath : undefined);

  const inlayHints = useInlayHints(
    enableInlayHints ? filePath : undefined,
    enableInlayHints,
    lspVisibleLineRange,
  );
  const semanticTokens = useSemanticTokens(
    useAthasEditor && enableRichEditorServices ? filePath : undefined,
    useAthasEditor && enableRichEditorServices,
    value,
  );

  // Code lens
  const codeLenses = useCodeLens(
    enableRichEditorServices ? filePath : undefined,
    enableRichEditorServices,
  );

  const handleCodeLensExecute = useCallback(
    (lens: { title: string; command?: string; arguments?: unknown[] }) => {
      if (!filePath || !lens.command) return;

      void lspClient.applyCodeAction(filePath, {
        title: lens.title,
        command: lens.command,
        arguments: lens.arguments ?? [],
      });
    },
    [filePath, lspClient],
  );

  const updateLspVisibleLineRange = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      const startLine = Math.max(
        0,
        Math.floor(scrollTop / zoomedLineHeight) - LSP_VIEWPORT_LINE_BUFFER,
      );
      const endLine =
        Math.ceil((scrollTop + viewportHeight) / zoomedLineHeight) + LSP_VIEWPORT_LINE_BUFFER;

      setLspVisibleLineRange((current) =>
        current.startLine === startLine && current.endLine === endLine
          ? current
          : { startLine, endLine },
      );
    },
    [zoomedLineHeight],
  );

  // Sync LSP overlay containers with textarea scroll via RAF (matches highlight layer timing)
  const syncLspOverlayTransform = useCallback((scrollTop: number, scrollLeft: number) => {
    const transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
    for (const ref of [codeLensRef, renameInputRef]) {
      if (ref.current) {
        ref.current.style.transform = transform;
      }
    }
  }, []);

  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    const textarea = container.querySelector("textarea");
    if (!textarea) return;

    const handleScroll = () => {
      if (lspScrollRafRef.current !== null) return;
      lspScrollRafRef.current = requestAnimationFrame(() => {
        syncLspOverlayTransform(textarea.scrollTop, textarea.scrollLeft);
        updateLspVisibleLineRange(textarea.scrollTop, textarea.clientHeight);
        lspScrollRafRef.current = null;
      });
    };

    textarea.addEventListener("scroll", handleScroll, { passive: true });
    // Sync initial position
    syncLspOverlayTransform(textarea.scrollTop, textarea.scrollLeft);
    updateLspVisibleLineRange(textarea.scrollTop, textarea.clientHeight);

    return () => {
      textarea.removeEventListener("scroll", handleScroll);
      if (lspScrollRafRef.current !== null) {
        cancelAnimationFrame(lspScrollRafRef.current);
        lspScrollRafRef.current = null;
      }
    };
  }, [syncLspOverlayTransform, updateLspVisibleLineRange]);

  // Combine mouse move handlers for hover and definition link
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableInteractiveServices) return;
    hoverHandlers.handleHover(e);
    definitionLinkHandlers.handleMouseMove(e);
  };

  // Combine mouse leave handlers
  const handleMouseLeave = () => {
    if (!enableInteractiveServices) return;
    hoverHandlers.handleMouseLeave();
    definitionLinkHandlers.handleMouseLeave();
  };

  // Scroll management
  useEditorScroll(editorRef, null);

  // Handle go-to-line events (from search results, diagnostics, vim, etc.)
  useEffect(() => {
    if (!isActiveSurface) return;
    const goToLine = (lineNumber: number, columnNumber?: number) => {
      if (!editorRef.current) return false;

      const currentContent = valueRef.current;
      if (!currentContent) return false;

      const target = resolveGoToLineTarget({
        content: currentContent,
        lineNumber,
        columnNumber,
        lineCount: useEditorViewStore.getState().actions.getLineCount(),
      });

      editorAPI.setSelection(undefined);
      editorAPI.setCursorPosition({
        line: target.line,
        column: target.column,
        offset: target.offset,
      });

      return true;
    };

    const handleGoToLine = (event: CustomEvent<GoToLineEventDetail>) => {
      const lineNumber = event.detail?.line;
      const columnNumber = event.detail?.column;
      const targetPath = event.detail?.path;
      if (targetPath && targetPath !== filePath) return;
      if (!lineNumber) return;

      // Try immediately, then retry if content not ready yet
      if (!goToLine(lineNumber, columnNumber)) {
        setTimeout(() => goToLine(lineNumber, columnNumber), 150);
      }
    };

    window.addEventListener("menu-go-to-line", handleGoToLine as EventListener);
    return () => {
      window.removeEventListener("menu-go-to-line", handleGoToLine as EventListener);
    };
  }, [filePath, isActiveSurface]);

  // Search functionality with debouncing to prevent lag on large files
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (!enableInteractiveServices || !isFindVisible) {
      searchRunIdRef.current += 1;
      setSearchResults([], -1);
      return;
    }

    // Clear matches immediately if no query
    if (!searchQuery.trim() || !value) {
      searchRunIdRef.current += 1;
      setSearchResults([], -1);
      return;
    }

    const searchRunId = searchRunIdRef.current + 1;
    searchRunIdRef.current = searchRunId;

    // Debounce the expensive regex matching
    searchTimerRef.current = setTimeout(() => {
      const regex = buildSearchRegex(searchQuery, searchOptions);
      if (!regex) {
        setSearchResults([], -1);
        return;
      }

      void findLimitedMatchesCooperative(value, regex, MAX_FILE_SEARCH_MATCHES, {
        shouldCancel: () => searchRunIdRef.current !== searchRunId,
      }).then((result) => {
        if (!result || searchRunIdRef.current !== searchRunId) return;
        setSearchResults(result.matches, result.matches.length > 0 ? 0 : -1, result.limited);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      searchRunIdRef.current += 1;
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [
    enableInteractiveServices,
    isFindVisible,
    searchQuery,
    searchOptions,
    value,
    setSearchResults,
  ]);

  // Effect to handle search navigation - scroll to current match and move cursor
  useEffect(() => {
    if (!enableInteractiveServices) return;
    if (searchMatches.length > 0 && currentMatchIndex >= 0) {
      const match = searchMatches[currentMatchIndex];
      if (!match) return;

      const startPosition = calculateCursorPositionFromContent(match.start, valueRef.current);
      const endPosition = calculateCursorPositionFromContent(match.end, valueRef.current);

      editorAPI.setSelection({ start: startPosition, end: endPosition });
      editorAPI.setCursorPosition(endPosition);
    }
  }, [currentMatchIndex, enableInteractiveServices, searchMatches]);

  if (!activeBuffer) {
    return <div className="flex flex-1 items-center justify-center text-text"></div>;
  }

  return (
    <>
      <EditorStylesheet />
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {/* Breadcrumbs */}
        {showToolbar && (
          <Breadcrumb
            {...breadcrumbProps}
            editorViewKey={editorViewKey}
            bufferId={activeBufferId ?? undefined}
            filePathOverride={breadcrumbProps?.filePathOverride ?? filePath}
          />
        )}

        {/* Find Bar */}
        {showToolbar && enableInteractiveServices && <FindBar />}

        <div
          ref={editorRef}
          className={`editor-container relative min-h-0 flex-1 overflow-hidden ${className || ""}`}
          data-zoom-level={zoomLevel}
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            // Zoom is now applied via font size scaling in Editor component
            // to avoid subpixel rendering mismatches between text and positioned elements
          }}
        >
          {/* Hover Tooltip */}
          {enableRichEditorServices && <HoverTooltip />}

          {/* Completion Dropdown */}
          {enableRichEditorServices && useAthasEditor && <CompletionDropdown />}

          {/* Code Lens */}
          {enableRichEditorServices && codeLenses.length > 0 && (
            <CodeLensOverlay
              ref={codeLensRef}
              lenses={codeLenses}
              fontSize={zoomedFontSize}
              lineHeight={zoomedLineHeight}
              scrollTop={editorRef.current?.querySelector("textarea")?.scrollTop ?? 0}
              viewportHeight={editorRef.current?.clientHeight ?? 600}
              onExecute={handleCodeLensExecute}
              resolveModelPosition={resolveModelPosition}
            />
          )}

          {/* Signature Help */}
          {enableRichEditorServices && (
            <SignatureHelpTooltip
              editorRef={editorRef}
              filePath={filePath}
              resolveModelPosition={resolveModelPosition}
            />
          )}

          {/* Rename Input */}
          {enableRichEditorServices && rename.renameState && (
            <RenameInput
              ref={renameInputRef}
              symbol={rename.renameState.symbol}
              line={rename.renameState.line}
              column={rename.renameState.column}
              fontSize={zoomedFontSize}
              lineHeight={zoomedLineHeight}
              charWidth={zoomedFontSize * 0.6}
              resolveModelPosition={resolveModelPosition}
              inputRef={rename.inputRef}
              onSubmit={(newName) => void rename.executeRename(newName)}
              onCancel={rename.cancelRename}
            />
          )}

          {/* Main editor - absolute positioned to fill container */}
          <div className="absolute inset-0 bg-primary-bg">
            {showMarkdownPreview ? (
              <MarkdownPreview />
            ) : showHtmlPreview ? (
              <HtmlPreview />
            ) : showCsvPreview ? (
              <CsvPreview />
            ) : useAthasEditor ? (
              <Suspense fallback={<div className="absolute inset-0 bg-primary-bg" />}>
                <AthasEditor
                  bufferId={activeBufferId ?? undefined}
                  viewStateKey={editorViewKey ?? undefined}
                  isActiveSurface={isActiveSurface}
                  isPreviewMode={isPreviewBuffer}
                  readOnly={readOnly}
                  scrollable={scrollable}
                  backgroundLayer={backgroundLayer}
                  onReadonlySurfaceClick={onReadonlySurfaceClick}
                  highlightMatches={highlightMatches}
                  currentHighlightIndex={currentHighlightIndex}
                  lineNumberStart={lineNumberStart}
                  lineNumberMap={lineNumberMap}
                  onContentChange={onChange}
                  inlayHints={enableInlayHints ? inlayHints : []}
                  semanticTokens={semanticTokens}
                  largeContentMode={largeContentMode}
                  largeContentLineCount={largeEditorModeInfo.lineCount}
                  largeContentLineOffsets={largeEditorModeInfo.lineOffsets}
                  onCoordinateResolverChange={handleCoordinateResolverChange}
                  onModelPositionResolverChange={handleModelPositionResolverChange}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onMouseEnter={
                    enableRichEditorServices ? hoverHandlers.handleMouseEnter : undefined
                  }
                  onClick={
                    enableRichEditorServices ? goToDefinitionHandlers.handleClick : undefined
                  }
                />
              </Suspense>
            ) : (
              <MonacoBackedEditor
                bufferId={activeBufferId ?? undefined}
                viewStateKey={editorViewKey ?? undefined}
                isActiveSurface={isActiveSurface}
                isPreviewMode={isPreviewBuffer}
                readOnly={readOnly}
                scrollable={scrollable}
                backgroundLayer={backgroundLayer}
                onReadonlySurfaceClick={onReadonlySurfaceClick}
                highlightMatches={highlightMatches}
                currentHighlightIndex={currentHighlightIndex}
                lineNumberStart={lineNumberStart}
                lineNumberMap={lineNumberMap}
                onContentChange={onChange}
                onVisibleLineRangeChange={setLspVisibleLineRange}
                onScrollOffsetChange={syncLspOverlayTransform}
                onCoordinateResolverChange={handleCoordinateResolverChange}
                onModelPositionResolverChange={handleModelPositionResolverChange}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseEnter={enableRichEditorServices ? hoverHandlers.handleMouseEnter : undefined}
                onClick={enableRichEditorServices ? goToDefinitionHandlers.handleClick : undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* Debug overlay for scroll monitoring */}
      {enableInteractiveServices && <ScrollDebugOverlay />}
    </>
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
