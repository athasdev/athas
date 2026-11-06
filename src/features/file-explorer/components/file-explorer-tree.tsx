import ignore from "ignore";
import { toggleQuickLookPreview } from "@/utils/local-files";
import {
  ClickIcon,
  EyeIcon,
  ListIcon,
  PaletteIcon,
  SlidersIcon,
  TextIndentIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@/ui/icons";
import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import { useEventListener } from "usehooks-ts";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import {
  collectFileTreeSearchHits,
  filterFileTreeEntries,
  filterFileTreeForFffHits,
  findFileTreeRowByPrefix,
  getFileTreeParentRowIndex,
  getFileTreeRowPositions,
  getGuideAncestorRows,
  getStickyAncestorRows,
  resolveFileTreeFocusIndex,
  type FileTreeFilterCache,
  type FilterFileTreeForSearchResult,
} from "@/features/file-explorer/lib/visible-file-tree-rows";
import {
  createFileTreeGitStatusLookup,
  getFileTreeEntryGitStatusDecoration,
  type FileTreeGitStatusDecoration,
  type FileTreeGitStatusLookup,
} from "@/features/file-explorer/lib/file-tree-git-status";
import {
  collectGitIgnoreFileReferences,
  getCachedFileTreeGitIgnoreRules,
  invalidateFileTreeGitIgnoreCache,
  isPathGitIgnoredByFileTreeRules,
  readFileTreeGitIgnoreContents,
  subscribeToFileTreeGitIgnoreCacheInvalidation,
  type FileTreeGitIgnoreRules,
} from "@/features/file-explorer/services/file-tree-gitignore";
import { fileOpenBenchmark } from "@/features/editor/services/file-open-benchmark";
import { findFileInTree } from "@/features/file-system/services/file-tree-utils";
import { readDirectory, readFile } from "@/features/file-system/api/file-system-api";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useFffSearch } from "@/features/file-search/hooks/use-fff-search";
import { getNativeWorkspaceRootPaths } from "@/features/file-search/services/file-search-paths";
import { useGitStore } from "@/features/git/stores/git.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { EmptyState } from "@/ui/empty";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { SidebarFilterBar, SidebarIconButton } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { frontendTrace } from "@/utils/frontend-trace";
import { IS_MAC } from "@/utils/platform";
import {
  getBaseName,
  getDirName,
  getRelativePath,
  joinPath,
  pathStartsWithRoot,
  stripTrailingPathSeparators,
} from "@/utils/path-helpers";
import { useFileExplorerContextMenu } from "../hooks/use-file-explorer-context-menu";
import { pasteFileClipboard } from "../services/paste-file-clipboard";
import { withoutNestedEntries } from "../utils/file-tree-selection";
import { useFileExplorerDragDrop } from "../hooks/use-file-explorer-drag-drop";
import { useFileExplorerSync } from "../hooks/use-file-explorer-sync";
import {
  getVisibleFileTreeRowKey,
  useFileExplorerVisibleRows,
} from "../hooks/use-file-explorer-visible-rows";
import { getFileTreeSubtreeEnds } from "@/features/file-explorer/lib/file-tree-viewport";
import { FileExplorerViewport, type FileExplorerViewportHandle } from "./file-explorer-viewport";
import type { FileTreeScrollAlignment } from "@/features/file-explorer/lib/file-tree-viewport";
import { FileExplorerTreeItem } from "./file-explorer-tree-item";
import type { FileTreeGuideTarget } from "./file-explorer-tree-item";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { onAppEvent } from "@/utils/app-events";

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
  onFileMove?: (oldPath: string, newPath: string) => void | Promise<void>;
  /** Moves keyboard focus into the tree each time it changes, after the first value. */
  focusRequest?: number;
}

interface FileExplorerAlertDialogState {
  title: string;
  message: string;
}

interface OpenAllFilesDialogState {
  filePaths: string[];
}

interface ResolvedFileTreeSearch {
  query: string;
  result: FilterFileTreeForSearchResult;
}

const FILE_TREE_SEARCH_DEBOUNCE_DELAY = 80;
const FILE_TREE_SEARCH_RESULT_LIMIT = 500;
/** How long typed characters keep adding to one type-to-find prefix. */
const TYPE_TO_FIND_RESET_MS = 750;
/** Each tree's last scroll offset per project root, so switching back or reopening the pane keeps it. */
const scrollTopByRootPath = new Map<string, number>();

// Ids must stay unique per path and free of whitespace, since aria-activedescendant refers to them.
const getFileTreeRowId = (treeId: string, path: string) =>
  `file-tree-row-${treeId}-${path.replace(/[^a-zA-Z0-9-]/g, (character) => `_${character.charCodeAt(0).toString(16)}_`)}`;

/** Menus and dialogs portal out of the tree but still bubble their React events through it. */
const isEventInsideTree = (event: React.SyntheticEvent) =>
  event.currentTarget.contains(event.target as Node | null);

/** Selected paths without the ones inside another selected folder, which go along with it. */
function getTopLevelPaths(paths: readonly string[]): string[] {
  return paths.filter(
    (path) =>
      !paths.some(
        (other) =>
          other !== path && (path.startsWith(`${other}/`) || path.startsWith(`${other}\\`)),
      ),
  );
}

