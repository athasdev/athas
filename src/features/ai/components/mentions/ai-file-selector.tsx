import { ClockIcon, SearchIcon } from "@/ui/icons";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useDebounce } from "use-debounce";
import { useFffSearch } from "@/features/file-search/hooks/use-fff-search";
import {
  canUseNativeFileSearch,
  getNativeWorkspaceRootPaths,
} from "@/features/file-search/utils/file-search-paths";
import { shouldIgnoreSearchFile } from "@/features/file-search/utils/file-search-filtering";
import { useFileSearch } from "@/features/global-search/hooks/use-file-search";
import type { FileCategory, FileItem } from "@/features/file-search/types/file-search.types";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/ui/combobox";
import { CommandItemBadge } from "@/ui/command";
import { cn } from "@/utils/cn";
import { getDirectoryPath } from "@/utils/path-helpers";

interface AIFileSelectorProps {
  files?: FileEntry[];
  query: string;
  onQueryChange?: (query: string) => void;
  onSelect: (file: FileItem) => void;
  rootFolderPath: string | null | undefined;
  selectedIndex: number;
  onSelectedIndexChange?: (index: number) => void;
  showSearchInput?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  presentation?: "menu" | "panel";
  emptyLabel?: string;
  compact?: boolean;
  autoFocusSearchInput?: boolean;
  useBackendSearch?: boolean;
  onResultsChange?: (files: FileItem[]) => void;
  leadingContent?: ReactNode;
  hasLeadingResults?: boolean;
}

function flattenFileSearchResults(categorizedFiles: ReturnType<typeof useFileSearch>) {
  const result: Array<{ file: FileItem; category: FileCategory; index: number }> = [];

  for (const file of categorizedFiles.openBufferFiles) {
    result.push({ file, category: "open", index: result.length });
  }
  for (const file of categorizedFiles.recentFilesInResults) {
    result.push({ file, category: "recent", index: result.length });
  }
  for (const file of categorizedFiles.otherFiles) {
    result.push({ file, category: "other", index: result.length });
  }

  return result;
}

const EMPTY_FILES: FileEntry[] = [];

const categoryLabels: Record<FileCategory, string> = {
  open: "Open",
  recent: "Recent",
  other: "Files",
};

