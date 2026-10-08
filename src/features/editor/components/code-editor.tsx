import type React from "react";
import { runPythonCell, runRCell } from "@/features/editor/services/notebook-cell-runner";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CsvPreview } from "@/features/viewer/csv/components/csv-preview";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useLspIntegration } from "@/features/editor/hooks/use-lsp-integration";
import { useEditorScroll } from "@/features/editor/hooks/use-scroll";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useEditorViewStore } from "@/features/editor/stores/view.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { resolveGoToLineTarget } from "@/features/editor/utils/go-to-line";
import type { EditorModelPositionResolver } from "@/features/editor/types/code-editor-view.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { toast } from "sonner";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useZoomStore } from "@/features/layout/stores/zoom.store";
import { readBufferText } from "../services/buffer-text";
import type { LiveDocumentEdit } from "../services/live-document-registry";
import CodeLensOverlay from "../lsp/code-lens-overlay";
import RenameInput from "../lsp/rename-input";
import type { CodeLensItem } from "../lsp/use-code-lens";
import { useRename } from "../lsp/use-rename";
import { MarkdownPreview } from "../markdown/markdown-preview";
import { NotebookEditor } from "../notebook/notebook-editor";
import { getPythonScriptCells } from "../notebook/python-script-cells";
import { type ScriptCellKind, useScriptCells } from "../notebook/use-script-cells";
import {
  applyRMarkdownChunkOptionSemantics,
  clearRMarkdownChunkOutput,
  formatRMarkdownChunkOutput,
  getRMarkdownChunks,
  rMarkdownChunkShouldEvaluate,
  rMarkdownChunkShouldPersistOutput,
  updateRMarkdownChunkOutput,
} from "../notebook/rmarkdown-chunks";
import type {
  EditorContentChangeOptions,
  EditorDocumentChangeBatch,
  Position,
  Range,
} from "../types/editor.types";
import { ScrollDebugOverlay } from "./debug/scroll-debug-overlay";
import { HtmlPreview } from "./html/html-preview";
import { CodeMirrorEditor } from "./codemirror-editor";
import { SvgPreview } from "./svg/svg-preview";
import { EditorStylesheet } from "./stylesheet";
import Breadcrumb, { type BreadcrumbProps } from "./toolbar/breadcrumb";
import { OutlineSidebar } from "@/features/outline/components/outline-sidebar";
import { type AppEventMap, onAppEvent } from "@/utils/app-events";
import {
  useBufferIdOrActive,
  useIsBufferPreview,
} from "@/features/panes/hooks/use-pane-buffer-state";

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
  /** Dock the document outline beside this tab's code, when the Outline setting is on. */
  outline?: boolean;
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
    options?: EditorContentChangeOptions,
  ) => void;
}

export interface CodeEditorRef {
  editor: HTMLDivElement | null;
  textarea: HTMLDivElement | null;
}

const PYTHON_SCRIPT_CELL_COMMAND = "athas.runPythonScriptCell";
const R_MARKDOWN_CHUNK_COMMAND = "athas.runRMarkdownChunk";

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

