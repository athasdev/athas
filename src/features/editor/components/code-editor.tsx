import type React from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { useEditorViewStore } from "@/features/editor/stores/view.store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { resolveGoToLineTarget } from "@/features/editor/utils/go-to-line";
import { calculateCursorPositionFromContent } from "@/features/editor/utils/position";
import { buildSearchRegex, findLimitedMatchesCooperative } from "@/features/editor/utils/search";
import type {
  EditorCoordinateResolver,
  EditorModelPositionResolver,
} from "@/features/editor/view-model/view-layout";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { toast } from "@/ui/toast";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { CompletionDropdown } from "../completion/completion-dropdown";
import { editorAPI } from "../extensions/api";
import CodeLensOverlay from "../lsp/code-lens-overlay";
import { HoverTooltip } from "../lsp/hover-tooltip";
import { LspClient } from "../lsp/lsp-client";
import RenameInput from "../lsp/rename-input";
import { SignatureHelpTooltip } from "../lsp/signature-help-tooltip";
import type { CodeLensItem } from "../lsp/use-code-lens";
import { useInlayHints } from "../lsp/use-inlay-hints";
import { useRename } from "../lsp/use-rename";
import { useSemanticTokens } from "../lsp/use-semantic-tokens";
import { MarkdownPreview } from "../markdown/markdown-preview";
import { NotebookEditor } from "../notebook/notebook-editor";
import { getPythonScriptCells } from "../notebook/python-script-cells";
import {
  applyRMarkdownChunkOptionSemantics,
  clearRMarkdownChunkOutput,
  formatRMarkdownChunkOutput,
  getRMarkdownChunks,
  rMarkdownChunkShouldEvaluate,
  rMarkdownChunkShouldPersistOutput,
  updateRMarkdownChunkOutput,
} from "../notebook/rmarkdown-chunks";
import type { Position, Range } from "../types/editor.types";
import { ScrollDebugOverlay } from "./debug/scroll-debug-overlay";
import { HtmlPreview } from "./html/html-preview";
import { MonacoEditor } from "./monaco-editor";
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
const PYTHON_SCRIPT_CELL_COMMAND = "athas.runPythonScriptCell";
const R_MARKDOWN_CHUNK_COMMAND = "athas.runRMarkdownChunk";

interface NotebookRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
  displayData?: Array<unknown>;
}

function isPythonScriptFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith(".py") || normalized.endsWith(".ipy");
}

function isRMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".rmd");
}

function editorWorkingDirectory(path: string): string | null {
  if (!path || path.startsWith("remote://") || path.includes("://")) return null;
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return path.slice(0, lastSlash);
}

function truncateCellOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 180) return trimmed;
  return `${trimmed.slice(0, 177)}...`;
}

