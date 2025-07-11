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
          className="fixed z-50 rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
              onClick={() => {
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
