import { isComposingKeyboardEvent } from "@/utils/keyboard/is-composing-keyboard-event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";
import {
  KEY_ARROW_DOWN,
  KEY_ARROW_UP,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_K,
  KEY_TAB,
} from "../constants/keyboard-keys";

interface UseKeyboardNavigationProps<T extends { key: string }> {
  isVisible: boolean;
  allResults: readonly T[];
  onClose: () => void;
  onSelect: (item: T) => void;
  /** Tab and Shift+Tab move between sections when given. */
  onCycleSection?: (direction: 1 | -1) => void;
  /** Resets the selection to the first row whenever it changes, such as on a section switch. */
  resetKey?: string;
}

export const useKeyboardNavigation = <T extends { key: string }>({
  isVisible,
  allResults,
  onClose,
  onSelect,
  onCycleSection,
  resetKey,
}: UseKeyboardNavigationProps<T>) => {
  // The selection follows its row by key, so results arriving asynchronously and reordering the
  // list do not move it to a different row.
  const [selection, setSelection] = useState<{ index: number; key: string | null }>({
    index: 0,
    key: null,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resultIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>();
    for (let index = 0; index < allResults.length; index++) {
      const result = allResults[index];
      if (result) {
        indexByKey.set(result.key, index);
      }
    }
    return indexByKey;
  }, [allResults]);

  const selectedIndex =
    (selection.key ? resultIndexByKey.get(selection.key) : undefined) ??
    Math.min(selection.index, Math.max(0, allResults.length - 1));

  const setSelectedIndex = useCallback(
    (next: SetStateAction<number>) => {
      setSelection((previous) => {
        const currentIndex =
          (previous.key ? resultIndexByKey.get(previous.key) : undefined) ??
          Math.min(previous.index, Math.max(0, allResults.length - 1));
        const index = typeof next === "function" ? next(currentIndex) : next;
        const key = allResults[index]?.key ?? null;
        return previous.index === index && previous.key === key ? previous : { index, key };
      });
    },
    [allResults, resultIndexByKey],
  );

  useEffect(() => {
    const key = allResults[selectedIndex]?.key ?? null;
    setSelection((previous) =>
      previous.index === selectedIndex && previous.key === key
        ? previous
        : { index: selectedIndex, key },
    );
  }, [allResults, selectedIndex]);

  useEffect(() => {
    if (isVisible) {
      setSelection({ index: 0, key: null });
    }
  }, [isVisible, resetKey]);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.defaultPrevented || isComposingKeyboardEvent(event.nativeEvent)) return;
      if (event.key === KEY_ESCAPE || (event.key === KEY_K && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === KEY_TAB && onCycleSection && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onCycleSection(event.shiftKey ? -1 : 1);
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
          onSelect(selectedResult);
        }
      }
    },
    [allResults, onClose, onCycleSection, onSelect, selectedIndex, setSelectedIndex],
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
