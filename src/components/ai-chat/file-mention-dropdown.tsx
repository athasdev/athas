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
    if (!dropdownRef.current || selectedIndex < 0) return;

    const container = dropdownRef.current;
    const itemsContainer = container.querySelector(".p-1") as HTMLElement;
    if (!itemsContainer) return;

    const selectedItem = itemsContainer.children[selectedIndex] as HTMLElement;
    if (!selectedItem) return;

    // Calculate positions relative to the scrollable container
    const containerScrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const itemOffsetTop = selectedItem.offsetTop;
    const itemHeight = selectedItem.offsetHeight;

    // Check if item is above the visible area
    if (itemOffsetTop < containerScrollTop) {
      container.scrollTop = itemOffsetTop - 4; // 4px padding
    }
    // Check if item is below the visible area
    else if (itemOffsetTop + itemHeight > containerScrollTop + containerHeight) {
      container.scrollTop = itemOffsetTop + itemHeight - containerHeight + 4; // 4px padding
    }
  }, [selectedIndex]);

  // Adjust position to prevent overflow
  const adjustedPosition = useMemo(() => {
    const itemHeight = 32; // Adjusted for more compact spacing
    const dropdownHeight = Math.min(filteredFiles.length * itemHeight, 320); // Show more items
    const padding = 16;

    let { top, left } = position;

    // Find the AI chat container to get its width
    const chatContainer = document.querySelector(".ai-chat-container") as HTMLElement;
    const containerWidth = chatContainer ? chatContainer.offsetWidth : 400;
    const dropdownWidth = Math.min(containerWidth * 0.9, 500); // 90% of container width, max 500px

    // Ensure dropdown doesn't go off the left edge
    if (left < padding) {
      left = padding;
    }

    // Ensure dropdown doesn't go off the right edge
    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }

    // Position just above the input area
    const abovePosition = top - dropdownHeight - 4; // Very close to input
    if (abovePosition >= padding) {
      top = abovePosition;
    } else {
      // If not enough space above, position below
      top = top + 40;
    }

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
      width: dropdownWidth,
      height: dropdownHeight,
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
    if (!rootFolderPath) return fullPath;

    const normalizedFullPath = fullPath.replace(/\\/g, "/");
    const normalizedRootPath = rootFolderPath.replace(/\\/g, "/");

    if (normalizedFullPath.startsWith(normalizedRootPath)) {
      const relativePath = normalizedFullPath.substring(normalizedRootPath.length);
      const cleanPath = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;

      // Get directory path without filename
      const lastSlashIndex = cleanPath.lastIndexOf("/");
      const dirPath = lastSlashIndex > 0 ? cleanPath.substring(0, lastSlashIndex) : "";

      // Trim from beginning if too long (keep ending)
      const maxLength = 35;
      if (dirPath.length > maxLength) {
        return `...${dirPath.substring(dirPath.length - maxLength)}`;
      }

      return dirPath;
    }

    return fullPath;
  };

  return (
    <div
      ref={dropdownRef}
      className="scrollbar-hidden fixed z-[100] rounded-lg border border-border bg-primary-bg shadow-xl"
      style={{
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        width: adjustedPosition.width,
        maxHeight: adjustedPosition.height,
        overflowY: "auto",
        overflowX: "hidden",
        backdropFilter: "blur(8px)",
        animation: "fadeInUp 0.15s ease-out",
      }}
    >
      <div className="p-0">
        {filteredFiles.map((file, index) => (
          <div
            key={file.path}
            className={`flex cursor-pointer items-center gap-2 rounded-none px-2 py-1 text-xs transition-all duration-150 ${
              index === selectedIndex
                ? "border-blue-500 border-l-2 bg-blue-500/20 text-blue-300"
                : "bg-transparent hover:bg-hover"
            }`}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(file);
            }}
          >
            <FileIcon
              fileName={file.name}
              isDir={false}
              size={11}
              className={`flex-shrink-0 ${index === selectedIndex ? "text-blue-400" : "text-text-lighter"}`}
            />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate">
                <span
                  className={`font-mono ${index === selectedIndex ? "font-medium text-blue-200" : "text-text"}`}
                >
                  {file.name}
                </span>
                {getRelativePath(file.path) && (
                  <span
                    className={`ml-2 text-xs opacity-60 ${index === selectedIndex ? "text-blue-300/70" : "text-text-lighter"}`}
                  >
                    {getRelativePath(file.path)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
