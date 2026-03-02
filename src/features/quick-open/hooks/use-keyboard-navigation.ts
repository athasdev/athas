import { useEffect, useRef, useState } from "react";
import {
  KEY_ARROW_DOWN,
  KEY_ARROW_UP,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_K,
} from "../constants/keyboard-keys";
import type { FileItem } from "../types/quick-open";

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
        const nextIndex = allResults.findIndex((item) => item.path === selectedPath);
        if (nextIndex >= 0) {
          return nextIndex;
        }
      }

      return Math.min(previousIndex, allResults.length - 1);
    });
  }, [allResults]);

  useEffect(() => {
    if (isVisible) {
      setSelectedIndex(0);
    }
  }, [isVisible]);

  // Handle keyboard events
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape and Cmd+K/Ctrl+K to close
      if (e.key === KEY_ESCAPE || (e.key === KEY_K && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onClose();
        return;
      }

      const totalItems = allResults.length;
      if (totalItems === 0) return;

      // Handle navigation
      if (e.key === KEY_ARROW_DOWN) {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev + 1) % totalItems;
          return next;
        });
      } else if (e.key === KEY_ARROW_UP) {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev - 1 + totalItems) % totalItems;
          return next;
        });
      } else if (e.key === KEY_ENTER) {
        e.preventDefault();
        setSelectedIndex((current) => {
          if (allResults[current]) {
            onSelect(allResults[current].path);
          }
          return current;
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, allResults, onClose, onSelect]);

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

  return { selectedIndex, setSelectedIndex, scrollContainerRef };
};
