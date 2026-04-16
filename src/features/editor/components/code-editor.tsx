import type React from "react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { CsvPreview } from "@/extensions/viewers/csv/csv-preview";
import { useLspIntegration } from "@/features/editor/hooks/use-lsp-integration";
import { useEditorScroll } from "@/features/editor/hooks/use-scroll";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { buildSearchRegex, findAllMatches } from "@/features/editor/utils/search";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { CompletionDropdown } from "../completion/completion-dropdown";
import CodeLensOverlay from "../lsp/code-lens-overlay";
import { HoverTooltip } from "../lsp/hover-tooltip";
import InlayHintsOverlay from "../lsp/inlay-hints-overlay";
import RenameInput from "../lsp/rename-input";
import { SignatureHelpTooltip } from "../lsp/signature-help-tooltip";
import { useCodeLens } from "../lsp/use-code-lens";
import { useInlayHints } from "../lsp/use-inlay-hints";
import { useRename } from "../lsp/use-rename";
import { MarkdownPreview } from "../markdown/markdown-preview";
import { ScrollDebugOverlay } from "./debug/scroll-debug-overlay";
import { Editor } from "./editor";
import { HtmlPreview } from "./html/html-preview";
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

const CodeEditor = ({
  className,
  bufferId: propBufferId,
  isActiveSurface = true,
  showToolbar = true,
  readOnly = false,
  breadcrumbProps,
  scrollable = true,
  backgroundLayer,
  onReadonlySurfaceClick,
}: CodeEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const codeLensRef = useRef<HTMLDivElement>(null);
  const inlayHintsRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLDivElement>(null);
  const lspScrollRafRef = useRef<number | null>(null);
  const { setRefs, setContent, setFileInfo } = useEditorStateStore.use.actions();
  const { setDisabled } = useEditorSettingsStore.use.actions();

  const buffers = useBufferStore.use.buffers();
  const globalActiveBufferId = useBufferStore.use.activeBufferId();
  const activeBufferId = propBufferId ?? globalActiveBufferId;
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { handleContentChange } = useEditorAppStore.use.actions();
  const searchQuery = useEditorUIStore.use.searchQuery();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const searchOptions = useEditorUIStore.use.searchOptions();
  const { setSearchMatches, setCurrentMatchIndex } = useEditorUIStore.use.actions();
  const { settings } = useSettingsStore();
  const isFindVisible = useUIState((state) => state.isFindVisible);

  // Apply zoom to font size for position calculations (must match editor.tsx)
  const zoomedFontSize = settings.fontSize * zoomLevel;

  // Extract values from active buffer or use defaults
  const value = activeBuffer && hasTextContent(activeBuffer) ? activeBuffer.content : "";
  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer ? handleContentChange : () => {};
  const isPreviewBuffer = activeBuffer?.isPreview ?? false;
  const enableInteractiveServices = isActiveSurface && !isPreviewBuffer && !readOnly;

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

  // Focus editor when active buffer changes
  useEffect(() => {
    if (!enableInteractiveServices) return;
    if (activeBufferId && editorRef.current) {
      // Find the textarea element within the editor
      const textarea = editorRef.current.querySelector("textarea");
      if (textarea) {
        // Small delay to ensure content is loaded
        setTimeout(() => {
          textarea.focus();
        }, 0);
      }
    }
  }, [activeBufferId, enableInteractiveServices]);

  // Sync content and file info with editor instance store
  useEffect(() => {
    if (!isActiveSurface) return;
    setContent(value, onChange);
  }, [isActiveSurface, value, onChange, setContent]);

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

  // Get cursor position for LSP integration
  const cursorPosition = useEditorStateStore.use.cursorPosition();

  // Consolidated LSP integration (document lifecycle, completions, hover, go-to-definition)
  const { hoverHandlers, goToDefinitionHandlers, definitionLinkHandlers } = useLspIntegration({
    enabled: enableInteractiveServices,
    filePath,
    value,
    cursorPosition,
    editorRef,
    fontSize: zoomedFontSize,
  });

  // Rename symbol support
  const rename = useRename(enableInteractiveServices ? filePath : undefined);

  // Inlay hints
  const inlayHints = useInlayHints(
    enableInteractiveServices ? filePath : undefined,
    enableInteractiveServices,
  );

  // Code lens
  const codeLenses = useCodeLens(
    enableInteractiveServices ? filePath : undefined,
    enableInteractiveServices,
  );

  // Sync LSP overlay containers with textarea scroll via RAF (matches highlight layer timing)
  const syncLspOverlayTransform = useCallback((scrollTop: number, scrollLeft: number) => {
    const transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
    for (const ref of [codeLensRef, inlayHintsRef, renameInputRef]) {
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
        lspScrollRafRef.current = null;
      });
    };

    textarea.addEventListener("scroll", handleScroll, { passive: true });
    // Sync initial position
    syncLspOverlayTransform(textarea.scrollTop, textarea.scrollLeft);

    return () => {
      textarea.removeEventListener("scroll", handleScroll);
      if (lspScrollRafRef.current !== null) {
        cancelAnimationFrame(lspScrollRafRef.current);
        lspScrollRafRef.current = null;
      }
    };
  }, [syncLspOverlayTransform]);

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

      const textarea = editorRef.current.querySelector("textarea");
      if (!textarea) return false;

      const currentContent = textarea.value;
      if (!currentContent) return false;

      const { fontSize } = useEditorSettingsStore.getState();
      const lineHeight = Math.ceil(fontSize * 1.4); // Must match calculateLineHeight()
      const lines = currentContent.split("\n");

      // Convert to 0-indexed line number and clamp to valid range
      const targetLine = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));

      const targetColumn = Math.max(
        0,
        Math.min((columnNumber ?? 1) - 1, lines[targetLine]?.length ?? 0),
      );

      // Calculate character offset for the target line
      let offset = 0;
      for (let i = 0; i < targetLine; i++) {
        offset += lines[i].length + 1;
      }
      offset += targetColumn;

      // Set cursor position in textarea
      textarea.selectionStart = offset;
      textarea.selectionEnd = offset;
      textarea.focus();

      // Calculate scroll position to CENTER the line in the viewport
      const lineTop = targetLine * lineHeight;
      const viewportHeight = textarea.clientHeight;
      const centeredScrollTop = Math.max(0, lineTop - viewportHeight / 2 + lineHeight / 2);

      textarea.scrollTop = centeredScrollTop;

      // Update cursor position in store
      const { setCursorPosition } = useEditorStateStore.getState().actions;
      setCursorPosition({
        line: targetLine,
        column: targetColumn,
        offset: offset,
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
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    // Clear matches immediately if no query
    if (!searchQuery.trim() || !value) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    // Debounce the expensive regex matching
    searchTimerRef.current = setTimeout(() => {
      const regex = buildSearchRegex(searchQuery, searchOptions);
      if (!regex) {
        setSearchMatches([]);
        setCurrentMatchIndex(-1);
        return;
      }

      const matches = findAllMatches(value, regex);
      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
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
    setSearchMatches,
    setCurrentMatchIndex,
  ]);

  // Effect to handle search navigation - scroll to current match and move cursor
  useEffect(() => {
    if (!enableInteractiveServices) return;
    if (searchMatches.length > 0 && currentMatchIndex >= 0) {
      const match = searchMatches[currentMatchIndex];
      if (match && editorRef.current) {
        const textarea = editorRef.current.querySelector("textarea") as HTMLTextAreaElement;
        if (textarea) {
          // Move cursor to select the match
          textarea.selectionStart = match.start;
          textarea.selectionEnd = match.end;

          // Convert match offset to line number
          let line = 0;
          for (let i = 0; i < match.start && i < value.length; i++) {
            if (value[i] === "\n") line++;
          }

          // Calculate scroll position to center the match in viewport
          const lineHeight = calculateLineHeight(zoomedFontSize);
          const targetScrollTop = line * lineHeight;
          const viewportHeight = textarea.clientHeight;
          const centeredScrollTop = Math.max(0, targetScrollTop - viewportHeight / 2 + lineHeight);

          textarea.scrollTop = centeredScrollTop;
        }
      }
    }
  }, [currentMatchIndex, enableInteractiveServices, searchMatches, value, zoomedFontSize]);

  if (!activeBuffer) {
    return <div className="flex flex-1 items-center justify-center text-text"></div>;
  }

  return (
    <>
      <EditorStylesheet />
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {/* Breadcrumbs */}
        {showToolbar && <Breadcrumb {...breadcrumbProps} />}

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
          {enableInteractiveServices && <HoverTooltip />}

          {/* Completion Dropdown */}
          {enableInteractiveServices && <CompletionDropdown />}

          {/* Code Lens */}
          {enableInteractiveServices && codeLenses.length > 0 && (
            <CodeLensOverlay
              ref={codeLensRef}
              lenses={codeLenses}
              fontSize={zoomedFontSize}
              scrollTop={editorRef.current?.querySelector("textarea")?.scrollTop ?? 0}
              viewportHeight={editorRef.current?.clientHeight ?? 600}
            />
          )}

          {/* Inlay Hints */}
          {enableInteractiveServices && inlayHints.length > 0 && (
            <InlayHintsOverlay
              ref={inlayHintsRef}
              hints={inlayHints}
              fontSize={zoomedFontSize}
              charWidth={zoomedFontSize * 0.6}
              scrollTop={editorRef.current?.querySelector("textarea")?.scrollTop ?? 0}
              viewportHeight={editorRef.current?.clientHeight ?? 600}
            />
          )}

          {/* Signature Help */}
          {enableInteractiveServices && <SignatureHelpTooltip />}

          {/* Rename Input */}
          {enableInteractiveServices && rename.renameState && (
            <RenameInput
              ref={renameInputRef}
              symbol={rename.renameState.symbol}
              line={rename.renameState.line}
              column={rename.renameState.column}
              fontSize={zoomedFontSize}
              charWidth={zoomedFontSize * 0.6}
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
            ) : (
              <Editor
                bufferId={activeBufferId ?? undefined}
                isActiveSurface={isActiveSurface}
                isPreviewMode={isPreviewBuffer}
                readOnly={readOnly}
                scrollable={scrollable}
                backgroundLayer={backgroundLayer}
                onReadonlySurfaceClick={onReadonlySurfaceClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseEnter={
                  enableInteractiveServices ? hoverHandlers.handleMouseEnter : undefined
                }
                onClick={enableInteractiveServices ? goToDefinitionHandlers.handleClick : undefined}
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
