import type React from "react";
import { useEffect, useRef } from "react";
import { useLspIntegration } from "@/features/editor/hooks/use-lsp-integration";
import { useEditorScroll } from "@/features/editor/hooks/use-scroll";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useGitGutter } from "@/features/version-control/git/controllers/use-git-gutter";
import { useAppStore } from "@/stores/app-store";
import { useZoomStore } from "@/stores/zoom-store";
import { HoverTooltip } from "../lsp/hover-tooltip";
import { MarkdownPreview } from "../markdown/markdown-preview";
import { Editor } from "./editor";
import { EditorStylesheet } from "./stylesheet";
import Breadcrumb from "./toolbar/breadcrumb";
import FindBar from "./toolbar/find-bar";

interface CodeEditorProps {
  // All props are now optional as we get most data from stores
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCursorPositionChange?: (position: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export interface CodeEditorRef {
  editor: HTMLDivElement | null;
  textarea: HTMLDivElement | null;
}

const SEARCH_DEBOUNCE_MS = 300; // Debounce search regex matching

const CodeEditor = ({ className }: CodeEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { setRefs, setContent, setFileInfo } = useEditorStateStore.use.actions();
  // No longer need to sync content - editor-view-store computes from buffer
  const { setDisabled } = useEditorSettingsStore.use.actions();

  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { handleContentChange } = useAppStore.use.actions();
  const searchQuery = useEditorUIStore.use.searchQuery();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const { setSearchMatches, setCurrentMatchIndex } = useEditorUIStore.use.actions();
  const isFileTreeLoading = useFileSystemStore((state) => state.isFileTreeLoading);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const { settings } = useSettingsStore();

  // Extract values from active buffer or use defaults
  const value = activeBuffer?.content || "";
  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer ? handleContentChange : () => {};

  const showMarkdownPreview = activeBuffer?.isMarkdownPreview || false;

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

  // Consolidated LSP integration (document lifecycle, completions, hover)
  useLspIntegration({
    filePath,
    value,
    cursorPosition,
    editorRef,
    fontSize: settings.fontSize,
    lineNumbers: settings.lineNumbers,
  });

  // Scroll management
  useEditorScroll(editorRef, null);

  // Git gutter integration with optimized updates
  useGitGutter({
    filePath,
    content: value,
    enabled: !!filePath && !!rootFolderPath,
  });

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
      const matches: { start: number; end: number }[] = [];
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      let match: RegExpExecArray | null;

      match = regex.exec(value);
      while (match !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
        });
        // Prevent infinite loop on zero-width matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
        match = regex.exec(value);
      }

      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery, value, setSearchMatches, setCurrentMatchIndex]);

  // Effect to handle search navigation
  useEffect(() => {
    if (searchMatches.length > 0 && currentMatchIndex >= 0) {
      const match = searchMatches[currentMatchIndex];
      if (match) {
        // Scroll to position
        if (editorRef.current) {
          const editor = editorRef.current;
          const textarea = editor.querySelector('[contenteditable="true"]') as HTMLDivElement;
          if (textarea) {
            textarea.focus();
            // Implement scroll to cursor position
          }
        }
      }
    }
  }, [currentMatchIndex, searchMatches]);

  // Cleanup effect removed - mountedRef was not being used

  // Early return if no active buffer or file tree is loading - must be after all hooks
  if (!activeBuffer || isFileTreeLoading) {
    return <div className="flex flex-1 items-center justify-center text-text"></div>;
  }

  return (
    <>
      <EditorStylesheet />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Breadcrumbs */}
        {settings.coreFeatures.breadcrumbs && <Breadcrumb />}

        {/* Find Bar */}
        <FindBar />

        <div
          ref={editorRef}
          className={`editor-container relative flex-1 overflow-hidden ${className || ""}`}
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            transform: `scale(${zoomLevel})`,
            transformOrigin: "top left",
            width: `${100 / zoomLevel}%`,
            height: `${100 / zoomLevel}%`,
          }}
        >
          {/* Hover Tooltip */}
          <HoverTooltip />

          {/* Main editor layout */}
          <div className="flex h-full">
            {/* Editor content area */}
            <div className="editor-wrapper relative flex-1 overflow-hidden">
              <div className="relative h-full flex-1 bg-primary-bg">
                {showMarkdownPreview ? <MarkdownPreview /> : <Editor />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
