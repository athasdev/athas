import type React from "react";
import { useEffect, useRef } from "react";
import { useEditorScroll } from "../../hooks/use-editor-scroll";
import { useHover } from "../../hooks/use-hover";
import { useLspCompletion } from "../../hooks/use-lsp-completion";
import { usePersistentSettingsStore } from "../../settings/stores/persistent-settings-store";
import { useAppStore } from "../../stores/app-store";
import { useBufferStore } from "../../stores/buffer-store";
import { useEditorContentStore } from "../../stores/editor-content-store";
import { useEditorInstanceStore } from "../../stores/editor-instance-store";
import { useEditorSearchStore } from "../../stores/editor-search-store";
import { useEditorSettingsStore } from "../../stores/editor-settings-store";
import { useFileSystemStore } from "../../stores/file-system/store";
import FindBar from "../find-bar";
import Breadcrumb from "./breadcrumb";
import { TextEditor } from "./core/text-editor";
import { EditorStylesheet } from "./editor-stylesheet";
import { CompletionDropdown } from "./overlays/completion-dropdown";
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
  const { setContent: setValue } = useEditorContentStore.use.actions();
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

  // Sync content to editor content store when active buffer changes
  useEffect(() => {
    setValue(value);
  }, [value, setValue]);

  // Set disabled state
  useEffect(() => {
    setDisabled(false);
  }, [setDisabled]);

  // LSP completion hook - pass undefined for now as LSP functions come from parent
  useLspCompletion({
    getCompletions: undefined,
    isLanguageSupported: () => false,
    filePath,
    value,
    fontSize,
    lineNumbers,
  });

  // Hover hook - pass undefined for now as LSP functions come from parent
  useHover({
    getHover: undefined,
    isLanguageSupported: () => false,
    filePath,
    fontSize,
    lineNumbers,
  });

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

              {/* LSP Completion Dropdown - temporarily disabled */}
              <CompletionDropdown />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
