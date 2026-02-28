import ignore from "ignore";
import {
  Clipboard,
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
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-clipboard-store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-tree-store";
import { findFileInTree } from "@/features/file-system/controllers/file-tree-utils";
import { readDirectory, readFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { ContextMenuState, FileEntry } from "@/features/file-system/types/app";
import { getGitStatus } from "@/features/git/api/status";
import type { GitFile, GitStatus } from "@/features/git/types/git";
import { useSettingsStore } from "@/features/settings/store";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import { IS_MAC } from "@/utils/platform";
import { useDragDrop } from "../hooks/use-drag-drop";
import { FileTreeItem } from "./file-tree-item";
import "../styles/file-tree.css";
import { useVirtualizer } from "@tanstack/react-virtual";

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
  // sticky handled purely by CSS; no JS scanning

  const { settings } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const isMac = IS_MAC;

  const clipboardActions = useFileClipboardStore.getState().actions;
  const clipboard = useFileClipboardStore((s) => s.clipboard);

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

  // removed scroll-time DOM scanning for sticky folders

  useEffect(() => {
    const loadGitignore = async () => {
      if (!rootFolderPath) {
        setGitIgnore(null);
        return;
      }

      try {
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

  useEffect(() => {
    if (!rootFolderPath) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleGitStatusUpdated = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        try {
          const status = await getGitStatus(rootFolderPath);
          setGitStatus(status);
        } catch {
          // Silently ignore errors
        }
      }, GIT_STATUS_DEBOUNCE_MS);
    };

    window.addEventListener("git-status-updated", handleGitStatusUpdated);
    return () => {
      window.removeEventListener("git-status-updated", handleGitStatusUpdated);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [rootFolderPath]);

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

  // Precompute git status map for O(1) lookups
  const gitPathMap = useMemo(() => {
    if (!gitStatus) return null as null | Map<string, GitFile>;
    const m = new Map<string, GitFile>();
    for (const f of gitStatus.files) m.set(f.path, f);
    return m;
  }, [gitStatus]);

  const getGitStatusClass = useCallback(
    (file: FileEntry): string => {
      if (!rootFolderPath || !gitPathMap) return "";
      const rel = getRelativePath(file.path, rootFolderPath);
      if (!rel) return "";
      const fileStatus = gitPathMap.get(rel);
      const mapStatus = (s: GitFile | null | undefined) => {
        if (!s) return "";
        switch (s.status) {
          case "modified":
            return s.staged ? "text-git-modified-staged" : "text-git-modified";
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
      };
      if (fileStatus) return mapStatus(fileStatus);
      if (file.isDir) {
        // Any change under directory
        for (const [p, s] of gitPathMap) {
          if (p === rel || p.startsWith(`${rel}/`)) return mapStatus(s);
        }
      }
      return "";
    },
    [gitPathMap, rootFolderPath],
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

  // Compute visible rows based on expansion state in the UI store
  const expandedPaths = useFileTreeStore((s) => s.expandedPaths);
  const visibleRows = useMemo(() => {
    const rows: Array<{ file: FileEntry; depth: number; isExpanded: boolean }> = [];
    const walk = (items: FileEntry[], depth: number) => {
      for (const item of items) {
        const isExpanded = item.isDir && expandedPaths.has(item.path);
        rows.push({ file: item, depth, isExpanded });
        if (item.isDir && isExpanded && item.children) walk(item.children, depth + 1);
      }
    };
    walk(filteredFiles, 0);
    return rows;
  }, [filteredFiles, expandedPaths]);

  // Virtualizer setup
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: () => 22,
    getScrollElement: () => containerRef.current,
    overscan: 8,
  });

  // No sticky overlays or global guides

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
          return { ...item, children: [...(item.children || []), newItem] };
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

    // Ensure the target folder is expanded in UI
    try {
      const current = useFileTreeStore.getState().getExpandedPaths();
      const next = new Set(current);
      next.add(parentPath);
      useFileTreeStore.getState().setExpandedPaths(next);
    } catch {}

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

  // Fast path->file lookup for delegation
  const pathToFile = useMemo(() => {
    const m = new Map<string, FileEntry>();
    for (const r of visibleRows) m.set(r.file.path, r.file);
    return m;
  }, [visibleRows]);

  const getTargetItem = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest("[data-file-path]") as
      | (HTMLElement & { dataset: { filePath?: string; isDir?: string } })
      | null;
    if (!el) return null;
    const path = el.dataset.filePath || el.getAttribute("data-file-path") || "";
    const isDir = (el.dataset.isDir || el.getAttribute("data-is-dir")) === "true";
    const file = pathToFile.get(path);
    if (!file) return null;
    return { path, isDir, file };
  };

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const t = getTargetItem(e.target);
      if (!t) {
        // clicked on empty space clears selection
        e.preventDefault();
        e.stopPropagation();
        updateActivePath?.("");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onFileSelect(t.path, t.isDir);
      updateActivePath?.(t.path);
    },
    [onFileSelect, updateActivePath, pathToFile],
  );

  const handleContainerDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const t = getTargetItem(e.target);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      onFileOpen?.(t.path, t.isDir);
      updateActivePath?.(t.path);
    },
    [onFileOpen, updateActivePath, pathToFile],
  );

  const handleContainerContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const t = getTargetItem(e.target);
      if (!t) return;
      handleContextMenu(e, t.path, t.isDir);
    },
    [handleContextMenu, pathToFile],
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

  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const t = getTargetItem(e.target);
      if (!t) return;
      setMouseDownInfo({ x: e.clientX, y: e.clientY, file: t.file });
    },
    [pathToFile],
  );

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (mouseDownInfo && !dragState.isDragging) {
        const dx = e.clientX - mouseDownInfo.x;
        const dy = e.clientY - mouseDownInfo.y;
        if (Math.hypot(dx, dy) > 5) {
          startDrag(e, mouseDownInfo.file);
          setMouseDownInfo(null);
        }
      }
    },
    [mouseDownInfo, dragState.isDragging, startDrag],
  );

  const handleContainerMouseUp = useCallback(() => setMouseDownInfo(null), []);
  const handleContainerMouseLeave = useCallback(() => setMouseDownInfo(null), []);

  const openPathInTab = useCallback(
    async (path: string) => {
      if (onFileOpen) {
        await Promise.resolve(onFileOpen(path, false));
        return;
      }
      await Promise.resolve(onFileSelect(path, false));
    },
    [onFileOpen, onFileSelect],
  );

  const collectLoadedFilesInDirectory = useCallback(
    (directoryPath: string): string[] => {
      const directory = findFileInTree(filteredFiles, directoryPath);
      if (!directory || !directory.isDir) return [];

      const collected: string[] = [];
      const walk = (entries?: FileEntry[]) => {
        if (!entries) return;
        for (const entry of entries) {
          if (entry.isDir) {
            walk(entry.children);
          } else {
            collected.push(entry.path);
          }
        }
      };

      walk(directory.children);
      return collected;
    },
    [filteredFiles],
  );

  const collectLocalFilesInDirectory = useCallback(
    async (directoryPath: string): Promise<string[]> => {
      const collected: string[] = [];
      const stack: string[] = [directoryPath];

      while (stack.length > 0) {
        const currentPath = stack.pop();
        if (!currentPath) continue;

        const entries = await readDirectory(currentPath);
        for (const entry of entries as Array<{ path: string; is_dir?: boolean }>) {
          if (!entry.path) continue;
          const isDir = !!entry.is_dir;

          if (isUserHidden(entry.path, isDir) || isGitIgnored(entry.path, isDir)) {
            continue;
          }

          if (isDir) {
            stack.push(entry.path);
          } else {
            collected.push(entry.path);
          }
        }
      }

      return collected;
    },
    [isUserHidden, isGitIgnored],
  );

  const handleOpenAllFilesInDirectory = useCallback(
    async (directoryPath: string) => {
      let filePaths: string[] = [];

      if (directoryPath.startsWith("remote://")) {
        filePaths = collectLoadedFilesInDirectory(directoryPath);
      } else {
        try {
          filePaths = await collectLocalFilesInDirectory(directoryPath);
        } catch (error) {
          console.error(
            "Failed to scan directory for Open All, falling back to loaded tree:",
            error,
          );
          filePaths = collectLoadedFilesInDirectory(directoryPath);
        }
      }

      const uniqueFilePaths = Array.from(new Set(filePaths));
      if (uniqueFilePaths.length === 0) return;

      if (uniqueFilePaths.length > 100) {
        const shouldProceed = window.confirm(
          `${uniqueFilePaths.length} files will be opened in tabs. Continue?`,
        );
        if (!shouldProceed) return;
      }

      for (const filePath of uniqueFilePaths) {
        await openPathInTab(filePath);
      }

      updateActivePath?.(uniqueFilePaths[uniqueFilePaths.length - 1]);
    },
    [collectLoadedFilesInDirectory, collectLocalFilesInDirectory, openPathInTab, updateActivePath],
  );

  // No recursive render; rows are virtualized

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
        "file-tree-container relative flex min-w-full flex-1 select-none flex-col overflow-auto p-1",
        dragState.dragOverPath === "__ROOT__" &&
          "!border-2 !border-dashed !border-accent !bg-accent !bg-opacity-10",
      )}
      ref={containerRef}
      style={{ scrollBehavior: "auto", overscrollBehavior: "contain" }}
      role="tree"
      tabIndex={0}
      onKeyDown={(e) => {
        // Let inputs handle their own keys
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) {
          return;
        }
        const index = visibleRows.findIndex((r) => r.file.path === activePath);
        const curIndex = index === -1 ? 0 : index;
        const current = visibleRows[curIndex]?.file;
        const isDir = visibleRows[curIndex]?.file.isDir;

        const toggle = (path: string) => useFileTreeStore.getState().toggleFolder(path);

        const mod = e.metaKey || e.ctrlKey;
        if (mod && current) {
          if (e.key === "c") {
            e.preventDefault();
            clipboardActions.copy([{ path: current.path, is_dir: !!isDir }]);
            return;
          }
          if (e.key === "x") {
            e.preventDefault();
            clipboardActions.cut([{ path: current.path, is_dir: !!isDir }]);
            return;
          }
          if (e.key === "v") {
            e.preventDefault();
            const sep = current.path.includes("\\") ? "\\" : "/";
            const targetDir = isDir ? current.path : current.path.split(sep).slice(0, -1).join(sep);
            if (targetDir) {
              clipboardActions.paste(targetDir).then(() => {
                onRefreshDirectory?.(targetDir);
              });
            }
            return;
          }
        }

        switch (e.key) {
          case "ArrowDown": {
            e.preventDefault();
            const next = Math.min(visibleRows.length - 1, curIndex + 1);
            const p = visibleRows[next]?.file.path;
            if (p) {
              updateActivePath?.(p);
              rowVirtualizer.scrollToIndex(next);
            }
            break;
          }
          case "ArrowUp": {
            e.preventDefault();
            const prev = Math.max(0, curIndex - 1);
            const p = visibleRows[prev]?.file.path;
            if (p) {
              updateActivePath?.(p);
              rowVirtualizer.scrollToIndex(prev);
            }
            break;
          }
          case "Home": {
            e.preventDefault();
            if (visibleRows[0]) {
              updateActivePath?.(visibleRows[0].file.path);
              rowVirtualizer.scrollToIndex(0);
            }
            break;
          }
          case "End": {
            e.preventDefault();
            if (visibleRows.length) {
              const last = visibleRows.length - 1;
              updateActivePath?.(visibleRows[last].file.path);
              rowVirtualizer.scrollToIndex(last);
            }
            break;
          }
          case "ArrowRight": {
            if (!current) break;
            e.preventDefault();
            if (isDir) {
              const expanded = useFileTreeStore.getState().isExpanded(current.path);
              if (!expanded) {
                toggle(current.path);
              } else {
                const child = visibleRows[curIndex + 1];
                if (child && child.depth === visibleRows[curIndex].depth + 1) {
                  updateActivePath?.(child.file.path);
                  rowVirtualizer.scrollToIndex(curIndex + 1);
                }
              }
            }
            break;
          }
          case "ArrowLeft": {
            if (!current) break;
            e.preventDefault();
            if (isDir && useFileTreeStore.getState().isExpanded(current.path)) {
              toggle(current.path);
            } else {
              const sep = current.path.includes("\\") ? "\\" : "/";
              const parentPath = current.path.split(sep).slice(0, -1).join(sep);
              const parentIdx = visibleRows.findIndex((r) => r.file.path === parentPath);
              if (parentIdx >= 0) {
                updateActivePath?.(parentPath);
                rowVirtualizer.scrollToIndex(parentIdx);
              }
            }
            break;
          }
          case "Enter": {
            if (!current) break;
            e.preventDefault();
            if (isDir) {
              toggle(current.path);
            } else {
              onFileOpen?.(current.path, false);
            }
            break;
          }
          case "F2": {
            if (!current) break;
            e.preventDefault();
            onRenamePath?.(current.path);
            break;
          }
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = dragState.draggedItem ? "move" : "copy";
      }}
      onDrop={handleRootDrop}
      onClick={handleContainerClick}
      onDoubleClick={handleContainerDoubleClick}
      onContextMenu={handleContainerContextMenu}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onMouseLeave={handleContainerMouseLeave}
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
        <div className="w-max min-w-full" style={{}}>
          {(() => {
            const items = rowVirtualizer.getVirtualItems();
            const paddingTop = items.length ? items[0].start : 0;
            const paddingBottom = items.length
              ? rowVirtualizer.getTotalSize() - items[items.length - 1].end
              : 0;
            return (
              <>
                <div style={{ height: paddingTop }} />
                {items.map((vi) => {
                  const row = visibleRows[vi.index];
                  return (
                    <FileTreeItem
                      key={row.file.path}
                      file={row.file}
                      depth={row.depth}
                      isExpanded={row.isExpanded}
                      activePath={activePath}
                      dragOverPath={dragState.dragOverPath}
                      isDragging={dragState.isDragging}
                      editingValue={editingValue}
                      onEditingValueChange={setEditingValue}
                      onKeyDown={handleKeyDown}
                      onBlur={handleBlur}
                      getGitStatusClass={getGitStatusClass}
                    />
                  );
                })}
                <div style={{ height: paddingBottom }} />
              </>
            );
          })()}
        </div>
      )}

      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="context-menu fixed z-100 rounded-md border border-border bg-secondary-bg py-1"
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
                  icon={FolderOpen}
                  label="Open All Files"
                  onClick={() => {
                    const targetPath = contextMenu.path;
                    setContextMenu(null);
                    void handleOpenAllFilesInDirectory(targetPath);
                  }}
                />
                <ContextMenuItem
                  icon={Terminal}
                  label="Open in Terminal"
                  onClick={() => {
                    const folderName = contextMenu.path.split("/").pop() || "terminal";
                    const { openTerminalBuffer } = useBufferStore.getState().actions;
                    openTerminalBuffer({
                      name: folderName,
                      workingDirectory: contextMenu.path,
                    });
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
              icon={Copy}
              label="Copy"
              onClick={() => {
                clipboardActions.copy([{ path: contextMenu.path, is_dir: contextMenu.isDir }]);
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              icon={Scissors}
              label="Cut"
              onClick={() => {
                clipboardActions.cut([{ path: contextMenu.path, is_dir: contextMenu.isDir }]);
                setContextMenu(null);
              }}
            />
            {clipboard && contextMenu.isDir && (
              <ContextMenuItem
                icon={Clipboard}
                label="Paste"
                onClick={() => {
                  clipboardActions.paste(contextMenu.path).then(() => {
                    onRefreshDirectory?.(contextMenu.path);
                  });
                  setContextMenu(null);
                }}
              />
            )}
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
