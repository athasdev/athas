import { useEffect, useRef, useState } from "react";
import {
  KEY_ARROW_DOWN,
  KEY_ARROW_UP,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_K,
} from "../constants/keyboard-keys";
import type { FileItem } from "../models/types";

interface UseKeyboardNavigationProps {
  isVisible: boolean;
  allResults: FileItem[];
  onClose: () => void;
  onSelect: (path: string) => void;
  scrollToIndex?: (index: number) => void;
}

export const useKeyboardNavigation = ({
  isVisible,
  allResults,
  onClose,
  onSelect,
  scrollToIndex,
}: UseKeyboardNavigationProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevResultsLengthRef = useRef(allResults.length);

  const allResultsRef = useRef(allResults);
  const onCloseRef = useRef(onClose);
  const onSelectRef = useRef(onSelect);
  const scrollToIndexRef = useRef(scrollToIndex);

  allResultsRef.current = allResults;
  onCloseRef.current = onClose;
  onSelectRef.current = onSelect;
  scrollToIndexRef.current = scrollToIndex;

  // Reset selected index when results length changes
  useEffect(() => {
    if (prevResultsLengthRef.current !== allResults.length) {
      setSelectedIndex(0);
      prevResultsLengthRef.current = allResults.length;
    }
  }, [allResults.length]);

  // Handle keyboard events
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEY_ESCAPE || (e.key === KEY_K && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      const totalItems = allResultsRef.current.length;
      if (totalItems === 0) return;

      if (e.key === KEY_ARROW_DOWN) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalItems);
      } else if (e.key === KEY_ARROW_UP) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      } else if (e.key === KEY_ENTER) {
        e.preventDefault();
        setSelectedIndex((current) => {
          const item = allResultsRef.current[current];
          if (item) {
            onSelectRef.current(item.path);
          }
          return current;
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible]);

  // Auto-scroll selected item into view
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
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedIndex, isVisible]);

  return { selectedIndex, scrollContainerRef };
};
