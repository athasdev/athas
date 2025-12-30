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
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEventListener, useOnClickOutside } from "usehooks-ts";
import { findFileInTree } from "@/features/file-system/controllers/file-tree-utils";
import { readDirectory, readFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { ContextMenuState, FileEntry } from "@/features/file-system/types/app";
import { useSettingsStore } from "@/features/settings/store";
import { getGitStatus } from "@/features/version-control/git/controllers/git";
import type { GitFile, GitStatus } from "@/features/version-control/git/types/git";
import { useIsMac } from "@/hooks/use-platform";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import { useDragDrop } from "../hooks/use-drag-drop";
import { FileTreeItem } from "./file-tree-item";
import "../styles/file-tree.css";

const GIT_STATUS_DEBOUNCE_MS = 500;

interface FileTreeProps {
  files: FileEntry[];
  activePath?: string;
  updateActivePath?: (path: string) => void;
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onFileOpen?: (path: string, isDir: boolean) => void;
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

function FileTreeComponent({
  files,
  activePath,
  updateActivePath,
  rootFolderPath,
  onFileSelect,
  onFileOpen,
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
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<Document>(document);

  const [gitIgnore, setGitIgnore] = useState<ReturnType<typeof ignore> | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [deepestStickyFolder, setDeepestStickyFolder] = useState<string | null>(null);

  const { settings } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const isMac = useIsMac();

  const { dragState, startDrag } = useDragDrop(rootFolderPath, onFileMove);

  const [mouseDownInfo, setMouseDownInfo] = useState<{
    x: number;
    y: number;
    file: FileEntry;
  } | null>(null);

  const userIgnore = useMemo(() => {
    const ig = ignore();
    if (settings.hiddenFilePatterns.length > 0) {
      ig.add(settings.hiddenFilePatterns);
    }
    if (settings.hiddenDirectoryPatterns.length > 0) {
      ig.add(settings.hiddenDirectoryPatterns.map((p) => (p.endsWith("/") ? p : `${p}/`)));
    }
    return ig;
  }, [settings.hiddenFilePatterns, settings.hiddenDirectoryPatterns]);

  const isUserHidden = useCallback(
    (fullPath: string, isDir: boolean): boolean => {
      let relative = getRelativePath(fullPath, rootFolderPath);
      if (!relative || relative.trim() === "") return false;
      if (isDir && !relative.endsWith("/")) relative += "/";
      return userIgnore.ignores(relative);
    },
    [userIgnore, rootFolderPath],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isThrottled = false;

    const handleScroll = () => {
      if (isThrottled) return;
      isThrottled = true;

      requestAnimationFrame(() => {
        const stickyFolders = container.querySelectorAll(".file-tree-item-dir");
        const containerRect = container.getBoundingClientRect();
        let deepest: string | null = null;
        let maxDepth = -1;

        stickyFolders.forEach((folder) => {
          const rect = folder.getBoundingClientRect();
          const depth = parseInt(folder.getAttribute("data-depth") || "0");
          const stickyTop = containerRect.top + depth * 22;
          const isStuck = rect.top <= stickyTop + 2;

          if (isStuck) {
            folder.classList.add("is-stuck");
            if (depth > maxDepth) {
              maxDepth = depth;
              deepest = folder.getAttribute("data-path");
            }
          } else {
            folder.classList.remove("is-stuck");
          }
        });

        setDeepestStickyFolder(deepest);
        isThrottled = false;
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
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
    const debounceTimer = setTimeout(() => {
      const loadGitStatus = async () => {
        if (!rootFolderPath) {
          setGitStatus(null);
          return;
        }

        try {
          const status = await getGitStatus(rootFolderPath);
          setGitStatus(status);
        } catch {
          setGitStatus(null);
        }
      };

      loadGitStatus();
    }, GIT_STATUS_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimer);
  }, [rootFolderPath, files]);

  const isGitIgnored = useCallback(
    (fullPath: string, isDir: boolean): boolean => {
      if (!gitIgnore || !rootFolderPath) return false;
      let relative = getRelativePath(fullPath, rootFolderPath);
      if (!relative || relative.trim() === "") return false;
      if (isDir && !relative.endsWith("/")) relative += "/";
      if (relative === ".git/" || relative === ".git") return false;
      return gitIgnore.ignores(relative);
    },
    [gitIgnore, rootFolderPath],
  );

  const getGitFileStatus = useCallback(
    (filePath: string): GitFile | null => {
      if (!gitStatus || !rootFolderPath) return null;
      const relativePath = getRelativePath(filePath, rootFolderPath);
      return gitStatus.files.find((file) => file.path === relativePath) || null;
    },
    [gitStatus, rootFolderPath],
  );

  const hasGitChangesInDirectory = useCallback(
    (dirPath: string): GitFile | null => {
      if (!gitStatus || !rootFolderPath) return null;
      const relativeDirPath = getRelativePath(dirPath, rootFolderPath);
      return (
        gitStatus.files.find(
          (file) => file.path.startsWith(`${relativeDirPath}/`) || file.path === relativeDirPath,
        ) || null
      );
    },
    [gitStatus, rootFolderPath],
  );

  const getGitStatusColor = useCallback(
    (file: FileEntry): string => {
      const gitFile = getGitFileStatus(file.path);
      if (gitFile) {
        switch (gitFile.status) {
          case "modified":
            return gitFile.staged ? "text-git-modified-staged" : "text-git-modified";
          case "added":
            return "text-git-added";
          case "deleted":
            return "text-git-deleted";
          case "untracked":
            return "text-git-untracked";
          case "renamed":
            return "text-git-renamed";
          default:
            return "";
        }
      }

      if (file.isDir) {
        const dirChange = hasGitChangesInDirectory(file.path);
        if (dirChange) {
          switch (dirChange.status) {
            case "modified":
              return dirChange.staged ? "text-git-modified-staged" : "text-git-modified";
            case "added":
              return "text-git-added";
            case "deleted":
              return "text-git-deleted";
            case "untracked":
              return "text-git-untracked";
            case "renamed":
              return "text-git-renamed";
            default:
              return "";
          }
        }
      }

      return "";
    },
    [getGitFileStatus, hasGitChangesInDirectory],
  );

  const filteredFiles = useMemo(() => {
    const process = (items: FileEntry[]): FileEntry[] =>
      items
        .filter((item) => !isUserHidden(item.path, item.isDir))
        .map((item) => ({
          ...item,
          ignored: isGitIgnored(item.path, item.isDir),
          children: item.children ? process(item.children) : undefined,
        }));

    return process(files);
  }, [files, isGitIgnored, isUserHidden]);

  const startInlineEditing = (parentPath: string, isFolder: boolean) => {
    if (!onUpdateFiles) return;

    const newItem: FileEntry = {
      name: "",
      path: `${parentPath}/`,
      isDir: isFolder,
      isEditing: true,
      isNewItem: true,
    };

    const addNewItemToTree = (items: FileEntry[], targetPath: string): FileEntry[] => {
      return items.map((item) => {
        if (item.path === targetPath && item.isDir) {
          return { ...item, children: [...(item.children || []), newItem], expanded: true };
        }
        if (item.children) {
          return { ...item, children: addNewItemToTree(item.children, targetPath) };
        }
        return item;
      });
    };

    if (parentPath === files[0]?.path.split("/").slice(0, -1).join("/") || !parentPath) {
      onUpdateFiles([...files, newItem]);
    } else {
      onUpdateFiles(addNewItemToTree(files, parentPath));
    }

    setEditingValue("");
  };

  const finishInlineEditing = (item: FileEntry, newName: string) => {
    if (!onUpdateFiles) return;

    if (newName.trim()) {
      let parentPath = item.path.endsWith("/") ? item.path.slice(0, -1) : item.path;
      if (!parentPath && rootFolderPath) parentPath = rootFolderPath;

      if (!parentPath) {
        alert("Error: Cannot determine where to create the file");
        return;
      }

      if (item.isRenaming) {
        onRenamePath?.(item.path, newName.trim());
        return;
      }

      if (item.isDir) {
        const folder = findFileInTree(files, `${parentPath}/${newName.trim()}`);
        if (folder) {
          alert("Folder already exists");
          return;
        }
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

    const removeNewItemFromTree = (items: FileEntry[]): FileEntry[] => {
      return items
        .filter((i) => !(i.isNewItem && i.isEditing))
        .map((i) => ({
          ...i,
          children: i.children ? removeNewItemFromTree(i.children) : undefined,
        }));
    };

    onUpdateFiles(removeNewItemFromTree(files));
    setEditingValue("");
  };

  const cancelInlineEditing = (file: FileEntry) => {
    if (!onUpdateFiles) return;

    if (file.isRenaming) {
      onRenamePath?.(file.path);
      return;
    }

    const removeNewItemFromTree = (items: FileEntry[]): FileEntry[] => {
      return items
        .filter((i) => !(i.isNewItem && i.isEditing))
        .map((i) => ({
          ...i,
          children: i.children ? removeNewItemFromTree(i.children) : undefined,
        }));
    };

    onUpdateFiles(removeNewItemFromTree(files));
    setEditingValue("");
  };

  const handleContextMenu = (e: React.MouseEvent, filePath: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    let x = e.pageX;
    let y = e.pageY;
    const menuWidth = 250;
    const menuHeight = 400;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight;

    setContextMenu({ x, y, path: filePath, isDir });
  };

  useOnClickOutside(contextMenuRef as RefObject<HTMLElement>, () => setContextMenu(null));

  useEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    },
    documentRef,
  );

  useEventListener("dragover", (e: DragEvent) => e.preventDefault(), documentRef);

  const handleFileClick = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      onFileSelect(path, isDir);
      updateActivePath?.(path);
    },
    [onFileSelect, updateActivePath],
  );

  const handleFileDoubleClick = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      onFileOpen?.(path, isDir);
      updateActivePath?.(path);
    },
    [onFileOpen, updateActivePath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, file: FileEntry) => {
      if (e.key === "Enter") finishInlineEditing(file, editingValue);
      else if (e.key === "Escape") cancelInlineEditing(file);
    },
    [editingValue],
  );

  const handleBlur = useCallback(
    (file: FileEntry) => {
      if (editingValue.trim()) finishInlineEditing(file, editingValue);
      else cancelInlineEditing(file);
    },
    [editingValue],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent, file: FileEntry) => {
    if (e.button === 0) {
      setMouseDownInfo({ x: e.clientX, y: e.clientY, file });
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (mouseDownInfo && !dragState.isDragging) {
        const deltaX = e.clientX - mouseDownInfo.x;
        const deltaY = e.clientY - mouseDownInfo.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance > 5) {
          startDrag(e, mouseDownInfo.file);
          setMouseDownInfo(null);
        }
      }
    },
    [mouseDownInfo, dragState.isDragging, startDrag],
  );

  const handleMouseUp = useCallback(() => setMouseDownInfo(null), []);
  const handleMouseLeave = useCallback(() => setMouseDownInfo(null), []);

  const renderFileTree = useCallback(
    (items: FileEntry[], depth = 0) => {
      return items.map((file) => (
        <FileTreeItem
          key={file.path}
          file={file}
          depth={depth}
          activePath={activePath}
          dragOverPath={dragState.dragOverPath}
          isDragging={dragState.isDragging}
          deepestStickyFolder={deepestStickyFolder}
          editingValue={editingValue}
          onEditingValueChange={setEditingValue}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleFileClick}
          onDoubleClick={handleFileDoubleClick}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          getGitStatusColor={getGitStatusColor}
          renderChildren={renderFileTree}
        />
      ));
    },
    [
      activePath,
      dragState.dragOverPath,
      dragState.isDragging,
      deepestStickyFolder,
      editingValue,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleFileClick,
      handleFileDoubleClick,
      handleKeyDown,
      handleBlur,
      getGitStatusColor,
    ],
  );

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files.length > 0) {
      const firstFilePath = files[0]?.path || "";
      const pathSep = firstFilePath.includes("\\") ? "\\" : "/";
      firstFilePath.split(pathSep).slice(0, -1).join(pathSep) || ".";
    }
  };

  return (
    <div
      className={cn(
        "file-tree-container relative flex min-w-full flex-1 select-none flex-col gap-0 overflow-auto",
        dragState.dragOverPath === "__ROOT__" &&
          "!border-2 !border-dashed !border-accent !bg-accent !bg-opacity-10",
      )}
      ref={containerRef}
      style={{ scrollBehavior: "auto", overscrollBehavior: "contain" }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = dragState.draggedItem ? "move" : "copy";
      }}
      onDrop={handleRootDrop}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateActivePath?.("");
      }}
    >
      {filteredFiles.length === 0 ? (
        <div className="file-tree-empty-state absolute inset-0 flex items-center justify-center">
          <button
            onClick={handleOpenFolder}
            className="ui-font flex w-fit min-w-fit items-center justify-center gap-2 rounded border border-border bg-hover px-3 py-1.5 text-text text-xs transition-colors hover:border-accent hover:text-accent"
          >
            <FolderOpen size={14} />
            <span>Open Folder</span>
            <kbd className="ml-1 rounded bg-secondary-bg px-1.5 py-0.5 font-mono text-[10px] text-text-lighter">
              {isMac ? "\u2318O" : "Ctrl+O"}
            </kbd>
          </button>
        </div>
      ) : (
        <div className="w-max min-w-full">{renderFileTree(filteredFiles)}</div>
      )}

      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="context-menu fixed z-100 rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, minWidth: "220px" }}
          >
            {contextMenu.isDir && (
              <>
                <ContextMenuItem
                  icon={FilePlus}
                  label="New File"
                  onClick={() => {
                    startInlineEditing(contextMenu.path, false);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={FolderPlus}
                  label="New Folder"
                  onClick={() => {
                    if (onCreateNewFolderInDirectory) startInlineEditing(contextMenu.path, true);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={Upload}
                  label="Upload Files"
                  onClick={() => {
                    onUploadFile?.(contextMenu.path);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={RefreshCw}
                  label="Refresh"
                  onClick={() => {
                    onRefreshDirectory?.(contextMenu.path);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={Terminal}
                  label="Open in Terminal"
                  onClick={() => {
                    window.electron?.shell.openPath(contextMenu.path);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={Search}
                  label="Find in Folder"
                  onClick={() => setContextMenu(null)}
                />
                {onGenerateImage && (
                  <ContextMenuItem
                    icon={ImageIcon}
                    label="Generate Image"
                    onClick={() => {
                      onGenerateImage(contextMenu.path);
                      setContextMenu(null);
                    }}
                  />
                )}
                <div className="my-1 border-border border-t" />
              </>
            )}

            {!contextMenu.isDir && (
              <>
                <ContextMenuItem
                  icon={FolderOpen}
                  label="Open"
                  onClick={() => {
                    onFileSelect(contextMenu.path, false);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={Copy}
                  label="Copy Content"
                  onClick={async () => {
                    try {
                      const response = await fetch(contextMenu.path);
                      const content = await response.text();
                      await navigator.clipboard.writeText(content);
                    } catch {}
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={FileText}
                  label="Duplicate"
                  onClick={() => {
                    onDuplicatePath?.(contextMenu.path);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={Info}
                  label="Properties"
                  onClick={async () => {
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
                    } catch {
                      const fileName = contextMenu.path.split("/").pop() || "";
                      alert(`File: ${fileName}\nPath: ${contextMenu.path}`);
                    }
                    setContextMenu(null);
                  }}
                />
                <div className="my-1 border-border border-t" />
              </>
            )}

            <ContextMenuItem
              icon={Link}
              label="Copy Path"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(contextMenu.path);
                } catch {}
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              icon={FileText}
              label="Copy Relative Path"
              onClick={async () => {
                try {
                  let relativePath = contextMenu.path;
                  if (rootFolderPath && contextMenu.path.startsWith(rootFolderPath)) {
                    relativePath = contextMenu.path.substring(rootFolderPath.length + 1);
                  }
                  await navigator.clipboard.writeText(relativePath);
                } catch {}
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              icon={Scissors}
              label="Cut"
              onClick={() => {
                onCutPath?.(contextMenu.path);
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              icon={Edit}
              label="Rename"
              onClick={() => {
                onRenamePath?.(contextMenu.path);
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              icon={Eye}
              label="Reveal in Finder"
              onClick={() => {
                if (onRevealInFinder) onRevealInFinder(contextMenu.path);
                else if (window.electron) window.electron.shell.showItemInFolder(contextMenu.path);
                else {
                  const parentDir = contextMenu.path.substring(
                    0,
                    contextMenu.path.lastIndexOf("/"),
                  );
                  window.open(`file://${parentDir}`, "_blank");
                }
                setContextMenu(null);
              }}
            />
            <div className="my-1 border-border border-t" />
            <ContextMenuItem
              icon={Trash}
              label="Delete"
              className="hover:text-red-500"
              onClick={() => {
                onDeletePath?.(contextMenu.path, contextMenu.isDir);
                setContextMenu(null);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

interface ContextMenuItemProps {
  icon: React.ComponentType<{ size: number }>;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}

function ContextMenuItem({ icon: Icon, label, onClick, className }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover",
        className,
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

export const FileTree = memo(FileTreeComponent);
export default FileTree;
