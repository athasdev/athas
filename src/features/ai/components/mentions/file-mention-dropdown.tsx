import { motion, useReducedMotion } from "framer-motion";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { FileItem } from "@/features/global-search/types/global-search.types";
import { shouldIgnoreFile } from "@/features/global-search/utils/file-filtering";
import { useProjectStore } from "@/features/window/stores/project.store";
import { instantTransition, motionDuration, motionEase } from "@/ui/motion";
import { chatComposerDropdownClassName } from "../input/chat-composer-control-styles";
import { AIFileSelector } from "./ai-file-selector";

interface FileMentionDropdownProps {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
  onVisibleFilesChange?: (files: FileEntry[]) => void;
}

const ATTACHED_DROPDOWN_GAP = -1;
const MENTION_DROPDOWN_MAX_HEIGHT = 260;
const MENTION_DROPDOWN_EMPTY_HEIGHT = 44;
const MENTION_DROPDOWN_ROW_HEIGHT = 29;

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  files,
  onSelect,
  onVisibleFilesChange,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [fallbackFiles, setFallbackFiles] = useState<FileEntry[]>([]);
  const [visibleResultCount, setVisibleResultCount] = useState(0);
  const prefersReducedMotion = useReducedMotion();

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

  const handleResultsChange = useCallback(
    (items: FileItem[]) => {
      setVisibleResultCount(items.length);
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

  const adjustedPosition = useMemo(() => {
    const activeElement = document.activeElement as HTMLElement | null;
    const activeRect =
      activeElement?.isContentEditable || activeElement?.tagName === "INPUT"
        ? activeElement.getBoundingClientRect()
        : null;
    const basePosition =
      position.bottom > 0
        ? position
        : activeRect && activeRect.width > 0 && activeRect.bottom > 0
          ? {
              top: Math.max(activeRect.top, activeRect.bottom - 24),
              bottom: activeRect.bottom,
              left: activeRect.left + 12,
              width: Math.min(360, Math.max(220, activeRect.width - 24)),
            }
          : position;
    const dropdownWidth = Math.min(Math.max(basePosition.width, 220), window.innerWidth - 16);
    const dropdownHeight =
      visibleResultCount === 0
        ? MENTION_DROPDOWN_EMPTY_HEIGHT
        : Math.min(
            visibleResultCount * MENTION_DROPDOWN_ROW_HEIGHT + 12,
            MENTION_DROPDOWN_MAX_HEIGHT,
            EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT,
          );
    const padding = 8;

    let { left } = basePosition;

    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }
    if (left < padding) {
      left = padding;
    }

    const attachedAboveTop = basePosition.top - dropdownHeight - ATTACHED_DROPDOWN_GAP;
    const attachedBelowTop = basePosition.bottom + ATTACHED_DROPDOWN_GAP;
    const top =
      attachedAboveTop >= padding
        ? attachedAboveTop
        : Math.min(attachedBelowTop, window.innerHeight - dropdownHeight - padding);

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
      width: dropdownWidth,
      height: dropdownHeight,
    };
  }, [position.bottom, position.left, position.top, position.width, visibleResultCount]);

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
      initial={
        prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: -4, filter: "blur(2px)" }
      }
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={
        prefersReducedMotion
          ? { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
          : { opacity: 0, scale: 0.98, y: -4, filter: "blur(2px)" }
      }
      transition={
        prefersReducedMotion
          ? instantTransition
          : { duration: motionDuration.fast, ease: motionEase.smooth }
      }
      className={chatComposerDropdownClassName(
        "fixed z-[10040] flex select-none flex-col overflow-hidden",
      )}
      style={{
        height: `${adjustedPosition.height}px`,
        width: `${adjustedPosition.width}px`,
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
        transformOrigin: "top left",
      }}
    >
      <AIFileSelector
        files={effectiveFiles}
        query={mentionState.search}
        onSelect={handleFileClick}
        rootFolderPath={rootFolderPath}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        onResultsChange={handleResultsChange}
        showSearchInput={false}
        listClassName="max-h-full"
        compact
      />
    </motion.div>,
    document.body,
  );
});
