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
  const [, forceUpdate] = useState({});

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
  
  // Debug: Log when files prop changes
  useEffect(() => {
    console.log("FileTree: files prop changed, count:", files.length);
    files.forEach(f => {
      if (f.isDir && f.expanded && f.children) {
        console.log(`  Dir ${f.path}: ${f.children.length} children`);
      }
    });
  }, [files]);

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
      
      // Calculate parent directory path
      const pathParts = sourcePath.split('/');
      const fileName = pathParts[pathParts.length - 1];
      let sourceParentPath = pathParts.slice(0, -1).join('/');
      
      console.log("=== CRITICAL DEBUG: File Move Analysis ===");
      console.log("1. Source file path:", sourcePath);
      console.log("2. Calculated parent path:", sourceParentPath);
      console.log("3. Root folder path:", rootFolderPath);
      console.log("4. Files array length:", files.length);
      
      // Find the actual parent directory that contains this file
      let actualParentPath: string | null = null;
      
      const findParentDirectory = (items: FileEntry[]): string | null => {
        for (const item of items) {
          if (item.isDir && item.children) {
            // Check if this directory contains our file
            if (item.children.some(child => child.path === sourcePath)) {
              console.log(`>>> 🎯 FOUND! File "${sourcePath}" is in directory "${item.path}"`);
              return item.path;
            }
            // Recursively search subdirectories
            const found = findParentDirectory(item.children);
            if (found) return found;
          }
        }
        return null;
      };
      
      actualParentPath = findParentDirectory(files);
      
      if (actualParentPath) {
        sourceParentPath = actualParentPath;
        console.log(`5. Using actual parent directory: "${sourceParentPath}"`);
      } else {
        console.log(`5. File not found in any directory, checking if at root level`);
      }
      
      // Check if file is at root level
      const isRootLevelFile = files.some(f => f.path === sourcePath);
      console.log("6. Is file at root level?", isRootLevelFile);
      
      // If the parent path is empty, it means the file is at the root
      if (!sourceParentPath && rootFolderPath) {
        sourceParentPath = rootFolderPath;
        console.log("7. Empty parent path, using root folder path:", sourceParentPath);
      }
      
      console.log("=== FINAL: Source parent path for refresh:", sourceParentPath || rootFolderPath || "(root)", "===");
      console.log("This is the directory that will be refreshed to remove the moved file.");
      
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
        console.log("=== FILE MOVE OPERATION ===");
        console.log("Moving from:", sourcePath);
        console.log("Moving to:", newPath);
        console.log("Source name:", sourceName);
        console.log("Source is directory:", sourceIsDir);
        
        await moveFile(sourcePath, newPath);
        console.log("Move successful, refreshing directories");
        
        // Notify about the file move for buffer updates
        if (onFileMove) {
          onFileMove(sourcePath, newPath);
        }
        
        // Add a delay to ensure file system operations complete
        await new Promise(resolve => setTimeout(resolve, 250));
        
        // Refresh both directories
        if (onRefreshDirectory) {
          console.log("=== STARTING DIRECTORY REFRESH ===");
          console.log("Source parent path:", sourceParentPath || "(empty)");
          console.log("Target path:", targetPath);
          console.log("Root folder path:", rootFolderPath || "(not set)");
          
          // Always refresh source directory first
          console.log(`>>> Attempting to refresh source directory: "${sourceParentPath || '(root)'}"`);
          try {
            await onRefreshDirectory(sourceParentPath);
            console.log(`✓ Source directory refresh completed: "${sourceParentPath || '(root)'}"`);
          } catch (error) {
            console.error(`✗ Failed to refresh source directory: "${sourceParentPath || '(root)'}"`, error);
          }
          
          // Then refresh target directory if different
          if (targetPath !== sourceParentPath) {
            console.log(`>>> Attempting to refresh target directory: "${targetPath}"`);
            try {
              await onRefreshDirectory(targetPath);
              console.log(`✓ Target directory refresh completed: "${targetPath}"`);
            } catch (error) {
              console.error(`✗ Failed to refresh target directory: "${targetPath}"`, error);
            }
          } else {
            console.log("Target directory is same as source parent, skipping duplicate refresh");
          }
          console.log("=== DIRECTORY REFRESH COMPLETE ===");
        } else {
          console.warn("onRefreshDirectory is not defined, cannot refresh file tree");
        }
        
        // Clear dragged item state after successful move
        setDraggedItem(null);
      } catch (error) {
        console.error("Failed to move file:", error);
        alert(`Failed to move ${sourceName}: ${error}`);
        // Also clear dragged item on error
        setDraggedItem(null);
      }
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
