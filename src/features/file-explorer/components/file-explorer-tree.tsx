import ignore from "ignore";
import {
  CheckIcon as Check,
  EyeIcon as Eye,
  GitBranchIcon as GitBranch,
  MagnifyingGlassIcon as Search,
  WarningIcon as AlertTriangle,
} from "@phosphor-icons/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import { useEventListener } from "usehooks-ts";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import {
  collectFileTreeSearchHits,
  filterFileTreeEntries,
  filterFileTreeForFffHits,
  getGuideAncestorRows,
} from "@/features/file-explorer/lib/visible-file-tree-rows";
import {
  createFileTreeGitStatusLookup,
  getFileTreeEntryGitStatusDecoration,
  type FileTreeGitStatusDecoration,
  type FileTreeGitStatusLookup,
} from "@/features/file-explorer/lib/file-tree-git-status";
import {
  collectGitIgnoreFileReferences,
  createFileTreeGitIgnoreRules,
  isPathGitIgnoredByFileTreeRules,
  type FileTreeGitIgnoreRules,
  type GitIgnoreFileContent,
} from "@/features/file-explorer/lib/file-tree-gitignore";
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import { findFileInTree } from "@/features/file-system/controllers/file-tree-utils";
import { readDirectory, readFile } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useFffSearch } from "@/features/global-search/hooks/use-fff-search";
import { useGitStore } from "@/features/git/stores/git.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import type { MenuItem } from "@/ui/dropdown";
import { SidebarEmptyActionState, SidebarSearchFilterRow } from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { frontendTrace } from "@/utils/frontend-trace";
import {
  getDirName,
  getRelativePath,
  joinPath,
  pathStartsWithRoot,
  stripTrailingPathSeparators,
} from "@/utils/path-helpers";
import { useFileExplorerContextMenu } from "../hooks/use-file-explorer-context-menu";
import { useFileExplorerDragDrop } from "../hooks/use-file-explorer-drag-drop";
import { useFileExplorerSync } from "../hooks/use-file-explorer-sync";
import { useFileExplorerVisibleRows } from "../hooks/use-file-explorer-visible-rows";
import { FileExplorerTreeItem } from "./file-explorer-tree-item";
import type { FileTreeGuideTarget } from "./file-explorer-tree-item";
import "../styles/file-explorer-tree.css";

const ALWAYS_HIDDEN_FILE_NAMES = new Set([".ds_store"]);
const OPEN_ALL_FILES_LIMIT = 1_000;
const OPEN_ALL_FILES_BATCH_SIZE = 8;
const yieldToFileExplorer = () =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

const isAlwaysHiddenFileName = (name: string): boolean =>
  ALWAYS_HIDDEN_FILE_NAMES.has(name.toLowerCase());

const isHiddenFileTreeName = (name: string): boolean => name.startsWith(".") && name.length > 1;

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
  onFileSelect: (path: string, isDir: boolean) => void | Promise<void>;
  onFileOpen?: (path: string, isDir: boolean) => void | Promise<void>;
  onCreateNewFileInDirectory: (
    directoryPath: string,
    fileName: string,
  ) => void | string | Promise<string | undefined>;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onUpdateFiles?: (files: FileEntry[]) => void;
  onRenamePath?: (path: string, newName?: string) => void;
  onDuplicatePath?: (path: string) => void;
  onRefreshDirectory?: (path: string, options?: { force?: boolean }) => void;
  onRevealInFinder?: (path: string) => void;
  onUploadFile?: (directoryPath: string) => void;
  onFileMove?: (oldPath: string, newPath: string) => void;
}

interface FileExplorerAlertDialogState {
  title: string;
  message: string;
}

interface OpenAllFilesDialogState {
  filePaths: string[];
}

