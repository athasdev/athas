import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { useEditorScroll } from "@/hooks/use-editor-scroll";
import { useHover } from "@/hooks/use-hover";
import { LspClient } from "@/lib/lsp/lsp-client";
import { usePersistentSettingsStore } from "@/settings/stores/persistent-settings-store";
import { useAppStore } from "@/stores/app-store";
import { useBufferStore } from "@/stores/buffer-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorSearchStore } from "@/stores/editor-search-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useLspStore } from "@/stores/lsp-store";
import FindBar from "../find-bar";
import Breadcrumb from "./breadcrumb";
import { TextEditor } from "./core/text-editor";
import { EditorStylesheet } from "./editor-stylesheet";
import { HoverTooltip } from "./overlays/hover-tooltip";

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
  const editorRef = useRef<HTMLDivElement>(null as any);

  const { setRefs, setContent, setFileInfo } = useEditorInstanceStore();
  // No longer need to sync content - editor-view-store computes from buffer
  const { setDisabled } = useEditorSettingsStore.use.actions();

  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { handleContentChange } = useAppStore.use.actions();
  const fontSize = useEditorSettingsStore.use.fontSize();
  const lineNumbers = useEditorSettingsStore.use.lineNumbers();
  const { searchQuery, searchMatches, currentMatchIndex, setSearchMatches, setCurrentMatchIndex } =
    useEditorSearchStore();
  const isFileTreeLoading = useFileSystemStore((state) => state.isFileTreeLoading);
  const { coreFeatures } = usePersistentSettingsStore();

  // Extract values from active buffer or use defaults
  const value = activeBuffer?.content || "";
  const filePath = activeBuffer?.path || "";
  const onChange = activeBuffer ? handleContentChange : () => {};

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
    console.log("Setting up LSP completion handlers, isLspSupported:", isLspSupported);
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
    fontSize,
    lineNumbers,
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
  const cursorPosition = useEditorCursorStore.use.cursorPosition();

  // Track typing speed for dynamic debouncing
  const lastTypeTimeRef = useRef<number>(Date.now());
  const typingSpeedRef = useRef<number>(500);

  // Trigger LSP completion on cursor position change
  useEffect(() => {
    if (!filePath || !editorRef.current) return;

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
    const timer = setTimeout(() => {
      lspActions.requestCompletion({
        filePath,
        cursorPos: cursorPosition.offset,
        value,
        editorRef,
      });
    }, typingSpeedRef.current);

    return () => clearTimeout(timer);
  }, [cursorPosition, filePath, value, lspActions]);

  // Scroll management
  useEditorScroll(editorRef, null);

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
    return <div className="paper-text-secondary flex flex-1 items-center justify-center"></div>;
  }

  return (
    <>
      <EditorStylesheet />
      <div className="flex h-full flex-col">
        {/* Breadcrumbs */}
        {coreFeatures.breadcrumbs && <Breadcrumb />}

        {/* Find Bar */}
        <FindBar />

        <div
          ref={editorRef}
          className={`editor-container relative flex-1 overflow-hidden ${className || ""}`}
        >
          {/* Hover Tooltip */}
          <HoverTooltip />

          {/* Main editor layout */}
          <div className="flex h-full">
            {/* Editor content area */}
            <div className="editor-wrapper relative flex-1 overflow-hidden">
              <div className="relative h-full flex-1 bg-primary-bg">
                <TextEditor />
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
