import { isComposingKeyboardEvent } from "@/features/keymaps/utils/is-composing-keyboard-event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";
import {
  KEY_ARROW_DOWN,
  KEY_ARROW_UP,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_K,
} from "../constants/keyboard-keys";
import type { FileItem } from "@/features/file-search/types/file-search.types";

interface UseKeyboardNavigationProps {
  isVisible: boolean;
  allResults: FileItem[];
  onClose: () => void;
  onSelect: (path: string) => void;
}

export const useKeyboardNavigation = ({
  isVisible,
  allResults,
  onClose,
  onSelect,
}: UseKeyboardNavigationProps) => {
  const [selection, setSelection] = useState<{ index: number; path: string | null }>({
    index: 0,
    path: null,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resultIndexByPath = useMemo(() => {
    const indexByPath = new Map<string, number>();
    for (let index = 0; index < allResults.length; index++) {
      const result = allResults[index];
      if (result) {
        indexByPath.set(result.path, index);
      }
    }
    return indexByPath;
  }, [allResults]);

  const selectedIndex =
    (selection.path ? resultIndexByPath.get(selection.path) : undefined) ??
    Math.min(selection.index, Math.max(0, allResults.length - 1));

  const setSelectedIndex = useCallback(
    (next: SetStateAction<number>) => {
      setSelection((previous) => {
        const currentIndex =
          (previous.path ? resultIndexByPath.get(previous.path) : undefined) ??
          Math.min(previous.index, Math.max(0, allResults.length - 1));
        const index = typeof next === "function" ? next(currentIndex) : next;
        const path = allResults[index]?.path ?? null;
        return previous.index === index && previous.path === path ? previous : { index, path };
      });
    },
    [allResults, resultIndexByPath],
  );

  useEffect(() => {
    const path = allResults[selectedIndex]?.path ?? null;
    setSelection((previous) =>
      previous.index === selectedIndex && previous.path === path
        ? previous
        : { index: selectedIndex, path },
    );
  }, [allResults, selectedIndex]);

  useEffect(() => {
    if (isVisible) {
      setSelection({ index: 0, path: null });
    }
  }, [isVisible]);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.defaultPrevented || isComposingKeyboardEvent(event.nativeEvent)) return;
      if (event.key === KEY_ESCAPE || (event.key === KEY_K && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        onClose();
        return;
      }

      const totalItems = allResults.length;
      if (totalItems === 0) return;

      if (event.key === KEY_ARROW_DOWN) {
        event.preventDefault();
        setSelectedIndex((previousIndex) => (previousIndex + 1) % totalItems);
        return;
      }

      if (event.key === KEY_ARROW_UP) {
        event.preventDefault();
        setSelectedIndex((previousIndex) => (previousIndex - 1 + totalItems) % totalItems);
        return;
      }

      if (event.key === KEY_ENTER) {
        event.preventDefault();
        const selectedResult = allResults[selectedIndex] ?? allResults[0];
        if (selectedResult) {
          onSelect(selectedResult.path);
        }
      }
    },
    [allResults, onClose, onSelect, selectedIndex, setSelectedIndex],
  );

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!isVisible || !scrollContainerRef.current) return;

    const selectedElement = scrollContainerRef.current.querySelector(
      `[data-item-index="${selectedIndex}"]`,
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
    }
  }, [selectedIndex, isVisible, allResults]);

  return { selectedIndex, setSelectedIndex, scrollContainerRef, handleInputKeyDown };
};
