import { MagnifyingGlassIcon as Search } from "@/ui/icons";
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useDebounce } from "use-debounce";
import { useFffSearch } from "@/features/global-search/hooks/use-fff-search";
import { useFileSearch } from "@/features/global-search/hooks/use-file-search";
import { canUseNativeFileSearch } from "@/features/global-search/utils/file-search-paths";
import { FileListItem } from "@/features/global-search/components/file-list-item";
import type { FileCategory, FileItem } from "@/features/global-search/types/global-search.types";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { CommandEmpty, CommandList } from "@/ui/command";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import {
  chatComposerDropdownHeaderClassName,
  chatComposerDropdownListClassName,
} from "../input/chat-composer-control-styles";

interface AIFileSelectorProps {
  files: FileEntry[];
  query: string;
  onQueryChange?: (query: string) => void;
  onSelect: (file: FileItem) => void;
  rootFolderPath: string | null | undefined;
  selectedIndex: number;
  onSelectedIndexChange?: (index: number) => void;
  showSearchInput?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  listClassName?: string;
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

const categoryLabels: Record<FileCategory, string> = {
  open: "Open",
  recent: "Recent",
  other: "Files",
};

export function AIFileSelector({
  files,
  query,
  onQueryChange,
  onSelect,
  rootFolderPath,
  selectedIndex,
  onSelectedIndexChange,
  showSearchInput = true,
  searchInputRef,
  listClassName,
  emptyLabel = "No matching files found",
  compact = false,
  autoFocusSearchInput = false,
  useBackendSearch = true,
  onResultsChange,
  leadingContent,
  hasLeadingResults = false,
}: AIFileSelectorProps) {
  const listboxId = useId();
  const lastEmittedResultsSignatureRef = useRef<string | null>(null);
  const [debouncedQuery] = useDebounce(query, 50);
  const isBackendSearchActive =
    useBackendSearch && debouncedQuery.trim().length > 0 && canUseNativeFileSearch(rootFolderPath);
  const { hits: backendHits } = useFffSearch(debouncedQuery, isBackendSearchActive, rootFolderPath);
  const fileItems = useMemo<FileItem[]>(() => {
    if (isBackendSearchActive) return [];

    return files
      .filter((file) => !file.isDir)
      .map((file) => ({
        name: file.name,
        path: file.path,
        isDir: false,
      }));
  }, [files, isBackendSearchActive]);
  const categorizedFiles = useFileSearch(fileItems, debouncedQuery);
  const results = useMemo(() => {
    if (isBackendSearchActive) {
      return backendHits.map((hit, index) => ({
        file: { name: hit.name, path: hit.path, isDir: false },
        category: "other" as const,
        index,
      }));
    }

    return flattenFileSearchResults(categorizedFiles);
  }, [backendHits, categorizedFiles, isBackendSearchActive]);
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

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectedIndexChange?.(Math.min(selectedIndex + 1, results.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectedIndexChange?.(Math.max(selectedIndex - 1, 0));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onSelectedIndexChange?.(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onSelectedIndexChange?.(results.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selected = results[selectedIndex] ?? results[0];
      onSelect(selected.file);
    }
  };

  return (
    <>
      {showSearchInput && (
        <div className={cn(chatComposerDropdownHeaderClassName, compact && "px-1.5 py-1.5")}>
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search files..."
            value={query}
            onChange={(event) => onQueryChange?.(event.target.value)}
            variant="ghost"
            size={compact ? "xs" : "sm"}
            leftIcon={Search}
            className="w-full"
            aria-label="Search files"
            aria-activedescendant={
              results.length > 0 ? `ai-file-selector-option-${selectedIndex}` : undefined
            }
            aria-controls={listboxId}
            aria-expanded="true"
            aria-autocomplete="list"
            role="combobox"
            onKeyDown={handleSearchKeyDown}
          />
        </div>
      )}

      <CommandList>
        <div
          className={cn("items-container", chatComposerDropdownListClassName, listClassName)}
          id={listboxId}
          role="listbox"
          aria-label="File list"
        >
          {leadingContent}
          {results.length === 0 && !hasLeadingResults ? (
            <CommandEmpty>{emptyLabel}</CommandEmpty>
          ) : (
            results.map(({ file, category, index }, resultIndex) => {
              const previousCategory = results[resultIndex - 1]?.category;
              const showCategoryHeader = category !== "other" && category !== previousCategory;

              return (
                <Fragment key={`${category}-${file.path}`}>
                  {showCategoryHeader && (
                    <div className="ui-text-base px-2 pt-1.5 pb-1 font-medium leading-[1.35] text-text-lighter/75">
                      {categoryLabels[category]}
                    </div>
                  )}
                  <FileListItem
                    id={`ai-file-selector-option-${index}`}
                    file={file}
                    category={category}
                    index={index}
                    isSelected={index === selectedIndex}
                    onClick={() => onSelect(file)}
                    onPreview={() => onSelectedIndexChange?.(index)}
                    rootFolderPath={rootFolderPath}
                    compact={compact}
                  />
                </Fragment>
              );
            })
          )}
        </div>
      </CommandList>
    </>
  );
}
