import ignore from "ignore";
import { AlertTriangle } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventListener } from "usehooks-ts";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard-store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree-store";
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import { findFileInTree } from "@/features/file-system/controllers/file-tree-utils";
import { readDirectory, readFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { useGitStore } from "@/features/git/stores/git-store";
import type { GitFile } from "@/features/git/types/git-types";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import { useFileExplorerContextMenu } from "../hooks/use-file-explorer-context-menu";
import { useFileExplorerDragDrop } from "../hooks/use-file-explorer-drag-drop";
import { useFileExplorerSync } from "../hooks/use-file-explorer-sync";
import { useFileExplorerVisibleRows } from "../hooks/use-file-explorer-visible-rows";
import { FileExplorerTreeItem } from "./file-explorer-tree-item";
import "../styles/file-explorer-tree.css";

const ALWAYS_HIDDEN_FILE_NAMES = new Set([".ds_store"]);

const isAlwaysHiddenFileName = (name: string): boolean =>
  ALWAYS_HIDDEN_FILE_NAMES.has(name.toLowerCase());

const getPathBaseName = (path: string): string => {
  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;
  const segments = trimmedPath.split(/[\\/]/);
  return segments[segments.length - 1] || path;
};

interface FileExplorerTreeProps {
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

function FileExplorerTreeComponent({
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
}: FileExplorerTreeProps) {
  const [deleteCandidate, setDeleteCandidate] = useState<{
    path: string;
    isDir: boolean;
  } | null>(null);
  const [isDeletingPath, setIsDeletingPath] = useState(false);
  const [editingValue, setEditingValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<Document>(document);

  const [gitIgnore, setGitIgnore] = useState<ReturnType<typeof ignore> | null>(null);
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const currentWorkspaceRepoPath = useGitStore((state) => state.currentWorkspaceRepoPath);
  // sticky handled purely by CSS; no JS scanning

  const { settings } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const revealPathInTree = useFileSystemStore((state) => state.revealPathInTree);

  const { dragState, startDrag } = useFileExplorerDragDrop(rootFolderPath, onFileMove);

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

  const gitStatus =
    currentWorkspaceRepoPath && currentWorkspaceRepoPath === rootFolderPath
      ? workspaceGitStatus
      : null;

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

  const gitStatusClassLookup = useMemo(() => {
    if (!gitStatus || !settings.showGitStatusInFileTree)
      return null as null | {
        files: Map<string, string>;
        directories: Map<string, string>;
      };

    const mapStatus = (status: GitFile): string => {
      switch (status.status) {
        case "modified":
          return status.staged ? "text-git-modified-staged" : "text-git-modified";
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

    const files = new Map<string, string>();
    const directories = new Map<string, string>();

    for (const gitFile of gitStatus.files) {
      const statusClass = mapStatus(gitFile);
      if (!statusClass) continue;

      files.set(gitFile.path, statusClass);

      const segments = gitFile.path.split("/");
      let currentPath = "";
      for (let index = 0; index < segments.length - 1; index++) {
        currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
        if (!directories.has(currentPath)) {
          directories.set(currentPath, statusClass);
        }
      }
    }

    return { files, directories };
  }, [gitStatus, settings.showGitStatusInFileTree]);

  const getGitStatusClass = useCallback(
    (file: FileEntry): string => {
      if (!rootFolderPath || !gitStatusClassLookup) return "";
      const rel = getRelativePath(file.path, rootFolderPath);
      if (!rel) return "";
      const fileStatus = gitStatusClassLookup.files.get(rel);
      if (fileStatus) return fileStatus;
      if (file.isDir) {
        return gitStatusClassLookup.directories.get(rel) || "";
      }
      return "";
    },
    [gitStatusClassLookup, rootFolderPath],
  );

  const filteredFiles = useMemo(() => {
    const process = (items: FileEntry[]): FileEntry[] =>
      items
        .filter(
          (item) => !isAlwaysHiddenFileName(item.name) && !isUserHidden(item.path, item.isDir),
        )
        .map((item) => ({
          ...item,
          ignored: isGitIgnored(item.path, item.isDir),
          children: item.children ? process(item.children) : undefined,
        }));

    return process(files);
  }, [files, isGitIgnored, isUserHidden]);

  useFileExplorerSync({
    activePath,
    updateActivePath,
    revealPathInTree,
  });

  const { visibleRows, rowVirtualizer } = useFileExplorerVisibleRows({
    files: filteredFiles,
    activePath,
    containerRef,
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
          return {
            ...item,
            children: addNewItemToTree(item.children, targetPath),
          };
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
        for (const entry of entries as Array<{
          path: string;
          is_dir?: boolean;
        }>) {
          if (!entry.path) continue;
          const isDir = !!entry.is_dir;
          const entryName = getPathBaseName(entry.path);

          if (isAlwaysHiddenFileName(entryName)) {
            continue;
          }

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

  const { setContextMenu, handleContextMenu, contextMenuElement } = useFileExplorerContextMenu({
    rootFolderPath,
    onFileSelect,
    onCreateNewFolderInDirectory,
    onGenerateImage,
    onRefreshDirectory,
    onRenamePath,
    onRevealInFinder,
    onUploadFile,
    onDuplicatePath,
    onDeleteRequested: setDeleteCandidate,
    onStartInlineEditing: startInlineEditing,
    onOpenAllFilesInDirectory: handleOpenAllFilesInDirectory,
  });

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
        e.preventDefault();
        e.stopPropagation();
        updateActivePath?.("");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!t.isDir) {
        fileOpenBenchmark.ensureStarted(t.path, "explorer-click");
        fileOpenBenchmark.mark(t.path, "explorer-click");
      }
      onFileSelect(t.path, t.isDir);
      if (t.isDir) {
        updateActivePath?.(t.path);
      }
    },
    [onFileSelect, updateActivePath, pathToFile],
  );

  const handleContainerDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const t = getTargetItem(e.target);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      if (!t.isDir) {
        fileOpenBenchmark.ensureStarted(t.path, "explorer-double-click");
        fileOpenBenchmark.mark(t.path, "explorer-double-click");
      }
      onFileOpen?.(t.path, t.isDir);
      if (t.isDir) {
        updateActivePath?.(t.path);
      }
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

  // No recursive render; rows are virtualized

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteCandidate) return;

    setIsDeletingPath(true);
    try {
      await Promise.resolve(onDeletePath?.(deleteCandidate.path, deleteCandidate.isDir));
      setDeleteCandidate(null);
    } finally {
      setIsDeletingPath(false);
    }
  }, [deleteCandidate, onDeletePath]);

  useEffect(() => {
    if (!activePath || !fileOpenBenchmark.has(activePath)) return;

    fileOpenBenchmark.mark(activePath, "explorer-active-path");

    const rafId = requestAnimationFrame(() => {
      fileOpenBenchmark.mark(activePath, "explorer-painted");
    });

    return () => cancelAnimationFrame(rafId);
  }, [activePath]);

  return (
    <div
      className={cn(
        "file-tree-container relative flex min-w-full flex-1 select-none flex-col overflow-auto p-1",
        dragState.dragOverPath === "__ROOT__" &&
          "border-2! border-dashed! border-accent! bg-accent! bg-opacity-10!",
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
        const clipboardActions = useFileClipboardStore.getState().actions;

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
          case "Escape": {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu(null);
            updateActivePath?.("");
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            containerRef.current?.focus();
            break;
          }
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
          <div className="ui-font flex flex-col items-center text-center">
            <span className="text-[0.78em] text-text-lighter">No folder open</span>
            <Button
              onClick={handleOpenFolder}
              variant="ghost"
              size="sm"
              className="mt-1.5 text-[0.78em] text-accent hover:text-accent/80"
            >
              Open Folder
            </Button>
          </div>
        </div>
      ) : (
        <div className="w-max min-w-full">
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
                    <FileExplorerTreeItem
                      key={row.file.path}
                      file={row.file}
                      depth={row.depth}
                      isExpanded={row.isExpanded}
                      isActive={activePath === row.file.path}
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

      {contextMenuElement}
      {deleteCandidate && (
        <Dialog
          title={deleteCandidate.isDir ? "Delete Folder" : "Delete File"}
          icon={AlertTriangle}
          onClose={() => {
            if (!isDeletingPath) setDeleteCandidate(null);
          }}
          size="sm"
          footer={
            <>
              <Button
                onClick={() => setDeleteCandidate(null)}
                disabled={isDeletingPath}
                variant="outline"
                size="sm"
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleDeleteConfirm()}
                disabled={isDeletingPath}
                variant="danger"
                size="sm"
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeletingPath ? "Deleting..." : "Delete"}
              </Button>
            </>
          }
        >
          <p className="text-text text-xs">
            {deleteCandidate.isDir
              ? `Are you sure you want to delete the folder "${getPathBaseName(deleteCandidate.path)}" and all its contents? This action cannot be undone.`
              : `Are you sure you want to delete the file "${getPathBaseName(deleteCandidate.path)}"? This action cannot be undone.`}
          </p>
        </Dialog>
      )}
    </div>
  );
}

export const FileExplorerTree = memo(FileExplorerTreeComponent);
export default FileExplorerTree;
