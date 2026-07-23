import React, { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AIChatState } from "@/features/ai/types/ai-chat-store.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { FileItem } from "@/features/global-search/types/global-search.types";
import { shouldIgnoreFile } from "@/features/global-search/utils/file-filtering";
import { useProjectStore } from "@/features/window/stores/project.store";
import { ComposerAttachedPanel } from "../input/composer-attached-panel";
import { AIFileSelector } from "./ai-file-selector";

interface FileMentionDropdownProps {
  anchorRef: RefObject<HTMLElement | null>;
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
  onVisibleFilesChange?: (files: FileEntry[]) => void;
  mentionState: AIChatState["mentionState"];
  onClose: () => void;
  onSelectedIndexChange: (index: number) => void;
}

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  anchorRef,
  files,
  onSelect,
  onVisibleFilesChange,
  mentionState,
  onClose,
  onSelectedIndexChange,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [fallbackFiles, setFallbackFiles] = useState<FileEntry[]>([]);

  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const { selectedIndex } = mentionState;
  const effectiveFiles = files.length > 0 ? files : fallbackFiles;

  useEffect(() => {
    if (files.length > 0) {
      setFallbackFiles([]);
      return;
    }

    let cancelled = false;

    getAllProjectFiles().then((allFiles) => {
      if (cancelled) return;

      setFallbackFiles(allFiles.filter((file) => !file.isDir && !shouldIgnoreFile(file.path)));
    });

    return () => {
      cancelled = true;
    };
  }, [files, getAllProjectFiles]);

  const handleFileClick = (file: { name: string; path: string }) => {
    const fileEntry: FileEntry = {
      name: file.name,
      path: file.path,
      isDir: false,
      children: undefined,
    };
    onSelect(fileEntry);
  };

  const handleResultsChange = useCallback(
    (items: FileItem[]) => {
      onVisibleFilesChange?.(
        items.map((file) => ({
          name: file.name,
          path: file.path,
          isDir: false,
          children: undefined,
        })),
      );
    },
    [onVisibleFilesChange],
  );

  useEffect(() => {
    const itemsContainer = dropdownRef.current?.querySelector(".items-container");
    const selectedItem = itemsContainer?.querySelector(
      `[data-item-index="${selectedIndex}"]`,
    ) as HTMLElement | null;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <ComposerAttachedPanel
      open={mentionState.active}
      anchorRef={anchorRef}
      onClose={onClose}
      ariaLabel="File suggestions"
      maxHeight={260}
    >
      <div ref={dropdownRef} className="flex min-h-0 flex-col">
        <AIFileSelector
          files={effectiveFiles}
          query={mentionState.search}
          onSelect={handleFileClick}
          rootFolderPath={rootFolderPath}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={onSelectedIndexChange}
          onResultsChange={handleResultsChange}
          showSearchInput={false}
          listClassName="max-h-full bg-primary-bg"
          compact
        />
      </div>
    </ComposerAttachedPanel>
  );
});
