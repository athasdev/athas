import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useEditorCompletionStore } from "@/features/editor/completion/completion-store";
import FindBar from "@/features/editor/components/find-bar";
import { useEditorScroll } from "@/features/editor/hooks/use-scroll";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useHover } from "@/features/editor/lsp/use-hover";
import { useEditorSearchStore } from "@/features/editor/search/search-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useGitGutter } from "@/features/version-control/git/controllers/use-git-gutter";
import { useAppStore } from "@/stores/app-store";
import { useZoomStore } from "@/stores/zoom-store";
import { HoverTooltip } from "../lsp/hover-tooltip";
import Breadcrumb from "./breadcrumb";
import { MarkdownPreview } from "./markdown-preview";
import { EditorStylesheet } from "./stylesheet";
import { TextEditor } from "./text-editor";

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

const CodeEditor = ({ className }: CodeEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const { setRefs, setContent, setFileInfo } = useEditorStateStore.use.actions();
  // No longer need to sync content - editor-view-store computes from buffer
  const { setDisabled } = useEditorSettingsStore.use.actions();
  const isMarkdownPreview = useEditorSettingsStore.use.isMarkdownPreview();

  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { handleContentChange } = useAppStore.use.actions();
  const searchQuery = useEditorSearchStore.use.searchQuery();
  const searchMatches = useEditorSearchStore.use.searchMatches();
  const currentMatchIndex = useEditorSearchStore.use.currentMatchIndex();
  const { setSearchMatches, setCurrentMatchIndex } = useEditorSearchStore.use.actions();
  const isFileTreeLoading = useFileSystemStore((state) => state.isFileTreeLoading);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const { settings } = useSettingsStore();

  // Extract values from active buffer or use defaults
  const value = activeBuffer?.content || "";
  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer ? handleContentChange : () => {};

  // Check if the current file is markdown
  const isMarkdownFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "md" || extension === "markdown";
  };

  const showMarkdownPreview = isMarkdownFile() && isMarkdownPreview;

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

  // Get LSP client instance
  const lspClient = useMemo(() => LspClient.getInstance(), []);

  // Check if current file is supported by LSP (synchronously for now)
  const isLspSupported = useMemo(() => {
    if (!filePath) return false;
    const ext = filePath.split(".").pop()?.toLowerCase();
    return ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx";
  }, [filePath]);

  // LSP store actions
  const lspActions = useLspStore.use.actions();

  // Set up LSP completion handlers
  useEffect(() => {
    lspActions.setCompletionHandlers(
      lspClient.getCompletions.bind(lspClient),
      () => isLspSupported,
    );
  }, [lspClient, isLspSupported, lspActions]);

  // Hover hook - prepare for future use
  useHover({
    getHover: lspClient.getHover.bind(lspClient),
    isLanguageSupported: () => isLspSupported,
    filePath,
    fontSize: settings.fontSize,
    lineNumbers: settings.lineNumbers,
  });

  // Notify LSP about document changes
  useEffect(() => {
    if (!filePath || !activeBuffer) return;

    // Document open
    lspClient.notifyDocumentOpen(filePath, value).catch(console.error);

    return () => {
      // Document close
      lspClient.notifyDocumentClose(filePath).catch(console.error);
    };
  }, [filePath, lspClient]);

  // Notify LSP about content changes
  useEffect(() => {
    if (!filePath || !activeBuffer) return;

    lspClient.notifyDocumentChange(filePath, value, 1).catch(console.error);
  }, [value, filePath, activeBuffer, lspClient]);

  // Get cursor position
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  // Track typing speed for dynamic debouncing
  const lastTypeTimeRef = useRef<number>(Date.now());
  const typingSpeedRef = useRef<number>(500);
  const isApplyingCompletion = useEditorCompletionStore.use.isApplyingCompletion();
  const timer = useRef<NodeJS.Timeout>(undefined);

  // Trigger LSP completion on cursor position change
  useEffect(() => {
    if (!filePath || !editorRef.current || isApplyingCompletion) {
      timer.current && clearTimeout(timer.current);
      return;
    }

    // Calculate typing speed
    const now = Date.now();
    const timeSinceLastType = now - lastTypeTimeRef.current;
    lastTypeTimeRef.current = now;

    // Adjust debounce based on typing speed
    if (timeSinceLastType < 100) {
      // Fast typing - increase debounce
      typingSpeedRef.current = Math.min(800, typingSpeedRef.current + 50);
    } else if (timeSinceLastType > 500) {
      // Slow typing - decrease debounce
      typingSpeedRef.current = Math.max(300, typingSpeedRef.current - 50);
    }

    // Debounce completion trigger with dynamic delay
    timer.current = setTimeout(() => {
      lspActions.requestCompletion({
        filePath,
        cursorPos: cursorPosition.offset,
        value,
        editorRef,
      });
    }, typingSpeedRef.current);

    return () => clearTimeout(timer.current);
  }, [cursorPosition, filePath, value, lspActions, isApplyingCompletion]);

  // Scroll management
  useEditorScroll(editorRef, null);

  // Git gutter integration with optimized updates
  useGitGutter({
    filePath,
    content: value,
    enabled: !!filePath && !!rootFolderPath,
  });

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim() || !value) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

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
      <div className="flex h-full flex-col">
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
                {showMarkdownPreview ? <MarkdownPreview /> : <TextEditor />}
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
