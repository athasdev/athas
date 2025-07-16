import { useEffect, useMemo, useRef } from "react";
import { ContextCategoryView } from "./context-category-view";
import { ContextItemsView } from "./context-items-view";
import { getCategoryFromId, useContextSelectorStore } from "./context-selector-store";
import type { ContextItem, FileEntry } from "./types";

interface ContextSelectorProps {
  files: FileEntry[];
  onSelect: (item: ContextItem) => void;
  rootFolderPath?: string;
}

export function ContextSelector({ files, onSelect, rootFolderPath }: ContextSelectorProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    contextState,
    hideContextSelector,
    selectCategory,
    goBackToCategories,
    selectNext,
    selectPrevious,
    setSearchQuery,
    getCurrentItems,
    getCategories,
    setFiles,
    setRootPath,
  } = useContextSelectorStore();

  // Update providers when files change
  useEffect(() => {
    setFiles(files);
  }, [files, setFiles]);

  // Update git provider when root path changes
  useEffect(() => {
    if (rootFolderPath) {
      setRootPath(rootFolderPath);
    }
  }, [rootFolderPath, setRootPath]);

  // Calculate position and size
  const adjustedPosition = useMemo(() => {
    if (!contextState.isOpen) return { top: 0, left: 0, width: 0, height: 0 };

    const chatContainer = document.querySelector(".ai-chat-container") as HTMLElement;
    const containerWidth = chatContainer ? chatContainer.offsetWidth : 400;
    const dropdownWidth = Math.min(containerWidth * 0.9, 500);

    // Calculate height based on content
    const baseHeight = contextState.currentView === "categories" ? 220 : 320;
    const padding = 16;

    let { top, left } = contextState.position;

    // Ensure dropdown doesn't go off screen
    if (left < padding) {
      left = padding;
    }
    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }

    // Always position above the input, but use max height for items view
    const abovePosition = top - (contextState.currentView === "categories" ? baseHeight : 220);
    if (abovePosition >= padding) {
      top = abovePosition;
    } else {
      // If not enough space above, position below the input
      top = top + 40;
    }

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
      width: dropdownWidth,
      height: baseHeight,
    };
  }, [contextState.isOpen, contextState.position, contextState.currentView]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!contextState.isOpen) return;

      // Handle Ctrl+key shortcuts for categories
      if (e.ctrlKey && contextState.currentView === "categories") {
        const categoryMap: Record<string, string> = {
          f: "files",
          d: "docs",
          r: "rules",
          w: "web",
          t: "terminals",
          g: "git",
          e: "errors",
        };

        const categoryId = categoryMap[e.key.toLowerCase()];
        if (categoryId) {
          e.preventDefault();
          selectCategory(categoryId);
          return;
        }
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          selectNext();
          break;
        case "ArrowUp":
          e.preventDefault();
          selectPrevious();
          break;
        case "Enter":
          e.preventDefault();
          handleEnterKey();
          break;
        case "Escape":
          e.preventDefault();
          hideContextSelector();
          break;
        case "Backspace":
          if (contextState.currentView === "items" && contextState.searchQuery === "") {
            e.preventDefault();
            goBackToCategories();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    contextState,
    selectNext,
    selectPrevious,
    hideContextSelector,
    goBackToCategories,
    selectCategory,
  ]);

  // Handle Enter key based on current view
  const handleEnterKey = () => {
    if (contextState.currentView === "categories") {
      const categories = getCategories();
      const selectedCategory = categories[contextState.selectedIndex];
      if (selectedCategory) {
        selectCategory(selectedCategory.id);
      }
    } else {
      const items = getCurrentItems();
      const selectedItem = items[contextState.selectedIndex];
      if (selectedItem) {
        onSelect(selectedItem);
        hideContextSelector();
      }
    }
  };

  // Handle category selection
  const handleCategorySelect = (category: any) => {
    selectCategory(category.id);
  };

  // Handle item selection
  const handleItemSelect = (item: ContextItem) => {
    onSelect(item);
    hideContextSelector();
  };

  // Handle search change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  // Close on outside click
  useEffect(() => {
    if (!contextState.isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        hideContextSelector();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contextState.isOpen, hideContextSelector]);

  if (!contextState.isOpen) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="fixed z-[100] rounded-lg border border-border bg-primary-bg shadow-xl"
      style={{
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        width: adjustedPosition.width,
        maxHeight: adjustedPosition.height,
        overflowY: "auto",
        overflowX: "hidden",
        backdropFilter: "blur(8px)",
        animation: "fadeInUp 0.15s ease-out",
      }}
    >
      {contextState.currentView === "categories" ? (
        <ContextCategoryView
          categories={getCategories()}
          selectedIndex={contextState.selectedIndex}
          onCategorySelect={handleCategorySelect}
        />
      ) : (
        <ContextItemsView
          category={getCategoryFromId(contextState.selectedCategory!)!}
          items={getCurrentItems()}
          selectedIndex={contextState.selectedIndex}
          searchQuery={contextState.searchQuery}
          onItemSelect={handleItemSelect}
          onBack={goBackToCategories}
          onSearchChange={handleSearchChange}
        />
      )}
    </div>
  );
}
