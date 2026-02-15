import type React from "react";
import { useEffect, useRef } from "react";
import { CsvPreview } from "@/extensions/viewers/csv/csv-preview";
import { useLspIntegration } from "@/features/editor/hooks/use-lsp-integration";
import { useEditorScroll } from "@/features/editor/hooks/use-scroll";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { buildSearchRegex, findAllMatches } from "@/features/editor/utils/search";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useAppStore } from "@/stores/app-store";
import { useZoomStore } from "@/stores/zoom-store";
import { CompletionDropdown } from "../completion/completion-dropdown";
import { HoverTooltip } from "../lsp/hover-tooltip";
import { MarkdownPreview } from "../markdown/markdown-preview";
import { ScrollDebugOverlay } from "./debug/scroll-debug-overlay";
import { Editor } from "./editor";
import { HtmlPreview } from "./html/html-preview";
import { EditorStylesheet } from "./stylesheet";
import Breadcrumb from "./toolbar/breadcrumb";
import FindBar from "./toolbar/find-bar";

interface CodeEditorProps {
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  paneId?: string;
  bufferId?: string;
}

export interface CodeEditorRef {
  editor: HTMLDivElement | null;
  textarea: HTMLDivElement | null;
}

interface GoToLineEventDetail {
  line?: number;
  path?: string;
}

const SEARCH_DEBOUNCE_MS = 300; // Debounce search regex matching

const CodeEditor = ({ className, bufferId: propBufferId }: CodeEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { setRefs, setContent, setFileInfo } = useEditorStateStore.use.actions();
  const { setDisabled } = useEditorSettingsStore.use.actions();

  const buffers = useBufferStore.use.buffers();
  const globalActiveBufferId = useBufferStore.use.activeBufferId();
  const activeBufferId = propBufferId ?? globalActiveBufferId;
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { handleContentChange } = useAppStore.use.actions();
  const searchQuery = useEditorUIStore.use.searchQuery();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const searchOptions = useEditorUIStore.use.searchOptions();
  const { setSearchMatches, setCurrentMatchIndex } = useEditorUIStore.use.actions();
  const isFileTreeLoading = useFileSystemStore((state) => state.isFileTreeLoading);
  const { settings } = useSettingsStore();

  // Apply zoom to font size for position calculations (must match editor.tsx)
  const zoomedFontSize = settings.fontSize * zoomLevel;

  // Extract values from active buffer or use defaults
  const value = activeBuffer?.content || "";
  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer ? handleContentChange : () => {};

  const showMarkdownPreview = activeBuffer?.isMarkdownPreview || false;
  const showHtmlPreview = activeBuffer?.isHtmlPreview || false;
  const showCsvPreview = activeBuffer?.isCsvPreview || false;

  // Initialize refs in store
  useEffect(() => {
    setRefs({
      editorRef,
    });
  }, [setRefs]);

  // Focus editor when active buffer changes
  useEffect(() => {
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
  }, [activeBufferId]);

  // Sync content and file info with editor instance store
  useEffect(() => {
    setContent(value, onChange);
  }, [value, onChange, setContent]);

  useEffect(() => {
    setFileInfo(filePath);
  }, [filePath, setFileInfo]);

  // Ensure syntax highlighter knows the current file path immediately on change
  useEffect(() => {
    if (!filePath) return;
    // Lazy import to avoid loading the extension module until needed
    import("@/features/editor/extensions/builtin/syntax-highlighting")
      .then((mod) => mod.setSyntaxHighlightingFilePath(filePath))
      .catch(() => {});
  }, [filePath]);

  // Editor view store automatically syncs with active buffer

  // Set disabled state
  useEffect(() => {
    setDisabled(false);
  }, [setDisabled]);

  // Get cursor position for LSP integration
  const cursorPosition = useEditorStateStore.use.cursorPosition();

  // Consolidated LSP integration (document lifecycle, completions, hover, go-to-definition)
  const { hoverHandlers, goToDefinitionHandlers, definitionLinkHandlers } = useLspIntegration({
    filePath,
    value,
    cursorPosition,
    editorRef,
    fontSize: zoomedFontSize,
  });

  // Combine mouse move handlers for hover and definition link
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    hoverHandlers.handleHover(e);
    definitionLinkHandlers.handleMouseMove(e);
  };

  // Combine mouse leave handlers
  const handleMouseLeave = () => {
    hoverHandlers.handleMouseLeave();
    definitionLinkHandlers.handleMouseLeave();
  };

  // Scroll management
  useEditorScroll(editorRef, null);

  // Handle go-to-line events (from search results, diagnostics, vim, etc.)
  useEffect(() => {
    const goToLine = (lineNumber: number) => {
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

      // Calculate character offset for the target line
      let offset = 0;
      for (let i = 0; i < targetLine; i++) {
        offset += lines[i].length + 1;
      }

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
        column: 0,
        offset: offset,
      });

      return true;
    };

    const handleGoToLine = (event: CustomEvent<GoToLineEventDetail>) => {
      const lineNumber = event.detail?.line;
      const targetPath = event.detail?.path;
      if (targetPath && targetPath !== filePath) return;
      if (!lineNumber) return;

      // Try immediately, then retry if content not ready yet
      if (!goToLine(lineNumber)) {
        setTimeout(() => goToLine(lineNumber), 150);
      }
    };

    window.addEventListener("menu-go-to-line", handleGoToLine as EventListener);
    return () => {
      window.removeEventListener("menu-go-to-line", handleGoToLine as EventListener);
    };
  }, [filePath]);

  // Search functionality with debouncing to prevent lag on large files
  useEffect(() => {
    // Clear existing timer
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
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
  }, [searchQuery, searchOptions, value, setSearchMatches, setCurrentMatchIndex]);

  // Effect to handle search navigation - scroll to current match and move cursor
  useEffect(() => {
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
  }, [currentMatchIndex, searchMatches, value, zoomedFontSize]);

  if (!activeBuffer || isFileTreeLoading) {
    return <div className="flex flex-1 items-center justify-center text-text"></div>;
  }

  return (
    <>
      <EditorStylesheet />
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {/* Breadcrumbs */}
        {settings.coreFeatures.breadcrumbs && <Breadcrumb />}

        {/* Find Bar */}
        <FindBar />

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
          <HoverTooltip />

          {/* Completion Dropdown */}
          <CompletionDropdown />

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
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseEnter={hoverHandlers.handleMouseEnter}
                onClick={goToDefinitionHandlers.handleClick}
              />
            )}
          </div>
        </div>
      </div>

      {/* Debug overlay for scroll monitoring */}
      <ScrollDebugOverlay />
    </>
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
