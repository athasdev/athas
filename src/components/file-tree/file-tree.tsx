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
import { useCallback, useEffect, useState } from "react";
import type { ContextMenuState, FileEntry } from "../../types/app";
import FileIcon from "../file-icon";
import "./file-tree.css";
import { cn } from "@/utils/cn";

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
}: FileTreeProps) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

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

    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 400);

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

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
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

  const renderFileTree = (items: FileEntry[], depth = 0) => {
    return items.map(file => (
      <div key={file.path}>
        {file.isEditing ? (
          <div
            className="flex min-h-[22px] w-full items-center gap-1.5 px-1.5 py-1"
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
              className="flex-1 border-text border-b border-none bg-transparent font-mono text-text text-xs outline-none focus:border-text-lighter"
              placeholder={file.isDir ? "folder name" : "file name"}
            />
          </div>
        ) : (
          <button
            draggable={!file.isDir}
            onDragStart={e => {
              if (!file.isDir) {
                e.dataTransfer.setData("application/file-path", file.path);
                e.dataTransfer.effectAllowed = "copy";
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
            )}
            style={{
              paddingLeft: `${12 + depth * 20}px`,
              userSelect: "none",
              WebkitUserSelect: "none",
              MozUserSelect: "none",
              msUserSelect: "none",
            }}
          >
            <FileIcon
              fileName={file.name}
              isDir={file.isDir}
              isExpanded={file.expanded}
              className="flex-shrink-0 text-text-lighter"
            />
            <span
              className="flex-1 select-none overflow-hidden text-ellipsis whitespace-nowrap"
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

  return (
    <>
      <div
        className="file-tree-container flex flex-1 select-none flex-col gap-0 p-2"
        style={{
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          msUserSelect: "none",
        }}
      >
        {renderFileTree(files)}
      </div>

      {contextMenu && (
        <div
          className="context-menu fixed z-50 rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                const parentDir = contextMenu.path.substring(0, contextMenu.path.lastIndexOf("/"));
                window.open(`file://${parentDir}`, "_blank");
              }
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover hover:text-red-500"
          >
            <Trash size={12} />
            Delete
          </button>
        </div>
      )}
    </>
  );
};

export default FileTree;
