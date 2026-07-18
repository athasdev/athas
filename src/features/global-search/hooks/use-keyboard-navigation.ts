import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
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
import type { FileItem } from "../types/global-search.types";

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevResultsLengthRef = useRef(allResults.length);

  const allResultsRef = useRef(allResults);
  const onCloseRef = useRef(onClose);
  const onSelectRef = useRef(onSelect);
  const scrollToIndexRef = useRef(scrollToIndex);
  const previousResetKeyRef = useRef(resetKey);

  allResultsRef.current = allResults;
  onCloseRef.current = onClose;
  onSelectRef.current = onSelect;
  scrollToIndexRef.current = scrollToIndex;

  useEffect(() => {
    if (resetKey !== undefined && previousResetKeyRef.current !== resetKey) {
      setSelectedIndex(0);
      previousResetKeyRef.current = resetKey;
      prevResultsLengthRef.current = allResults.length;
      return;
    }

    if (resetKey === undefined && prevResultsLengthRef.current !== allResults.length) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex((current) =>
        allResults.length === 0 ? 0 : Math.min(current, allResults.length - 1),
      );
    }
    prevResultsLengthRef.current = allResults.length;
  }, [allResults.length, resetKey]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
      if (!isVisible || event.defaultPrevented) return;

      if (event.key === KEY_ESCAPE || (event.key === KEY_K && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const totalItems = allResultsRef.current.length;
      if (totalItems === 0) return;

      if (event.key === KEY_ARROW_DOWN) {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalItems);
      } else if (event.key === KEY_ARROW_UP) {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      } else if (event.key === KEY_ENTER) {
        event.preventDefault();
        setSelectedIndex((current) => {
          const item = allResultsRef.current[current];
          if (item) {
            onSelectRef.current(item.path);
          }
          return current;
        });
      }
    },
    [isVisible],
  );

  useEffect(() => {
    if (!isVisible || !listenGlobally) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, isVisible, listenGlobally]);

  useEffect(() => {
    if (!isVisible) return;

    if (scrollToIndexRef.current) {
      scrollToIndexRef.current(selectedIndex);
      return;
    }

    if (!scrollContainerRef.current) return;

    const selectedElement = scrollContainerRef.current.querySelector(
      `[data-item-index="${selectedIndex}"]`,
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    }
  }, [selectedIndex, isVisible]);

  return { selectedIndex, scrollContainerRef, handleKeyDown };
};
