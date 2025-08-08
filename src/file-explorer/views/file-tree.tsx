import ignore from "ignore";
import {
  Copy,
  Edit,
  Eye,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  ImageIcon,
  Info,
  Link,
  RefreshCw,
  Scissors,
  Search,
  Terminal,
  Trash,
  Upload,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findFileInTree } from "@/file-system/controllers/file-tree-utils";
import { moveFile, readDirectory, readFile } from "@/file-system/controllers/platform";
import type { ContextMenuState, FileEntry } from "@/file-system/models/app";
import { cn } from "@/utils/cn";
import { type GitFile, type GitStatus, getGitStatus } from "@/utils/git";
import FileIcon from "./file.icon";
import { useCustomDragDrop } from "./file-tree-custom-dnd";
import "./file-tree.css";

interface FileTreeProps {
  files: FileEntry[];
  activeBufferPath?: string;
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onCreateNewFileInDirectory: (directoryPath: string, fileName: string) => void;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onUpdateFiles?: (files: FileEntry[]) => void;
  onCopyPath?: (path: string) => void;
  onCutPath?: (path: string) => void;
  onRenamePath?: (path: string, newName?: string) => void;
  onDuplicatePath?: (path: string) => void;
  onRefreshDirectory?: (path: string) => void;
  onRevealInFinder?: (path: string) => void;
  onUploadFile?: (directoryPath: string) => void;
  onFileMove?: (oldPath: string, newPath: string) => void;
}