/** The tree without the unsaved new-item row, keeping every branch that did not contain one. */
function removeNewItemsFromTree(items: FileEntry[]): FileEntry[] {
  let changed = false;
  const next: FileEntry[] = [];
  for (const item of items) {
    if (item.isNewItem && item.isEditing) {
      changed = true;
      continue;
    }
    const children = item.children ? removeNewItemsFromTree(item.children) : item.children;
    if (children !== item.children) {
      changed = true;
      next.push({ ...item, children });
    } else {
      next.push(item);
    }
  }
  return changed ? next : items;
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
  focusRequest = 0,
}: FileExplorerTreeProps) {
  const [deleteCandidates, setDeleteCandidates] = useState<Array<{
    path: string;
    isDir: boolean;
  }> | null>(null);
  const [alertDialog, setAlertDialog] = useState<FileExplorerAlertDialogState | null>(null);
  const [openAllFilesDialog, setOpenAllFilesDialog] = useState<OpenAllFilesDialogState | null>(
    null,
  );
  const [isDeletingPath, setIsDeletingPath] = useState(false);
  const [isOpeningAllFiles, setIsOpeningAllFiles] = useState(false);
  const [editingValue, setEditingValue] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | undefined>(activePath);
  const [hasTreeFocus, setHasTreeFocus] = useState(false);
  // The focused row gets a ring once the keyboard moves it; a pointer press hides the ring again.
  const [isKeyboardFocusVisible, setIsKeyboardFocusVisible] = useState(false);
  // More than one selected row; a single selection is the focused or active row itself.
  const [multiSelection, setMultiSelection] = useState<ReadonlySet<string> | null>(null);
  const selectionAnchorPathRef = useRef<string | undefined>(undefined);
  const lastKeyboardIndexRef = useRef(-1);
  const typeToFindRef = useRef({ prefix: "", timestamp: 0 });
  const pendingCollapseRevealPathRef = useRef<string | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  // Read from scroll events: by the time a project switch commits, the new rows may already have
  // clamped the scroller.
  const lastScrollTopRef = useRef(0);
  const treeId = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const getRowId = useCallback((path: string) => getFileTreeRowId(treeId, path), [treeId]);
  // Folders opened or closed by hand while a filter is shown, for that filter query only.
  const [searchExpansionToggles, setSearchExpansionToggles] = useState<{
    query: string;
    paths: ReadonlySet<string>;
  } | null>(null);
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);
  const [treeSearchQuery, setTreeSearchQuery] = useState("");
  const [debouncedTreeSearchQuery] = useDebounce(treeSearchQuery, FILE_TREE_SEARCH_DEBOUNCE_DELAY);
  const viewportRef = useRef<FileExplorerViewportHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastResolvedTreeSearchRef = useRef<ResolvedFileTreeSearch | null>(null);
  const searchScrollTopRef = useRef<number | null>(null);
  const wasTreeSearchActiveRef = useRef(false);
  const documentRef = useRef<Document>(document);

  const [gitIgnoreRules, setGitIgnoreRules] = useState<FileTreeGitIgnoreRules | null>(null);
  const [gitIgnoreCacheVersion, setGitIgnoreCacheVersion] = useState(0);
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const currentWorkspaceRepoPath = useGitStore((state) => state.currentWorkspaceRepoPath);

  const fileTreeSettings = useSettingsStore(
    useShallow((state) => ({
      autoRevealActiveFileInFileTree: state.settings.autoRevealActiveFileInFileTree,
      compactFoldersInFileTree: state.settings.compactFoldersInFileTree,
      confirmBeforeFileDelete: state.settings.confirmBeforeFileDelete,
      fileTreeIndentSize: state.settings.fileTreeIndentSize,
      fileTreeSortOrder: state.settings.fileTreeSortOrder,
      hiddenDirectoryPatterns: state.settings.hiddenDirectoryPatterns,
      hiddenFilePatterns: state.settings.hiddenFilePatterns,
      hideRootFolderInFileTree: state.settings.hideRootFolderInFileTree,
      showFileIconsInFileTree: state.settings.showFileIconsInFileTree,
      showFolderArrowsInFileTree: state.settings.showFolderArrowsInFileTree,
      showGitignoredFilesInFileTree: state.settings.showGitignoredFilesInFileTree,
      showGitStatusInFileTree: state.settings.showGitStatusInFileTree,
      showHiddenFilesInFileTree: state.settings.showHiddenFilesInFileTree,
      showIndentGuidesInFileTree: state.settings.showIndentGuidesInFileTree,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const cutClipboardEntries = useFileClipboardStore((state) =>
    state.clipboard?.operation === "cut" ? state.clipboard.entries : null,
  );
  const cutFilePaths = useMemo(
    () => new Set(cutClipboardEntries?.map((entry) => entry.path) ?? []),
    [cutClipboardEntries],
  );
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const addFolderToWorkspace = useFileSystemStore((state) => state.addFolderToWorkspace);
  const removeFolderFromWorkspace = useFileSystemStore((state) => state.removeFolderFromWorkspace);
  const revealPathInTree = useFileSystemStore((state) => state.revealPathInTree);
  const workspaceFolders = useProjectStore((state) => state.workspaceFolders);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );

  useLayoutEffect(() => {
    if (!rootFolderPath) return;
    useFileTreeStore.getState().actions.expandRootOnce(rootFolderPath);
  }, [rootFolderPath]);

  const handleAutoExpandDirectory = useCallback(
    (path: string) => {
      if (useFileTreeStore.getState().actions.isExpanded(path)) return;
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

  const pressedRowRef = useRef<{ x: number; y: number; file: FileEntry } | null>(null);

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

  // Every tree update produces a new references array, but the ignore files only need reading
  // again when the set of them changes or one of them is edited.
  const collectedGitIgnoreFileReferences = useMemo(
    () => collectGitIgnoreFileReferences(files, rootFolderPath),
    [files, rootFolderPath],
  );
  const gitIgnoreFileReferencesKey = collectedGitIgnoreFileReferences
    .map((reference) => reference.path)
    .join("\n");
  const gitIgnoreFileReferencesRef = useRef(collectedGitIgnoreFileReferences);
  gitIgnoreFileReferencesRef.current = collectedGitIgnoreFileReferences;

  useEffect(
    () =>
      subscribeToFileTreeGitIgnoreCacheInvalidation((path) => {
        if (!rootFolderPath || (path && !pathStartsWithRoot(path, rootFolderPath))) return;
        setGitIgnoreCacheVersion((version) => version + 1);
      }),
    [rootFolderPath],
  );

  useEffect(() => {
    invalidateFileTreeGitIgnoreCache();
  }, [rootFolderPath]);

  useEffect(() => {
    let cancelled = false;
    const gitIgnoreFileReferences = gitIgnoreFileReferencesRef.current;

    const loadGitignore = async () => {
      if (!rootFolderPath) {
        setGitIgnoreRules(null);
        return;
      }

      const ignoreFiles = await readFileTreeGitIgnoreContents(gitIgnoreFileReferences, readFile);

      if (!cancelled) {
        setGitIgnoreRules(getCachedFileTreeGitIgnoreRules(rootFolderPath, ignoreFiles));
      }
    };

    loadGitignore();

    return () => {
      cancelled = true;
    };
  }, [gitIgnoreCacheVersion, gitIgnoreFileReferencesKey, rootFolderPath]);

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

  // A new cache whenever the rules change; within one set of rules, unchanged directories reuse
  // their filtered children.
  const fileTreeFilter = useMemo(
    () => ({
      options: {
        isAlwaysHidden: isAlwaysHiddenFileName,
        isGitIgnored,
        isHiddenName: isHiddenFileTreeName,
        isUserHidden,
        showGitignoredFiles: fileTreeSettings.showGitignoredFilesInFileTree,
        showHiddenFiles: fileTreeSettings.showHiddenFilesInFileTree,
      },
      cache: new WeakMap() as FileTreeFilterCache,
    }),
    [
      isGitIgnored,
      isUserHidden,
      fileTreeSettings.showGitignoredFilesInFileTree,
      fileTreeSettings.showHiddenFilesInFileTree,
    ],
  );

  const filteredFiles = useMemo(() => {
    const startedAt = performance.now();
    const result = filterFileTreeEntries(files, fileTreeFilter.options, fileTreeFilter.cache);
    frontendTrace("info", "file-tree", "filteredFiles:computed", {
      rootItems: files.length,
      filteredRootItems: result.length,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
    return result;
  }, [files, fileTreeFilter]);

  const { consumeRevealRequest, revealRequest } = useFileExplorerSync({
    activePath,
    autoRevealActiveFile: fileTreeSettings.autoRevealActiveFileInFileTree,
    updateActivePath,
    revealPathInTree,
  });

  const isTreeSearchActive = treeSearchQuery.trim().length > 0;
  const isDebouncedTreeSearchActive = debouncedTreeSearchQuery.trim().length > 0;
  const { hits: treeSearchHits, isSearching: isFffTreeSearchSearching } = useFffSearch(
    debouncedTreeSearchQuery,
    isDebouncedTreeSearchActive,
    nativeRootPaths,
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
    () =>
      filterFileTreeForFffHits(filteredFiles, effectiveTreeSearchHits, {
        rootPath: rootFolderPath,
      }),
    [effectiveTreeSearchHits, filteredFiles, rootFolderPath],
  );
  const currentResolvedTreeSearch = useMemo<ResolvedFileTreeSearch | null>(
    () =>
      isTreeSearchActive && !isTreeSearchSearching
        ? {
            query: debouncedTreeSearchQuery.trim(),
            result: treeSearchResult,
          }
        : null,
    [debouncedTreeSearchQuery, isTreeSearchActive, isTreeSearchSearching, treeSearchResult],
  );
  const displayedTreeSearch = isTreeSearchSearching
    ? lastResolvedTreeSearchRef.current
    : currentResolvedTreeSearch;
  const displayedTreeSearchResult = displayedTreeSearch?.result;
  const displayedFiles = displayedTreeSearchResult?.files ?? filteredFiles;
  const activeSearchExpansionToggles =
    displayedTreeSearch && searchExpansionToggles?.query === displayedTreeSearch.query
      ? searchExpansionToggles.paths
      : null;
  const displayedExpandedPaths = useMemo(() => {
    const searchExpandedPaths = displayedTreeSearchResult?.expandedPaths;
    if (!searchExpandedPaths || !activeSearchExpansionToggles) return searchExpandedPaths;
    const next = new Set(searchExpandedPaths);
    for (const path of activeSearchExpansionToggles) {
      if (next.has(path)) next.delete(path);
      else next.add(path);
    }
    return next;
  }, [activeSearchExpansionToggles, displayedTreeSearchResult]);

  useEffect(() => {
    if (!isTreeSearchActive) {
      lastResolvedTreeSearchRef.current = null;
      return;
    }

    if (currentResolvedTreeSearch) {
      lastResolvedTreeSearchRef.current = currentResolvedTreeSearch;
    }
  }, [currentResolvedTreeSearch, isTreeSearchActive]);
  const { rowHeight, visibleRows, visibleRowIndexByPath } = useFileExplorerVisibleRows({
    files: displayedFiles,
    expandedPathsOverride: displayedExpandedPaths,
    rootFolderPath,
  });
  const getStickyAncestors = useCallback(
    (index: number) =>
      getStickyAncestorRows(visibleRows, index).flatMap((row) => {
        const ancestorIndex = visibleRowIndexByPath.get(row.file.path);
        return ancestorIndex === undefined ? [] : [ancestorIndex];
      }),
    [visibleRowIndexByPath, visibleRows],
  );
  const subtreeEnds = useMemo(
    () => getFileTreeSubtreeEnds(visibleRows.map((row) => row.depth)),
    [visibleRows],
  );
  const getSubtreeEnd = useCallback((index: number) => subtreeEnds[index] ?? index, [subtreeEnds]);

  useLayoutEffect(() => {
    const wasSearchActive = wasTreeSearchActiveRef.current;
    if (isTreeSearchActive && !wasSearchActive) {
      searchScrollTopRef.current = viewportRef.current?.getScrollTop() ?? 0;
    } else if (!isTreeSearchActive && wasSearchActive) {
      const previousScrollTop = searchScrollTopRef.current;
      if (previousScrollTop !== null) {
        viewportRef.current?.setScrollTop(previousScrollTop);
      }
      searchScrollTopRef.current = null;
    }
    wasTreeSearchActiveRef.current = isTreeSearchActive;
  }, [isTreeSearchActive]);

  useLayoutEffect(() => {
    if (!revealRequest) return;

    const index = visibleRowIndexByPath.get(revealRequest.path);
    if (index === undefined) return;

    if (fileOpenBenchmark.has(revealRequest.path)) {
      fileOpenBenchmark.mark(revealRequest.path, "visible-row-found", `index=${index}`);
    }
    if (!viewportRef.current?.scrollToIndex(index, "nearest")) return;

    consumeRevealRequest(revealRequest.id);
  }, [consumeRevealRequest, revealRequest, visibleRowIndexByPath]);
  const keyboardPath = focusedPath || activePath;
  const keyboardIndex = resolveFileTreeFocusIndex(
    visibleRows,
    visibleRowIndexByPath.get,
    keyboardPath,
    lastKeyboardIndexRef.current,
  );
  const keyboardRowPath = keyboardIndex >= 0 ? visibleRows[keyboardIndex]?.file.path : undefined;
  const highlightedPath = hasTreeFocus ? keyboardRowPath : activePath;
  const rowPositions = useMemo(() => getFileTreeRowPositions(visibleRows), [visibleRows]);

  useEffect(() => {
    if (keyboardIndex >= 0) lastKeyboardIndexRef.current = keyboardIndex;
  }, [keyboardIndex]);

  // A folder closed from its sticky header or an indent guide sits above the view; without this the
  // tree keeps its offset and shows whatever rows now follow, far from the folder.
  useLayoutEffect(() => {
    const path = pendingCollapseRevealPathRef.current;
    if (!path) return;
    const index = visibleRowIndexByPath.get(path);
    if (index === undefined || visibleRows[index]?.isExpanded) return;
    pendingCollapseRevealPathRef.current = null;
    viewportRef.current?.scrollToIndex(index, "nearest");
  }, [visibleRowIndexByPath, visibleRows]);

  useLayoutEffect(() => {
    if (!rootFolderPath) return;
    const viewport = viewportRef.current;
    const savedScrollTop = scrollTopByRootPath.get(rootFolderPath) ?? 0;
    lastScrollTopRef.current = savedScrollTop;
    if (savedScrollTop > 0) {
      pendingScrollRestoreRef.current = savedScrollTop;
    } else {
      pendingScrollRestoreRef.current = null;
      viewport?.setScrollTop(0);
    }
    return () => {
      pendingScrollRestoreRef.current = null;
      scrollTopByRootPath.set(rootFolderPath, lastScrollTopRef.current);
    };
  }, [rootFolderPath]);

  useLayoutEffect(() => {
    const savedScrollTop = pendingScrollRestoreRef.current;
    if (savedScrollTop === null || visibleRows.length === 0) return;
    pendingScrollRestoreRef.current = null;
    viewportRef.current?.setScrollTop(savedScrollTop);
  }, [visibleRows]);

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
    viewportRef.current?.focus();
  }, []);

  const treeSearchMatchIndexes = useMemo(() => {
    if (!displayedTreeSearchResult || displayedTreeSearchResult.matchedPaths.size === 0) return [];

    const indexes: number[] = [];
    for (const path of displayedTreeSearchResult.orderedMatchedPaths) {
      const index = visibleRowIndexByPath.get(path);
      if (index !== undefined) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [displayedTreeSearchResult, visibleRowIndexByPath]);

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
        viewportRef.current?.scrollToIndex(nextIndex, "nearest");
      }
    },
    [isTreeSearchActive, keyboardPath, treeSearchMatchIndexes, visibleRowIndexByPath, visibleRows],
  );

  useEffect(() => {
    if (!isTreeSearchActive || treeSearchMatchIndexes.length === 0) return;
    if (keyboardPath && displayedTreeSearchResult?.matchedPaths.has(keyboardPath)) return;

    const firstMatchIndex = treeSearchMatchIndexes[0];
    const firstMatchPath = visibleRows[firstMatchIndex]?.file.path;

    if (!firstMatchPath) return;

    setFocusedPath(firstMatchPath);
    viewportRef.current?.scrollToIndex(firstMatchIndex, "nearest");
  }, [
    isTreeSearchActive,
    keyboardPath,
    displayedTreeSearchResult,
    treeSearchMatchIndexes,
    visibleRows,
  ]);

  useEffect(() => {
    const handleFileTreeOpenSearch = () => {
      setTreeSearchOpen(true);
    };

    return onAppEvent("file-tree:open-search", handleFileTreeOpenSearch);
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
      const current = useFileTreeStore.getState().actions.getExpandedPaths();
      const next = new Set(current);
      next.add(parentPath);
      useFileTreeStore.getState().actions.setExpandedPaths(next);
    } catch {}

    setEditingValue("");
  };

  const discardDraftItems = () => {
    onUpdateFiles?.(removeNewItemsFromTree(files));
    setEditingValue("");
  };

  const finishInlineEditing = (item: FileEntry, newName: string) => {
    if (!onUpdateFiles) return;

    if (item.isRenaming && !newName.trim()) {
      onRenamePath?.(item.path, getBaseName(item.path, ""));
      return;
    }

    if (newName.trim()) {
      let parentPath = stripTrailingPathSeparators(item.path);
      if (!parentPath && rootFolderPath) parentPath = rootFolderPath;

      if (!parentPath) {
        showAlertDialog("Cannot Create File", "Cannot determine where to create the file.");
        discardDraftItems();
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
          discardDraftItems();
          return;
        }
        onCreateNewFolderInDirectory?.(parentPath, newName.trim());
      } else {
        const file = findFileInTree(files, joinPath(parentPath, newName.trim()));
        if (file) {
          showAlertDialog("File Already Exists", "A file with this name already exists.");
          discardDraftItems();
          return;
        }
        onCreateNewFileInDirectory(parentPath, newName.trim());
      }
    }

    discardDraftItems();
  };

  const cancelInlineEditing = (file: FileEntry) => {
    if (!onUpdateFiles) return;

    if (file.isRenaming) {
      onRenamePath?.(file.path, getBaseName(file.path, ""));
      return;
    }

    onUpdateFiles(removeNewItemsFromTree(files));
    setEditingValue("");
  };

  // Rows are memoized; handlers that keep their identity stop every visible row from rendering
  // again on each scroll frame.
  const inlineEditingRef = useRef({ finishInlineEditing, cancelInlineEditing });
  inlineEditingRef.current = { finishInlineEditing, cancelInlineEditing };
  // The name field unmounts once it is done, which drops focus to the page; it goes back to the
  // tree unless the field was left by moving focus somewhere else.
  const returnFocusAfterInlineEdit = useCallback((nextFocusedPath?: string) => {
    if (nextFocusedPath) setFocusedPath(nextFocusedPath);
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (
        !activeElement ||
        activeElement === document.body ||
        containerRef.current?.contains(activeElement)
      ) {
        viewportRef.current?.focus();
      }
    });
  }, []);
  const handleInlineEditSubmit = useCallback(
    (value: string, file: FileEntry) => {
      inlineEditingRef.current.finishInlineEditing(file, value);
      const name = value.trim();
      const parentPath = file.isRenaming
        ? getDirName(file.path)
        : stripTrailingPathSeparators(file.path) || rootFolderPath;
      returnFocusAfterInlineEdit(name && parentPath ? joinPath(parentPath, name) : undefined);
    },
    [returnFocusAfterInlineEdit, rootFolderPath],
  );
  const handleInlineEditCancel = useCallback(
    (file: FileEntry) => {
      inlineEditingRef.current.cancelInlineEditing(file);
      returnFocusAfterInlineEdit(file.isRenaming ? file.path : undefined);
    },
    [returnFocusAfterInlineEdit],
  );

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

  const deletePaths = useCallback(
    async (candidates: Array<{ path: string; isDir: boolean }>) => {
      for (const candidate of candidates) {
        try {
          await Promise.resolve(onDeletePath?.(candidate.path, candidate.isDir));
        } catch (error) {
          toast.error(`Could not delete ${getPathBaseName(candidate.path)}`, {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    [onDeletePath],
  );

  const handleDeleteRequested = useCallback(
    (candidates: Array<{ path: string; isDir: boolean }>) => {
      if (candidates.length === 0) return;
      if (fileTreeSettings.confirmBeforeFileDelete) {
        setDeleteCandidates(candidates);
        return;
      }

      void deletePaths(candidates);
    },
    [deletePaths, fileTreeSettings.confirmBeforeFileDelete],
  );

  const getSelectedEntries = useCallback(
    () =>
      multiSelection
        ? visibleRows
            .filter((row) => multiSelection.has(row.file.path))
            .map((row) => ({ path: row.file.path, isDir: row.file.isDir }))
        : null,
    [multiSelection, visibleRows],
  );

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
    onDeleteRequested: handleDeleteRequested,
    getSelectedEntries,
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
  const pathToFile = useMemo(
    () => ({
      get: (path: string): FileEntry | undefined => {
        const index = visibleRowIndexByPath.get(path);
        return index === undefined ? undefined : visibleRows[index]?.file;
      },
    }),
    [visibleRowIndexByPath, visibleRows],
  );

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
      const index = visibleRowIndexByPath.get(path);
      const row = index === undefined ? undefined : visibleRows[index];
      if (row?.isExpanded) pendingCollapseRevealPathRef.current = path;

      // Filtered rows take their open folders from the filter, so a folder opened or closed there
      // is tracked for the filter instead of in the tree's own expanded folders.
      if (displayedTreeSearch && displayedExpandedPaths) {
        const query = displayedTreeSearch.query;
        setSearchExpansionToggles((current) => {
          const paths = new Set(current?.query === query ? current.paths : []);
          if (paths.has(path)) paths.delete(path);
          else paths.add(path);
          return { query, paths };
        });
        if (
          row &&
          !row.isExpanded &&
          !row.file.children &&
          !useFileTreeStore.getState().actions.isExpanded(path)
        ) {
          await Promise.resolve(onFileSelect(path, true));
        }
        return;
      }

      await Promise.resolve(onFileSelect(path, true));
    },
    [displayedExpandedPaths, displayedTreeSearch, onFileSelect, visibleRowIndexByPath, visibleRows],
  );

  const clearMultiSelection = useCallback((anchorPath?: string) => {
    setMultiSelection(null);
    selectionAnchorPathRef.current = anchorPath;
  }, []);

  const selectRangeTo = useCallback(
    (targetIndex: number) => {
      const anchorPath = selectionAnchorPathRef.current ?? keyboardRowPath;
      const anchorIndex =
        (anchorPath ? visibleRowIndexByPath.get(anchorPath) : undefined) ??
        (keyboardIndex >= 0 ? keyboardIndex : targetIndex);
      selectionAnchorPathRef.current = visibleRows[anchorIndex]?.file.path;
      const from = Math.min(anchorIndex, targetIndex);
      const to = Math.max(anchorIndex, targetIndex);
      if (from === to) {
        setMultiSelection(null);
        return;
      }
      const paths = new Set<string>();
      for (let index = from; index <= to; index++) {
        const path = visibleRows[index]?.file.path;
        if (path) paths.add(path);
      }
      setMultiSelection(paths);
    },
    [keyboardIndex, keyboardRowPath, visibleRowIndexByPath, visibleRows],
  );

  const toggleRowSelection = useCallback(
    (path: string) => {
      const base =
        multiSelection ??
        (highlightedPath && visibleRowIndexByPath.get(highlightedPath) !== undefined
          ? new Set([highlightedPath])
          : new Set<string>());
      const next = new Set(base);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      selectionAnchorPathRef.current = path;
      setMultiSelection(next.size > 1 ? next : null);
      setFocusedPath(next.has(path) || next.size === 0 ? path : [...next][0]);
    },
    [highlightedPath, multiSelection, visibleRowIndexByPath],
  );

  /** The rows a keyboard action applies to: the selection when the focused row is part of it. */
  const getActionTargets = useCallback((): FileEntry[] => {
    const focusedRow = keyboardIndex >= 0 ? visibleRows[keyboardIndex] : undefined;
    if (!focusedRow) return [];
    if (!multiSelection?.has(focusedRow.file.path)) return [focusedRow.file];
    return withoutNestedEntries(
      visibleRows.filter((row) => multiSelection.has(row.file.path)).map((row) => row.file),
    );
  }, [keyboardIndex, multiSelection, visibleRows]);

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isEventInsideTree(e)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      const t = getTargetItem(e.target);
      viewportRef.current?.focus();
      if (!t) {
        e.preventDefault();
        e.stopPropagation();
        setFocusedPath(undefined);
        clearMultiSelection();
        updateActivePath?.("");
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const isToggleModifier = IS_MAC ? e.metaKey : e.ctrlKey;
      if (e.shiftKey || isToggleModifier) {
        if (e.shiftKey) {
          const targetIndex = visibleRowIndexByPath.get(t.path);
          if (targetIndex !== undefined) selectRangeTo(targetIndex);
          setFocusedPath(t.path);
        } else {
          toggleRowSelection(t.path);
        }
        return;
      }

      clearMultiSelection(t.path);
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
    [
      clearMultiSelection,
      onFileSelect,
      pathToFile,
      selectRangeTo,
      toggleDirectory,
      toggleRowSelection,
      updateActivePath,
      visibleRowIndexByPath,
    ],
  );

  const handleContainerDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isEventInsideTree(e)) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
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
      if (!isEventInsideTree(e)) return;
      const t = getTargetItem(e.target);
      if (t) {
        if (!multiSelection?.has(t.path)) clearMultiSelection(t.path);
        handleContextMenu(e, t.path, t.isDir);
        return;
      }

      if (rootFolderPath) {
        handleContextMenu(e, rootFolderPath, true);
      }
    },
    [clearMultiSelection, handleContextMenu, multiSelection, pathToFile, rootFolderPath],
  );

  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const t = getTargetItem(e.target);
      if (!t) return;
      pressedRowRef.current = { x: e.clientX, y: e.clientY, file: t.file };
    },
    [pathToFile],
  );

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pressed = pressedRowRef.current;
      if (pressed && !dragState.isDragging) {
        const dx = e.clientX - pressed.x;
        const dy = e.clientY - pressed.y;
        if (Math.hypot(dx, dy) > 5) {
          const selection = multiSelection
            ? visibleRows.filter((row) => multiSelection.has(row.file.path)).map((row) => row.file)
            : undefined;
          startDrag(e, pressed.file, selection);
          pressedRowRef.current = null;
        }
      }
    },
    [dragState.isDragging, multiSelection, startDrag, visibleRows],
  );

  const releasePressedRow = useCallback(() => {
    pressedRowRef.current = null;
  }, []);

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteCandidates) return;

    setIsDeletingPath(true);
    try {
      await deletePaths(deleteCandidates);
    } finally {
      setDeleteCandidates(null);
      setIsDeletingPath(false);
      clearMultiSelection();
    }
  }, [clearMultiSelection, deleteCandidates, deletePaths]);

  useEffect(() => {
    if (focusRequest > 0) viewportRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (!activePath || !fileOpenBenchmark.has(activePath)) return;

    fileOpenBenchmark.mark(activePath, "explorer-active-path");

    const rafId = requestAnimationFrame(() => {
      fileOpenBenchmark.mark(activePath, "explorer-painted");
    });

    return () => cancelAnimationFrame(rafId);
  }, [activePath]);

  const focusRow = (index: number, alignment: FileTreeScrollAlignment = "nearest") => {
    const path = visibleRows[index]?.file.path;
    if (!path) return;
    setFocusedPath(path);
    viewportRef.current?.scrollToIndex(index, alignment);
  };

  /** Moves keyboard focus to a row; with Shift the selection grows from its anchor to the row. */
  const moveFocusTo = (
    index: number,
    extendSelection: boolean,
    alignment: FileTreeScrollAlignment = "nearest",
  ) => {
    const path = visibleRows[index]?.file.path;
    if (!path) return;
    if (extendSelection) selectRangeTo(index);
    else clearMultiSelection(path);
    focusRow(index, alignment);
  };

  const requestDelete = (targets: FileEntry[]) => {
    const candidates = getTopLevelPaths(targets.map((target) => target.path)).flatMap((path) => {
      const target = targets.find((entry) => entry.path === path);
      return target && !workspaceRootPaths.includes(path) ? [{ path, isDir: target.isDir }] : [];
    });
    if (candidates.length === 0) return;
    if (fileTreeSettings.confirmBeforeFileDelete) {
      setDeleteCandidates(candidates);
      return;
    }
    void deletePaths(candidates);
  };

  const findRowByTypedCharacter = (character: string) => {
    const now = Date.now();
    const typed = typeToFindRef.current;
    const prefix =
      now - typed.timestamp > TYPE_TO_FIND_RESET_MS ? character : `${typed.prefix}${character}`;
    typeToFindRef.current = { prefix, timestamp: now };
    return findFileTreeRowByPrefix(visibleRows, prefix, keyboardIndex);
  };

  const handleTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isEventInsideTree(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      setTreeSearchOpen(true);
      return;
    }
    // Fields and the filter bar's buttons handle their own keys.
    const control = (e.target as HTMLElement).closest(
      "input, textarea, select, button, a, [contenteditable]",
    );
    if (control && control.getAttribute("role") !== "treeitem") return;
    if (!mod && !e.altKey && !e.shiftKey && e.key === "/") {
      e.preventDefault();
      e.stopPropagation();
      setTreeSearchOpen(true);
      return;
    }
    if (e.nativeEvent.isComposing) return;
    setIsKeyboardFocusVisible(true);

    const curIndex = keyboardIndex === -1 ? 0 : keyboardIndex;
    const currentRow = visibleRows[curIndex];
    const current = currentRow?.file;
    const isDir = current?.isDir;
    const clipboardActions = useFileClipboardStore.getState().actions;
    if (mod && !e.altKey && current) {
      const key = e.key.toLowerCase();
      if (key === "c" || key === "x") {
        e.preventDefault();
        const entries = getActionTargets().map((entry) => ({
          path: entry.path,
          is_dir: entry.isDir,
        }));
        void (key === "c" ? clipboardActions.copy(entries) : clipboardActions.cut(entries));
        return;
      }
      if (key === "v") {
        e.preventDefault();
        const targetDir = isDir ? current.path : getDirName(current.path);
        if (targetDir && useFileClipboardStore.getState().clipboard) {
          void pasteFileClipboard(targetDir);
        }
        return;
      }
      if (key === "a") {
        e.preventDefault();
        if (visibleRows.length > 1) {
          setMultiSelection(new Set(visibleRows.map((row) => row.file.path)));
        }
        return;
      }
      if (IS_MAC && e.metaKey && e.key === "Backspace") {
        e.preventDefault();
        requestDelete(getActionTargets());
        return;
      }
      if (e.key === "ArrowDown" && IS_MAC && e.metaKey && !isDir) {
        e.preventDefault();
        void Promise.resolve(onFileOpen?.(current.path, false));
        return;
      }
    }
    if (mod || e.altKey) return;

    switch (e.key) {
      case "Escape": {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu(null);
        clearMultiSelection(keyboardRowPath);
        viewportRef.current?.focus();
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        moveFocusTo(
          keyboardIndex === -1 ? 0 : Math.min(visibleRows.length - 1, curIndex + 1),
          e.shiftKey,
        );
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        moveFocusTo(keyboardIndex === -1 ? 0 : Math.max(0, curIndex - 1), e.shiftKey);
        break;
      }
      case "PageDown":
      case "PageUp": {
        e.preventDefault();
        const pageRows = viewportRef.current?.getPageRowCount() ?? 1;
        const next =
          e.key === "PageDown"
            ? Math.min(visibleRows.length - 1, curIndex + pageRows)
            : Math.max(0, curIndex - pageRows);
        moveFocusTo(next, e.shiftKey);
        break;
      }
      case "Home": {
        e.preventDefault();
        moveFocusTo(0, e.shiftKey, "start");
        break;
      }
      case "End": {
        e.preventDefault();
        moveFocusTo(visibleRows.length - 1, e.shiftKey, "end");
        break;
      }
      case "ArrowRight": {
        if (!currentRow || e.shiftKey) break;
        e.preventDefault();
        if (!isDir) break;
        if (!currentRow.isExpanded) {
          void toggleDirectory(currentRow.file.path);
          break;
        }
        const child = visibleRows[curIndex + 1];
        if (child && child.depth === currentRow.depth + 1) moveFocusTo(curIndex + 1, false);
        break;
      }
      case "ArrowLeft": {
        if (!currentRow || e.shiftKey) break;
        e.preventDefault();
        if (isDir && currentRow.isExpanded) {
          void toggleDirectory(currentRow.file.path);
          break;
        }
        const parentIndex = getFileTreeParentRowIndex(visibleRows, curIndex);
        if (parentIndex >= 0) moveFocusTo(parentIndex, false);
        break;
      }
      case "Enter": {
        if (!current || e.shiftKey) break;
        e.preventDefault();
        if (isDir) {
          void toggleDirectory(current.path);
        } else {
          void Promise.resolve(onFileOpen?.(current.path, false));
        }
        break;
      }
      case " ": {
        if (!current || e.shiftKey) break;
        // Space while typing a name is part of the name.
        if (Date.now() - typeToFindRef.current.timestamp <= TYPE_TO_FIND_RESET_MS) {
          e.preventDefault();
          const index = findRowByTypedCharacter(" ");
          if (index >= 0) moveFocusTo(index, false);
          break;
        }
        e.preventDefault();
        if (isDir) {
          void toggleDirectory(current.path);
          break;
        }
        if (!IS_MAC) {
          void Promise.resolve(onFileSelect(current.path, false));
          break;
        }
        e.stopPropagation();
        void toggleQuickLookPreview(current.path).catch((error) => {
          console.error("Failed to toggle Quick Look:", error);
        });
        break;
      }
      case "F2": {
        if (!current || e.shiftKey) break;
        e.preventDefault();
        onRenamePath?.(current.path);
        break;
      }
      case "Delete": {
        if (!current) break;
        e.preventDefault();
        requestDelete(getActionTargets());
        break;
      }
      default: {
        if (e.key.length !== 1 || !current) break;
        const index = findRowByTypedCharacter(e.key);
        e.preventDefault();
        if (index >= 0) moveFocusTo(index, false);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/file-explorer relative flex min-h-0 min-w-0 flex-1 select-none flex-col overflow-hidden px-0 pb-(--app-scrollbar-size)",
        dragState.dragOverPath === "__ROOT__" &&
          "border-2! border-dashed! border-primary! bg-primary-soft!",
      )}
      onFocusCapture={() => {
        setHasTreeFocus(true);
        setFocusedPath((current) => current || activePath || visibleRows[0]?.file.path);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHasTreeFocus(false);
        }
      }}
      onKeyDown={handleTreeKeyDown}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = dragState.draggedItem ? "move" : "copy";
      }}
      onDrop={handleRootDrop}
      onClick={handleContainerClick}
      onDoubleClick={handleContainerDoubleClick}
      onContextMenu={handleContainerContextMenu}
      onMouseDown={(event) => {
        setIsKeyboardFocusVisible(false);
        handleContainerMouseDown(event);
      }}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={releasePressedRow}
      onMouseLeave={releasePressedRow}
    >
      <div
        className="shrink-0"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <SidebarFilterBar
          ref={searchInputRef}
          value={treeSearchQuery}
          onChange={setTreeSearchQuery}
          aria-label="Filter files"
          placeholder="Filter files"
          aria-controls="file-tree-results"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(e) => {
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
              return;
            }
            if (e.key === "ArrowDown" && visibleRows.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              viewportRef.current?.focus();
            }
          }}
          actionsLabel="File explorer controls"
          actions={
            <>
              {treeSearchQuery.length > 0 ? (
                <SidebarIconButton
                  tooltip="Clear search"
                  aria-label="Clear search"
                  onClick={() => {
                    setTreeSearchQuery("");
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                >
                  <XIcon />
                </SidebarIconButton>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarIconButton
                      tooltip="File explorer preferences"
                      aria-label="File explorer preferences"
                    />
                  }
                >
                  <SlidersIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <EyeIcon />
                      Visibility
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.showHiddenFilesInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("showHiddenFilesInFileTree", checked)
                        }
                      >
                        Hidden Files
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.showGitignoredFilesInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("showGitignoredFilesInFileTree", checked)
                        }
                      >
                        Gitignored Files
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.showGitStatusInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("showGitStatusInFileTree", checked)
                        }
                      >
                        Git Status Decorations
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <PaletteIcon />
                      Appearance
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.showFileIconsInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("showFileIconsInFileTree", checked)
                        }
                      >
                        File Icons
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.showFolderArrowsInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("showFolderArrowsInFileTree", checked)
                        }
                      >
                        Folder Arrows
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.showIndentGuidesInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("showIndentGuidesInFileTree", checked)
                        }
                      >
                        Indent Guides
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.compactFoldersInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("compactFoldersInFileTree", checked)
                        }
                      >
                        Compact Folders
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={fileTreeSettings.hideRootFolderInFileTree}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          void updateSetting("hideRootFolderInFileTree", checked)
                        }
                      >
                        Hide Root Folder
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ListIcon />
                      Sort Order
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={fileTreeSettings.fileTreeSortOrder}
                        onValueChange={(value) => {
                          if (value === "folders-first" || value === "name") {
                            void updateSetting("fileTreeSortOrder", value);
                          }
                        }}
                      >
                        <DropdownMenuRadioItem value="folders-first" closeOnClick={false}>
                          Folders First
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="name" closeOnClick={false}>
                          Name
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <TextIndentIcon />
                      Indentation
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={String(fileTreeSettings.fileTreeIndentSize)}
                        onValueChange={(value) =>
                          void updateSetting("fileTreeIndentSize", Number(value))
                        }
                      >
                        <DropdownMenuRadioItem value="12" closeOnClick={false}>
                          Compact
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="16" closeOnClick={false}>
                          Default
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="20" closeOnClick={false}>
                          Spacious
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="24" closeOnClick={false}>
                          Wide
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={fileTreeSettings.autoRevealActiveFileInFileTree}
                    closeOnClick={false}
                    onCheckedChange={(checked) =>
                      void updateSetting("autoRevealActiveFileInFileTree", checked)
                    }
                  >
                    <ClickIcon />
                    Auto Reveal Active File
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={fileTreeSettings.confirmBeforeFileDelete}
                    closeOnClick={false}
                    onCheckedChange={(checked) =>
                      void updateSetting("confirmBeforeFileDelete", checked)
                    }
                  >
                    <TrashIcon />
                    Confirm Before Delete
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>
      <FileExplorerViewport
        ref={viewportRef}
        id="file-tree-results"
        className="min-h-0 min-w-0 flex-1"
        role="tree"
        aria-label="File Explorer"
        aria-busy={isTreeSearchSearching}
        aria-activedescendant={keyboardRowPath ? getRowId(keyboardRowPath) : undefined}
        aria-multiselectable="true"
        tabIndex={0}
        onScroll={(event) => {
          lastScrollTopRef.current = event.currentTarget.scrollTop;
        }}
        rowCount={visibleRows.length}
        rowHeight={rowHeight}
        getRowKey={(index) => getVisibleFileTreeRowKey(visibleRows, index)}
        getStickyAncestors={getStickyAncestors}
        getSubtreeEnd={getSubtreeEnd}
        emptyState={
          !rootFolderPath ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState
                layout="sidebar"
                message="No folder open"
                action={{ label: "Open Folder", onClick: handleOpenFolder }}
              />
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState
                layout="sidebar"
                message={
                  isTreeSearchSearching ? (
                    <Spinner label="Searching files" showLabel compact />
                  ) : isTreeSearchActive ? (
                    "No matching files"
                  ) : (
                    "Folder is empty"
                  )
                }
              />
            </div>
          ) : null
        }
        renderRow={(index, placement) => {
          const row = visibleRows[index];
          if (!row) return null;
          const previousRow = visibleRows[index - 1];
          const nextRow = visibleRows[index + 1];
          const isEditingRow = row.file.isEditing || row.file.isRenaming;
          const guideTargets: Array<FileTreeGuideTarget | null> =
            fileTreeSettings.showIndentGuidesInFileTree
              ? getGuideAncestorRows(visibleRows, index).map((ancestor) =>
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
                )
              : [];
          return (
            <FileExplorerTreeItem
              file={row.file}
              depth={row.depth}
              displayName={row.displayName}
              guideTargets={guideTargets}
              previousDepth={previousRow?.depth ?? 0}
              nextDepth={nextRow?.depth ?? 0}
              indentSize={fileTreeSettings.fileTreeIndentSize}
              showIcon={fileTreeSettings.showFileIconsInFileTree}
              showFolderArrows={fileTreeSettings.showFolderArrowsInFileTree}
              showIndentGuides={fileTreeSettings.showIndentGuidesInFileTree}
              isExpanded={row.isExpanded}
              isActive={
                multiSelection
                  ? multiSelection.has(row.file.path)
                  : highlightedPath === row.file.path
              }
              isFocused={
                hasTreeFocus &&
                (isKeyboardFocusVisible || multiSelection !== null) &&
                keyboardRowPath === row.file.path
              }
              positionInSet={rowPositions.positionInSet[index]}
              setSize={rowPositions.setSize[index]}
              isCut={cutFilePaths.has(row.file.path)}
              isDragOver={dragState.dragOverPath === row.file.path}
              isDragging={dragState.isDragging}
              editingValue={isEditingRow ? editingValue : undefined}
              onEditingValueChange={setEditingValue}
              onSubmit={handleInlineEditSubmit}
              onCancel={handleInlineEditCancel}
              getGitStatusDecoration={getGitStatusDecoration}
              rowId={placement === "list" ? getRowId(row.file.path) : undefined}
              searchQuery={displayedTreeSearch?.query}
            />
          );
        }}
      />

      {contextMenuElement}
      {alertDialog && (
        <Dialog
          title={alertDialog.title}
          icon={WarningIcon}
          onClose={() => setAlertDialog(null)}
          footer={
            <Button onClick={() => setAlertDialog(null)} variant="accent">
              OK
            </Button>
          }
        >
          <p className="text-foreground ui-text-base">{alertDialog.message}</p>
        </Dialog>
      )}
      {openAllFilesDialog && (
        <Dialog
          title="Open All Files"
          icon={WarningIcon}
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
          <p className="text-foreground ui-text-base">
            {openAllFilesDialog.filePaths.length} files will be opened in tabs. Continue?
          </p>
        </Dialog>
      )}
      {deleteCandidates && (
        <Dialog
          title={
            deleteCandidates.length > 1
              ? "Delete Items"
              : deleteCandidates[0]?.isDir
                ? "Delete Folder"
                : "Delete File"
          }
          icon={WarningIcon}
          onClose={() => {
            if (!isDeletingPath) setDeleteCandidates(null);
          }}
          footer={
            <>
              <Button
                onClick={() => setDeleteCandidates(null)}
                disabled={isDeletingPath}
                variant="default"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleDeleteConfirm()}
                disabled={isDeletingPath}
                variant="ghost"
                tone="danger"
              >
                {isDeletingPath ? "Deleting..." : "Delete"}
              </Button>
            </>
          }
        >
          <p className="text-foreground ui-text-base">
            {deleteCandidates.length > 1
              ? `Are you sure you want to delete these ${deleteCandidates.length} items${deleteCandidates.some((candidate) => candidate.isDir) ? ", including everything in the selected folders" : ""}? This action cannot be undone.`
              : deleteCandidates[0]?.isDir
                ? `Are you sure you want to delete the folder "${getPathBaseName(deleteCandidates[0].path)}" and all its contents? This action cannot be undone.`
                : `Are you sure you want to delete the file "${getPathBaseName(deleteCandidates[0]?.path ?? "")}"? This action cannot be undone.`}
          </p>
        </Dialog>
      )}
    </div>
  );
}

export const FileExplorerTree = memo(FileExplorerTreeComponent);
