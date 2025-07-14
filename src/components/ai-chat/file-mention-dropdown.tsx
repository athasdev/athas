import React, { useEffect, useMemo, useRef } from "react";
import { useAIChatStore } from "../../stores/ai-chat-store";
import type { FileEntry } from "../../types/app";
import FileIcon from "../file-icon";

interface FileMentionDropdownProps {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
  rootFolderPath?: string;
}

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  files,
  onSelect,
  rootFolderPath,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get state from store
  const { mentionState, hideMention, getFilteredFiles } = useAIChatStore();
  const { position, selectedIndex } = mentionState;

  // Get filtered files from store
  const filteredFiles = useMemo(() => getFilteredFiles(files), [files, getFilteredFiles]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedItem = dropdownRef.current?.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  // Adjust position to prevent overflow
  const adjustedPosition = useMemo(() => {
    const dropdownWidth = 320;
    const dropdownHeight = Math.min(filteredFiles.length * 32, 160); // 32px per item, max 5 items
    const padding = 8;

    let { top, left } = position;

    // Ensure dropdown doesn't go off the left edge of the screen
    if (left < padding) {
      left = padding;
    }

    // Ensure dropdown doesn't go off the right edge of the screen
    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }

    if (top + dropdownHeight > window.innerHeight - padding) {
      const abovePosition = top - dropdownHeight - 20;
      if (abovePosition >= padding) {
        top = abovePosition;
      } else {
        top = Math.max(padding, window.innerHeight - dropdownHeight - padding);
      }
    }

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
    };
  }, [position.top, position.left, filteredFiles.length]);

  // Close on outside click or escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        hideMention();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideMention();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [hideMention]);

  if (filteredFiles.length === 0) {
    return null;
  }

  const getRelativePath = (fullPath: string): string => {
    // Use rootFolderPath to calculate relative path
    let relativePath = fullPath;

    if (rootFolderPath && fullPath.startsWith(rootFolderPath)) {
      relativePath = fullPath.slice(rootFolderPath.length);
      // Remove leading slash if present
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }
    } else if (fullPath.startsWith("/")) {
      // If no rootFolderPath or path doesn't start with it, remove just the leading slash
      relativePath = fullPath.slice(1);
    }

    // Show max 40 chars, ellipsis in middle if too long
    if (relativePath.length > 40) {
      const start = relativePath.slice(0, 20);
      const end = relativePath.slice(-17);
      return `${start}...${end}`;
    }
    return relativePath;
  };

  return (
    <div
      ref={dropdownRef}
      className="scrollbar-hidden fixed z-[100] rounded-md border border-border bg-primary-bg shadow-lg"
      style={{
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        maxHeight: "200px",
        minWidth: "200px",
        maxWidth: "320px",
        overflowY: "auto",
        overflowX: "hidden",
        display: "block",
        visibility: "visible",
        backdropFilter: "blur(8px)",
        animation: "fadeInUp 0.15s ease-out",
      }}
    >
      {filteredFiles.map((file, index) => (
        <div
          key={file.path}
          className={`flex cursor-pointer items-center gap-2 border-border border-b px-2 py-1.5 text-xs transition-all duration-100 last:border-b-0 ${
            index === selectedIndex ? "bg-selected text-text shadow-sm" : "text-text hover:bg-hover"
          }`}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(file);
          }}
        >
          <FileIcon fileName={file.name} isDir={false} size={11} className="flex-shrink-0" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate font-medium font-mono text-text text-xs">{file.name}</div>
            <div className="mt-0.5 truncate text-[10px] text-text-lighter opacity-75">
              {getRelativePath(file.path)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});
