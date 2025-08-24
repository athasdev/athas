import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEventListener, useOnClickOutside } from "usehooks-ts";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import FileIcon from "@/file-explorer/views/file.icon";
import { readDirectory } from "@/file-system/controllers/platform";
import { useFileSystemStore } from "@/file-system/controllers/store";
import type { FileEntry } from "@/file-system/models/app";
import { useBufferStore } from "@/stores/buffer-store";
import { useUIState } from "@/stores/ui-state-store";

export default function Breadcrumb() {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { rootFolderPath, handleFileSelect } = useFileSystemStore();
  const { isFindVisible, setIsFindVisible } = useUIState();

  const handleNavigate = async (path: string) => {
    try {
      await handleFileSelect(path, false);
    } catch (error) {
      console.error("Failed to navigate to path:", path, error);
    }
  };

  const handleSearchClick = () => {
    setIsFindVisible(!isFindVisible);
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
      const fileEntries: FileEntry[] = entries.map((entry: any) => ({
        name: entry.name || "Unknown",
        path: entry.path,
        isDir: entry.is_dir || false,
        expanded: false,
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
      console.error("Failed to go back:", error);
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
      const fileEntries: FileEntry[] = entries.map((entry: any) => ({
        name: entry.name || "Unknown",
        path: entry.path,
        isDir: entry.is_dir || false,
        expanded: false,
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
      console.error("Failed to load directory contents:", error);
    }
  };

  // Close dropdown when clicking outside
  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, () => {
    setDropdown(null);
  });

  useEventListener("keydown", async (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (dropdown && dropdown.navigationStack.length > 0) {
        await handleGoBack();
      } else {
        setDropdown(null);
      }
    }
  });

  if (!activeBuffer || segments.length === 0) return null;

  return (
    <>
      <div className="flex min-h-[28px] select-none items-center justify-between border-border border-b bg-terniary-bg px-3 py-1">
        <div className="flex items-center gap-0.5 overflow-hidden font-mono text-text-lighter text-xs">
          {segments.map((segment, index) => (
            <div key={index} className="flex min-w-0 items-center gap-0.5">
              {index > 0 && (
                <ChevronRight size={10} className="mx-0.5 flex-shrink-0 text-text-lighter" />
              )}
              <button
                ref={(el) => {
                  buttonRefs.current[index] = el;
                }}
                onClick={(e) => handleSegmentClick(index, e)}
                className="flex max-w-[240px] items-center gap-1 truncate rounded px-1 py-0.5 text-xs transition-colors hover:bg-hover hover:text-text"
                title={segment}
              >
                {segment}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center">
          <button
            onClick={onSearchClick}
            className="flex h-5 w-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Find in file"
          >
            <Search size={12} />
          </button>
        </div>
      </div>

      {dropdown &&
        createPortal(
          <div
            ref={dropdownRef}
            className="breadcrumb-dropdown fixed overflow-y-auto rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
            style={{
              zIndex: EDITOR_CONSTANTS.Z_INDEX.DROPDOWN,
              maxHeight: `${EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT}px`,
              minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
              left: `${dropdown.x}px`,
              top: `${dropdown.y}px`,
            }}
          >
            {/* Go back button when we have navigation history */}
            {dropdown.navigationStack.length > 0 && (
              <button
                onClick={handleGoBack}
                className="flex w-full items-center gap-2 border-border border-b px-3 py-1.5 text-left font-mono text-text-lighter text-xs hover:bg-hover hover:text-text"
              >
                <ArrowLeft size={12} className="flex-shrink-0" />
                <span>Go back</span>
              </button>
            )}

            {dropdown.items.map((item) => (
              <button
                key={item.path}
                onClick={async () => {
                  if (item.isDir) {
                    // For folders, load their contents and update dropdown
                    try {
                      const entries = await readDirectory(item.path);
                      const fileEntries: FileEntry[] = entries.map((entry: any) => ({
                        name: entry.name || "Unknown",
                        path: entry.path,
                        isDir: entry.is_dir || false,
                        expanded: false,
                        children: undefined,
                      }));

                      // Sort: directories first, then files, alphabetically
                      fileEntries.sort((a, b) => {
                        if (a.isDir && !b.isDir) return -1;
                        if (!a.isDir && b.isDir) return 1;
                        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                      });

                      // Update dropdown with new contents and track navigation
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
                      console.error("Failed to load folder contents:", error);
                    }
                  } else {
                    // For files, navigate and close dropdown
                    onNavigate(item.path);
                    setDropdown(null);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
              >
                <FileIcon
                  fileName={item.name}
                  isDir={item.isDir}
                  isExpanded={false}
                  className="flex-shrink-0 text-text-lighter"
                />
                <span className="truncate">{item.name}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