const FILE_TREE_SEARCH_DEBOUNCE_DELAY = 80;
const FILE_TREE_SEARCH_RESULT_LIMIT = 500;
const getFileTreeRowId = (path: string) => `file-tree-row-${path.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

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
  const [alertDialog, setAlertDialog] = useState<FileExplorerAlertDialogState | null>(null);
  const [openAllFilesDialog, setOpenAllFilesDialog] = useState<OpenAllFilesDialogState | null>(
    null,
  );
  const [isDeletingPath, setIsDeletingPath] = useState(false);
  const [isOpeningAllFiles, setIsOpeningAllFiles] = useState(false);
  const [editingValue, setEditingValue] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | undefined>(activePath);
  const [hasTreeFocus, setHasTreeFocus] = useState(false);
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);
  const [treeSearchQuery, setTreeSearchQuery] = useState("");
  const [debouncedTreeSearchQuery] = useDebounce(treeSearchQuery, FILE_TREE_SEARCH_DEBOUNCE_DELAY);
  const [isFileTreeFilterMenuOpen, setIsFileTreeFilterMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<Document>(document);

  const [gitIgnoreRules, setGitIgnoreRules] = useState<FileTreeGitIgnoreRules | null>(null);
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const currentWorkspaceRepoPath = useGitStore((state) => state.currentWorkspaceRepoPath);

  const fileTreeSettings = useSettingsStore(
    useShallow((state) => ({
      fileTreeDensity: state.settings.fileTreeDensity,
      fileTreeIndentSize: state.settings.fileTreeIndentSize,
      hiddenDirectoryPatterns: state.settings.hiddenDirectoryPatterns,
      hiddenFilePatterns: state.settings.hiddenFilePatterns,
      showGitignoredFilesInFileTree: state.settings.showGitignoredFilesInFileTree,
      showGitStatusInFileTree: state.settings.showGitStatusInFileTree,
      showHiddenFilesInFileTree: state.settings.showHiddenFilesInFileTree,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const cutClipboardEntries = useFileClipboardStore((state) =>
    state.clipboard?.operation === "cut" ? state.clipboard.entries : null,
  );
  const cutFilePaths = useMemo(
    () => new Set(cutClipboardEntries?.map((entry) => entry.path) ?? []),
    [cutClipboardEntries],
  );
  const fileTreeDensity = fileTreeSettings.fileTreeDensity;
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const addFolderToWorkspace = useFileSystemStore((state) => state.addFolderToWorkspace);
  const removeFolderFromWorkspace = useFileSystemStore((state) => state.removeFolderFromWorkspace);
  const revealPathInTree = useFileSystemStore((state) => state.revealPathInTree);

  const handleAutoExpandDirectory = useCallback(
    (path: string) => {
      if (useFileTreeStore.getState().isExpanded(path)) return;
      void Promise.resolve(onFileSelect(path, true));
    },
    [onFileSelect],
  );

  const showAlertDialog = useCallback((title: string, message: string) => {
    setAlertDialog({ title, message });
  }, []);

  const handleMoveError = useCallback(
    (message: string) => showAlertDialog("Move Failed", message),
    [showAlertDialog],
  );

  const { dragState, startDrag } = useFileExplorerDragDrop(
    rootFolderPath,
    onFileMove,
    handleAutoExpandDirectory,
    handleMoveError,
  );

  const [mouseDownInfo, setMouseDownInfo] = useState<{
    x: number;
    y: number;
    file: FileEntry;
  } | null>(null);

  const userIgnore = useMemo(() => {
    const ig = ignore();
    if (fileTreeSettings.hiddenFilePatterns.length > 0) {
      ig.add(fileTreeSettings.hiddenFilePatterns);
    }
    if (fileTreeSettings.hiddenDirectoryPatterns.length > 0) {
      ig.add(fileTreeSettings.hiddenDirectoryPatterns.map((p) => (p.endsWith("/") ? p : `${p}/`)));
    }
    return ig;
  }, [fileTreeSettings.hiddenFilePatterns, fileTreeSettings.hiddenDirectoryPatterns]);

  const workspaceRootPaths = useMemo(() => {
    const roots: string[] = [];
    let hasRootFolderPath = false;

    for (const file of files) {
      if (!file.isDir) continue;
      roots.push(file.path);
      if (file.path === rootFolderPath) {
        hasRootFolderPath = true;
      }
    }

    if (rootFolderPath && !hasRootFolderPath) {
      roots.unshift(rootFolderPath);
    }

    return roots;
  }, [files, rootFolderPath]);

  const getWorkspaceRootForPath = useCallback(
    (path: string) => workspaceRootPaths.find((rootPath) => pathStartsWithRoot(path, rootPath)),
    [workspaceRootPaths],
  );

  const isUserHidden = useCallback(
    (fullPath: string, isDir: boolean): boolean => {
      const matchedRootPath = getWorkspaceRootForPath(fullPath);
      if (!matchedRootPath) return false;

      let relative = getRelativePath(fullPath, matchedRootPath);
      if (!relative || relative.trim() === "") return false;
      if (isDir && !relative.endsWith("/")) relative += "/";
      return userIgnore.ignores(relative);
    },
    [getWorkspaceRootForPath, userIgnore],
  );

  const gitIgnoreFileReferences = useMemo(
    () => collectGitIgnoreFileReferences(files, rootFolderPath),
    [files, rootFolderPath],
  );

  useEffect(() => {
    let cancelled = false;

    const loadGitignore = async () => {
      if (!rootFolderPath) {
        setGitIgnoreRules(null);
        return;
      }

      const ignoreFiles = await Promise.all(
        gitIgnoreFileReferences.map(async (file): Promise<GitIgnoreFileContent | null> => {
          try {
            return {
              ...file,
              content: await readFile(file.path),
            };
          } catch {
            return null;
          }
        }),
      );

      if (!cancelled) {
        setGitIgnoreRules(
          createFileTreeGitIgnoreRules(
            rootFolderPath,
            ignoreFiles.filter((file): file is GitIgnoreFileContent => file !== null),
          ),
        );
      }
    };

    loadGitignore();

    return () => {
      cancelled = true;
    };
  }, [gitIgnoreFileReferences, rootFolderPath]);

  const gitStatus =
    currentWorkspaceRepoPath && currentWorkspaceRepoPath === rootFolderPath
      ? workspaceGitStatus
      : null;

  const isGitIgnored = useCallback(
    (fullPath: string, isDir: boolean): boolean => {
      if (!gitIgnoreRules || !rootFolderPath) return false;
      if (getWorkspaceRootForPath(fullPath) !== rootFolderPath) return false;

      return isPathGitIgnoredByFileTreeRules(gitIgnoreRules, fullPath, isDir);
    },
    [getWorkspaceRootForPath, gitIgnoreRules, rootFolderPath],
  );

  const gitStatusDecorationLookup = useMemo(() => {
    const startedAt = performance.now();
    if (!gitStatus || !fileTreeSettings.showGitStatusInFileTree)
      return null as FileTreeGitStatusLookup | null;

    const lookup = createFileTreeGitStatusLookup(gitStatus);

    frontendTrace("info", "file-tree", "gitStatusDecorationLookup:computed", {
      gitFiles: gitStatus.files.length,
      filesMapSize: lookup.files.size,
      directoriesMapSize: lookup.directories.size,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
    return lookup;
  }, [fileTreeSettings.showGitStatusInFileTree, gitStatus]);

  const getGitStatusDecoration = useCallback(
    (file: FileEntry): FileTreeGitStatusDecoration | null =>
      getWorkspaceRootForPath(file.path) === rootFolderPath
        ? getFileTreeEntryGitStatusDecoration(file, rootFolderPath, gitStatusDecorationLookup)
        : null,
    [getWorkspaceRootForPath, gitStatusDecorationLookup, rootFolderPath],
  );

  const filteredFiles = useMemo(() => {
    const startedAt = performance.now();
    const result = filterFileTreeEntries(files, {
      isAlwaysHidden: isAlwaysHiddenFileName,
      isGitIgnored,
      isHiddenName: isHiddenFileTreeName,
      isUserHidden,
      showGitignoredFiles: fileTreeSettings.showGitignoredFilesInFileTree,
      showHiddenFiles: fileTreeSettings.showHiddenFilesInFileTree,
    });
    frontendTrace("info", "file-tree", "filteredFiles:computed", {
      rootItems: files.length,
      filteredRootItems: result.length,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
    return result;
  }, [
    files,
    isGitIgnored,
    isUserHidden,
    fileTreeSettings.showGitignoredFilesInFileTree,
    fileTreeSettings.showHiddenFilesInFileTree,
  ]);

  useFileExplorerSync({
    activePath,
    updateActivePath,
    revealPathInTree,
  });

  const isTreeSearchActive = treeSearchQuery.trim().length > 0;
  const isDebouncedTreeSearchActive = debouncedTreeSearchQuery.trim().length > 0;
  const { hits: treeSearchHits, isSearching: isFffTreeSearchSearching } = useFffSearch(
    debouncedTreeSearchQuery,
    isDebouncedTreeSearchActive,
    rootFolderPath,
    FILE_TREE_SEARCH_RESULT_LIMIT,
  );
  const isTreeSearchSettling =
    isTreeSearchActive && treeSearchQuery.trim() !== debouncedTreeSearchQuery.trim();
  const isTreeSearchSearching =
    isTreeSearchActive && (isTreeSearchSettling || isFffTreeSearchSearching);
  const effectiveTreeSearchHits = useMemo(
    () =>
      rootFolderPath?.startsWith("wsl://")
        ? collectFileTreeSearchHits(
            filteredFiles,
            debouncedTreeSearchQuery,
            FILE_TREE_SEARCH_RESULT_LIMIT,
          )
        : treeSearchHits,
    [debouncedTreeSearchQuery, filteredFiles, rootFolderPath, treeSearchHits],
  );
  const treeSearchResult = useMemo(
    () => filterFileTreeForFffHits(filteredFiles, effectiveTreeSearchHits),
    [effectiveTreeSearchHits, filteredFiles],
  );
  const displayedFiles =
    isTreeSearchActive && !isTreeSearchSearching
      ? treeSearchResult.files
      : isTreeSearchActive
        ? []
        : filteredFiles;
  const displayedExpandedPaths =
    isTreeSearchActive && !isTreeSearchSearching ? treeSearchResult.expandedPaths : undefined;
  const hasActiveFileTreeFilters =
    !fileTreeSettings.showHiddenFilesInFileTree ||
    !fileTreeSettings.showGitignoredFilesInFileTree ||
    !fileTreeSettings.showGitStatusInFileTree;
  const fileTreeFilterMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: "hidden-files",
        label: "Hidden Files",
        icon: <Eye />,
        keybinding: fileTreeSettings.showHiddenFilesInFileTree ? (
          <Check className="size-3.5 text-accent" />
        ) : null,
        onClick: () =>
          void updateSetting(
            "showHiddenFilesInFileTree",
            !fileTreeSettings.showHiddenFilesInFileTree,
          ),
      },
      {
        id: "gitignored-files",
        label: "Gitignored Files",
        icon: <GitBranch />,
        keybinding: fileTreeSettings.showGitignoredFilesInFileTree ? (
          <Check className="size-3.5 text-accent" />
        ) : null,
        onClick: () =>
          void updateSetting(
            "showGitignoredFilesInFileTree",
            !fileTreeSettings.showGitignoredFilesInFileTree,
          ),
      },
      { id: "sep-status", label: "", separator: true, onClick: () => {} },
      {
        id: "git-status",
        label: "Git Status",
        icon: <GitBranch />,
        keybinding: fileTreeSettings.showGitStatusInFileTree ? (
          <Check className="size-3.5 text-accent" />
        ) : null,
        onClick: () =>
          void updateSetting("showGitStatusInFileTree", !fileTreeSettings.showGitStatusInFileTree),
      },
    ],
    [
      fileTreeSettings.showGitStatusInFileTree,
      fileTreeSettings.showGitignoredFilesInFileTree,
      fileTreeSettings.showHiddenFilesInFileTree,
      updateSetting,
    ],
  );

  const { visibleRows, visibleRowIndexByPath, rowVirtualizer } = useFileExplorerVisibleRows({
    files: displayedFiles,
    activePath,
    containerRef,
    expandedPathsOverride: displayedExpandedPaths,
    rootFolderPath,
  });
  const keyboardPath = focusedPath || activePath;
  const highlightedPath = hasTreeFocus ? keyboardPath : activePath;

  useEffect(() => {
    if (!hasTreeFocus) {
      setFocusedPath(activePath);
    }
  }, [activePath, hasTreeFocus]);

  useEffect(() => {
    if (!treeSearchOpen) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    return () => cancelAnimationFrame(rafId);
  }, [treeSearchOpen]);

  const closeTreeSearch = useCallback(() => {
    setTreeSearchOpen(false);
    setTreeSearchQuery("");
    containerRef.current?.focus();
  }, []);

  const treeSearchMatchIndexes = useMemo(() => {
    if (!isTreeSearchActive || treeSearchResult.matchedPaths.size === 0) return [];

    const indexes: number[] = [];
    for (const path of treeSearchResult.orderedMatchedPaths) {
      const index = visibleRowIndexByPath.get(path);
      if (index !== undefined) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [
    isTreeSearchActive,
    treeSearchResult.matchedPaths,
    treeSearchResult.orderedMatchedPaths,
    visibleRowIndexByPath,
  ]);

  const navigateTreeSearchMatch = useCallback(
    (direction: 1 | -1) => {
      if (!isTreeSearchActive || treeSearchMatchIndexes.length === 0) return;

      const currentIndex = keyboardPath ? (visibleRowIndexByPath.get(keyboardPath) ?? -1) : -1;
      const fallbackIndex =
        direction > 0
          ? treeSearchMatchIndexes[0]
          : treeSearchMatchIndexes[treeSearchMatchIndexes.length - 1];
      let nextIndex = fallbackIndex;

      if (direction > 0) {
        for (const index of treeSearchMatchIndexes) {
          if (index > currentIndex) {
            nextIndex = index;
            break;
          }
        }
      } else {
        for (let index = treeSearchMatchIndexes.length - 1; index >= 0; index--) {
          const matchIndex = treeSearchMatchIndexes[index];
          if (matchIndex < currentIndex) {
            nextIndex = matchIndex;
            break;
          }
        }
      }
      const nextPath = visibleRows[nextIndex]?.file.path;

      if (nextPath) {
        setFocusedPath(nextPath);
        rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
      }
    },
    [
      isTreeSearchActive,
      keyboardPath,
      rowVirtualizer,
      treeSearchMatchIndexes,
      visibleRowIndexByPath,
      visibleRows,
    ],
  );

  useEffect(() => {
    if (!isTreeSearchActive || treeSearchMatchIndexes.length === 0) return;
    if (keyboardPath && treeSearchResult.matchedPaths.has(keyboardPath)) return;

    const firstMatchIndex = treeSearchMatchIndexes[0];
    const firstMatchPath = visibleRows[firstMatchIndex]?.file.path;

    if (!firstMatchPath) return;

    setFocusedPath(firstMatchPath);
    rowVirtualizer.scrollToIndex(firstMatchIndex, { align: "auto" });
  }, [
    isTreeSearchActive,
    keyboardPath,
    rowVirtualizer,
    treeSearchResult.matchedPaths,
    treeSearchMatchIndexes,
    visibleRows,
  ]);

  useEffect(() => {
    const handleFileTreeOpenSearch = () => {
      setTreeSearchOpen(true);
    };

    window.addEventListener("file-tree-open-search", handleFileTreeOpenSearch);
    return () => window.removeEventListener("file-tree-open-search", handleFileTreeOpenSearch);
  }, []);

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

    if (parentPath === getDirName(files[0]?.path ?? "") || !parentPath) {
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
      let parentPath = stripTrailingPathSeparators(item.path);
      if (!parentPath && rootFolderPath) parentPath = rootFolderPath;

      if (!parentPath) {
        showAlertDialog("Cannot Create File", "Cannot determine where to create the file.");
        return;
      }

      if (item.isRenaming) {
        onRenamePath?.(item.path, newName.trim());
        return;
      }

      if (item.isDir) {
        const folder = findFileInTree(files, joinPath(parentPath, newName.trim()));
        if (folder) {
          showAlertDialog("Folder Already Exists", "A folder with this name already exists.");
          return;
        }
        onCreateNewFolderInDirectory?.(parentPath, newName.trim());
      } else {
        const file = findFileInTree(files, joinPath(parentPath, newName.trim()));
        if (file) {
          showAlertDialog("File Already Exists", "A file with this name already exists.");
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
          if (collected.length >= OPEN_ALL_FILES_LIMIT) return;
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
      let stackCursor = 0;

      while (stackCursor < stack.length) {
        if (collected.length >= OPEN_ALL_FILES_LIMIT) break;
        const batchEnd = Math.min(stackCursor + 8, stack.length);
        const currentBatch = stack.slice(stackCursor, batchEnd);
        stackCursor = batchEnd;
        const directoryEntries = await Promise.all(
          currentBatch.map((currentPath) => readDirectory(currentPath)),
        );

        for (const entries of directoryEntries) {
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

            if (isUserHidden(entry.path, isDir)) {
              continue;
            }

            if (!fileTreeSettings.showHiddenFilesInFileTree && isHiddenFileTreeName(entryName)) {
              continue;
            }

            if (
              !fileTreeSettings.showGitignoredFilesInFileTree &&
              isGitIgnored(entry.path, isDir)
            ) {
              continue;
            }

            if (isDir) {
              stack.push(entry.path);
            } else {
              if (collected.length >= OPEN_ALL_FILES_LIMIT) break;
              collected.push(entry.path);
            }
          }
        }

        await yieldToFileExplorer();
      }

      return collected;
    },
    [
      isUserHidden,
      isGitIgnored,
      fileTreeSettings.showGitignoredFilesInFileTree,
      fileTreeSettings.showHiddenFilesInFileTree,
    ],
  );

  const openFilePathsInTabs = useCallback(
    async (filePaths: string[]) => {
      for (let index = 0; index < filePaths.length; index++) {
        const filePath = filePaths[index];
        await openPathInTab(filePath);
        if ((index + 1) % OPEN_ALL_FILES_BATCH_SIZE === 0) {
          await yieldToFileExplorer();
        }
      }

      updateActivePath?.(filePaths[filePaths.length - 1]);
    },
    [openPathInTab, updateActivePath],
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

      const seenFilePaths = new Set<string>();
      const uniqueFilePaths: string[] = [];
      for (const filePath of filePaths) {
        if (seenFilePaths.has(filePath)) continue;
        seenFilePaths.add(filePath);
        uniqueFilePaths.push(filePath);
      }
      if (uniqueFilePaths.length === 0) return;

      if (uniqueFilePaths.length > 100) {
        setOpenAllFilesDialog({ filePaths: uniqueFilePaths });
        return;
      }

      await openFilePathsInTabs(uniqueFilePaths);
    },
    [collectLoadedFilesInDirectory, collectLocalFilesInDirectory, openFilePathsInTabs],
  );

  const handleOpenAllFilesConfirm = useCallback(async () => {
    if (!openAllFilesDialog) return;

    setIsOpeningAllFiles(true);
    try {
      await openFilePathsInTabs(openAllFilesDialog.filePaths);
      setOpenAllFilesDialog(null);
    } finally {
      setIsOpeningAllFiles(false);
    }
  }, [openAllFilesDialog, openFilePathsInTabs]);

  const { setContextMenu, handleContextMenu, contextMenuElement } = useFileExplorerContextMenu({
    rootFolderPath,
    onFileSelect,
    onCreateNewFileInDirectory,
    onCreateNewFolderInDirectory,
    onGenerateImage,
    onRefreshDirectory,
    onRenamePath,
    onRevealInFinder,
    onUploadFile,
    onDuplicatePath,
    onAddFolderToWorkspace: () => {
      void addFolderToWorkspace();
    },
    onRemoveFolderFromWorkspace: (path) => {
      void removeFolderFromWorkspace(path);
    },
    isWorkspaceRootPath: (path) => workspaceRootPaths.includes(path),
    canRemoveWorkspaceRootPath: (path) =>
      path !== rootFolderPath && workspaceRootPaths.includes(path),
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

  const toggleDirectory = useCallback(
    async (path: string) => {
      await Promise.resolve(onFileSelect(path, true));
    },
    [onFileSelect],
  );

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const t = getTargetItem(e.target);
      if (!t) {
        e.preventDefault();
        e.stopPropagation();
        setFocusedPath(undefined);
        updateActivePath?.("");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!t.isDir) {
        fileOpenBenchmark.ensureStarted(t.path, "explorer-click");
        fileOpenBenchmark.mark(t.path, "explorer-click");
      }
      if (t.isDir) {
        void toggleDirectory(t.path);
        setFocusedPath(t.path);
        updateActivePath?.(t.path);
      } else {
        setFocusedPath(t.path);
        void Promise.resolve(onFileSelect(t.path, false));
      }
    },
    [onFileSelect, toggleDirectory, updateActivePath, pathToFile],
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
      setFocusedPath(t.path);
      void Promise.resolve(onFileOpen?.(t.path, t.isDir));
      if (t.isDir) {
        updateActivePath?.(t.path);
      }
    },
    [onFileOpen, updateActivePath, pathToFile],
  );

  const handleContainerContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const t = getTargetItem(e.target);
      if (t) {
        handleContextMenu(e, t.path, t.isDir);
        return;
      }

      if (rootFolderPath) {
        handleContextMenu(e, rootFolderPath, true);
      }
    },
    [handleContextMenu, pathToFile, rootFolderPath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, file: FileEntry) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finishInlineEditing(file, editingValue);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelInlineEditing(file);
      }
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
        "file-tree-container relative flex min-w-full flex-1 select-none flex-col overflow-auto p-0",
        dragState.dragOverPath === "__ROOT__" &&
          "border-2! border-dashed! border-accent! bg-accent! bg-opacity-10!",
      )}
      ref={containerRef}
      style={{ scrollBehavior: "auto", overscrollBehavior: "contain" }}
      role="tree"
      aria-label="File Explorer"
      aria-activedescendant={highlightedPath ? getFileTreeRowId(highlightedPath) : undefined}
      tabIndex={0}
      onFocusCapture={() => {
        setHasTreeFocus(true);
        setFocusedPath((current) => current || activePath || visibleRows[0]?.file.path);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHasTreeFocus(false);
        }
      }}
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          setTreeSearchOpen(true);
          return;
        }

        if (!mod && !e.altKey && !e.shiftKey && e.key === "/") {
          e.preventDefault();
          e.stopPropagation();
          setTreeSearchOpen(true);
          return;
        }

        // Let inputs handle their own keys
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) {
          return;
        }
        const index = keyboardPath ? (visibleRowIndexByPath.get(keyboardPath) ?? -1) : -1;
        const curIndex = index === -1 ? 0 : index;
        const current = visibleRows[curIndex]?.file;
        const isDir = visibleRows[curIndex]?.file.isDir;

        const clipboardActions = useFileClipboardStore.getState().actions;
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
                onRefreshDirectory?.(targetDir, { force: true });
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
            containerRef.current?.focus();
            break;
          }
          case "ArrowDown": {
            e.preventDefault();
            const next = Math.min(visibleRows.length - 1, curIndex + 1);
            const p = visibleRows[next]?.file.path;
            if (p) {
              setFocusedPath(p);
              rowVirtualizer.scrollToIndex(next);
            }
            break;
          }
          case "ArrowUp": {
            e.preventDefault();
            const prev = Math.max(0, curIndex - 1);
            const p = visibleRows[prev]?.file.path;
            if (p) {
              setFocusedPath(p);
              rowVirtualizer.scrollToIndex(prev);
            }
            break;
          }
          case "Home": {
            e.preventDefault();
            if (visibleRows[0]) {
              setFocusedPath(visibleRows[0].file.path);
              rowVirtualizer.scrollToIndex(0);
            }
            break;
          }
          case "End": {
            e.preventDefault();
            if (visibleRows.length) {
              const last = visibleRows.length - 1;
              setFocusedPath(visibleRows[last].file.path);
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
                void toggleDirectory(current.path);
              } else {
                const child = visibleRows[curIndex + 1];
                if (child && child.depth === visibleRows[curIndex].depth + 1) {
                  setFocusedPath(child.file.path);
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
              void toggleDirectory(current.path);
            } else {
              const sep = current.path.includes("\\") ? "\\" : "/";
              const parentPath = current.path.split(sep).slice(0, -1).join(sep);
              const parentIdx = visibleRowIndexByPath.get(parentPath) ?? -1;
              if (parentIdx >= 0) {
                setFocusedPath(parentPath);
                rowVirtualizer.scrollToIndex(parentIdx);
              }
            }
            break;
          }
          case "Enter": {
            if (!current) break;
            e.preventDefault();
            if (isDir) {
              void toggleDirectory(current.path);
            } else {
              void Promise.resolve(onFileOpen?.(current.path, false));
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
      <SidebarSearchFilterRow
        value={treeSearchQuery}
        onChange={setTreeSearchQuery}
        searchIcon={Search}
        placeholder="Search"
        searchAriaLabel="Filter files in tree"
        searchInputRef={searchInputRef}
        searchInputProps={{
          "aria-controls": "file-tree-results",
          autoCapitalize: "none",
          autoComplete: "off",
          autoCorrect: "off",
          spellCheck: "false",
          onKeyDown: (e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeTreeSearch();
              return;
            }

            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              navigateTreeSearchMatch(e.shiftKey ? -1 : 1);
            }
          },
        }}
        filterOpen={isFileTreeFilterMenuOpen}
        onFilterOpenChange={setIsFileTreeFilterMenuOpen}
        filterItems={fileTreeFilterMenuItems}
        filterActive={hasActiveFileTreeFilters}
        filterTooltip="Filter Files"
        filterAriaLabel="Filter files"
        filterCloseOnSelect={false}
        filterMenuClassName="w-fit min-w-fit"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      {!rootFolderPath ? (
        <div className="file-tree-empty-state absolute inset-0 flex items-center justify-center">
          <SidebarEmptyActionState
            message="No folder open"
            actionLabel="Open Folder"
            onAction={handleOpenFolder}
          />
        </div>
      ) : displayedFiles.length === 0 ? (
        <div className="file-tree-empty-state absolute inset-0 flex items-center justify-center">
          <SidebarEmptyActionState
            message={
              isTreeSearchSearching
                ? "Searching files"
                : isTreeSearchActive
                  ? "No matching files"
                  : "Folder is empty"
            }
          />
        </div>
      ) : (
        <div id="file-tree-results" className="file-tree-scroll-body p-1">
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
                  const previousRow = visibleRows[vi.index - 1];
                  const nextRow = visibleRows[vi.index + 1];
                  const isEditingRow = row.file.isEditing || row.file.isRenaming;
                  const guideTargets: Array<FileTreeGuideTarget | null> = getGuideAncestorRows(
                    visibleRows,
                    vi.index,
                  ).map((ancestor) =>
                    ancestor
                      ? {
                          path: ancestor.file.path,
                          name: ancestor.displayName ?? ancestor.file.name,
                          isDir: ancestor.file.isDir,
                          isActive: activePath
                            ? activePath === ancestor.file.path ||
                              activePath.startsWith(`${ancestor.file.path}/`) ||
                              activePath.startsWith(`${ancestor.file.path}\\`)
                            : false,
                        }
                      : null,
                  );
                  return (
                    <FileExplorerTreeItem
                      key={row.file.path}
                      file={row.file}
                      depth={row.depth}
                      displayName={row.displayName}
                      guideTargets={guideTargets}
                      previousDepth={previousRow?.depth ?? 0}
                      nextDepth={nextRow?.depth ?? 0}
                      indentSize={fileTreeSettings.fileTreeIndentSize}
                      density={fileTreeDensity}
                      isExpanded={row.isExpanded}
                      isActive={highlightedPath === row.file.path}
                      isCut={cutFilePaths.has(row.file.path)}
                      isDragOver={dragState.dragOverPath === row.file.path}
                      isDragging={dragState.isDragging}
                      editingValue={isEditingRow ? editingValue : undefined}
                      onEditingValueChange={setEditingValue}
                      onKeyDown={handleKeyDown}
                      onBlur={handleBlur}
                      getGitStatusDecoration={getGitStatusDecoration}
                      rowId={getFileTreeRowId(row.file.path)}
                      searchQuery={isTreeSearchActive ? treeSearchQuery : undefined}
                      isSearchMatch={treeSearchResult.matchedPaths.has(row.file.path)}
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
      {alertDialog && (
        <Dialog
          title={alertDialog.title}
          icon={AlertTriangle}
          onClose={() => setAlertDialog(null)}
          footer={
            <Button onClick={() => setAlertDialog(null)} variant="accent" compact>
              OK
            </Button>
          }
        >
          <p className="text-text ui-text-xs">{alertDialog.message}</p>
        </Dialog>
      )}
      {openAllFilesDialog && (
        <Dialog
          title="Open All Files"
          icon={AlertTriangle}
          onClose={() => {
            if (!isOpeningAllFiles) setOpenAllFilesDialog(null);
          }}
          footer={
            <>
              <Button
                onClick={() => setOpenAllFilesDialog(null)}
                disabled={isOpeningAllFiles}
                variant="default"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleOpenAllFilesConfirm()}
                disabled={isOpeningAllFiles}
                variant="accent"
              >
                {isOpeningAllFiles ? "Opening..." : "Open"}
              </Button>
            </>
          }
        >
          <p className="text-text ui-text-xs">
            {openAllFilesDialog.filePaths.length} files will be opened in tabs. Continue?
          </p>
        </Dialog>
      )}
      {deleteCandidate && (
        <Dialog
          title={deleteCandidate.isDir ? "Delete Folder" : "Delete File"}
          icon={AlertTriangle}
          onClose={() => {
            if (!isDeletingPath) setDeleteCandidate(null);
          }}
          footer={
            <>
              <Button
                onClick={() => setDeleteCandidate(null)}
                disabled={isDeletingPath}
                variant="default"
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleDeleteConfirm()}
                disabled={isDeletingPath}
                variant="danger"
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeletingPath ? "Deleting..." : "Delete"}
              </Button>
            </>
          }
        >
          <p className="text-text ui-text-xs">
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
