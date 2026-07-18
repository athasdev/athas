import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  KEY_ARROW_DOWN,
  KEY_ARROW_UP,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_K,
} from "../constants/keyboard-keys";
import type { FileItem } from "../types/quick-open.types";

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedPathRef = useRef<string | null>(null);
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

  useEffect(() => {
    selectedPathRef.current = allResults[selectedIndex]?.path || null;
  }, [allResults, selectedIndex]);

  // Preserve selection as results change by matching selected path first,
  // then clamping to valid range as a fallback.
  useEffect(() => {
    setSelectedIndex((previousIndex) => {
      if (allResults.length === 0) {
        return 0;
      }

      const selectedPath = selectedPathRef.current;
      if (selectedPath) {
        const nextIndex = resultIndexByPath.get(selectedPath) ?? -1;
        if (nextIndex >= 0) {
          return nextIndex;
        }
      }

      return Math.min(previousIndex, allResults.length - 1);
    });
  }, [allResults, resultIndexByPath]);

  useEffect(() => {
    if (isVisible) {
      setSelectedIndex(0);
    }
  }, [isVisible]);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
    [allResults, onClose, onSelect, selectedIndex],
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
  }, [selectedIndex, isVisible]);

  return { selectedIndex, setSelectedIndex, scrollContainerRef, handleInputKeyDown };
};
