import { MagnifyingGlass as Search } from "@phosphor-icons/react";
import { useEffect, useMemo, type RefObject } from "react";
import { useDebounce } from "use-debounce";
import { useFffSearch } from "@/features/global-search/hooks/use-fff-search";
import { useFileSearch } from "@/features/global-search/hooks/use-file-search";
import { FileListItem } from "@/features/global-search/components/file-list-item";
import type { FileCategory, FileItem } from "@/features/global-search/models/types";
import type { FileEntry } from "@/features/file-system/types/app";
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

const canUseBackendFileSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) && !rootPath?.startsWith("remote://") && !rootPath?.startsWith("diff://");

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
}: AIFileSelectorProps) {
  const [debouncedQuery] = useDebounce(query, 50);
  const isBackendSearchActive =
    useBackendSearch && debouncedQuery.trim().length > 0 && canUseBackendFileSearch(rootFolderPath);
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

  useEffect(() => {
    if (selectedIndex <= results.length - 1) return;
    onSelectedIndexChange?.(Math.max(results.length - 1, 0));
  }, [onSelectedIndexChange, results.length, selectedIndex]);

  useEffect(() => {
    if (!showSearchInput || !autoFocusSearchInput) return;

    const frame = requestAnimationFrame(() => searchInputRef?.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocusSearchInput, searchInputRef, showSearchInput]);

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
          />
        </div>
      )}

      <CommandList>
        <div
          className={cn("items-container", chatComposerDropdownListClassName, listClassName)}
          role="listbox"
          aria-label="File list"
        >
          {results.length === 0 ? (
            <CommandEmpty>{emptyLabel}</CommandEmpty>
          ) : (
            results.map(({ file, category, index }) => (
              <FileListItem
                key={`${category}-${file.path}`}
                file={file}
                category={category}
                index={index}
                isSelected={index === selectedIndex}
                onClick={() => onSelect(file)}
                onPreview={() => onSelectedIndexChange?.(index)}
                rootFolderPath={rootFolderPath}
                compact={compact}
              />
            ))
          )}
        </div>
      </CommandList>
    </>
  );
}
