import { motion } from "framer-motion";
import { Search } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAIChatStore } from "@/features/ai/store/store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { fuzzyScore } from "@/features/quick-open/utils/fuzzy-search";
import { shouldIgnoreFile } from "@/features/quick-open/utils/file-filtering";
import { useProjectStore } from "@/features/window/stores/project-store";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { getDirectoryPath } from "@/utils/path-helpers";

interface FileMentionDropdownProps {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
}

const MAX_RESULTS = 10;
const ATTACHED_DROPDOWN_GAP = -1;

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  files,
  onSelect,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [fallbackFiles, setFallbackFiles] = useState<FileEntry[]>([]);

  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();
  const { mentionState, hideMention } = useAIChatStore();
  const { position, selectedIndex } = mentionState;
  const effectiveFiles = files.length > 0 ? files : fallbackFiles;
  const fileItems = useMemo(
    () => effectiveFiles.map((file) => ({ name: file.name, path: file.path })),
    [effectiveFiles],
  );

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

  useEffect(() => {
    setSearchTerm(mentionState.search || "");
  }, [mentionState.search]);

  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) {
      return fileItems.slice(0, MAX_RESULTS).sort((a, b) => a.name.localeCompare(b.name));
    }

    const scored: Array<{ file: { name: string; path: string }; score: number }> = [];
    for (const file of fileItems) {
      const score = Math.max(fuzzyScore(file.name, searchTerm), fuzzyScore(file.path, searchTerm));
      if (score > 0) {
        scored.push({ file, score });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.name.localeCompare(b.file.name);
    });

    return scored.slice(0, MAX_RESULTS).map(({ file }) => file);
  }, [fileItems, searchTerm]);

  const handleFileClick = (file: { name: string; path: string }) => {
    const fileEntry: FileEntry = {
      name: file.name,
      path: file.path,
      isDir: false,
      children: undefined,
    };
    onSelect(fileEntry);
  };

  useEffect(() => {
    const itemsContainer = dropdownRef.current?.querySelector(".items-container");
    const selectedItem = itemsContainer?.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedIndex]);

  const adjustedPosition = useMemo(() => {
    const dropdownWidth = Math.min(Math.max(position.width, 280), window.innerWidth - 16);
    const dropdownHeight = Math.min(
      filteredFiles.length * 34 + 64,
      EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT,
    );
    const padding = 8;

    let { left } = position;

    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }
    if (left < padding) {
      left = padding;
    }

    const attachedAboveTop = position.top - dropdownHeight - ATTACHED_DROPDOWN_GAP;
    const attachedBelowTop = position.bottom + ATTACHED_DROPDOWN_GAP;
    const top =
      attachedAboveTop >= padding
        ? attachedAboveTop
        : Math.min(attachedBelowTop, window.innerHeight - dropdownHeight - padding);

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
      width: dropdownWidth,
    };
  }, [position.bottom, position.left, position.top, position.width, filteredFiles.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        hideMention();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideMention();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [hideMention]);

  if (filteredFiles.length === 0) {
    return null;
  }

  return createPortal(
    <motion.div
      ref={dropdownRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="fixed z-[10040] flex select-none flex-col overflow-hidden rounded-t-2xl rounded-b-xl border border-border/70 bg-primary-bg/98 shadow-[0_14px_32px_-26px_rgba(0,0,0,0.5)] backdrop-blur-sm"
      style={{
        maxHeight: "220px",
        width: `${adjustedPosition.width}px`,
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
        transformOrigin: "top left",
      }}
      role="listbox"
      aria-label="File suggestions"
    >
      <div className="border-border/50 border-b bg-primary-bg/92 px-2 py-2">
        <Input
          type="text"
          placeholder="Search files..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          variant="default"
          leftIcon={Search}
          className="w-full border-border/60 bg-secondary-bg/85"
          aria-label="Search files"
        />
      </div>

      <div
        className="items-container min-h-0 flex-1 overflow-y-auto bg-primary-bg/96 p-1.5"
        role="listbox"
        aria-label="File list"
      >
        {filteredFiles.map((file, index) => (
          <Button
            key={file.path}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleFileClick(file)}
            className={cn(
              "h-auto w-full justify-start gap-2 px-2.5 py-2 text-left",
              "focus:outline-none focus:ring-1 focus:ring-border-strong/35",
              index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover",
            )}
            role="option"
            aria-selected={index === selectedIndex}
            tabIndex={index === selectedIndex ? 0 : -1}
          >
            <FileExplorerIcon
              fileName={file.name}
              isDir={false}
              isExpanded={false}
              size={10}
              className="shrink-0 text-text-lighter"
            />
            <div className="min-w-0 flex-1 truncate">
              <span className="text-text">{file.name}</span>
              <span className="ml-2 text-[10px] text-text-lighter opacity-60">
                {getDirectoryPath(file.path, rootFolderPath) || "root"}
              </span>
            </div>
          </Button>
        ))}
      </div>
    </motion.div>,
    document.body,
  );
});