const FileTree = ({
  files,
  activeBufferPath,
  rootFolderPath,
  onFileSelect,
  onCreateNewFileInDirectory,
  onCreateNewFolderInDirectory,
  onDeletePath,
  onGenerateImage,
  onUpdateFiles,
  onCutPath,
  onRenamePath,
  onDuplicatePath,
  onRefreshDirectory,
  onRevealInFinder,
  onUploadFile,
  onFileMove,
}: FileTreeProps) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  const [gitIgnore, setGitIgnore] = useState<ReturnType<typeof ignore> | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [deepestStickyFolder, setDeepestStickyFolder] = useState<string | null>(null);

  // Track scroll for deepest sticky folder detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Find all sticky folders currently visible
      const stickyFolders = container.querySelectorAll(".file-tree-item-dir");
      let deepest = null;
      let maxDepth = -1;

      stickyFolders.forEach((folder) => {
        const rect = folder.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Check if folder is sticky (at its sticky position)
        if (rect.top <= containerRect.top + 100) {
          // 100px buffer for nested folders
          const depth = parseInt(folder.getAttribute("data-depth") || "0");
          if (depth > maxDepth) {
            maxDepth = depth;
            deepest = folder.getAttribute("data-path");
          }
        }
      });

      setDeepestStickyFolder(deepest);
    };

    container.addEventListener("scroll", handleScroll);
    // Also run on mount
    handleScroll();

    return () => container.removeEventListener("scroll", handleScroll);
  }, [files]);

  useEffect(() => {
    const loadGitignore = async () => {
      if (!rootFolderPath) {
        setGitIgnore(null);
        return;
      }

      try {
        await readDirectory(`${rootFolderPath}/.git`);

        const content = await readFile(`${rootFolderPath}/.gitignore`);
        const ig = ignore();
        ig.add(
          content
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#")),
        );
        setGitIgnore(ig);
      } catch {
        setGitIgnore(null);
      }
    };

    loadGitignore();
  }, [rootFolderPath]);

  useEffect(() => {
    const loadGitStatus = async () => {
      if (!rootFolderPath) {
        setGitStatus(null);
        return;
      }

      try {
        const status = await getGitStatus(rootFolderPath);
        setGitStatus(status);
      } catch (error) {
        console.error("Failed to load git status:", error);
        setGitStatus(null);
      }
    };

    loadGitStatus();
  }, [rootFolderPath, files]);

  const isGitIgnored = useCallback(
    (fullPath: string, isDir: boolean): boolean => {
      if (!gitIgnore || !rootFolderPath) return false;

      const normRoot = rootFolderPath.replace(/\\/g, "/");
      let relative = fullPath.replace(/\\/g, "/");

      if (relative.startsWith(normRoot)) {
        relative = relative.slice(normRoot.length);
      }

      if (relative.startsWith("/")) relative = relative.slice(1);

      // Handle empty relative paths (like temporary items at root)
      if (!relative || relative.trim() === "") return false;

      if (isDir && !relative.endsWith("/")) relative += "/";

      return gitIgnore.ignores(relative);
    },
    [gitIgnore, rootFolderPath],
  );

  const getGitFileStatus = useCallback(
    (filePath: string): GitFile | null => {
      if (!gitStatus || !rootFolderPath) return null;

      const normalizedFilePath = filePath.replace(/\\/g, "/");
      const normalizedRoot = rootFolderPath.replace(/\\/g, "/");

      let relativePath = normalizedFilePath;
      if (normalizedFilePath.startsWith(normalizedRoot)) {
        relativePath = normalizedFilePath.slice(normalizedRoot.length);
      }

      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }

      return gitStatus.files.find((file) => file.path === relativePath) || null;
    },
    [gitStatus, rootFolderPath],
  );

  const hasGitChangesInDirectory = useCallback(
    (dirPath: string): GitFile | null => {
      if (!gitStatus || !rootFolderPath) return null;

      const normalizedDirPath = dirPath.replace(/\\/g, "/");
      const normalizedRoot = rootFolderPath.replace(/\\/g, "/");

      let relativeDirPath = normalizedDirPath;
      if (normalizedDirPath.startsWith(normalizedRoot)) {
        relativeDirPath = normalizedDirPath.slice(normalizedRoot.length);
      }

      if (relativeDirPath.startsWith("/")) {
        relativeDirPath = relativeDirPath.slice(1);
      }

      // Find any file within this directory that has changes
      const fileWithChanges = gitStatus.files.find((file) => {
        const filePath = file.path;
        return filePath.startsWith(`${relativeDirPath}/`) || filePath === relativeDirPath;
      });

      return fileWithChanges || null;
    },
    [gitStatus, rootFolderPath],
  );

  const getGitStatusColor = useCallback(
    (file: FileEntry): string => {
      // First check if this file itself has git status
      const gitFile = getGitFileStatus(file.path);
      if (gitFile) {
        switch (gitFile.status) {
          case "modified":
            return gitFile.staged
              ? "text-[var(--color-git-modified-staged)]"
              : "text-[var(--color-git-modified)]";
          case "added":
            return "text-[var(--color-git-added)]";
          case "deleted":
            return "text-[var(--color-git-deleted)]";
          case "untracked":
            return "text-[var(--color-git-untracked)]";
          case "renamed":
            return "text-[var(--color-git-renamed)]";
          default:
            return "";
        }
      }

      // If it's a directory, check if any files within it have changes
      if (file.isDir) {
        const dirChange = hasGitChangesInDirectory(file.path);
        if (dirChange) {
          switch (dirChange.status) {
            case "modified":
              return dirChange.staged
                ? "text-[var(--color-git-modified-staged)]"
                : "text-[var(--color-git-modified)]";
            case "added":
              return "text-[var(--color-git-added)]";
            case "deleted":
              return "text-[var(--color-git-deleted)]";
            case "untracked":
              return "text-[var(--color-git-untracked)]";
            case "renamed":
              return "text-[var(--color-git-renamed)]";
            default:
              return "";
          }
        }
      }

      return "";
    },
    [getGitFileStatus, hasGitChangesInDirectory],
  );

  // ─────────────────────────────────────────────────────────────────
  // Pre-process files once per render
  // ─────────────────────────────────────────────────────────────────
  const filteredFiles = useMemo(() => {
    const process = (items: FileEntry[]): FileEntry[] =>
      items.map((item) => {
        const ignored = isGitIgnored(item.path, item.isDir);
        return {
          ...item,
          ignored,
          children: item.children ? process(item.children) : undefined,
        };
      });

    return process(files);
  }, [files, isGitIgnored]);

  // Use custom drag and drop
  const { dragState, startCustomDrag } = useCustomDragDrop(
    rootFolderPath,
    onFileMove,
    onRefreshDirectory,
  );

  const [draggedItem, setDraggedItem] = useState<{
    path: string;
    name: string;
    isDir: boolean;
  } | null>(null);

  // Mouse tracking for drag threshold
  const [mouseDownInfo, setMouseDownInfo] = useState<{
    x: number;
    y: number;
    file: FileEntry;
  } | null>(null);

  const startInlineEditing = (parentPath: string, isFolder: boolean) => {
    if (!onUpdateFiles) return;

    // Create a temporary new item for editing
    const newItem: FileEntry = {
      name: "",
      path: `${parentPath}/`,
      isDir: isFolder,
      isEditing: true,
      isNewItem: true,
    };

    // Add the new item to the file tree
    const addNewItemToTree = (items: FileEntry[], targetPath: string): FileEntry[] => {
      return items.map((item) => {
        if (item.path === targetPath && item.isDir) {
          // Add the new item to this directory
          const children = [...(item.children || []), newItem];
          return { ...item, children, expanded: true };
        } else if (item.children) {
          return {
            ...item,
            children: addNewItemToTree(item.children, targetPath),
          };
        }
        return item;
      });
    };

    // If it's the root directory, add to root level
    if (parentPath === files[0]?.path.split("/").slice(0, -1).join("/") || !parentPath) {
      onUpdateFiles([...files, newItem]);
    } else {
      const updatedFiles = addNewItemToTree(files, parentPath);
      onUpdateFiles(updatedFiles);
    }

    setEditingValue("");
  };

  const finishInlineEditing = (item: FileEntry, newName: string) => {
    if (!onUpdateFiles) return;

    if (newName.trim()) {
      // Create the actual file/folder
      let parentPath = item.path.endsWith("/") ? item.path.slice(0, -1) : item.path;

      // Ensure parentPath is not empty - use rootFolderPath as fallback
      if (!parentPath && rootFolderPath) {
        parentPath = rootFolderPath;
      }

      if (!parentPath) {
        console.error("Cannot determine parent path for file creation");
        alert("Error: Cannot determine where to create the file");
        return;
      }

      if (item.isRenaming) {
        onRenamePath?.(item.path, newName.trim());
        return;
      }

      if (item.isDir) {
        onCreateNewFolderInDirectory?.(parentPath, newName.trim());
      } else {
        const file = findFileInTree(files, `${parentPath}/${newName.trim()}`);
        if (file) {
          alert("File already exists");
          return;
        }
        onCreateNewFileInDirectory(parentPath, newName.trim());
      }
    }

    // Remove the temporary item from the tree
    const removeNewItemFromTree = (items: FileEntry[]): FileEntry[] => {
      return items
        .filter((i) => !(i.isNewItem && i.isEditing))
        .map((i) => ({
          ...i,
          children: i.children ? removeNewItemFromTree(i.children) : undefined,
        }));
    };

    const updatedFiles = removeNewItemFromTree(files);
    onUpdateFiles(updatedFiles);
    setEditingValue("");
  };

  const cancelInlineEditing = (file: FileEntry) => {
    if (!onUpdateFiles) return;

    if (file.isRenaming) {
      onRenamePath?.(file.path);
      return;
    }

    // Remove the temporary item from the tree
    const removeNewItemFromTree = (items: FileEntry[]): FileEntry[] => {
      return items
        .filter((i) => !(i.isNewItem && i.isEditing))
        .map((i) => ({
          ...i,
          children: i.children ? removeNewItemFromTree(i.children) : undefined,
        }));
    };

    const updatedFiles = removeNewItemFromTree(files);
    onUpdateFiles(updatedFiles);
    setEditingValue("");
  };

  const handleContextMenu = (e: React.MouseEvent, filePath: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    // Get the raw coordinates first
    let x = e.pageX;
    let y = e.pageY;

    // Only adjust if the menu would go off-screen
    const menuWidth = 250;
    const menuHeight = 400; // approximate max height

    // Adjust X if menu would go off right edge
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth;
    }

    // Adjust Y if menu would go off bottom edge
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight;
    }

    setContextMenu({
      x: x,
      y: y,
      path: filePath,
      isDir: isDir,
    });
  };

  const handleDocumentClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".context-menu")) {
      setContextMenu(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };

    // Prevent default drag behavior at document level
    const handleDocumentDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("dragover", handleDocumentDragOver);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("dragover", handleDocumentDragOver);
    };
  }, []);

  const handleFileClick = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      onFileSelect(path, isDir);
    },
    [onFileSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, file: FileEntry) => {
      if (e.key === "Enter") {
        finishInlineEditing(file, editingValue);
      } else if (e.key === "Escape") {
        cancelInlineEditing(file);
      }
    },
    [finishInlineEditing, cancelInlineEditing, editingValue],
  );

  const handleBlur = useCallback(
    (file: FileEntry) => {
      if (editingValue.trim()) {
        finishInlineEditing(file, editingValue);
      } else {
        cancelInlineEditing(file);
      }
    },
    [finishInlineEditing, cancelInlineEditing, editingValue],
  );

  const renderFileTree = (items: FileEntry[], depth = 0) => {
    return items.map((file) => (
      <div key={file.path} className="file-tree-item" data-depth={depth}>
        {file.isEditing || file.isRenaming ? (
          <div
            className={cn("flex min-h-[22px] w-full items-center", "gap-1.5 px-1.5 py-1")}
            style={{ paddingLeft: `${12 + depth * 20}px`, paddingRight: "8px" }}
          >
            <FileIcon
              fileName={file.isDir ? "folder" : "file"}
              isDir={file.isDir}
              isExpanded={false}
              className="flex-shrink-0 text-text-lighter"
            />
            <input
              ref={(inputElement) => {
                if (inputElement) {
                  // Focus the input
                  inputElement.focus();
                  // Scroll to the input element
                  inputElement.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "nearest",
                  });
                }
              }}
              type="text"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              value={editingValue}
              onFocus={() => {
                if (file.isRenaming) {
                  setEditingValue(file.name);
                }
              }}
              onChange={(e) => setEditingValue(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, file)}
              onBlur={() => handleBlur(file)}
              className={cn(
                "flex-1 border-text border-b border-none bg-transparent",
                "font-mono text-text text-xs outline-none focus:border-text-lighter",
              )}
              placeholder={file.isDir ? "folder name" : "file name"}
            />
          </div>
        ) : (
          <button
            type="button"
            data-file-path={file.path}
            data-is-dir={file.isDir}
            onMouseDown={(e) => {
              // Track initial mouse position for drag threshold
              if (e.button === 0) {
                setMouseDownInfo({
                  x: e.clientX,
                  y: e.clientY,
                  file: file,
                });
              }
            }}
            onMouseMove={(e) => {
              // Check if we should start dragging based on movement threshold
              if (mouseDownInfo && !dragState.isDragging) {
                const deltaX = e.clientX - mouseDownInfo.x;
                const deltaY = e.clientY - mouseDownInfo.y;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                // Start drag if moved more than 5 pixels
                if (distance > 5) {
                  startCustomDrag(e, mouseDownInfo.file);
                  setMouseDownInfo(null);
                }
              }
            }}
            onMouseUp={() => {
              // Clear mouse down info if no drag was started
              setMouseDownInfo(null);
            }}
            onMouseLeave={() => {
              // Clear mouse down info if mouse leaves the button
              setMouseDownInfo(null);
            }}
            onClick={(e) => handleFileClick(e, file.path, file.isDir)}
            onContextMenu={(e) => handleContextMenu(e, file.path, file.isDir)}
            className={cn(
              "flex min-h-[22px] w-full cursor-pointer",
              "select-none items-center gap-1.5 overflow-hidden",
              "text-ellipsis whitespace-nowrap border-none bg-transparent",
              "px-1.5 py-1 text-left font-mono text-text text-xs",
              "shadow-none outline-none transition-colors duration-150",
              "hover:bg-hover focus:outline-none",
              activeBufferPath === file.path && "bg-selected",
              dragState.dragOverPath === file.path &&
                "!bg-accent !bg-opacity-20 !border-2 !border-accent !border-dashed",
              dragState.isDragging && "cursor-move",
              file.ignored && "opacity-50",
              file.isDir && "file-tree-item-dir",
              file.isDir && deepestStickyFolder === file.path && "border-white/5 border-b",
            )}
            data-path={file.path}
            data-depth={depth}
            style={
              {
                paddingLeft: `${14 + depth * 20}px`,
                paddingRight: "8px",
                "--depth": depth,
              } as React.CSSProperties & { "--depth": number }
            }
          >
            <FileIcon
              fileName={file.name}
              isDir={file.isDir}
              isExpanded={file.expanded}
              className="flex-shrink-0 text-text-lighter"
            />
            <span
              className={cn(
                "flex-1 select-none overflow-hidden",
                "text-ellipsis whitespace-nowrap",
                getGitStatusColor(file),
              )}
              style={{
                userSelect: "none",
                WebkitUserSelect: "none",
                MozUserSelect: "none",
                msUserSelect: "none",
              }}
            >
              {file.name}
            </span>
          </button>
        )}
        {file.expanded && file.children && <div>{renderFileTree(file.children, depth + 1)}</div>}
      </div>
    ));
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Handle internal drag-and-drop to root
    if (draggedItem) {
      const { path: sourcePath, name: sourceName } = draggedItem;

      // Get root path from rootFolderPath or derive from files
      let targetPath = rootFolderPath;
      if (!targetPath && files.length > 0) {
        const firstFilePath = files[0].path;
        const pathSep = firstFilePath.includes("\\") ? "\\" : "/";
        targetPath = firstFilePath.split(pathSep).slice(0, -1).join(pathSep);
      }

      if (!targetPath) {
        console.error("Could not determine root folder path");
        setDraggedItem(null);
        return;
      }

      // Check if file is already at root level
      const pathSeparator = sourcePath.includes("\\") ? "\\" : "/";
      const sourceParentPath =
        sourcePath.split(pathSeparator).slice(0, -1).join(pathSeparator) || rootFolderPath || "";

      if (targetPath === sourceParentPath) {
        setDraggedItem(null);
        return;
      }

      try {
        const newPath = targetPath + pathSeparator + sourceName;
        await moveFile(sourcePath, newPath);

        if (onFileMove) {
          onFileMove(sourcePath, newPath);
        }

        if (onRefreshDirectory) {
          // Small delay to ensure file system operation is complete
          await new Promise((resolve) => setTimeout(resolve, 100));

          await onRefreshDirectory(targetPath);
          if (targetPath !== sourceParentPath) {
            await onRefreshDirectory(sourceParentPath);
          }
        }

        setDraggedItem(null);
      } catch (error) {
        console.error("Failed to move file:", error);
        alert(`Failed to move ${sourceName}: ${error}`);
        setDraggedItem(null);
      }
    }
    // Handle external file drops to root
    else if (e.dataTransfer.files.length > 0) {
      // Get root path - handle both forward and backslashes
      const firstFilePath = files[0]?.path || "";
      const pathSep = firstFilePath.includes("\\") ? "\\" : "/";
      const _rootPath = firstFilePath.split(pathSep).slice(0, -1).join(pathSep) || ".";

      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const _file = e.dataTransfer.files[i];
        // TODO: Implement file upload
      }
    }
  };

  return (
    <div
      className={cn(
        "file-tree-container flex flex-1 select-none",
        "flex-col gap-0 overflow-auto",
        dragState.dragOverPath === "__ROOT__" &&
          "!bg-accent !bg-opacity-10 !border-2 !border-accent !border-dashed",
      )}
      ref={containerRef}
      style={{
        scrollBehavior: "auto", // Disable smooth scrolling
        overscrollBehavior: "contain",
      }}
      onWheel={(e) => {
        // Handle wheel scrolling with native delta values for natural acceleration
        const container = containerRef.current;
        if (!container) return;

        // Use the native deltaY value to preserve mouse acceleration
        container.scrollTop += e.deltaY;

        // Prevent default to avoid any browser interference
        e.preventDefault();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (draggedItem) {
          e.dataTransfer.dropEffect = "move";
        } else {
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleRootDrop}
    >
      {renderFileTree(filteredFiles)}

      {contextMenu &&
        createPortal(
          <div
            className={cn(
              "context-menu fixed z-50 rounded-md border",
              "border-border bg-secondary-bg py-1 shadow-lg",
            )}
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              minWidth: "220px",
            }}
          >
            {contextMenu.isDir && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startInlineEditing(contextMenu.path, false);
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <FilePlus size={12} />
                  New File
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onCreateNewFolderInDirectory) {
                      startInlineEditing(contextMenu.path, true);
                    } else {
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <FolderPlus size={12} />
                  New Folder
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onUploadFile) {
                      onUploadFile(contextMenu.path);
                    } else {
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <Upload size={12} />
                  Upload Files
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onRefreshDirectory) {
                      onRefreshDirectory(contextMenu.path);
                    } else {
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Use the Terminal app on macOS
                    if (window.electron) {
                      window.electron.shell.openPath(contextMenu.path);
                    } else {
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <Terminal size={12} />
                  Open in Terminal
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <Search size={12} />
                  Find in Folder
                </button>
                {onGenerateImage && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onGenerateImage(contextMenu.path);
                      setContextMenu(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5",
                      "text-left font-mono text-text text-xs hover:bg-hover",
                    )}
                  >
                    <ImageIcon size={12} />
                    Generate Image
                  </button>
                )}
                <div className="my-1 border-border border-t" />
              </>
            )}

            {!contextMenu.isDir && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFileSelect(contextMenu.path, false);
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <FolderOpen size={12} />
                  Open
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const response = await fetch(contextMenu.path);
                      const content = await response.text();
                      await navigator.clipboard.writeText(content);
                    } catch (error) {
                      console.error("Failed to copy file content:", error);
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <Copy size={12} />
                  Copy Content
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onDuplicatePath) {
                      onDuplicatePath(contextMenu.path);
                    } else {
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <FileText size={12} />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const stats = await fetch(`file://${contextMenu.path}`, {
                        method: "HEAD",
                      });
                      const size = stats.headers.get("content-length") || "Unknown";
                      const fileName = contextMenu.path.split("/").pop() || "";
                      const extension = fileName.includes(".")
                        ? fileName.split(".").pop()
                        : "No extension";
                      alert(
                        `File: ${fileName}\nPath: ${contextMenu.path}\nSize: ${size} bytes\nType: ${extension}`,
                      );
                    } catch {
                      const fileName = contextMenu.path.split("/").pop() || "";
                      alert(`File: ${fileName}\nPath: ${contextMenu.path}`);
                    }
                    setContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5",
                    "text-left font-mono text-text text-xs hover:bg-hover",
                  )}
                >
                  <Info size={12} />
                  Properties
                </button>
                <div className="my-1 border-border border-t" />
              </>
            )}

            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(contextMenu.path);
                } catch (_error) {}
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover",
              )}
            >
              <Link size={12} />
              Copy Path
            </button>

            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  let relativePath = contextMenu.path;
                  if (rootFolderPath && contextMenu.path.startsWith(rootFolderPath)) {
                    relativePath = contextMenu.path.substring(rootFolderPath.length + 1);
                  }
                  await navigator.clipboard.writeText(relativePath);
                } catch (error) {
                  console.error("Failed to copy relative path:", error);
                }
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover",
              )}
            >
              <FileText size={12} />
              Copy Relative Path
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onCutPath) {
                  onCutPath(contextMenu.path);
                } else {
                }
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover",
              )}
            >
              <Scissors size={12} />
              Cut
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRenamePath?.(contextMenu.path);
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover",
              )}
            >
              <Edit size={12} />
              Rename
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onRevealInFinder) {
                  onRevealInFinder(contextMenu.path);
                } else if (window.electron) {
                  window.electron.shell.showItemInFolder(contextMenu.path);
                } else {
                  // Fallback: try to open the parent directory
                  const parentDir = contextMenu.path.substring(
                    0,
                    contextMenu.path.lastIndexOf("/"),
                  );
                  window.open(`file://${parentDir}`, "_blank");
                }
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover",
              )}
            >
              <Eye size={12} />
              Reveal in Finder
            </button>

            <div className="my-1 border-border border-t" />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onDeletePath) {
                  onDeletePath(contextMenu.path, contextMenu.isDir);
                } else {
                }
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover hover:text-red-500",
              )}
            >
              <Trash size={12} />
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default FileTree;
