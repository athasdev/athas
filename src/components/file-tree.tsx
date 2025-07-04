import React, { useState, useEffect } from "react";
import { FilePlus, ImageIcon, FolderPlus, Trash } from "lucide-react";
import { FileEntry, ContextMenuState } from "../types/app";
import FileIcon from "./file-icon";
import { moveFile, copyExternalFile } from "../utils/platform";

interface FileTreeProps {
  files: FileEntry[];
  activeBufferPath?: string;
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onCreateNewFileInDirectory: (directoryPath: string) => void;
  onCreateNewFolderInDirectory?: (directoryPath: string) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onRefreshDirectory?: (directoryPath: string) => void;
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
  onRefreshDirectory,
  onFileMove,
}: FileTreeProps) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<{path: string, name: string, isDir: boolean} | null>(null);

  const handleContextMenu = (
    e: React.MouseEvent,
    filePath: string,
    isDir: boolean,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: filePath,
      isDir: isDir,
    });
  };

  const handleDocumentClick = () => {
    setContextMenu(null);
  };

  useEffect(() => {
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  const handleDragStart = (e: React.DragEvent, file: FileEntry) => {
    console.log("Drag started:", file.path);
    e.dataTransfer.setData("text/plain", file.path);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
    setDraggedItem({ path: file.path, name: file.name, isDir: file.isDir });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragOverPath(null);
    setDraggedItem(null);
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Drag over:", targetPath, "isDir:", isDir, "draggedItem:", draggedItem);
    
    // For internal drag, check if it's a valid drop target
    if (isDir && draggedItem && targetPath !== draggedItem.path) {
      e.dataTransfer.dropEffect = "move";
      setDragOverPath(targetPath);
    } else if (isDir && !draggedItem) {
      // For external drag, always allow dropping on directories
      e.dataTransfer.dropEffect = "copy";
      setDragOverPath(targetPath);
    } else {
      e.dataTransfer.dropEffect = "none";
      setDragOverPath(null);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverPath(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetPath: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Drop on:", targetPath, "isDir:", isDir, "draggedItem:", draggedItem);
    
    setDragOverPath(null);
    setIsDragging(false);
    
    if (!isDir) {
      return;
    }
    
    // Handle internal drag and drop
    if (draggedItem) {
      const { path: sourcePath, name: sourceName, isDir: sourceIsDir } = draggedItem;
      
      if (sourcePath === targetPath) {
        setDraggedItem(null);
        return;
      }
      
      // Get the parent directory path
      const pathParts = sourcePath.split('/');
      const sourceParentPath = pathParts.slice(0, -1).join('/') || rootFolderPath || '.';
      console.log("Source parent path:", sourceParentPath, "from", sourcePath, "root:", rootFolderPath);
      
      if (targetPath === sourceParentPath) {
        setDraggedItem(null);
        return;
      }
      
      if (targetPath.startsWith(sourcePath + '/')) {
        setDraggedItem(null);
        return;
      }
      
      try {
        const newPath = targetPath + '/' + sourceName;
        console.log("Moving file from", sourcePath, "to", newPath);
        
        await moveFile(sourcePath, newPath);
        console.log("Move successful, refreshing directories");
        
        // Notify about the file move for buffer updates
        if (onFileMove) {
          onFileMove(sourcePath, newPath);
        }
        
        // Refresh both directories
        if (onRefreshDirectory) {
          console.log("Refreshing source directory:", sourceParentPath);
          await onRefreshDirectory(sourceParentPath);
          
          if (targetPath !== sourceParentPath) {
            console.log("Refreshing target directory:", targetPath);
            await onRefreshDirectory(targetPath);
          }
        } else {
          console.warn("onRefreshDirectory is not defined, cannot refresh file tree");
        }
      } catch (error) {
        console.error("Failed to move file:", error);
        alert(`Failed to move ${sourceName}: ${error}`);
      }
      
      setDraggedItem(null);
    } else {
      // Handle external file drop
      const files = e.dataTransfer.files;
      console.log("External drop detected, files:", files.length);
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          console.log("External file dropped:", file.name, "to", targetPath);
          // Note: In Tauri, external file drops are handled via the tauri://file-drop event
          // This code path is mainly for web version
        }
      }
    }
  };

  const renderFileTree = (items: FileEntry[], depth = 0) => {
    return items.map((file) => (
      <div key={file.path}>
        <button
          draggable
          onDragStart={(e) => handleDragStart(e, file)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, file.path, file.isDir)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, file.path, file.isDir)}
          onClick={() => onFileSelect(file.path, file.isDir)}
          onContextMenu={(e) => handleContextMenu(e, file.path, file.isDir)}
          className={`w-full text-left px-1.5 py-1 bg-transparent border-none text-[var(--text-color)] text-xs font-mono flex items-center gap-1.5 transition-colors duration-150 whitespace-nowrap overflow-hidden text-ellipsis min-h-[22px] shadow-none outline-none hover:bg-[var(--hover-color)] focus:outline-none ${activeBufferPath === file.path ? "bg-[var(--selected-color)]" : ""
            } ${
            dragOverPath === file.path && file.isDir ? "!bg-blue-500 !bg-opacity-20 !border-2 !border-blue-500 !border-dashed" : ""
            } ${
            isDragging ? "cursor-move" : "cursor-pointer"
            }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <FileIcon
            fileName={file.name}
            isDir={file.isDir}
            isExpanded={file.expanded}
            className="text-[var(--text-lighter)] flex-shrink-0"
          />
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {file.name}
          </span>
        </button>
        {file.expanded && file.children && (
          <div className="ml-4">{renderFileTree(file.children, depth + 1)}</div>
        )}
      </div>
    ));
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Handle external file drops to root
    if (!draggedItem && e.dataTransfer.files.length > 0) {
      const rootPath = files[0]?.path.split('/').slice(0, -1).join('/') || '.';
      console.log("External files dropped to root:", rootPath);
      
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        console.log("File to upload:", file.name, file.path);
        // TODO: Implement file upload
      }
    }
  };

  return (
    <>
      <div 
        className="overflow-y-auto p-2 flex flex-col gap-0 flex-1 custom-scrollbar"
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
        {renderFileTree(files)}
      </div>

      {contextMenu && (
        <div
          className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          {contextMenu.isDir && (
            <>
              <button
                onClick={() => {
                  onCreateNewFileInDirectory(contextMenu.path);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
              >
                <FilePlus size={12} />
                New File
              </button>
              {onCreateNewFolderInDirectory && (
                <button
                  onClick={() => {
                    onCreateNewFolderInDirectory(contextMenu.path);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
                >
                  <FolderPlus size={12} />
                  New Folder
                </button>
              )}
              {onGenerateImage && (
                <button
                  onClick={() => {
                    onGenerateImage(contextMenu.path);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
                >
                  <ImageIcon size={12} />
                  Generate Image
                </button>
              )}
              {(onCreateNewFolderInDirectory || onGenerateImage) && <div className="border-t border-[var(--border-color)] my-1" />}
            </>
          )}

          {onDeletePath && (
            <button
              onClick={() => {
                onDeletePath(contextMenu.path, contextMenu.isDir);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] hover:text-red-500 flex items-center gap-2"
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
