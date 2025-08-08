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
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorSearchStore } from "@/stores/editor-search-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useLspStore } from "@/stores/lsp-store";
import { getFileDiff } from "@/utils/git";
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
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
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

  // Git gutter change indicators
  const gitDecorationIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const applyGitGutterDecorations = async () => {
      const decorationsStore = useEditorDecorationsStore.getState();
      // Clear any existing git decorations
      gitDecorationIdsRef.current.forEach((id) => decorationsStore.removeDecoration(id));
      gitDecorationIdsRef.current = [];

      // Only apply for real files with a project root
      if (!filePath || !rootFolderPath) return;
      if (filePath.startsWith("diff://")) return;

      try {
        // Convert absolute file path to path relative to repo root for git diff
        let relativePath = filePath;
        if (relativePath.startsWith(rootFolderPath)) {
          relativePath = relativePath.slice(rootFolderPath.length);
          if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
        }

        const diff = await getFileDiff(rootFolderPath, relativePath, false);
        if (!diff || (diff as any).is_binary || (diff as any).is_image) {
          console.log("Git gutter: No diff data or binary file for", relativePath);
          return;
        }

        console.log(
          "Git gutter: Processing diff for",
          relativePath,
          "with",
          (diff as any).lines.length,
          "lines",
        );

        // Track line changes with better logic
        const addedLines = new Set<number>();
        const modifiedLines = new Set<number>();
        const deletedLines = new Map<number, number>(); // Maps line number to count of deleted lines

        let i = 0;
        while (i < (diff as any).lines.length) {
          const line = (diff as any).lines[i];

          if (line.line_type === "removed") {
            // Start of a deletion group
            let deletedCount = 0;
            let j = i;

            // Count consecutive deletions
            while (
              j < (diff as any).lines.length &&
              (diff as any).lines[j].line_type === "removed"
            ) {
              deletedCount++;
              j++;
            }

            // Check if followed by additions (modification) or just deletions
            let addedCount = 0;
            let k = j;
            while (k < (diff as any).lines.length && (diff as any).lines[k].line_type === "added") {
              addedCount++;
              k++;
            }

            if (addedCount > 0) {
              // This is a modification - deletions followed by additions
              const startLine = (diff as any).lines[j]?.new_line_number;
              if (typeof startLine === "number") {
                for (let m = 0; m < Math.min(deletedCount, addedCount); m++) {
                  modifiedLines.add(startLine - 1 + m);
                }
                // Any extra additions are new lines
                for (let m = Math.min(deletedCount, addedCount); m < addedCount; m++) {
                  addedLines.add(startLine - 1 + m);
                }
                // Any extra deletions show as deleted markers
                if (deletedCount > addedCount) {
                  const deletedLine = startLine - 1 + addedCount;
                  deletedLines.set(deletedLine, deletedCount - addedCount);
                }
              }
              i = k; // Skip processed additions
            } else {
              // Pure deletion - show deleted marker at the next available line
              const nextLine = (diff as any).lines[j];
              const deletedAtLine = nextLine?.new_line_number
                ? nextLine.new_line_number - 1
                : Math.max(0, ((diff as any).lines[i]?.old_line_number || 1) - 1);
              deletedLines.set(deletedAtLine, deletedCount);
              i = j;
            }
          } else if (line.line_type === "added") {
            // Pure addition - not part of a modification
            if (typeof line.new_line_number === "number") {
              addedLines.add(line.new_line_number - 1);
            }
            i++;
          } else {
            i++;
          }
        }

        const addMarker = (lineNumber: number, className: string, content: string = " ") => {
          const id = decorationsStore.addDecoration({
            type: "gutter",
            className,
            content,
            range: {
              start: { line: lineNumber, column: 0, offset: 0 },
              end: { line: lineNumber, column: 0, offset: 0 },
            },
          });
          gitDecorationIdsRef.current.push(id);
        };

        // Apply markers
        addedLines.forEach((ln) => addMarker(ln, "git-gutter-added"));
        modifiedLines.forEach((ln) => addMarker(ln, "git-gutter-modified"));
        deletedLines.forEach((deletedCount, ln) => {
          // Show a marker indicating deleted lines
          addMarker(ln, "git-gutter-deleted", `−${deletedCount > 1 ? deletedCount : ""}`);
        });

        console.log(
          "Git gutter: Applied",
          addedLines.size,
          "added,",
          modifiedLines.size,
          "modified,",
          deletedLines.size,
          "deleted markers",
        );
      } catch (error) {
        console.error("Failed to apply git gutter decorations for", filePath, ":", error);
        // Clear any partial decorations on error
        gitDecorationIdsRef.current.forEach((id) => decorationsStore.removeDecoration(id));
        gitDecorationIdsRef.current = [];
      }
    };

    applyGitGutterDecorations();

    // Cleanup on unmount or when dependencies change
    return () => {
      const decorationsStore = useEditorDecorationsStore.getState();
      gitDecorationIdsRef.current.forEach((id) => decorationsStore.removeDecoration(id));
      gitDecorationIdsRef.current = [];
    };
  }, [filePath, rootFolderPath, value]);

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
