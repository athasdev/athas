import React, { useCallback, useEffect, useRef } from "react";
import type { MentionState } from "@/features/ai/types/chat-composer.types";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { FileItem } from "@/features/file-search/types/file-search.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { ComposerAttachedPanel } from "../input/composer-attached-panel";
import { AIFileSelector } from "./ai-file-selector";

interface FileMentionDropdownProps {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
  onVisibleFilesChange?: (files: FileEntry[]) => void;
  mentionState: MentionState;
  onClose: () => void;
  onSelectedIndexChange: (index: number) => void;
}

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  files,
  onSelect,
  onVisibleFilesChange,
  mentionState,
  onClose,
  onSelectedIndexChange,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const { selectedIndex } = mentionState;
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
      position={mentionState.position}
      onClose={onClose}
      ariaLabel="File suggestions"
      maxHeight={240}
    >
      <div ref={dropdownRef} className="flex min-h-0 flex-col">
        <AIFileSelector
          files={files}
          query={mentionState.search}
          onSelect={handleFileClick}
          rootFolderPath={rootFolderPath}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={onSelectedIndexChange}
          onResultsChange={handleResultsChange}
          showSearchInput={false}
          listClassName="max-h-full"
          compact
        />
      </div>
    </ComposerAttachedPanel>
  );
});
