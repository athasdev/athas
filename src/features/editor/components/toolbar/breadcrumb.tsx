import { ArrowLeft, ArrowRight, ChevronRight, Eye, Search, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { EditorStatusActions } from "@/features/editor/components/toolbar/editor-status-actions";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useJumpListStore } from "@/features/editor/stores/jump-list-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { navigateToJumpEntry } from "@/features/editor/utils/jump-navigation";
import { logger } from "@/features/editor/utils/logger";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { readDirectory } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar-store";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { buttonClassName } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { isMac } from "@/utils/platform";

interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export default function Breadcrumb() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { rootFolderPath, handleFileSelect } = useFileSystemStore();
  const { isFindVisible, setIsFindVisible } = useUIState();
  const inlineEditActions = useInlineEditToolbarStore.use.actions();

  const jumpListActions = useJumpListStore.use.actions();
  const canGoBack = jumpListActions.canGoBack();
  const canGoForward = jumpListActions.canGoForward();
  const inlineEditShortcutLabel = isMac() ? "Cmd+I" : "Ctrl+I";

  const handleJumpBack = async () => {
    const bufferStore = useBufferStore.getState();
    const editorState = useEditorStateStore.getState();
    const activeBufferId = bufferStore.activeBufferId;
    const activeBuffer = bufferStore.buffers.find((b) => b.id === activeBufferId);

    const currentPosition =
      activeBufferId && activeBuffer?.path
        ? {
            bufferId: activeBufferId,
            filePath: activeBuffer.path,
            line: editorState.cursorPosition.line,
            column: editorState.cursorPosition.column,
            offset: editorState.cursorPosition.offset,
            scrollTop: editorState.scrollTop,
            scrollLeft: editorState.scrollLeft,
          }
        : undefined;

    const entry = jumpListActions.goBack(currentPosition);
    if (entry) {
      await navigateToJumpEntry(entry);
    }
  };

  const handleJumpForward = async () => {
    const entry = jumpListActions.goForward();
    if (entry) {
      await navigateToJumpEntry(entry);
    }
  };

  const handleNavigate = async (path: string) => {
    try {
      await handleFileSelect(path, false);
    } catch (error) {
      logger.error("Editor", "Failed to navigate to path:", path, error);
    }
  };

  const handleSearchClick = () => {
    setIsFindVisible(!isFindVisible);
  };

  const handleInlineEditClick = () => {
    inlineEditActions.show();
  };

  const inlineEditTooltip = `AI inline edit (${inlineEditShortcutLabel})`;

  const isMarkdownFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "md" || extension === "markdown";
  };

  const isHtmlFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "html" || extension === "htm";
  };

  const isCsvFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "csv";
  };

  const handlePreviewClick = () => {
    if (
      !activeBuffer ||
      activeBuffer.type === "markdownPreview" ||
      activeBuffer.type === "htmlPreview" ||
      activeBuffer.type === "csvPreview"
    )
      return;

    const { openBuffer } = useBufferStore.getState().actions;
    const previewPath = `${activeBuffer.path}:preview`;
    const previewName = `${activeBuffer.name} (Preview)`;

    const isMarkdown = isMarkdownFile();
    const isHtml = isHtmlFile();
    const isCsv = isCsvFile();

    const bufferContent = hasTextContent(activeBuffer) ? activeBuffer.content : "";

    openBuffer(
      previewPath,
      previewName,
      bufferContent,
      false, // isImage
      undefined, // databaseType
      false, // isDiff
      true, // isVirtual
      undefined, // diffData
      isMarkdown, // isMarkdownPreview
      isHtml, // isHtmlPreview
      isCsv, // isCsvPreview
      activeBuffer.path, // sourceFilePath
    );
  };

  const filePath = activeBuffer?.path || "";
  const rootPath = rootFolderPath;
  const onNavigate = handleNavigate;
  const onSearchClick = handleSearchClick;
  const [dropdown, setDropdown] = useState<{
    segmentIndex: number;
    x: number;
    y: number;
    items: FileEntry[];
    currentPath: string;
    navigationStack: string[];
  } | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const getPathSegments = () => {
    if (!filePath) return [];

    if (filePath.startsWith("remote://")) {
      const pathWithoutRemote = filePath.replace(/^remote:\/\/[^/]+/, "");
      return pathWithoutRemote.split("/").filter(Boolean);
    }

    if (filePath.includes("://")) {
      return [filePath.split("://")[1] || filePath];
    }

    if (rootPath && filePath.startsWith(rootPath)) {
      const relativePath = filePath.slice(rootPath.length);
      return relativePath.split("/").filter(Boolean);
    }

    return filePath.split("/").filter(Boolean);
  };

  const segments = getPathSegments();

  const handleGoBack = async () => {
    if (!dropdown || dropdown.navigationStack.length === 0) return;

    const previousPath = dropdown.navigationStack[dropdown.navigationStack.length - 1];
    try {
      const entries = await readDirectory(previousPath);
      const fileEntries: FileEntry[] = entries.map((entry: DirectoryEntry) => ({
        name: entry.name || "Unknown",
        path: entry.path,
        isDir: entry.is_dir || false,
        children: undefined,
      }));

      fileEntries.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      setDropdown((prev) =>
        prev
          ? {
              ...prev,
              items: fileEntries,
              currentPath: previousPath,
              navigationStack: prev.navigationStack.slice(0, -1),
            }
          : null,
      );
    } catch (error) {
      logger.error("Editor", "Failed to go back:", error);
    }
  };

  const handleSegmentClick = async (segmentIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // If it's the last segment (current file), just navigate
    if (segmentIndex === segments.length - 1) {
      const fullPath = rootPath
        ? `${rootPath}/${segments.slice(0, segmentIndex + 1).join("/")}`
        : segments.slice(0, segmentIndex + 1).join("/");
      onNavigate(fullPath);
      return;
    }

    // If clicking the same segment that has dropdown open, close it
    if (dropdown && dropdown.segmentIndex === segmentIndex) {
      setDropdown(null);
      return;
    }

    // Get the directory path for this segment
    const dirPath = rootPath
      ? `${rootPath}/${segments.slice(0, segmentIndex + 1).join("/")}`
      : segments.slice(0, segmentIndex + 1).join("/");

    try {
      // Load directory contents
      const entries = await readDirectory(dirPath);
      const fileEntries: FileEntry[] = entries.map((entry: DirectoryEntry) => ({
        name: entry.name || "Unknown",
        path: entry.path,
        isDir: entry.is_dir || false,
        children: undefined,
      }));

      // Sort: directories first, then files, alphabetically
      fileEntries.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      // Get button position for dropdown
      const button = buttonRefs.current[segmentIndex];
      if (button) {
        const rect = button.getBoundingClientRect();
        setDropdown({
          segmentIndex,
          x: rect.left,
          y: rect.bottom + 2,
          items: fileEntries,
          currentPath: dirPath,
          navigationStack: [],
        });
      }
    } catch (error) {
      logger.error("Editor", "Failed to load directory contents:", error);
    }
  };

  if (!activeBuffer || segments.length === 0) return null;

  return (
    <>
      <div className="flex min-h-7 select-none items-center justify-between bg-terniary-bg px-3 py-1">
        <div className="ui-font flex items-center gap-0.5 overflow-hidden text-text-lighter text-xs">
          <div className="mr-1 flex items-center gap-0.5">
            <button
              onClick={handleJumpBack}
              disabled={!canGoBack}
              className="flex h-5 w-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              title="Go Back (Ctrl+-)"
              aria-label="Go back to previous location"
            >
              <ArrowLeft size={12} />
            </button>
            <button
              onClick={handleJumpForward}
              disabled={!canGoForward}
              className="flex h-5 w-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              title="Go Forward (Ctrl+Shift+-)"
              aria-label="Go forward to next location"
            >
              <ArrowRight size={12} />
            </button>
          </div>
          {segments.map((segment, index) => (
            <div key={index} className="flex min-w-0 items-center gap-0.5">
              {index > 0 && (
                <ChevronRight size={10} className="mx-0.5 shrink-0 text-text-lighter" />
              )}
              <button
                ref={(el) => {
                  buttonRefs.current[index] = el;
                }}
                onClick={(e) => handleSegmentClick(index, e)}
                className="flex max-w-60 items-center gap-1 truncate rounded-md px-1 py-0.5 text-xs transition-colors hover:bg-hover hover:text-text"
                title={segment}
              >
                {segment}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {((isMarkdownFile() && activeBuffer?.type !== "markdownPreview") ||
            (isHtmlFile() && activeBuffer?.type !== "htmlPreview") ||
            (isCsvFile() && activeBuffer?.type !== "csvPreview")) && (
            <button
              onClick={handlePreviewClick}
              className={buttonClassName({
                variant: "ghost",
                size: "icon-xs",
                className: "rounded text-text-lighter",
              })}
              title="Preview"
              aria-label="Preview"
            >
              <Eye size={12} />
            </button>
          )}
          <Tooltip content={inlineEditTooltip} side="bottom">
            <button
              onClick={handleInlineEditClick}
              className={buttonClassName({
                variant: "ghost",
                size: "icon-xs",
                className: "rounded text-text-lighter",
              })}
              title={inlineEditTooltip}
              aria-label={`AI inline edit (${inlineEditShortcutLabel})`}
            >
              <Sparkles size={12} />
            </button>
          </Tooltip>
          <button
            onClick={onSearchClick}
            className={buttonClassName({
              variant: "ghost",
              size: "icon-xs",
              className: "rounded text-text-lighter",
            })}
            title="Find in file"
          >
            <Search size={12} />
          </button>
          <div className="mx-1 h-3.5 w-px bg-border/70" />
          <EditorStatusActions />
        </div>
      </div>

      {dropdown && (
        <Dropdown
          isOpen={Boolean(dropdown)}
          point={{ x: dropdown.x, y: dropdown.y }}
          onClose={() => setDropdown(null)}
          className="breadcrumb-dropdown min-w-0"
          style={{
            zIndex: EDITOR_CONSTANTS.Z_INDEX.DROPDOWN,
            maxHeight: `${EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT}px`,
            minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
          }}
        >
          {dropdown.navigationStack.length > 0 && (
            <button
              onClick={handleGoBack}
              className={dropdownItemClassName(
                "border-border/70 border-b text-text-lighter hover:text-text",
              )}
            >
              <ArrowLeft size={12} className="shrink-0" />
              <span>Go back</span>
            </button>
          )}

          {dropdown.items.map((item) => (
            <button
              key={item.path}
              onClick={async () => {
                if (item.isDir) {
                  try {
                    const entries = await readDirectory(item.path);
                    const fileEntries: FileEntry[] = entries.map((entry: DirectoryEntry) => ({
                      name: entry.name || "Unknown",
                      path: entry.path,
                      isDir: entry.is_dir || false,
                      children: undefined,
                    }));

                    fileEntries.sort((a, b) => {
                      if (a.isDir && !b.isDir) return -1;
                      if (!a.isDir && b.isDir) return 1;
                      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    });

                    setDropdown((prev) =>
                      prev
                        ? {
                            ...prev,
                            items: fileEntries,
                            currentPath: item.path,
                            navigationStack: [...prev.navigationStack, prev.currentPath],
                          }
                        : null,
                    );
                  } catch (error) {
                    logger.error("Editor", "Failed to load folder contents:", error);
                  }
                } else {
                  onNavigate(item.path);
                  setDropdown(null);
                }
              }}
              className={dropdownItemClassName()}
            >
              <FileExplorerIcon
                fileName={item.name}
                isDir={item.isDir}
                isExpanded={false}
                className="shrink-0 text-text-lighter"
              />
              <span className="truncate">{item.name}</span>
            </button>
          ))}
        </Dropdown>
      )}
    </>
  );
}
