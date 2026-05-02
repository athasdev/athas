import { motion } from "framer-motion";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAIChatStore } from "@/features/ai/store/store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { shouldIgnoreFile } from "@/features/global-search/utils/file-filtering";
import { useProjectStore } from "@/features/window/stores/project-store";
import { chatComposerDropdownClassName } from "../input/chat-composer-control-styles";
import { AIFileSelector } from "./ai-file-selector";

interface FileMentionDropdownProps {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
}

const ATTACHED_DROPDOWN_GAP = -1;

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  files,
  onSelect,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [fallbackFiles, setFallbackFiles] = useState<FileEntry[]>([]);

  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();
  const { mentionState, hideMention } = useAIChatStore();
  const setSelectedIndex = useAIChatStore((state) => state.setSelectedIndex);
  const { position, selectedIndex } = mentionState;
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

  useEffect(() => {
    const itemsContainer = dropdownRef.current?.querySelector(".items-container");
    const selectedItem = itemsContainer?.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedIndex]);

  const adjustedPosition = useMemo(() => {
    const dropdownWidth = Math.min(Math.max(position.width, 280), window.innerWidth - 16);
    const dropdownHeight = Math.min(210, EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT);
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
  }, [position.bottom, position.left, position.top, position.width]);

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

  return createPortal(
    <motion.div
      ref={dropdownRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={chatComposerDropdownClassName("fixed z-[10040] flex select-none flex-col")}
      style={{
        maxHeight: "210px",
        width: `${adjustedPosition.width}px`,
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
        transformOrigin: "top left",
      }}
      role="listbox"
      aria-label="File suggestions"
    >
      <AIFileSelector
        files={effectiveFiles}
        query={mentionState.search}
        onSelect={handleFileClick}
        rootFolderPath={rootFolderPath}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        showSearchInput={false}
        listClassName="max-h-[210px]"
        compact
      />
    </motion.div>,
    document.body,
  );
});