export function AIFileSelector({
  files = EMPTY_FILES,
  query,
  onQueryChange,
  onSelect,
  rootFolderPath,
  selectedIndex,
  onSelectedIndexChange,
  showSearchInput = true,
  searchInputRef,
  presentation = "menu",
  emptyLabel = "No matching files found",
  compact = false,
  autoFocusSearchInput = false,
  useBackendSearch = true,
  onResultsChange,
  leadingContent,
  hasLeadingResults = false,
}: AIFileSelectorProps) {
  const lastEmittedResultsSignatureRef = useRef<string | null>(null);
  const [debouncedQuery] = useDebounce(query, 50);
  const workspaceFolders = useFileSystemStore((state) => state.workspaceFolders);
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const workspaceKey = JSON.stringify([
    rootFolderPath,
    workspaceFolders.map((folder) => folder.path),
  ]);
  const [projectFiles, setProjectFiles] = useState<{
    key: string;
    files: FileEntry[];
    error: boolean;
  } | null>(null);
  const needsProjectFiles = files.length === 0 && Boolean(rootFolderPath);
  const currentProjectFiles = projectFiles?.key === workspaceKey ? projectFiles : null;
  const isLoadingFiles = needsProjectFiles && !currentProjectFiles;

  useEffect(() => {
    if (!needsProjectFiles) return;
    let cancelled = false;
    setProjectFiles(null);
    getAllProjectFiles().then(
      (loadedFiles) => {
        if (!cancelled) setProjectFiles({ key: workspaceKey, files: loadedFiles, error: false });
      },
      () => {
        if (!cancelled) setProjectFiles({ key: workspaceKey, files: [], error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getAllProjectFiles, needsProjectFiles, workspaceKey]);

  const effectiveFiles = files.length > 0 ? files : (currentProjectFiles?.files ?? EMPTY_FILES);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const isBackendSearchActive =
    useBackendSearch && debouncedQuery.trim().length > 0 && canUseNativeFileSearch(rootFolderPath);
  const {
    hits: backendHits,
    error: backendError,
    isSearching,
  } = useFffSearch(debouncedQuery, isBackendSearchActive, nativeRootPaths);
  const fileItems = useMemo<FileItem[]>(() => {
    return effectiveFiles
      .filter((file) => !file.isDir && !shouldIgnoreSearchFile(file.path))
      .map((file) => ({
        name: file.name,
        path: file.path,
        isDir: false,
      }));
  }, [effectiveFiles]);
  const categorizedFiles = useFileSearch(fileItems, debouncedQuery);
  const results = useMemo(() => {
    if (isBackendSearchActive && !backendError) {
      return backendHits
        .filter((hit) => !shouldIgnoreSearchFile(hit.path))
        .map((hit, index) => ({
          file: { name: hit.name, path: hit.path, isDir: false },
          category: "other" as const,
          index,
        }));
    }

    return flattenFileSearchResults(categorizedFiles);
  }, [backendError, backendHits, categorizedFiles, isBackendSearchActive]);
  const resultFiles = useMemo(() => results.map(({ file }) => file), [results]);
  const resultFilesSignature = useMemo(
    () => resultFiles.map((file) => `${file.path}\0${file.name}`).join("\n"),
    [resultFiles],
  );

  useEffect(() => {
    if (selectedIndex <= results.length - 1) return;
    onSelectedIndexChange?.(Math.max(results.length - 1, 0));
  }, [onSelectedIndexChange, results.length, selectedIndex]);

  useEffect(() => {
    if (!onResultsChange) return;
    if (lastEmittedResultsSignatureRef.current === resultFilesSignature) return;

    lastEmittedResultsSignatureRef.current = resultFilesSignature;
    onResultsChange(resultFiles);
  }, [onResultsChange, resultFiles, resultFilesSignature]);

  useEffect(() => {
    if (!showSearchInput || !autoFocusSearchInput) return;

    const frame = requestAnimationFrame(() => searchInputRef?.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocusSearchInput, searchInputRef, showSearchInput]);

  return (
    <Combobox<FileItem>
      items={resultFiles}
      value={null}
      onValueChange={(file) => {
        if (file) onSelect(file);
      }}
      inputValue={query}
      onInputValueChange={(nextQuery) => onQueryChange?.(nextQuery)}
      onItemHighlighted={(file) => {
        if (!file) return;
        const index = resultFiles.findIndex((result) => result.path === file.path);
        if (index >= 0) onSelectedIndexChange?.(index);
      }}
      itemToStringLabel={(file) => file.name}
      itemToStringValue={(file) => file.path}
      isItemEqualToValue={(left, right) => left.path === right.path}
      filter={() => true}
      autoHighlight
    >
      {showSearchInput && (
        <div
          className={cn(
            "border-border/60 border-b bg-surface/95 px-2 py-2",
            compact && "px-1.5 py-1.5",
          )}
        >
          <ComboboxInput
            ref={searchInputRef}
            placeholder="Search files..."
            variant="ghost"
            leftIcon={SearchIcon}
            showTrigger={false}
            className="w-full"
            aria-label="Search files"
          />
        </div>
      )}

      <ComboboxList
        className={cn(
          "items-container min-h-0 flex-1 overflow-y-auto bg-surface/95 p-1.5 overscroll-contain",
          compact && "p-0",
          presentation === "menu" ? "max-h-66" : "max-h-full",
        )}
        aria-label="File list"
        aria-busy={isLoadingFiles || isSearching}
      >
        {leadingContent}
        <ComboboxEmpty>
          {hasLeadingResults
            ? null
            : isSearching || isLoadingFiles
              ? "Loading project files…"
              : currentProjectFiles?.error
                ? "Could not load project files. Reopen to retry."
                : !rootFolderPath && files.length === 0
                  ? "Open a project to attach files"
                  : emptyLabel}
        </ComboboxEmpty>
        {results.map(({ file, category, index }, resultIndex) => {
          const previousCategory = results[resultIndex - 1]?.category;
          const showCategoryHeader = category !== "other" && category !== previousCategory;
          const directoryPath = getDirectoryPath(file.path, rootFolderPath);

          return (
            <Fragment key={`${category}-${file.path}`}>
              {showCategoryHeader ? (
                <div
                  className={cn(
                    "px-2 font-medium text-subtle-foreground/75",
                    compact
                      ? "ui-text-sm pt-1 pb-0.5 leading-normal"
                      : "ui-text-base pt-1.5 pb-1 leading-row",
                  )}
                >
                  {categoryLabels[category]}
                </div>
              ) : null}
              <ComboboxItem
                value={file}
                showIndicator={false}
                aria-selected={index === selectedIndex}
                className={cn(
                  compact ? "min-h-7 gap-1.5 rounded-md py-1" : "min-h-8 gap-2 py-2",
                  index === selectedIndex && "bg-selected",
                )}
              >
                <span className="grid size-4 shrink-0 place-items-center">
                  <ThemedFileIcon fileName={file.name} isDir={false} />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-foreground">{file.name}</span>
                  {directoryPath ? (
                    <span className="truncate text-subtle-foreground/80">{directoryPath}</span>
                  ) : null}
                </span>
                {category === "open" ? (
                  <CommandItemBadge>open</CommandItemBadge>
                ) : category === "recent" ? (
                  <CommandItemBadge>
                    <ClockIcon />
                  </CommandItemBadge>
                ) : null}
              </ComboboxItem>
            </Fragment>
          );
        })}
      </ComboboxList>
    </Combobox>
  );
}
