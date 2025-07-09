import { FilePlus, FolderPlus, ImageIcon, Trash } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { ContextMenuState, FileEntry } from "../types/app";
import FileIcon from "./file-icon";

interface FileTreeProps {
  files: FileEntry[];
  activeBufferPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onCreateNewFileInDirectory: (directoryPath: string) => void;
  onCreateNewFolderInDirectory?: (directoryPath: string) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
  onGenerateImage?: (directoryPath: string) => void;
}

const FileTree = ({
  files,
  activeBufferPath,
  onFileSelect,
  onCreateNewFileInDirectory,
  onCreateNewFolderInDirectory,
  onDeletePath,
  onGenerateImage,
}: FileTreeProps) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = (e: React.MouseEvent, filePath: string, isDir: boolean) => {
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

  const renderFileTree = (items: FileEntry[], depth = 0) => {
    return items.map(file => (
      <div key={file.path}>
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
          className={`w-full text-left px-1.5 py-1 bg-transparent border-none text-[var(--text-color)] cursor-pointer text-xs font-mono flex items-center gap-1.5 transition-colors duration-150 whitespace-nowrap overflow-hidden text-ellipsis min-h-[22px] shadow-none outline-none hover:bg-[var(--hover-color)] focus:outline-none ${
            activeBufferPath === file.path ? "bg-[var(--selected-color)]" : ""
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

  return (
    <>
      <div className="overflow-y-auto p-2 flex flex-col gap-0 flex-1 custom-scrollbar">
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
              {(onCreateNewFolderInDirectory || onGenerateImage) && (
                <div className="border-t border-[var(--border-color)] my-1" />
              )}
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
