import { FilePlus, FolderPlus, ImageIcon, Trash } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { ContextMenuState, FileEntry } from "../types/app";
import FileIcon from "./file-icon";

interface FileTreeProps {
  files: FileEntry[];
  activeBufferPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onCreateNewFileInDirectory: (directoryPath: string, fileName: string) => void;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onUpdateFiles?: (files: FileEntry[]) => void;
}

const FileTree = ({
  files,
  activeBufferPath,
  onFileSelect,
  onCreateNewFileInDirectory,
  onCreateNewFolderInDirectory,
  onDeletePath,
  onGenerateImage,
  onUpdateFiles,
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

    const _rect = document.body.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 200);

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
            onClick={() => onFileSelect(file.path, file.isDir)}
            onContextMenu={e => handleContextMenu(e, file.path, file.isDir)}
            className={`flex min-h-[22px] w-full cursor-pointer items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap border-none bg-transparent px-1.5 py-1 text-left font-mono text-text text-xs shadow-none outline-none transition-colors duration-150 hover:bg-hover focus:outline-none ${
              activeBufferPath === file.path ? "bg-selected" : ""
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
          >
            <FileIcon
              fileName={file.name}
              isDir={file.isDir}
              isExpanded={file.expanded}
              className="flex-shrink-0 text-text-lighter"
            />
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {file.name}
            </span>
          </button>
        )}
        {file.expanded && file.children && (
          <div className="ml-4">{renderFileTree(file.children, depth + 1)}</div>
        )}
      </div>
    ));
  };

  return (
    <>
      <div className="custom-scrollbar flex flex-1 flex-col gap-0 overflow-y-auto p-2">
        {renderFileTree(files)}
      </div>

      {contextMenu && (
        <div
          className="context-menu fixed z-50 rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
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
              {onCreateNewFolderInDirectory && (
                <button
                  type="button"
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    startInlineEditing(contextMenu.path, true);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
                >
                  <FolderPlus size={12} />
                  New Folder
                </button>
              )}
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
              {(onCreateNewFolderInDirectory || onGenerateImage) && (
                <div className="my-1 border-border border-t" />
              )}
            </>
          )}

          {onDeletePath && (
            <button
              type="button"
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                onDeletePath(contextMenu.path, contextMenu.isDir);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover hover:text-red-500"
            >
              <Trash size={12} />
              Delete
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default FileTree;
