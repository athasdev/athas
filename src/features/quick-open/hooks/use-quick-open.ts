import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  getQuickOpenSection,
  matchQuickOpenPrefix,
  QUICK_OPEN_SECTIONS,
} from "../constants/quick-open-sections";
import { useAgentsSection } from "../sections/use-agents-section";
import { useFilesSection } from "../sections/use-files-section";
import { useGitHubSection } from "../sections/use-github-section";
import { useGitSection } from "../sections/use-git-section";
import { useSymbolsSection } from "../sections/use-symbols-section";
import { useTabsSection } from "../sections/use-tabs-section";
import { useTextSection } from "../sections/use-text-section";
import type { QuickOpenItem, QuickOpenSectionId } from "../types/quick-open.types";
import { useKeyboardNavigation } from "./use-keyboard-navigation";

const selectItem = (item: QuickOpenItem) => item.select();

export const useQuickOpen = () => {
  const isVisible = useUIState((state) => state.isQuickOpenVisible);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const [section, setSection] = useState<QuickOpenSectionId>("files");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const onClose = useCallback(() => {
    setIsQuickOpenVisible(false);
  }, [setIsQuickOpenVisible]);

  const input = (id: QuickOpenSectionId) => ({
    query,
    isActive: isVisible && section === id,
    close: onClose,
  });
  const results = {
    files: useFilesSection({ ...input("files"), isVisible }),
    text: useTextSection(input("text")),
    symbols: useSymbolsSection(input("symbols")),
    git: useGitSection(input("git")),
    github: useGitHubSection(input("github")),
    agents: useAgentsSection(input("agents")),
    tabs: useTabsSection(input("tabs")),
  } satisfies Record<QuickOpenSectionId, unknown>;
  const result = results[section];

  const changeSection = useCallback((next: QuickOpenSectionId) => {
    setSection(next);
    inputRef.current?.focus();
  }, []);

  const cycleSection = useCallback((direction: 1 | -1) => {
    setSection((current) => {
      const index = QUICK_OPEN_SECTIONS.findIndex((candidate) => candidate.id === current);
      const count = QUICK_OPEN_SECTIONS.length;
      return QUICK_OPEN_SECTIONS[(index + direction + count) % count]!.id;
    });
  }, []);

  // Typing a section's prefix in Files jumps to that section, keeping what follows it.
  const changeQuery = useCallback(
    (value: string) => {
      const match = section === "files" ? matchQuickOpenPrefix(value) : null;
      if (match) {
        setSection(match.section);
        setQuery(match.query);
        return;
      }
      setQuery(value);
    },
    [section],
  );

  const { selectedIndex, setSelectedIndex, scrollContainerRef, handleInputKeyDown } =
    useKeyboardNavigation({
      isVisible,
      allResults: result.items,
      onClose,
      onSelect: selectItem,
      onCycleSection: cycleSection,
      resetKey: section,
    });

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      // Backspace in an empty query leaves the section, undoing a prefix jump.
      if (event.key === "Backspace" && query === "" && section !== "files") {
        event.preventDefault();
        setSection("files");
        return;
      }
      handleInputKeyDown(event);
    },
    [handleInputKeyDown, query, section],
  );

  useEffect(() => {
    if (isVisible) {
      setSection("files");
      setQuery("");
      inputRef.current?.focus();
    }
  }, [isVisible]);

  return {
    isVisible,
    section: getQuickOpenSection(section),
    changeSection,
    query,
    changeQuery,
    inputRef,
    handleKeyDown,
    scrollContainerRef,
    onClose,
    result,
    selectedIndex,
    setSelectedIndex,
  };
};
