import { isComposingKeyboardEvent } from "@/features/keymaps/utils/is-composing-keyboard-event";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  scrollToIndex?: (index: number) => void;
  listenGlobally?: boolean;
  resetKey?: string;
}

export const useKeyboardNavigation = ({
  isVisible,
  allResults,
  onClose,
  onSelect,
  scrollToIndex,
  listenGlobally = true,
  resetKey,
}: UseKeyboardNavigationProps) => {
  const [selection, setSelection] = useState<{
    index: number;
    path: string | null;
    resetKey?: string;
  }>({
    index: 0,
    path: null,
    resetKey,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resultIndexByPath = useMemo(
    () => new Map(allResults.map((item, index) => [item.path, index])),
    [allResults],
  );
  const resolveIndex = useCallback(
    (current: typeof selection) =>
      current.resetKey !== resetKey
        ? 0
        : ((current.path === null ? undefined : resultIndexByPath.get(current.path)) ??
          Math.min(current.index, Math.max(0, allResults.length - 1))),
    [allResults.length, resetKey, resultIndexByPath],
  );
  const selectedIndex = resolveIndex(selection);

  useEffect(() => {
    const path = allResults[selectedIndex]?.path ?? null;
    setSelection((previous) =>
      previous.index === selectedIndex && previous.path === path && previous.resetKey === resetKey
        ? previous
        : { index: selectedIndex, path, resetKey },
    );
  }, [allResults, resetKey, selectedIndex]);

  const moveSelection = useCallback(
    (direction: number) => {
      setSelection((previous) => {
        const index = (resolveIndex(previous) + direction + allResults.length) % allResults.length;
        return { index, path: allResults[index]?.path ?? null, resetKey };
      });
    },
    [allResults, resetKey, resolveIndex],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
      if (!isVisible || event.defaultPrevented) return;
      if (isComposingKeyboardEvent("nativeEvent" in event ? event.nativeEvent : event)) return;

      if (event.key === KEY_ESCAPE || (event.key === KEY_K && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const totalItems = allResults.length;
      if (totalItems === 0) return;

      if (event.key === KEY_ARROW_DOWN) {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === KEY_ARROW_UP) {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === KEY_ENTER) {
        event.preventDefault();
        const item = allResults[selectedIndex];
        if (item) onSelect(item.path);
      }
    },
    [allResults, isVisible, moveSelection, onClose, onSelect, selectedIndex],
  );

  useEffect(() => {
    if (!isVisible || !listenGlobally) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, isVisible, listenGlobally]);

  useEffect(() => {
    if (!isVisible) return;

    if (scrollToIndex) {
      scrollToIndex(selectedIndex);
      return;
    }

    if (!scrollContainerRef.current) return;

    const selectedElement = scrollContainerRef.current.querySelector(
      `[data-item-index="${selectedIndex}"]`,
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
    }
  }, [isVisible, scrollToIndex, selectedIndex]);

  return { selectedIndex, scrollContainerRef, handleKeyDown };
};