const AthasEditor = lazy(() =>
  import("@/features/editor/engines/athas/components/editor").then((module) => ({
    default: module.AthasEditor,
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
  const previousSearchInputSignatureRef = useRef<string | null>(null);
  const wasFindVisibleForSearchRef = useRef(false);
  const handledSearchNavigationRevisionRef = useRef(0);
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
  const searchNavigationRevision = useEditorUIStore.use.searchNavigationRevision();
  const searchOptions = useEditorUIStore.use.searchOptions();
  const { setSearchResults } = useEditorUIStore.use.actions();
  const { settings } = useSettingsStore();
  const isFindVisible = useUIState((state) => state.isFindVisible);
  const lspClient = useMemo(() => LspClient.getInstance(), []);
  const searchInputSignature = useMemo(
    () =>
      [
        searchQuery,
        Number(searchOptions.caseSensitive),
        Number(searchOptions.wholeWord),
        Number(searchOptions.useRegex),
      ].join("\u0000"),
    [searchOptions.caseSensitive, searchOptions.useRegex, searchOptions.wholeWord, searchQuery],
  );

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
  const useAthasEditor = settings.coreFeatures.athasEditorEngine;
  const showNotebookEditor =
    activeBuffer?.type === "editor" && filePath.toLowerCase().endsWith(".ipynb");
  const enableInteractiveServices =
    isActiveSurface && !isPreviewBuffer && !readOnly && !showNotebookEditor;
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
    const focusTimer = setTimeout(() => {
      focusTarget.focus();
    }, 0);

    return () => clearTimeout(focusTimer);
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

  // Inline lenses are reserved for Athas-owned actions that do not require LSP layout support.
  const pythonScriptCells = useMemo(
    () =>
      enableInteractiveServices && isPythonScriptFile(filePath) ? getPythonScriptCells(value) : [],
    [enableInteractiveServices, filePath, value],
  );
  const pythonScriptCellLenses = useMemo<CodeLensItem[]>(
    () =>
      pythonScriptCells.map((cell) => ({
        line: cell.markerLine,
        title: "Run cell",
        command: PYTHON_SCRIPT_CELL_COMMAND,
        arguments: [cell.index],
      })),
    [pythonScriptCells],
  );
  const rMarkdownChunks = useMemo(
    () => (enableInteractiveServices && isRMarkdownFile(filePath) ? getRMarkdownChunks(value) : []),
    [enableInteractiveServices, filePath, value],
  );
  const rMarkdownChunkLenses = useMemo<CodeLensItem[]>(
    () =>
      rMarkdownChunks.map((chunk) => ({
        line: chunk.markerLine,
        title: "Run chunk",
        command: R_MARKDOWN_CHUNK_COMMAND,
        arguments: [chunk.index],
      })),
    [rMarkdownChunks],
  );
  const visibleCodeLenses = useMemo(
    () => [...pythonScriptCellLenses, ...rMarkdownChunkLenses],
    [pythonScriptCellLenses, rMarkdownChunkLenses],
  );

  const handleCodeLensExecute = useCallback(
    (lens: { title: string; command?: string; arguments?: unknown[] }) => {
      if (!filePath || !lens.command) return;

      if (lens.command === PYTHON_SCRIPT_CELL_COMMAND) {
        const cellIndex = typeof lens.arguments?.[0] === "number" ? lens.arguments[0] : -1;
        const cell = pythonScriptCells[cellIndex];
        if (!cell) return;

        void invoke<NotebookRunResult>("notebook_run_python_cell", {
          code: cell.code,
          setupCode: cell.setupCode,
          cwd: editorWorkingDirectory(filePath),
        })
          .then((result) => {
            if (result.timedOut) {
              toast.error("Python cell timed out.");
              return;
            }
            if (result.status !== 0 || result.stderr.trim()) {
              toast.error(
                truncateCellOutput(result.stderr || `Python exited with status ${result.status}.`),
              );
              return;
            }
            const stdout = truncateCellOutput(result.stdout);
            if (stdout) {
              toast.success(`Python cell output: ${stdout}`);
              return;
            }
            if (result.displayData?.length) {
              toast.success(`Python cell produced ${result.displayData.length} display output(s).`);
              return;
            }
            toast.success("Python cell ran.");
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : "Failed to run Python cell");
          });
        return;
      }

      if (lens.command === R_MARKDOWN_CHUNK_COMMAND) {
        const chunkIndex = typeof lens.arguments?.[0] === "number" ? lens.arguments[0] : -1;
        const chunk = rMarkdownChunks[chunkIndex];
        if (!chunk) return;

        if (!rMarkdownChunkShouldEvaluate(chunk)) {
          onChange(clearRMarkdownChunkOutput(valueRef.current, chunk));
          toast.success("R chunk skipped because eval=FALSE.");
          return;
        }

        void invoke<NotebookRunResult>("notebook_run_r_cell", {
          code: chunk.code,
          setupCode: chunk.setupCode,
          cwd: editorWorkingDirectory(filePath),
        })
          .then((result) => {
            const currentValue = valueRef.current;
            const currentChunk = getRMarkdownChunks(currentValue)[chunkIndex] ?? chunk;
            const semanticResult = applyRMarkdownChunkOptionSemantics(result, currentChunk);
            if (rMarkdownChunkShouldPersistOutput(currentChunk)) {
              onChange(
                updateRMarkdownChunkOutput(
                  currentValue,
                  currentChunk,
                  formatRMarkdownChunkOutput(semanticResult),
                ),
              );
            } else {
              onChange(clearRMarkdownChunkOutput(currentValue, currentChunk));
            }

            if (result.timedOut) {
              toast.error("R chunk timed out.");
              return;
            }
            const allowCapturedError = currentChunk.options.error === true;
            if (
              !allowCapturedError &&
              (semanticResult.status !== 0 || semanticResult.stderr.trim())
            ) {
              toast.error(
                truncateCellOutput(
                  semanticResult.stderr || `R exited with status ${semanticResult.status}.`,
                ),
              );
              return;
            }
            const stdout = truncateCellOutput(semanticResult.stdout);
            if (allowCapturedError && semanticResult.stderr.trim()) {
              toast.success("R chunk completed with captured error output.");
              return;
            }
            toast.success(stdout ? `R chunk output: ${stdout}` : "R chunk ran.");
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : "Failed to run R chunk");
          });
        return;
      }

      void lspClient.applyCodeAction(filePath, {
        title: lens.title,
        command: lens.command,
        arguments: lens.arguments ?? [],
      });
    },
    [filePath, lspClient, onChange, pythonScriptCells, rMarkdownChunks],
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
    if (useAthasEditor) {
      hoverHandlers.handleHover(e);
    }
    definitionLinkHandlers.handleMouseMove(e);
  };

  // Combine mouse leave handlers
  const handleMouseLeave = () => {
    if (!enableInteractiveServices) return;
    if (useAthasEditor) {
      hoverHandlers.handleMouseLeave();
    }
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

    const previousSearchInputSignature = previousSearchInputSignatureRef.current;
    const searchInputChanged =
      previousSearchInputSignature !== null &&
      previousSearchInputSignature !== searchInputSignature;
    const searchJustOpened = isFindVisible && !wasFindVisibleForSearchRef.current;
    const shouldRevealSearchResult = searchJustOpened || searchInputChanged;
    previousSearchInputSignatureRef.current = searchInputSignature;
    wasFindVisibleForSearchRef.current = isFindVisible;

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

      void findLimitedMatchesCooperative(value, regex, Number.POSITIVE_INFINITY, {
        shouldCancel: () => searchRunIdRef.current !== searchRunId,
      }).then((result) => {
        if (!result || searchRunIdRef.current !== searchRunId) return;
        setSearchResults(
          result.matches,
          result.matches.length > 0 ? 0 : -1,
          result.limited,
          shouldRevealSearchResult,
        );
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
    searchInputSignature,
    searchOptions,
    value,
    setSearchResults,
  ]);

  // Effect to handle explicit search navigation - scroll to current match and move cursor
  useEffect(() => {
    if (!enableInteractiveServices) return;
    if (searchNavigationRevision === handledSearchNavigationRevisionRef.current) return;
    handledSearchNavigationRevisionRef.current = searchNavigationRevision;

    if (searchMatches.length > 0 && currentMatchIndex >= 0) {
      const match = searchMatches[currentMatchIndex];
      if (!match) return;

      const startPosition = calculateCursorPositionFromContent(match.start, valueRef.current);
      const endPosition = calculateCursorPositionFromContent(match.end, valueRef.current);

      editorAPI.setSelection({ start: startPosition, end: endPosition });
      editorAPI.setCursorPosition(endPosition);
    }
  }, [currentMatchIndex, enableInteractiveServices, searchMatches, searchNavigationRevision]);

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
          {enableRichEditorServices && useAthasEditor && <HoverTooltip />}

          {/* Completion Dropdown */}
          {enableRichEditorServices && useAthasEditor && <CompletionDropdown />}

          {/* Code Lens */}
          {enableRichEditorServices && visibleCodeLenses.length > 0 && (
            <CodeLensOverlay
              ref={codeLensRef}
              lenses={visibleCodeLenses}
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
            ) : showNotebookEditor ? (
              <NotebookEditor />
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
                    enableRichEditorServices && useAthasEditor
                      ? hoverHandlers.handleMouseEnter
                      : undefined
                  }
                  onClick={
                    enableRichEditorServices ? goToDefinitionHandlers.handleClick : undefined
                  }
                />
              </Suspense>
            ) : (
              <MonacoEditor
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
