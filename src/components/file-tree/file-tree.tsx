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
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuState, FileEntry } from "../../types/app";
import FileIcon from "../file-icon";
import "./file-tree.css";
import { cn } from "@/utils/cn";
import { moveFile } from "../../utils/platform";
import { useCustomDragDrop } from "./file-tree-custom-dnd";

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
  onRenamePath?: (path: string, newName: string) => void;
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

  // Log when files prop changes
  useEffect(() => {
    console.log(`🌳 FileTree received ${files.length} files`, files);
  }, [files]);

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
      return items.map(item => {
        if (item.path === targetPath && item.isDir) {
          // Add the new item to this directory
          const children = [...(item.children || []), newItem];
          return { ...item, children, expanded: true };
        } else if (item.children) {
          return { ...item, children: addNewItemToTree(item.children, targetPath) };
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
      const parentPath = item.path.endsWith("/") ? item.path.slice(0, -1) : item.path;
      if (item.isDir) {
        onCreateNewFolderInDirectory?.(parentPath, newName.trim());
      } else {
        onCreateNewFileInDirectory(parentPath, newName.trim());
      }
    }

    // Remove the temporary item from the tree
    const removeNewItemFromTree = (items: FileEntry[]): FileEntry[] => {
      return items
        .filter(i => !(i.isNewItem && i.isEditing))
        .map(i => ({
          ...i,
          children: i.children ? removeNewItemFromTree(i.children) : undefined,
        }));
    };

    const updatedFiles = removeNewItemFromTree(files);
    onUpdateFiles(updatedFiles);
    setEditingValue("");
  };

  const cancelInlineEditing = () => {
    if (!onUpdateFiles) return;

    // Remove the temporary item from the tree
    const removeNewItemFromTree = (items: FileEntry[]): FileEntry[] => {
      return items
        .filter(i => !(i.isNewItem && i.isEditing))
        .map(i => ({
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

  // Native HTML5 drag-and-drop handlers removed - using custom drag-and-drop instead

  const renderFileTree = (items: FileEntry[], depth = 0) => {
    return items.map(file => (
      <div key={file.path}>
        {file.isEditing ? (
          <div
            className={cn("flex min-h-[22px] w-full items-center", "gap-1.5 px-1.5 py-1")}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
          >
            <FileIcon
              fileName={file.isDir ? "folder" : "file"}
              isDir={file.isDir}
              isExpanded={false}
              className="flex-shrink-0 text-text-lighter"
            />
            <input
              type="text"
              value={editingValue}
              onChange={e => setEditingValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  finishInlineEditing(file, editingValue);
                } else if (e.key === "Escape") {
                  cancelInlineEditing();
                }
              }}
              onBlur={() => {
                if (editingValue.trim()) {
                  finishInlineEditing(file, editingValue);
                } else {
                  cancelInlineEditing();
                }
              }}
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
            onMouseDown={e => {
              // Use custom drag for both files and folders
              if (e.button === 0) {
                startCustomDrag(e, file);
              }
            }}
            onClick={e => handleFileClick(e, file.path, file.isDir)}
            onContextMenu={e => handleContextMenu(e, file.path, file.isDir)}
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
            )}
            style={{
              paddingLeft: `${12 + depth * 20}px`,
            }}
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

      console.log("Drop to root - source:", sourcePath, "target:", targetPath);

      // Check if file is already at root level
      const pathSeparator = sourcePath.includes("\\") ? "\\" : "/";
      const sourceParentPath =
        sourcePath.split(pathSeparator).slice(0, -1).join(pathSeparator) || rootFolderPath || "";

      if (targetPath === sourceParentPath) {
        console.log("File is already at root level");
        setDraggedItem(null);
        return;
      }

      try {
        const newPath = targetPath + pathSeparator + sourceName;
        console.log("Moving file to root:", sourcePath, "->", newPath);
        await moveFile(sourcePath, newPath);

        if (onFileMove) {
          onFileMove(sourcePath, newPath);
        }

        if (onRefreshDirectory) {
          // Small delay to ensure file system operation is complete
          await new Promise(resolve => setTimeout(resolve, 100));

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
      const rootPath = firstFilePath.split(pathSep).slice(0, -1).join(pathSep) || ".";
      console.log("External files dropped to root:", rootPath);

      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        console.log("File to upload:", file.name);
        // TODO: Implement file upload
      }
    }
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!containerRef.current) return;

    e.preventDefault();

    // Calculate smooth scroll delta
    const delta = e.deltaY * 0.5; // Reduce scroll speed for smoother feel

    // Use requestAnimationFrame for smooth scrolling
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop += delta;
      }
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel]);

  return (
    <div
      className={cn(
        "file-tree-container flex flex-1 select-none",
        "flex-col gap-0 p-2",
        "min-h-full", // Ensure container takes full height
        dragState.dragOverPath === "__ROOT__" &&
          "!bg-accent !bg-opacity-10 !border-2 !border-accent !border-dashed",
      )}
      ref={containerRef}
      onDragOver={e => {
        e.preventDefault();
        if (draggedItem) {
          e.dataTransfer.dropEffect = "move";
        } else {
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleRootDrop}
      onContextMenu={e => e.preventDefault()}
    >
      {renderFileTree(files)}

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
                  onClick={e => {
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onCreateNewFolderInDirectory) {
                      startInlineEditing(contextMenu.path, true);
                    } else {
                      console.log("New folder in:", contextMenu.path);
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onUploadFile) {
                      onUploadFile(contextMenu.path);
                    } else {
                      console.log("Upload files to:", contextMenu.path);
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onRefreshDirectory) {
                      onRefreshDirectory(contextMenu.path);
                    } else {
                      console.log("Refresh directory:", contextMenu.path);
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Use the Terminal app on macOS
                    if (window.electron) {
                      window.electron.shell.openPath(contextMenu.path);
                    } else {
                      console.log("Open in terminal:", contextMenu.path);
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Find in folder:", contextMenu.path);
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
                    onClick={e => {
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Open file:", contextMenu.path);
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
                  onClick={async e => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const response = await fetch(contextMenu.path);
                      const content = await response.text();
                      await navigator.clipboard.writeText(content);
                      console.log("Copied file content to clipboard");
                    } catch (error) {
                      console.log("Failed to copy file content:", error);
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
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onDuplicatePath) {
                      onDuplicatePath(contextMenu.path);
                    } else {
                      console.log("Duplicate file:", contextMenu.path);
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
                  onClick={async e => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const stats = await fetch(`file://${contextMenu.path}`, { method: "HEAD" });
                      const size = stats.headers.get("content-length") || "Unknown";
                      const fileName = contextMenu.path.split("/").pop() || "";
                      const extension = fileName.includes(".")
                        ? fileName.split(".").pop()
                        : "No extension";
                      alert(
                        `File: ${fileName}\nPath: ${contextMenu.path}\nSize: ${size} bytes\nType: ${extension}`,
                      );
                    } catch (_error) {
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
              onClick={async e => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(contextMenu.path);
                  console.log("Copied absolute path:", contextMenu.path);
                } catch (error) {
                  console.log("Failed to copy path:", error);
                }
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
              onClick={async e => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  let relativePath = contextMenu.path;
                  if (rootFolderPath && contextMenu.path.startsWith(rootFolderPath)) {
                    relativePath = contextMenu.path.substring(rootFolderPath.length + 1);
                  }
                  await navigator.clipboard.writeText(relativePath);
                  console.log("Copied relative path:", relativePath);
                } catch (error) {
                  console.log("Failed to copy relative path:", error);
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
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                if (onCutPath) {
                  onCutPath(contextMenu.path);
                } else {
                  console.log("Cut:", contextMenu.path);
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
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                const newName = prompt("Enter new name:", contextMenu.path.split("/").pop() || "");
                if (newName?.trim()) {
                  if (onRenamePath) {
                    onRenamePath(contextMenu.path, newName.trim());
                  } else {
                    console.log("Rename:", contextMenu.path, "to", newName.trim());
                  }
                }
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
              onClick={e => {
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
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                if (onDeletePath) {
                  onDeletePath(contextMenu.path, contextMenu.isDir);
                } else {
                  console.log("Delete:", contextMenu.path);
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