const CodeEditor = ({
  className,
  paneId,
  bufferId: propBufferId,
  isActiveSurface = true,
  showToolbar = true,
  outline = false,
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
  const codeLensRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLDivElement>(null);
  const editorModelPositionResolverRef = useRef<EditorModelPositionResolver | null>(null);
  const [codeLensContentLeft, setCodeLensContentLeft] = useState<number>(
    EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
  );
  const [codeLensViewportHeight, setCodeLensViewportHeight] = useState(600);
  const [codeLensScrollTop, setCodeLensScrollTop] = useState(0);
  const showInlineCodeLensesRef = useRef(false);
  const { setChangeHandler, setActiveEditorViewKey } = useEditorStateStore.use.actions();

  const activeBufferId = useBufferIdOrActive(propBufferId);
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  // Only what the wrapper needs: the text changes on every keystroke, and re-rendering here
  // re-renders the whole editor surface with it.
  const activeBuffer = useBufferStore(
    useShallow(
      useCallback(
        (state: { buffers: PaneContent[] }) => {
          const buffer = getBufferById(state.buffers, activeBufferId);
          if (!buffer) return null;
          return {
            id: buffer.id,
            type: buffer.type,
            path: buffer.path,
            isMarkdownPreview: buffer.type === "editor" && buffer.isMarkdownPreview === true,
          };
        },
        [activeBufferId],
      ),
    ),
  );
  const getValue = useCallback(() => {
    const buffer = getBufferById(useBufferStore.getState().buffers, activeBufferId);
    return buffer ? readBufferText(buffer) : "";
  }, [activeBufferId]);
  const editorViewKey = paneId && activeBufferId ? `${paneId}:${activeBufferId}` : activeBufferId;
  const { handleContentChange, handleDocumentChange } = useEditorAppStore.use.actions();
  const editorFontSize = useSettingsStore((state) => state.settings.fontSize);
  const editorLineHeight = useSettingsStore((state) => state.settings.editorLineHeight);
  const codeLensEnabled = useSettingsStore((state) => state.settings.codeLens);
  const showOutlineSetting = useSettingsStore((state) => state.settings.showOutline);

  // Apply zoom to font size for position calculations (must match editor.tsx)
  const zoomedFontSize = editorFontSize * zoomLevel;
  const zoomedLineHeight = calculateLineHeight(zoomedFontSize, editorLineHeight);

  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer
    ? (onContentChange ?? (isActiveSurface ? handleContentChange : () => {}))
    : () => {};
  const onDocumentChange =
    activeBuffer && !onContentChange
      ? (
          batch: EditorDocumentChangeBatch,
          previousCursorPosition?: Position,
          previousSelection?: Range,
          liveEdit?: LiveDocumentEdit,
        ) =>
          handleDocumentChange(
            activeBuffer.id,
            batch,
            previousCursorPosition,
            previousSelection,
            liveEdit,
          )
      : undefined;
  const isPreviewBuffer = useIsBufferPreview(activeBuffer?.id);
  const showMarkdownPreview =
    activeBuffer?.type === "markdownPreview" || activeBuffer?.isMarkdownPreview === true;
  const showNotebookEditor =
    activeBuffer?.type === "editor" && filePath.toLowerCase().endsWith(".ipynb");
  const enableInteractiveServices =
    isActiveSurface && !isPreviewBuffer && !readOnly && !showNotebookEditor && !showMarkdownPreview;
  const enableRichEditorServices = enableInteractiveServices;
  const enableCodeLens = enableRichEditorServices && codeLensEnabled;

  const showHtmlPreview = activeBuffer?.type === "htmlPreview";
  const showCsvPreview = activeBuffer?.type === "csvPreview";
  const showSvgPreview = activeBuffer?.type === "svgPreview";

  useEffect(() => {
    if (!isActiveSurface) return;
    setActiveEditorViewKey(editorViewKey ?? null);
  }, [editorViewKey, isActiveSurface, setActiveEditorViewKey]);

  // Focus editor when active buffer changes
  useEffect(() => {
    if (!enableInteractiveServices) return;
    if (!activeBufferId || !editorRef.current) return;

    const focusTarget =
      editorRef.current.querySelector<HTMLElement>(
        '[data-editor-engine="codemirror"] .cm-content',
      ) ?? editorRef.current.querySelector<HTMLTextAreaElement>("textarea");

    if (!focusTarget) return;

    // Small delay to ensure the editor surface is mounted.
    const focusTimer = setTimeout(() => {
      focusTarget.focus();
    }, 0);

    return () => clearTimeout(focusTimer);
  }, [activeBufferId, enableInteractiveServices]);

  useEffect(() => {
    if (!isActiveSurface) return;
    setChangeHandler(onChange);
  }, [isActiveSurface, onChange, setChangeHandler]);

  const resolveModelPosition = useCallback<EditorModelPositionResolver>(
    (line, column) => editorModelPositionResolverRef.current?.(line, column) ?? null,
    [],
  );
  const handleModelPositionResolverChange = useCallback(
    (resolver: EditorModelPositionResolver | null) => {
      editorModelPositionResolverRef.current = resolver;
    },
    [],
  );
  const codeLensLinesRef = useRef<{ content: string; lines: string[] } | null>(null);
  const getCodeLensLineText = useCallback(
    (line: number) => {
      const content = getValue();
      let cached = codeLensLinesRef.current;
      if (cached?.content !== content) {
        cached = { content, lines: content.split("\n") };
        codeLensLinesRef.current = cached;
      }
      return cached.lines[line];
    },
    [getValue],
  );
  const measureCodeLensLayout = useCallback(() => {
    const container = editorRef.current;
    if (!container) return;

    setCodeLensViewportHeight(container.clientHeight);
    const containerRect = container.getBoundingClientRect();
    const contentContainer = container.querySelector<HTMLElement>(
      "[data-editor-content-container]",
    );
    if (contentContainer) {
      const contentRect = contentContainer.getBoundingClientRect();
      setCodeLensContentLeft(Math.max(0, contentRect.left - containerRect.left));
      return;
    }

    const editorContent = container.querySelector<HTMLElement>(
      '[data-editor-engine="codemirror"] .cm-content',
    );
    if (editorContent) {
      const contentRect = editorContent.getBoundingClientRect();
      setCodeLensContentLeft(Math.max(0, contentRect.left - containerRect.left));
      return;
    }

    setCodeLensContentLeft(EDITOR_CONSTANTS.EDITOR_PADDING_LEFT);
  }, []);

  useLayoutEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    measureCodeLensLayout();
    const animationFrame = requestAnimationFrame(measureCodeLensLayout);
    const resizeObserver = new ResizeObserver(measureCodeLensLayout);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [activeBufferId, measureCodeLensLayout, showToolbar, zoomedFontSize, zoomedLineHeight]);

  // Consolidated LSP document lifecycle
  useLspIntegration({
    enabled: enableRichEditorServices,
    filePath,
    getValue,
  });
  const scriptCellKind: ScriptCellKind | null = !enableInteractiveServices
    ? null
    : isPythonScriptFile(filePath)
      ? "python"
      : isRMarkdownFile(filePath)
        ? "rmarkdown"
        : null;
  const { pythonScriptCells, rMarkdownChunks } = useScriptCells(
    activeBufferId ?? null,
    scriptCellKind,
  );

  // Rename symbol support
  const rename = useRename(enableRichEditorServices ? filePath : undefined);

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
  const inlineCodeLenses = useMemo(
    () => (codeLensEnabled ? [...pythonScriptCellLenses, ...rMarkdownChunkLenses] : []),
    [codeLensEnabled, pythonScriptCellLenses, rMarkdownChunkLenses],
  );
  const showInlineCodeLenses = enableCodeLens && inlineCodeLenses.length > 0;

  useEffect(() => {
    showInlineCodeLensesRef.current = showInlineCodeLenses;
    if (!showInlineCodeLenses) return;
    setCodeLensScrollTop(editorRef.current?.querySelector(".cm-scroller")?.scrollTop ?? 0);
  }, [activeBufferId, showInlineCodeLenses]);

  const handleCodeLensExecute = useCallback(
    (lens: { title: string; command?: string; arguments?: unknown[] }) => {
      if (!filePath || !lens.command) return;

      if (lens.command === PYTHON_SCRIPT_CELL_COMMAND) {
        const cellIndex = typeof lens.arguments?.[0] === "number" ? lens.arguments[0] : -1;
        const cell = getPythonScriptCells(getValue())[cellIndex];
        if (!cell) return;

        void runPythonCell(cell.code, editorWorkingDirectory(filePath), cell.setupCode)
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
        const chunk = getRMarkdownChunks(getValue())[chunkIndex];
        if (!chunk) return;

        if (!rMarkdownChunkShouldEvaluate(chunk)) {
          onChange(clearRMarkdownChunkOutput(getValue(), chunk));
          toast.success("R chunk skipped because eval=FALSE.");
          return;
        }

        void runRCell(chunk.code, editorWorkingDirectory(filePath), chunk.setupCode)
          .then((result) => {
            const currentValue = getValue();
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
    },
    [filePath, getValue, onChange],
  );

  // Keep app-owned overlays aligned with the editor's scroll position.
  const syncLspOverlayTransform = useCallback((scrollTop: number, scrollLeft: number) => {
    const transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
    for (const ref of [codeLensRef, renameInputRef]) {
      if (ref.current) {
        ref.current.style.transform = transform;
      }
    }
    if (!showInlineCodeLensesRef.current) return;
    // The overlay renders half a viewport beyond each edge, so a quarter-viewport step keeps
    // every visible lens rendered without re-rendering on each scroll event.
    const step = (editorRef.current?.clientHeight ?? 0) / 4;
    setCodeLensScrollTop((current) => (Math.abs(current - scrollTop) < step ? current : scrollTop));
  }, []);

  // Scroll management
  useEditorScroll(editorRef, null);

  // Handle go-to-line events (from search results, diagnostics, vim, etc.)
  useEffect(() => {
    if (!isActiveSurface) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const goToLine = (lineNumber: number, columnNumber: number | undefined, focus: boolean) => {
      if (!editorRef.current) return false;

      const currentContent = getValue();
      if (!currentContent) return false;

      const target = resolveGoToLineTarget({
        content: currentContent,
        lineNumber,
        columnNumber,
        lineCount: useEditorViewStore.getState().actions.getLineCount(),
      });

      if (!activeBufferId) return false;
      const position = { line: target.line, column: target.column, offset: target.offset };
      // Moves the cursor and centers it; only a go-to-line typed in the editor takes focus.
      useEditorStateStore.getState().actions.requestNavigation({
        bufferId: activeBufferId,
        range: { start: position, end: position },
        focus,
      });

      return true;
    };

    const handleGoToLine = (request: AppEventMap["menu-go-to-line"]) => {
      const lineNumber = request.line;
      const columnNumber = request.column;
      const targetPath = request.path;
      const focus = request.focus ?? false;
      if (targetPath && targetPath !== filePath) return;
      if (!lineNumber) return;

      // Try immediately, then retry if content not ready yet
      if (!goToLine(lineNumber, columnNumber, focus)) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => goToLine(lineNumber, columnNumber, focus), 150);
      }
    };

    const unsubscribe = onAppEvent("menu-go-to-line", handleGoToLine);
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [activeBufferId, filePath, isActiveSurface]);

  if (!activeBuffer) {
    return <div className="flex flex-1 items-center justify-center text-foreground"></div>;
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

        <div className="flex min-h-0 min-w-0 flex-1">
          <div
            ref={editorRef}
            className={`editor-container relative min-h-0 min-w-0 flex-1 overflow-hidden ${className || ""}`}
            data-zoom-level={zoomLevel}
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              // Zoom is now applied via font size scaling in Editor component
              // to avoid subpixel rendering mismatches between text and positioned elements
            }}
          >
            {/* Code Lens */}
            {showInlineCodeLenses && (
              <CodeLensOverlay
                ref={codeLensRef}
                lenses={inlineCodeLenses}
                fontSize={zoomedFontSize}
                lineHeight={zoomedLineHeight}
                scrollTop={codeLensScrollTop}
                viewportHeight={codeLensViewportHeight}
                contentLeft={codeLensContentLeft}
                getLineText={getCodeLensLineText}
                onExecute={handleCodeLensExecute}
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
            <div className="absolute inset-0 bg-background">
              {showMarkdownPreview ? (
                <MarkdownPreview
                  bufferId={activeBufferId ?? undefined}
                  isActiveSurface={isActiveSurface}
                />
              ) : showHtmlPreview ? (
                <HtmlPreview />
              ) : showCsvPreview ? (
                <CsvPreview />
              ) : showSvgPreview ? (
                <SvgPreview bufferId={activeBufferId ?? undefined} />
              ) : showNotebookEditor ? (
                <NotebookEditor />
              ) : (
                <CodeMirrorEditor
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
                  onContentChange={onContentChange ? onChange : undefined}
                  onDocumentChange={onDocumentChange}
                  onScrollOffsetChange={syncLspOverlayTransform}
                  onModelPositionResolverChange={handleModelPositionResolverChange}
                />
              )}
            </div>
          </div>
          {outline && showOutlineSetting && activeBufferId ? (
            <aside
              aria-label="Outline"
              className="flex w-64 min-w-0 shrink-0 border-border border-l"
              data-slot="editor-outline"
            >
              <OutlineSidebar bufferId={activeBufferId} />
            </aside>
          ) : null}
        </div>
      </div>

      {/* Debug overlay for scroll monitoring */}
      {enableInteractiveServices && <ScrollDebugOverlay />}
    </>
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
